import type { Bindings } from "./types"

const schema = `
CREATE TABLE IF NOT EXISTS challenge (
  id TEXT PRIMARY KEY,
  install_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  email TEXT NOT NULL,
  email_hash TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  installer_version TEXT NOT NULL,
  platform TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  last_sent_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  verified_at INTEGER
);
CREATE INDEX IF NOT EXISTS challenge_email_hash_created_idx ON challenge (email_hash, created_at);
CREATE INDEX IF NOT EXISTS challenge_expires_idx ON challenge (expires_at);
CREATE TABLE IF NOT EXISTS registration (
  install_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  email TEXT NOT NULL,
  email_verified_at INTEGER NOT NULL,
  installer_version TEXT NOT NULL,
  platform TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  retain_until INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS registration_retain_until_idx ON registration (retain_until);
CREATE TABLE IF NOT EXISTS receipt (
  id TEXT PRIMARY KEY,
  install_id TEXT NOT NULL,
  issued_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_validated_at INTEGER,
  revoked_at INTEGER,
  FOREIGN KEY (install_id) REFERENCES registration (install_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS receipt_install_idx ON receipt (install_id);
CREATE INDEX IF NOT EXISTS receipt_expires_idx ON receipt (expires_at);
CREATE TABLE IF NOT EXISTS revocation (
  receipt_id TEXT PRIMARY KEY,
  install_id TEXT NOT NULL,
  revoked_at INTEGER NOT NULL,
  retain_until INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS revocation_retain_until_idx ON revocation (retain_until);
CREATE TABLE IF NOT EXISTS send_event (
  id TEXT PRIMARY KEY,
  email_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS send_event_email_created_idx ON send_event (email_hash, created_at);
`

export async function ensureSchema(db: D1Database) {
  await db.batch(
    schema
      .split(";")
      .map((statement) => statement.trim())
      .filter(Boolean)
      .map((statement) => db.prepare(statement)),
  )
}

export async function cleanup(db: D1Database, now = Date.now()) {
  await ensureSchema(db)
  const unverifiedChallengeCutoff = now - 60 * 60 * 1000
  const verifiedChallengeCutoff = now - 24 * 60 * 60 * 1000
  const sendCutoff = now - 2 * 60 * 60 * 1000
  return db.batch([
    db
      .prepare("DELETE FROM challenge WHERE verified_at IS NULL AND created_at < ?")
      .bind(unverifiedChallengeCutoff),
    db
      .prepare("DELETE FROM challenge WHERE verified_at IS NOT NULL AND verified_at < ?")
      .bind(verifiedChallengeCutoff),
    db.prepare("DELETE FROM send_event WHERE created_at < ?").bind(sendCutoff),
    db.prepare("DELETE FROM receipt WHERE expires_at < ?").bind(now),
    db.prepare("DELETE FROM registration WHERE retain_until < ?").bind(now),
    db.prepare("DELETE FROM revocation WHERE retain_until < ?").bind(now),
  ])
}

export function database(env: Bindings) {
  return env.InstallerVerificationDatabase
}
