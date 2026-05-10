import type { Database } from 'better-sqlite3';

export interface StoredTimer {
  channel: string;
  startedAt: number;
  skipped: boolean;
}

export class MarblesTimerRepo {
  constructor(private readonly db: Database) {}

  list(account: string, cutoffMs: number): StoredTimer[] {
    const rows = this.db
      .prepare(
        'SELECT channel, started_at, skipped FROM marbles_timers WHERE account = ? AND started_at >= ?',
      )
      .all(account, cutoffMs) as Array<{
      channel: string;
      started_at: number;
      skipped: number;
    }>;
    return rows.map((r) => ({
      channel: r.channel,
      startedAt: r.started_at,
      skipped: r.skipped === 1,
    }));
  }

  upsert(account: string, channel: string, startedAt: number): void {
    this.db
      .prepare(
        `INSERT INTO marbles_timers (account, channel, started_at, skipped) VALUES (?, ?, ?, 0)
         ON CONFLICT(account, channel) DO UPDATE SET started_at = excluded.started_at, skipped = 0`,
      )
      .run(account, channel, startedAt);
  }

  markSkipped(account: string, channel: string): void {
    this.db
      .prepare(
        'UPDATE marbles_timers SET skipped = 1 WHERE account = ? AND channel = ?',
      )
      .run(account, channel);
  }

  delete(account: string, channel: string): void {
    this.db
      .prepare('DELETE FROM marbles_timers WHERE account = ? AND channel = ?')
      .run(account, channel);
  }

  pruneBefore(cutoffMs: number): void {
    this.db.prepare('DELETE FROM marbles_timers WHERE started_at < ?').run(cutoffMs);
  }
}
