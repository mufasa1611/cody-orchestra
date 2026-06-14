CREATE TABLE IF NOT EXISTS remote_command (
  id TEXT PRIMARY KEY,
  install_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('uninstall')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','acknowledged','completed','failed')),
  created_at INTEGER NOT NULL,
  acknowledged_at INTEGER,
  completed_at INTEGER,
  retain_until INTEGER NOT NULL,
  FOREIGN KEY (install_id) REFERENCES registration (install_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS remote_command_install_status_idx ON remote_command (install_id, status);
CREATE INDEX IF NOT EXISTS remote_command_retain_until_idx ON remote_command (retain_until);
