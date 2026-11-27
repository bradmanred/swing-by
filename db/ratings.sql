-- Parents' star ratings (worker/ratings.js). Lives in the photos database (PHOTOS_DB).
--   npx wrangler d1 execute swing-by-photos --remote --file db/ratings.sql
-- (and on swing-by-photos-preview for previews). Safe to run more than once. Already run on both databases (27 Nov 2026).
CREATE TABLE IF NOT EXISTS ratings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  park TEXT NOT NULL,        -- playground id, as in src/content/playgrounds/<id>.json
  reporter TEXT NOT NULL,    -- a random id remembered by the parent's browser (sb_parent cookie)
  conn TEXT NOT NULL,        -- a one-way hash of their internet connection, so one household counts once
  stars INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (park, reporter)
);
CREATE INDEX IF NOT EXISTS ratings_park ON ratings (park);
CREATE INDEX IF NOT EXISTS ratings_conn ON ratings (conn, created_at);
