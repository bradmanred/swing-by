-- Suggestions from "How could we make Swing By better?" on the home page (worker/feedback.js), in the PHOTOS_DB
-- database (swing-by-photos, and swing-by-photos-preview for previews). Only moderators can read them, at /moderate/.
-- To create it: npx wrangler d1 execute <database name> --remote --file db/feedback.sql
CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
