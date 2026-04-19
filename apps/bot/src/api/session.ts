import { randomBytes } from 'node:crypto';
import type { Database } from 'better-sqlite3';

const SESSION_KEY_NAME = 'dashboard.session.secret';

export const getOrCreateSessionSecret = (db: Database): string => {
  const row = db
    .prepare('SELECT value FROM session_keys WHERE key = ?')
    .get(SESSION_KEY_NAME) as { value: string } | undefined;
  if (row) return row.value;
  const value = randomBytes(48).toString('base64');
  db.prepare(
    'INSERT INTO session_keys (key, value, created_at) VALUES (?, ?, ?)',
  ).run(SESSION_KEY_NAME, value, Date.now());
  return value;
};
