import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { StatsRepo } from './repo.js';

const bootstrap = (db: Database.Database): void => {
  db.exec(`
    CREATE TABLE streams_seen (id INTEGER PRIMARY KEY AUTOINCREMENT, user_login TEXT, user_name TEXT, viewer_count INTEGER, language TEXT, seen_at INTEGER);
    CREATE TABLE channels_joined (id INTEGER PRIMARY KEY AUTOINCREMENT, account TEXT, channel TEXT, action TEXT, at INTEGER);
    CREATE TABLE plays_sent (id INTEGER PRIMARY KEY AUTOINCREMENT, account TEXT, channel TEXT, at INTEGER);
    CREATE TABLE lobbies_detected (id INTEGER PRIMARY KEY AUTOINCREMENT, channel TEXT, distinct_users INTEGER, at INTEGER);
    CREATE TABLE chat_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, channel TEXT, user_login TEXT, text TEXT, at INTEGER);
    CREATE TABLE auth_events (id INTEGER PRIMARY KEY AUTOINCREMENT, account TEXT, phase TEXT, message TEXT, at INTEGER);
  `);
};

describe('StatsRepo', () => {
  let db: Database.Database;
  let repo: StatsRepo;

  beforeEach(() => {
    db = new Database(':memory:');
    bootstrap(db);
    repo = new StatsRepo(db);
  });

  it('records and counts plays, lobbies, joins', () => {
    repo.recordPlay('primary', 'alice');
    repo.recordPlay('primary', 'bob');
    repo.recordLobby('alice', 4);
    repo.recordChannelAction('primary', 'alice', 'join');
    const c = repo.counts();
    expect(c.playsSent).toBe(2);
    expect(c.lobbiesDetected).toBe(1);
    expect(c.channelsJoined).toBe(1);
  });

  it('playsToday counts plays for an account since today\'s local midnight', () => {
    const now = Date.now();
    const oneHour = 60 * 60 * 1000;
    // Two recent plays today, one play "yesterday" (well past local midnight).
    repo.recordPlay('primary', 'alice');
    repo.recordPlay('primary', 'bob');
    // Manually backdate one row to 36h ago so it falls into yesterday in any TZ.
    db.prepare('UPDATE plays_sent SET at = ? WHERE channel = ?').run(
      now - 36 * oneHour,
      'bob',
    );
    repo.recordPlay('primary', 'carol');
    // Different account — should not count.
    repo.recordPlay('secondary', 'alice');
    expect(repo.playsToday('primary', 'UTC')).toBe(2);
    expect(repo.playsToday('secondary', 'UTC')).toBe(1);
  });

  it('deleteAllChat removes every chat row and returns the count', () => {
    repo.recordChat('alice', 'u1', 'hi');
    repo.recordChat('alice', 'u2', '!play');
    repo.recordChat('bob', 'u3', 'gg');
    expect(repo.deleteAllChat()).toBe(3);
    const remaining = db.prepare('SELECT COUNT(*) AS c FROM chat_messages').get() as {
      c: number;
    };
    expect(remaining.c).toBe(0);
    expect(repo.deleteAllChat()).toBe(0);
  });

  it('counts plays per channel (case-insensitive)', () => {
    repo.recordPlay('p', 'alice');
    repo.recordPlay('p', 'alice');
    expect(repo.playsForChannel('ALICE')).toBe(2);
  });

  it('normalises channel case on write so mixed-case plays count and group as one', () => {
    repo.recordPlay('p', 'CoolStreamer');
    repo.recordPlay('p', 'coolstreamer');
    // playsForChannel lower-cases its query; the write side must match.
    expect(repo.playsForChannel('coolstreamer')).toBe(2);
    // and topChannels must not split the same channel into two rows.
    const top = repo.aggregate('24h').topChannels;
    expect(top).toHaveLength(1);
    expect(top[0]).toEqual({ channel: 'coolstreamer', plays: 2 });
  });

  it('aggregates over a window', () => {
    repo.recordPlay('p', 'a');
    repo.recordLobby('a', 4);
    repo.recordChat('a', 'u', '!play');
    const res = repo.aggregate('24h');
    expect(res.range).toBe('24h');
    expect(res.totals.plays).toBe(1);
    expect(res.totals.lobbies).toBe(1);
    expect(res.totals.chatMessages).toBe(1);
    expect(res.topChannels[0]?.channel).toBe('a');
  });
});
