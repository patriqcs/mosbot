import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { randomBytes } from 'node:crypto';
import { TokenStore, type StoredToken } from './token-store.js';

describe('TokenStore', () => {
  let db: Database.Database;
  let store: TokenStore;

  beforeEach(() => {
    db = new Database(':memory:');
    store = new TokenStore(db, randomBytes(32));
  });

  it('saves and restores encrypted tokens', () => {
    const token: StoredToken = {
      accessToken: 'access',
      refreshToken: 'refresh',
      expiresAt: Date.now() + 3600_000,
      obtainedAt: Date.now(),
      scopes: ['chat:read'],
      userId: '123',
      userLogin: 'alice',
    };
    store.save('primary', token);
    const row = db.prepare('SELECT payload FROM auth_tokens WHERE account = ?').get('primary') as {
      payload: string;
    };
    expect(row.payload).not.toContain('access');
    expect(row.payload).not.toContain('refresh');
    const restored = store.load('primary');
    expect(restored?.accessToken).toBe('access');
    expect(restored?.refreshToken).toBe('refresh');
    expect(restored?.userId).toBe('123');
  });

  it('returns null for unknown accounts', () => {
    expect(store.load('missing')).toBeNull();
  });

  it('clears tokens', () => {
    store.save('a', {
      accessToken: 'x',
      refreshToken: 'y',
      expiresAt: 1,
      obtainedAt: 0,
      scopes: [],
    });
    store.clear('a');
    expect(store.load('a')).toBeNull();
  });
});
