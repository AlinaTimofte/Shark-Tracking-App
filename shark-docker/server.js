const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

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

const DEFAULT_ADMIN_PASSWORD = 'shark123';
const TOKEN_TTL_MS = 2 * 60 * 60 * 1000;

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
    const entry = {
        time: new Date().toISOString(),
        event,
        ip: req?.socket?.remoteAddress,
        user: req?.user?.username,
        ...details
    };
    fs.appendFileSync(AUDIT_FILE, `${JSON.stringify(entry)}\n`);
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
                auditLog: 'security_audit.log'
            });
        }

        if (req.method === 'GET' && pathname === '/api/sharks/full-data') {
            authenticate(req);
            const sharks = readSecretSharks();
            if (req.user?.role === 'admin') {
                audit('private_sharks_viewed', { count: sharks.length }, req);
                return sendJSON(res, 200, sharks.map((shark) => ({ ...shark, precision: 'admin-exact' })));
            }
            return sendJSON(res, 200, sharks.map(publicSharkView));
        }

        if (req.method === 'GET' && pathname === '/api/sightings/pending') {
            if (!requireAdmin(req, res)) return;
            const sightings = readJSON(SIGHTINGS_FILE, []);
            audit('pending_sightings_viewed', { count: sightings.length }, req);
            return sendJSON(res, 200, sightings.map(storedReportView));
        }

        if (req.method === 'POST' && pathname === '/api/login') {
            const { username, password } = await readBody(req);
            const users = readJSON(USERS_FILE, []);
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
            const { sharkIndex, newCoords } = await readBody(req);
            const coordsAreValid = Array.isArray(newCoords)
                && newCoords.length === 2
                && newCoords.every((value) => Number.isFinite(Number(value)));

            if (!Number.isInteger(sharkIndex) || !coordsAreValid) {
                return sendJSON(res, 400, { success: false, message: 'Invalid shark index or coordinates' });
            }

            const sharks = readSecretSharks();
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

            writeSecretSharks(sharks);
            audit('shark_moved', { sharkIndex, sharkName: sharks[sharkIndex].name }, req);
            return sendJSON(res, 200, { success: true, message: 'The shark has been updated' });
        }

        if (req.method === 'POST' && pathname === '/api/report') {
            const { description, coords, reporter } = await readBody(req);
            const coordsAreValid = Array.isArray(coords)
                && coords.length === 2
                && coords.every((value) => Number.isFinite(Number(value)));

            if (!description || !coordsAreValid) {
                return sendJSON(res, 400, { success: false, message: 'Description and coordinates are required' });
            }

            const report = {
                id: Date.now(),
                date: new Date().toLocaleDateString(),
                reporter: String(reporter || 'Anonymous').slice(0, 80),
                description: String(description).slice(0, 500),
                coords: coords.map(Number)
            };

            const sightings = readJSON(SIGHTINGS_FILE, []);
            sightings.push({
                report,
                signature: signReport(report),
                signatureAlgorithm: 'RSA-SHA256'
            });
            writeJSON(SIGHTINGS_FILE, sightings);
            audit('sighting_submitted', { reportId: report.id });

            return sendJSON(res, 200, { success: true, message: 'The report has been submitted and digitally signed' });
        }

        if (req.method === 'POST' && pathname === '/api/admin/approve-sighting') {
            if (!requireAdmin(req, res)) return;
            const { id } = await readBody(req);
            const sightings = readJSON(SIGHTINGS_FILE, []);
            const sharks = readSecretSharks();
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
            writeSecretSharks(sharks);
            writeJSON(SIGHTINGS_FILE, sightings);
            audit('sighting_approved', { reportId: id }, req);
            return sendJSON(res, 200, { success: true });
        }

        return sendJSON(res, 404, { success: false, message: 'API route not found' });
    } catch (err) {
        audit('api_error', { path: pathname, error: err.message }, req);
        return sendJSON(res, 500, { success: false, message: err.message });
    }
}

ensureUsers();
readSecretSharks();
if (!fs.existsSync(SIGHTINGS_FILE)) writeJSON(SIGHTINGS_FILE, []);

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

server.listen(port, () => {
    console.log(`Server active on http://localhost:${port}`);
    console.log('Security enabled: PBKDF2 login, signed tokens, AES-256-GCM shark storage, RSA report signatures');
});
