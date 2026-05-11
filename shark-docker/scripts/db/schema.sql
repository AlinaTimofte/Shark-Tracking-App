CREATE TABLE IF NOT EXISTS app_users (
    username TEXT PRIMARY KEY,
    role TEXT NOT NULL,
    password JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sharks (
    id SERIAL PRIMARY KEY,
    source_key TEXT UNIQUE NOT NULL,
    encrypted_payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sightings (
    report_id BIGINT PRIMARY KEY,
    report JSONB NOT NULL,
    signature TEXT NOT NULL,
    signature_algorithm TEXT NOT NULL DEFAULT 'RSA-SHA256',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_events (
    id BIGSERIAL PRIMARY KEY,
    event TEXT NOT NULL,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    ip TEXT,
    username TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_events_event ON audit_events(event);
CREATE INDEX IF NOT EXISTS idx_audit_events_created_at ON audit_events(created_at);
