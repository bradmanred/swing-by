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

-- Things parents typed into "Something else?" because they weren't on the tick list. Never shown publicly; the
-- weekly tick-box review (scripts/other-equipment.mjs) uses the totals to suggest new tick boxes.
-- Added 24 October 2026 and already run on both databases.
CREATE TABLE IF NOT EXISTS equipment_other (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  park TEXT NOT NULL,
  reporter TEXT NOT NULL,    -- same sb_parent id as equipment_reports
  conn TEXT NOT NULL,        -- same connection hash as equipment_reports
  text TEXT NOT NULL,        -- what they typed, tidied, up to 40 characters
  norm TEXT NOT NULL,        -- lower-case grouping key, so "Rocking horses" and "rocking horse" count together
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (park, reporter, norm)
);
CREATE INDEX IF NOT EXISTS equipment_other_park ON equipment_other (park, reporter);
CREATE INDEX IF NOT EXISTS equipment_other_norm ON equipment_other (norm);
