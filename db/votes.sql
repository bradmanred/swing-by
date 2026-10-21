-- Table for the "Where should we go next?" vote (D1 database swing-by-votes, bound to the Worker as VOTES).
-- Already created on Cloudflare, in both swing-by-votes and the preview database swing-by-votes-preview.
-- To recreate it: npx wrangler d1 execute <database name> --remote --file db/votes.sql
CREATE TABLE IF NOT EXISTS votes (
  voter TEXT PRIMARY KEY,
  area TEXT NOT NULL,
  other TEXT, -- what they typed for "Somewhere else" (private)
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- Added later: on an older copy of the table run  ALTER TABLE votes ADD COLUMN other TEXT;
