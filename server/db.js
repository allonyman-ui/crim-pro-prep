const { DatabaseSync } = require("node:sqlite");
const path = require("node:path");
const fs = require("node:fs");

const dataDir = path.join(__dirname, "..", "data");
fs.mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(path.join(dataDir, "app.db"));
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT
);

CREATE TABLE IF NOT EXISTS invites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token TEXT NOT NULL UNIQUE,
  note TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  used_by INTEGER,
  used_at TEXT,
  FOREIGN KEY(created_by) REFERENCES users(id),
  FOREIGN KEY(used_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS progress (
  user_id INTEGER PRIMARY KEY,
  cards_seen TEXT NOT NULL DEFAULT '[]',
  quiz_stats TEXT NOT NULL DEFAULT '{"answered":0,"correct":0}',
  chapters_opened TEXT NOT NULL DEFAULT '[]',
  last_tab TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS activity_days (
  user_id INTEGER NOT NULL,
  day TEXT NOT NULL,
  PRIMARY KEY(user_id, day),
  FOREIGN KEY(user_id) REFERENCES users(id)
);
`);

module.exports = db;
