import type { Database } from 'better-sqlite3';
import { z } from 'zod';
import { decrypt, encrypt } from './encryption.js';

const StoredToken = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  expiresAt: z.number().int().positive(),
  obtainedAt: z.number().int().positive(),
  scopes: z.array(z.string()).default([]),
  userId: z.string().optional(),
  userLogin: z.string().optional(),
});
export type StoredToken = z.infer<typeof StoredToken>;

export class TokenStore {
  constructor(
    private readonly db: Database,
    private readonly key: Buffer,
  ) {
    this.db
      .prepare(
        `CREATE TABLE IF NOT EXISTS auth_tokens (
          account TEXT PRIMARY KEY,
          payload TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        )`,
      )
      .run();
  }

  save(account: string, token: StoredToken): void {
    const plaintext = JSON.stringify(StoredToken.parse(token));
    const payload = encrypt(this.key, plaintext);
    this.db
      .prepare(
        `INSERT INTO auth_tokens (account, payload, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(account) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at`,
      )
      .run(account, payload, Date.now());
  }

  load(account: string): StoredToken | null {
    const row = this.db
      .prepare('SELECT payload FROM auth_tokens WHERE account = ?')
      .get(account) as { payload: string } | undefined;
    if (!row) return null;
    const plain = decrypt(this.key, row.payload);
    return StoredToken.parse(JSON.parse(plain));
  }

  clear(account: string): void {
    this.db.prepare('DELETE FROM auth_tokens WHERE account = ?').run(account);
  }

  lastUpdated(account: string): number | null {
    const row = this.db
      .prepare('SELECT updated_at FROM auth_tokens WHERE account = ?')
      .get(account) as { updated_at: number } | undefined;
    return row?.updated_at ?? null;
  }
}
