import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';

export type Db = BetterSQLite3Database<typeof schema>;

export interface DbHandle {
  sqlite: Database.Database;
  db: Db;
}

export const openDb = (path: string): DbHandle => {
  mkdirSync(dirname(path), { recursive: true });
  const sqlite = new Database(path);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('synchronous = NORMAL');
  sqlite.pragma('foreign_keys = ON');
  runBootstrapMigrations(sqlite);
  const db = drizzle(sqlite, { schema });
  return { sqlite, db };
};

const BOOTSTRAP_SQL = `
CREATE TABLE IF NOT EXISTS streams_seen (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_login TEXT NOT NULL,
  user_name TEXT NOT NULL,
  viewer_count INTEGER NOT NULL,
  language TEXT NOT NULL,
  seen_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS streams_seen_at_idx ON streams_seen(seen_at);
CREATE INDEX IF NOT EXISTS streams_seen_login_idx ON streams_seen(user_login);

CREATE TABLE IF NOT EXISTS channels_joined (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account TEXT NOT NULL,
  channel TEXT NOT NULL,
  action TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS channels_joined_at_idx ON channels_joined(at);

CREATE TABLE IF NOT EXISTS plays_sent (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account TEXT NOT NULL,
  channel TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS plays_sent_at_idx ON plays_sent(at);
CREATE INDEX IF NOT EXISTS plays_sent_channel_idx ON plays_sent(channel);

CREATE TABLE IF NOT EXISTS lobbies_detected (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel TEXT NOT NULL,
  distinct_users INTEGER NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS lobbies_at_idx ON lobbies_detected(at);

CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel TEXT NOT NULL,
  user_login TEXT NOT NULL,
  text TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS chat_at_idx ON chat_messages(at);

CREATE TABLE IF NOT EXISTS auth_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account TEXT NOT NULL,
  phase TEXT NOT NULL,
  message TEXT,
  at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS session_keys (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE VIEW IF NOT EXISTS daily_plays AS
  SELECT DATE(at / 1000, 'unixepoch') AS day, COUNT(*) AS plays
  FROM plays_sent GROUP BY day ORDER BY day DESC;

CREATE VIEW IF NOT EXISTS top_channels AS
  SELECT channel, COUNT(*) AS plays
  FROM plays_sent GROUP BY channel ORDER BY plays DESC;
`;

const runBootstrapMigrations = (sqlite: Database.Database): void => {
  sqlite.exec(BOOTSTRAP_SQL);
};
