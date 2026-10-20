-- Parent photos (D1 database swing-by-photos, bound to the Worker as PHOTOS_DB; previews use swing-by-photos-preview).
-- Already created on Cloudflare. To recreate it: npx wrangler d1 execute <database name> --remote --file db/photos.sql
CREATE TABLE IF NOT EXISTS photos (
  id TEXT PRIMARY KEY,
  park TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'reported')),
  credit TEXT,
  mime TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  bytes INTEGER NOT NULL,
  image BLOB NOT NULL,
  uploader TEXT NOT NULL, -- one-way hash of IP address and date, only used to limit uploads
  report_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  reviewed_at TEXT
);
CREATE INDEX IF NOT EXISTS photos_park ON photos (park, status);
CREATE INDEX IF NOT EXISTS photos_uploader ON photos (uploader, created_at);
CREATE INDEX IF NOT EXISTS photos_status ON photos (status, created_at);
