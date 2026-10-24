-- What parents say a playground has (worker/equipment.js). Lives in the photos database (PHOTOS_DB).
--   npx wrangler d1 execute swing-by-photos --remote --file db/equipment.sql
-- (and on swing-by-photos-preview for previews). Safe to run more than once.
CREATE TABLE IF NOT EXISTS equipment_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  park TEXT NOT NULL,        -- playground id, as in src/content/playgrounds/<id>.json
  reporter TEXT NOT NULL,    -- a random id remembered by the parent's browser (sb_parent cookie)
  conn TEXT NOT NULL,        -- a one-way hash of their internet connection, so one household counts once
  item TEXT NOT NULL,        -- a code from src/data/labels.json (equipment, access or facilities), or 'open'
  present INTEGER NOT NULL,  -- 1 = it's there; for 'open', 0 = there's no public playground here
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (park, reporter, item)
);
CREATE INDEX IF NOT EXISTS equipment_reports_park ON equipment_reports (park);
CREATE INDEX IF NOT EXISTS equipment_reports_conn ON equipment_reports (conn, created_at);
