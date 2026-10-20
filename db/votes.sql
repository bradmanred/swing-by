-- Table for the "Where should we go next?" vote (D1 database swing-by-votes, bound to the Worker as VOTES).
-- Already created on Cloudflare. To recreate it: npx wrangler d1 execute swing-by-votes --remote --file db/votes.sql
CREATE TABLE IF NOT EXISTS votes (
  voter TEXT PRIMARY KEY,
  area TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
