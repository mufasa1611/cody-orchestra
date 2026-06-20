ALTER TABLE registration ADD COLUMN machine_id TEXT;
ALTER TABLE challenge ADD COLUMN machine_id TEXT;

CREATE TABLE IF NOT EXISTS banned_machine (
  id TEXT PRIMARY KEY,
  machine_id TEXT NOT NULL UNIQUE,
  reason TEXT,
  banned_by TEXT,
  created_at INTEGER NOT NULL,
  retain_until INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS banned_machine_machine_id_idx ON banned_machine (machine_id);
CREATE INDEX IF NOT EXISTS banned_machine_retain_until_idx ON banned_machine (retain_until);
