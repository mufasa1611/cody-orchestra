CREATE TABLE IF NOT EXISTS feedback (
  id TEXT PRIMARY KEY,
  install_id TEXT,
  display_name TEXT,
  email TEXT,
  message TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  retain_until INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS feedback_created_at_idx ON feedback (created_at);
CREATE INDEX IF NOT EXISTS feedback_retain_until_idx ON feedback (retain_until);
