ALTER TABLE challenge ADD COLUMN purpose TEXT NOT NULL DEFAULT 'installer';
ALTER TABLE registration ADD COLUMN purpose TEXT NOT NULL DEFAULT 'installer';
