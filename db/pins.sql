-- Where parents say a playground really is, when the pin is in the wrong place (worker/pins.js). Lives in the photos
-- database (PHOTOS_DB).
--   npx wrangler d1 execute swing-by-photos --remote --file db/pins.sql
-- (and on swing-by-photos-preview for previews). Safe to run more than once.
CREATE TABLE IF NOT EXISTS pin_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  park TEXT NOT NULL,        -- playground id, as in src/content/playgrounds/<id>.json
  reporter TEXT NOT NULL,    -- a random id remembered by the parent's browser (sb_pin cookie)
  conn TEXT NOT NULL,        -- a one-way hash of their internet connection, so one household counts once
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (park, reporter)
);
CREATE INDEX IF NOT EXISTS pin_reports_park ON pin_reports (park);
CREATE INDEX IF NOT EXISTS pin_reports_conn ON pin_reports (conn, created_at);
