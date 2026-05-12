const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let Pool = null;
try {
    ({ Pool } = require('pg'));
} catch (err) {
    Pool = null;
}

const port = 3000;
const DATA_DIR = __dirname;
const PUBLIC_DIR = path.join(DATA_DIR, 'public');
const RUNTIME_DIR = process.env.SHARK_RUNTIME_DIR
    ? path.resolve(process.env.SHARK_RUNTIME_DIR)
    : path.join(DATA_DIR, 'runtime');
const SECURITY_DIR = path.join(RUNTIME_DIR, '.security');
const KEYS_DIR = path.join(RUNTIME_DIR, 'keys');

const PUBLIC_SHARKS_FILE = path.join(DATA_DIR, 'public_sharks.json');
const SECRET_SHARKS_FILE = path.join(RUNTIME_DIR, 'secret_sharks.enc');
const LEGACY_SECRET_SHARKS_FILE = path.join(DATA_DIR, 'secret_sharks.json');
const SIGHTINGS_FILE = path.join(RUNTIME_DIR, 'sightings.json');
const USERS_FILE = path.join(RUNTIME_DIR, 'users.json');
const SECRETS_FILE = path.join(SECURITY_DIR, 'secrets.json');
const AUDIT_FILE = path.join(RUNTIME_DIR, 'security_audit.log');
const PRIVATE_KEY_FILE = path.join(KEYS_DIR, 'private.pem');
const PUBLIC_KEY_FILE = path.join(KEYS_DIR, 'public.pem');
const DB_SCHEMA_FILE = path.join(DATA_DIR, 'scripts', 'db', 'schema.sql');

const DEFAULT_ADMIN_PASSWORD = 'shark123';
const TOKEN_TTL_MS = 2 * 60 * 60 * 1000;
const SAFE_COUNT_TABLES = new Set(['app_users', 'sharks', 'sightings', 'audit_events']);
const SQL_INJECTION_PATTERNS = [
    /(--|#|\/\*|\*\/)/,
    /;\s*(drop|delete|insert|update|alter|create|truncate)\b/i,
    /\bunion\s+select\b/i,
    /\bselect\b.+\bfrom\b/i,
    /\bor\b\s+(['"]?\w+['"]?\s*=\s*['"]?\w+|\d+\s*=\s*\d+)/i,
    /\band\b\s+(['"]?\w+['"]?\s*=\s*['"]?\w+|\d+\s*=\s*\d+)/i,
    /\b(drop|alter|truncate)\s+table\b/i
];
const database = {
    pool: null,
    available: false
};

function hasDatabaseConfig() {
    return Boolean(
        process.env.DATABASE_URL
        || process.env.PGHOST
        || process.env.PGDATABASE
        || process.env.PGUSER
        || process.env.PGPASSWORD
    );
}

function ensureDir(dir) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readJSON(file, fallback = []) {
    if (!fs.existsSync(file)) return fallback;
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (err) {
        audit('json_read_failed', { file: path.basename(file), error: err.message });
        return fallback;
    }
}

function writeJSON(file, data) {
    fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

function audit(event, details = {}, req = null) {
    ensureDir(RUNTIME_DIR);
    const entry = {
        time: new Date().toISOString(),
        event,
        ip: req?.socket?.remoteAddress,
        user: req?.user?.username,
        ...details
    };
    fs.appendFileSync(AUDIT_FILE, `${JSON.stringify(entry)}\n`);

    if (database.available) {
        database.pool.query(
            'INSERT INTO audit_events (event, details, ip, username) VALUES ($1, $2, $3, $4)',
            [event, details, req?.socket?.remoteAddress || null, req?.user?.username || null]
        ).catch((err) => {
            fs.appendFileSync(AUDIT_FILE, `${JSON.stringify({
                time: new Date().toISOString(),
                event: 'audit_db_write_failed',
                error: err.message
            })}\n`);
        });
    }
}

function dbConfig() {
    if (process.env.DATABASE_URL) {
        return { connectionString: process.env.DATABASE_URL };
    }

    return {
        host: process.env.PGHOST || 'localhost',
        port: Number(process.env.PGPORT || 5432),
        database: process.env.PGDATABASE || 'shark_tracker',
        user: process.env.PGUSER || process.env.USER || 'postgres',
        password: process.env.PGPASSWORD || undefined
    };
}

function slug(value) {
    return String(value || 'item')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 48) || 'item';
}

function sharkSourceKey(shark, index) {
    return `shark-${index + 1}-${slug(shark.name || shark.tag)}`;
}

function normalizeText(value, maxLength) {
    return String(value || '')
        .replace(/[\u0000-\u001f\u007f]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, maxLength);
}

function findSqlInjectionAttempt(value, location = 'body') {
    if (typeof value === 'string') {
        const match = SQL_INJECTION_PATTERNS.find((pattern) => pattern.test(value));
        return match ? { location, value: value.slice(0, 120), pattern: match.toString() } : null;
    }

    if (Array.isArray(value)) {
        for (let index = 0; index < value.length; index++) {
            const result = findSqlInjectionAttempt(value[index], `${location}[${index}]`);
            if (result) return result;
        }
    }

    if (value && typeof value === 'object') {
        for (const [key, nestedValue] of Object.entries(value)) {
            const result = findSqlInjectionAttempt(nestedValue, `${location}.${key}`);
            if (result) return result;
        }
    }

    return null;
}

function rejectSqlInjectionAttempt(req, res, payload) {
    const attempt = findSqlInjectionAttempt(payload);
    if (!attempt) return false;

    audit('sql_injection_attempt_blocked', attempt, req);
    sendJSON(res, 400, {
        success: false,
        message: 'Invalid input detected'
    });
    return true;
}

function isValidUsername(username) {
    return /^[a-zA-Z0-9_.-]{1,64}$/.test(username);
}

function assertSafeCountTable(tableName) {
    if (!SAFE_COUNT_TABLES.has(tableName)) {
        throw new Error(`Unsafe table name rejected: ${tableName}`);
    }
    return tableName;
}

function canonicalJSON(value) {
    if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(',')}]`;
    if (value && typeof value === 'object') {
        return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJSON(value[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
}

function loadSecrets() {
    ensureDir(RUNTIME_DIR);
    ensureDir(SECURITY_DIR);
    if (process.env.JWT_SECRET && process.env.ENCRYPTION_KEY) {
        return {
            jwtSecret: process.env.JWT_SECRET,
            encryptionKey: process.env.ENCRYPTION_KEY
        };
    }

    if (!fs.existsSync(SECRETS_FILE)) {
        writeJSON(SECRETS_FILE, {
            jwtSecret: crypto.randomBytes(32).toString('base64'),
            encryptionKey: crypto.randomBytes(32).toString('base64')
        });
    }
    return readJSON(SECRETS_FILE, {});
}

function ensureKeys() {
    ensureDir(KEYS_DIR);
    if (fs.existsSync(PRIVATE_KEY_FILE) && fs.existsSync(PUBLIC_KEY_FILE)) return;

    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    });

    fs.writeFileSync(PRIVATE_KEY_FILE, privateKey);
    fs.writeFileSync(PUBLIC_KEY_FILE, publicKey);
    audit('rsa_keys_generated', { modulusLength: 2048 });
}

const secrets = loadSecrets();
ensureKeys();

function hashPassword(password, salt = crypto.randomBytes(16).toString('base64')) {
    const hash = crypto.pbkdf2Sync(password, salt, 210000, 32, 'sha256').toString('base64');
    return { algorithm: 'pbkdf2-sha256', iterations: 210000, salt, hash };
}

function verifyPassword(password, stored) {
    const attempted = crypto.pbkdf2Sync(password, stored.salt, stored.iterations, 32, 'sha256');
    const expected = Buffer.from(stored.hash, 'base64');
    return expected.length === attempted.length && crypto.timingSafeEqual(expected, attempted);
}

function ensureUsers() {
    ensureDir(RUNTIME_DIR);
    if (fs.existsSync(USERS_FILE)) return;
    writeJSON(USERS_FILE, [{
        username: 'admin',
        role: 'admin',
        password: hashPassword(DEFAULT_ADMIN_PASSWORD)
    }]);
    audit('default_admin_created', { username: 'admin' });
}

function base64url(input) {
    return Buffer.from(input).toString('base64url');
}

function parseBase64url(input) {
    return Buffer.from(input, 'base64url').toString('utf8');
}

function signToken(payload) {
    const header = { alg: 'HS256', typ: 'JWT' };
    const body = { ...payload, exp: Date.now() + TOKEN_TTL_MS };
    const encodedHeader = base64url(JSON.stringify(header));
    const encodedBody = base64url(JSON.stringify(body));
    const signature = crypto
        .createHmac('sha256', Buffer.from(secrets.jwtSecret, 'base64'))
        .update(`${encodedHeader}.${encodedBody}`)
        .digest('base64url');
    return `${encodedHeader}.${encodedBody}.${signature}`;
}

function verifyToken(token) {
    const parts = token?.split('.');
    if (!parts || parts.length !== 3) return null;

    const [encodedHeader, encodedBody, signature] = parts;
    const expected = crypto
        .createHmac('sha256', Buffer.from(secrets.jwtSecret, 'base64'))
        .update(`${encodedHeader}.${encodedBody}`)
        .digest('base64url');

    const received = Buffer.from(signature);
    const calculated = Buffer.from(expected);
    if (received.length !== calculated.length || !crypto.timingSafeEqual(received, calculated)) return null;

    const payload = JSON.parse(parseBase64url(encodedBody));
    if (payload.exp < Date.now()) return null;
    return payload;
}

function authenticate(req) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    const payload = token ? verifyToken(token) : null;
    if (payload) req.user = payload;
    return payload;
}

function requireAdmin(req, res) {
    authenticate(req);
    if (req.user?.role === 'admin') return true;
    audit('admin_access_denied', { path: req.url }, req);
    sendJSON(res, 401, { success: false, message: 'Admin authentication required' });
    return false;
}

function encryptJSON(data) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(secrets.encryptionKey, 'base64'), iv);
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(data), 'utf8'), cipher.final()]);
    return {
        algorithm: 'aes-256-gcm',
        iv: iv.toString('base64'),
        tag: cipher.getAuthTag().toString('base64'),
        ciphertext: ciphertext.toString('base64')
    };
}

function decryptJSON(envelope) {
    const decipher = crypto.createDecipheriv(
        'aes-256-gcm',
        Buffer.from(secrets.encryptionKey, 'base64'),
        Buffer.from(envelope.iv, 'base64')
    );
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
    const plaintext = Buffer.concat([
        decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
        decipher.final()
    ]);
    return JSON.parse(plaintext.toString('utf8'));
}

function approximateCoord(value) {
    return Math.round(value * 2) / 2;
}

function publicSharkView(shark) {
    const coords = shark.coords ? shark.coords.map(approximateCoord) : shark.coords;
    const history = shark.history ? shark.history.map((point) => point.map(approximateCoord)) : undefined;
    return { ...shark, coords, history, precision: 'public-approximate' };
}

function readSecretSharks() {
    ensureDir(RUNTIME_DIR);
    if (fs.existsSync(SECRET_SHARKS_FILE)) return decryptJSON(readJSON(SECRET_SHARKS_FILE, {}));

    if (fs.existsSync(LEGACY_SECRET_SHARKS_FILE)) {
        const legacy = readJSON(LEGACY_SECRET_SHARKS_FILE, []);
        writeSecretSharks(legacy);
        audit('legacy_secret_sharks_encrypted');
        return legacy;
    }

    const initial = readJSON(PUBLIC_SHARKS_FILE, []).map((shark) => ({
        ...shark,
        history: shark.history || [shark.coords]
    }));
    writeSecretSharks(initial);
    audit('encrypted_shark_store_initialized', { count: initial.length });
    return initial;
}

function writeSecretSharks(sharks) {
    ensureDir(RUNTIME_DIR);
    writeJSON(SECRET_SHARKS_FILE, encryptJSON(sharks));
}

async function initDatabase() {
    if (!Pool || process.env.DISABLE_POSTGRES === 'true' || !hasDatabaseConfig()) {
        audit('database_disabled_or_driver_missing', {
            hasPgDriver: Boolean(Pool),
            hasDatabaseConfig: hasDatabaseConfig()
        });
        return;
    }

    const pool = new Pool(dbConfig());
    try {
        let lastError = null;
        for (let attempt = 1; attempt <= 10; attempt++) {
            try {
                await pool.query('SELECT 1');
                lastError = null;
                break;
            } catch (err) {
                lastError = err;
                await new Promise((resolve) => setTimeout(resolve, 1000));
            }
        }
        if (lastError) throw lastError;

        const schema = fs.readFileSync(DB_SCHEMA_FILE, 'utf8');
        await pool.query(schema);
        database.pool = pool;
        database.available = true;
        await seedDatabaseFromRuntimeFiles();
        audit('database_connected');
    } catch (err) {
        await pool.end().catch(() => {});
        database.pool = null;
        database.available = false;
        audit('database_unavailable_using_json_fallback', { error: err.message });
    }
}

async function tableCount(tableName) {
    const safeTableName = assertSafeCountTable(tableName);
    const result = await database.pool.query(`SELECT COUNT(*)::int AS count FROM ${safeTableName}`);
    return result.rows[0].count;
}

async function seedDatabaseFromRuntimeFiles() {
    if (!database.available) return;

    if (await tableCount('app_users') === 0) {
        const users = readJSON(USERS_FILE, []);
        for (const user of users) {
            await database.pool.query(
                'INSERT INTO app_users (username, role, password) VALUES ($1, $2, $3) ON CONFLICT (username) DO NOTHING',
                [user.username, user.role, user.password]
            );
        }
        audit('database_seeded_users', { count: users.length });
    }

    if (await tableCount('sharks') === 0) {
        const sharks = readSecretSharks();
        for (const [index, shark] of sharks.entries()) {
            await database.pool.query(
                'INSERT INTO sharks (source_key, encrypted_payload) VALUES ($1, $2) ON CONFLICT (source_key) DO NOTHING',
                [sharkSourceKey(shark, index), encryptJSON(shark)]
            );
        }
        audit('database_seeded_sharks', { count: sharks.length });
    }

    if (await tableCount('sightings') === 0) {
        const sightings = readJSON(SIGHTINGS_FILE, []);
        for (const item of sightings) {
            await database.pool.query(
                `INSERT INTO sightings (report_id, report, signature, signature_algorithm)
                 VALUES ($1, $2, $3, $4)
                 ON CONFLICT (report_id) DO NOTHING`,
                [item.report.id, item.report, item.signature, item.signatureAlgorithm || 'RSA-SHA256']
            );
        }
        audit('database_seeded_sightings', { count: sightings.length });
    }
}

async function readUsers() {
    if (!database.available) return readJSON(USERS_FILE, []);
    const result = await database.pool.query('SELECT username, role, password FROM app_users ORDER BY username');
    return result.rows.map((row) => ({
        username: row.username,
        role: row.role,
        password: row.password
    }));
}

async function readSharks() {
    if (!database.available) return readSecretSharks();
    const result = await database.pool.query('SELECT encrypted_payload FROM sharks ORDER BY id');
    return result.rows.map((row) => decryptJSON(row.encrypted_payload));
}

async function writeSharks(sharks) {
    writeSecretSharks(sharks);

    if (!database.available) return;
    const client = await database.pool.connect();
    try {
        await client.query('BEGIN');
        await client.query('DELETE FROM sharks');
        for (const [index, shark] of sharks.entries()) {
            await client.query(
                'INSERT INTO sharks (source_key, encrypted_payload) VALUES ($1, $2)',
                [sharkSourceKey(shark, index), encryptJSON(shark)]
            );
        }
        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

async function readSightings() {
    if (!database.available) return readJSON(SIGHTINGS_FILE, []);
    const result = await database.pool.query(
        'SELECT report, signature, signature_algorithm FROM sightings ORDER BY created_at, report_id'
    );
    return result.rows.map((row) => ({
        report: row.report,
        signature: row.signature,
        signatureAlgorithm: row.signature_algorithm
    }));
}

async function writeSightings(sightings) {
    writeJSON(SIGHTINGS_FILE, sightings);

    if (!database.available) return;
    const client = await database.pool.connect();
    try {
        await client.query('BEGIN');
        await client.query('DELETE FROM sightings');
        for (const item of sightings) {
            await client.query(
                `INSERT INTO sightings (report_id, report, signature, signature_algorithm)
                 VALUES ($1, $2, $3, $4)`,
                [item.report.id, item.report, item.signature, item.signatureAlgorithm || 'RSA-SHA256']
            );
        }
        await client.query('COMMIT');
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

function signReport(report) {
    return crypto
        .sign('sha256', Buffer.from(canonicalJSON(report)), fs.readFileSync(PRIVATE_KEY_FILE, 'utf8'))
        .toString('base64');
}

function verifyReport(report, signature) {
    return crypto.verify(
        'sha256',
        Buffer.from(canonicalJSON(report)),
        fs.readFileSync(PUBLIC_KEY_FILE, 'utf8'),
        Buffer.from(signature, 'base64')
    );
}

function storedReportView(item) {
    const validSignature = verifyReport(item.report, item.signature);
    return { ...item.report, signature: item.signature, validSignature };
}

function sendJSON(res, statusCode, data) {
    const body = JSON.stringify(data);
    res.writeHead(statusCode, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
    });
    res.end(body);
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', (chunk) => {
            body += chunk;
            if (body.length > 1_000_000) {
                reject(new Error('Request body too large'));
                req.destroy();
            }
        });
        req.on('end', () => {
            if (!body) return resolve({});
            try {
                resolve(JSON.parse(body));
            } catch (err) {
                reject(new Error('Invalid JSON body'));
            }
        });
    });
}

function serveStatic(req, res, pathname) {
    const requested = pathname === '/' ? '/index.html' : pathname;
    const filePath = path.normalize(path.join(PUBLIC_DIR, requested));

    if (!filePath.startsWith(PUBLIC_DIR) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
        return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentTypes = {
        '.html': 'text/html',
        '.css': 'text/css',
        '.js': 'application/javascript',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png'
    };

    res.writeHead(200, { 'Content-Type': contentTypes[ext] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
}

async function handleApi(req, res, pathname) {
    try {
        if (req.method === 'GET' && pathname === '/api/security/status') {
            authenticate(req);
            return sendJSON(res, 200, {
                authenticated: req.user?.role === 'admin',
                encryption: 'AES-256-GCM',
                reportIntegrity: 'RSA-SHA256 signatures',
                passwordStorage: 'PBKDF2-SHA256 salted hashes',
                sqlInjectionProtection: 'parameterized queries and input validation',
                auditLog: 'security_audit.log',
                database: database.available ? 'postgres' : 'json-fallback'
            });
        }

        if (req.method === 'GET' && pathname === '/api/sharks/full-data') {
            authenticate(req);
            const sharks = await readSharks();
            if (req.user?.role === 'admin') {
                audit('private_sharks_viewed', { count: sharks.length }, req);
                return sendJSON(res, 200, sharks.map((shark) => ({ ...shark, precision: 'admin-exact' })));
            }
            return sendJSON(res, 200, sharks.map(publicSharkView));
        }

        if (req.method === 'GET' && pathname === '/api/sightings/pending') {
            if (!requireAdmin(req, res)) return;
            const sightings = await readSightings();
            audit('pending_sightings_viewed', { count: sightings.length }, req);
            return sendJSON(res, 200, sightings.map(storedReportView));
        }

        if (req.method === 'POST' && pathname === '/api/login') {
            const body = await readBody(req);
            if (rejectSqlInjectionAttempt(req, res, body)) return;

            const username = normalizeText(body.username, 64);
            const password = String(body.password || '');
            if (!isValidUsername(username)) {
                audit('invalid_username_rejected', { username }, req);
                return sendJSON(res, 400, { success: false, message: 'Invalid username format' });
            }

            const users = await readUsers();
            const user = users.find((candidate) => candidate.username === username);

            if (!user || !verifyPassword(password || '', user.password)) {
                audit('login_failed', { username }, req);
                return sendJSON(res, 401, { success: false, message: 'Wrong username or password' });
            }

            const token = signToken({ username: user.username, role: user.role });
            audit('login_success', { username: user.username }, req);
            return sendJSON(res, 200, { success: true, token, role: user.role });
        }

        if (req.method === 'POST' && pathname === '/api/logout') {
            if (!requireAdmin(req, res)) return;
            audit('logout', {}, req);
            return sendJSON(res, 200, { success: true });
        }

        if (req.method === 'POST' && pathname === '/api/admin/move-shark') {
            if (!requireAdmin(req, res)) return;
            const body = await readBody(req);
            if (rejectSqlInjectionAttempt(req, res, body)) return;

            const { sharkIndex, newCoords } = body;
            const coordsAreValid = Array.isArray(newCoords)
                && newCoords.length === 2
                && newCoords.every((value) => Number.isFinite(Number(value)));

            if (!Number.isInteger(sharkIndex) || !coordsAreValid) {
                return sendJSON(res, 400, { success: false, message: 'Invalid shark index or coordinates' });
            }

            const sharks = await readSharks();
            if (!sharks[sharkIndex]) {
                return sendJSON(res, 404, { success: false, message: 'Shark not found' });
            }

            const parsedCoords = newCoords.map(Number);
            sharks[sharkIndex].coords = parsedCoords;
            if (!sharks[sharkIndex].history) sharks[sharkIndex].history = [];
            sharks[sharkIndex].history.push(parsedCoords);
            sharks[sharkIndex].latestPing = new Date().toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric'
            });

            await writeSharks(sharks);
            audit('shark_moved', { sharkIndex, sharkName: sharks[sharkIndex].name }, req);
            return sendJSON(res, 200, { success: true, message: 'The shark has been updated' });
        }

        if (req.method === 'POST' && pathname === '/api/report') {
            const body = await readBody(req);
            if (rejectSqlInjectionAttempt(req, res, body)) return;

            const { coords } = body;
            const coordsAreValid = Array.isArray(coords)
                && coords.length === 2
                && coords.every((value) => Number.isFinite(Number(value)));

            const reporter = normalizeText(body.reporter || 'Anonymous', 80);
            const description = normalizeText(body.description, 500);

            if (!description || !coordsAreValid) {
                return sendJSON(res, 400, { success: false, message: 'Description and coordinates are required' });
            }

            const report = {
                id: Date.now(),
                date: new Date().toLocaleDateString(),
                reporter,
                description,
                coords: coords.map(Number)
            };

            const sightings = await readSightings();
            sightings.push({
                report,
                signature: signReport(report),
                signatureAlgorithm: 'RSA-SHA256'
            });
            await writeSightings(sightings);
            audit('sighting_submitted', { reportId: report.id });

            return sendJSON(res, 200, { success: true, message: 'The report has been submitted and digitally signed' });
        }

        if (req.method === 'POST' && pathname === '/api/admin/approve-sighting') {
            if (!requireAdmin(req, res)) return;
            const body = await readBody(req);
            if (rejectSqlInjectionAttempt(req, res, body)) return;

            const { id } = body;
            if (!Number.isInteger(id)) {
                return sendJSON(res, 400, { success: false, message: 'Invalid report id' });
            }

            const sightings = await readSightings();
            const sharks = await readSharks();
            const index = sightings.findIndex((item) => item.report.id === id);

            if (index === -1) {
                return sendJSON(res, 404, { success: false, message: 'Report not found' });
            }

            const signedReport = sightings[index];
            if (!verifyReport(signedReport.report, signedReport.signature)) {
                audit('sighting_signature_rejected', { reportId: id }, req);
                return sendJSON(res, 400, { success: false, message: 'Digital signature verification failed' });
            }

            const report = signedReport.report;
            sharks.push({
                tag: 'Community',
                name: 'Verified Community Sighting',
                description: report.description,
                type: 'Unknown',
                length: '?',
                weight: '?',
                zone: 'User Reported',
                img: 'images/placeholder_shark.jpg',
                coords: report.coords,
                firstPing: report.date,
                latestPing: report.date,
                history: [report.coords],
                isUserReport: true
            });

            sightings.splice(index, 1);
            await writeSharks(sharks);
            await writeSightings(sightings);
            audit('sighting_approved', { reportId: id }, req);
            return sendJSON(res, 200, { success: true });
        }

        return sendJSON(res, 404, { success: false, message: 'API route not found' });
    } catch (err) {
        audit('api_error', { path: pathname, error: err.message }, req);
        return sendJSON(res, 500, { success: false, message: err.message });
    }
}

const server = http.createServer((req, res) => {
    const { pathname } = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === 'OPTIONS') {
        return sendJSON(res, 200, { success: true });
    }

    if (pathname.startsWith('/api/')) {
        return handleApi(req, res, pathname);
    }

    return serveStatic(req, res, pathname);
});

server.on('error', (err) => {
    console.error(`Server failed to start: ${err.message}`);
    process.exit(1);
});

async function start() {
    ensureUsers();
    readSecretSharks();
    if (!fs.existsSync(SIGHTINGS_FILE)) writeJSON(SIGHTINGS_FILE, []);
    await initDatabase();

    server.listen(port, () => {
        console.log(`Server active on http://localhost:${port}`);
        console.log('Security enabled: PBKDF2 login, signed tokens, AES-256-GCM shark storage, RSA report signatures');
        console.log(`Storage mode: ${database.available ? 'PostgreSQL' : 'runtime JSON fallback'}`);
    });
}

start().catch((err) => {
    console.error(`Startup failed: ${err.message}`);
    process.exit(1);
});
