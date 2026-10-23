-- Already run on both databases on 24 October 2026.
-- Adds openly licensed photos found on Geograph and Wikimedia Commons to the photos table, and records which
-- playgrounds the weekly photo search has looked at. Safe to run once on the existing database:
--   npx wrangler d1 execute swing-by-photos --remote --file db/photos-sources.sql
-- (and on swing-by-photos-preview for previews).
ALTER TABLE photos ADD COLUMN source TEXT NOT NULL DEFAULT 'parent'; -- parent | geograph | commons
ALTER TABLE photos ADD COLUMN source_url TEXT;  -- the photo's own page, for the credit link and to avoid suggesting it twice
ALTER TABLE photos ADD COLUMN licence TEXT;     -- e.g. CC BY-SA 2.0
ALTER TABLE photos ADD COLUMN author TEXT;      -- the photographer, as the source credits them
ALTER TABLE photos ADD COLUMN title TEXT;       -- the photo's title at the source, to help moderators
ALTER TABLE photos ADD COLUMN distance_m INTEGER; -- how far the photo was taken from the playground pin
CREATE UNIQUE INDEX IF NOT EXISTS photos_source_url ON photos (source_url) WHERE source_url IS NOT NULL;

CREATE TABLE IF NOT EXISTS photo_searches (
  park TEXT PRIMARY KEY,
  searched_at TEXT NOT NULL DEFAULT (datetime('now')),
  found INTEGER NOT NULL DEFAULT 0
);
