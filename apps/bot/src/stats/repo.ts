import type { Database } from 'better-sqlite3';
import type { StatsRange, StatsResponse } from '@mosbot/shared';

export interface StatsCounts {
  streamsSeen: number;
  channelsJoined: number;
  playsSent: number;
  lobbiesDetected: number;
}

const rangeToMs: Record<StatsRange, number> = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
};

const rangeBucketMs: Record<StatsRange, number> = {
  '24h': 60 * 60 * 1000,
  '7d': 6 * 60 * 60 * 1000,
  '30d': 24 * 60 * 60 * 1000,
};

/**
 * Epoch ms of the most recent midnight in `timezone`, given `now`. Used to
 * scope per-day quotas to local-time days even when the bot runs in UTC.
 */
const startOfTodayMs = (timezone: string, now: number = Date.now()): number => {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(new Date(now));
  const pick = (type: string): number => {
    const v = parts.find((q) => q.type === type)?.value ?? '0';
    return Number(v === '24' ? '0' : v);
  };
  const elapsedMs = (pick('hour') * 3600 + pick('minute') * 60 + pick('second')) * 1000;
  return now - elapsedMs;
};

export class StatsRepo {
  constructor(private readonly db: Database) {}

  recordStreamSeen(s: {
    userLogin: string;
    userName: string;
    viewerCount: number;
    language: string;
  }): void {
    this.db
      .prepare(
        'INSERT INTO streams_seen (user_login, user_name, viewer_count, language, seen_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(s.userLogin, s.userName, s.viewerCount, s.language, Date.now());
  }

  recordChannelAction(account: string, channel: string, action: 'join' | 'part'): void {
    this.db
      .prepare('INSERT INTO channels_joined (account, channel, action, at) VALUES (?, ?, ?, ?)')
      .run(account, channel, action, Date.now());
  }

  recordPlay(account: string, channel: string): void {
    // Twitch channels are case-insensitive; store lower-cased so playsForChannel
    // (which lower-cases its query) and topChannels' GROUP BY stay consistent.
    this.db
      .prepare('INSERT INTO plays_sent (account, channel, at) VALUES (?, ?, ?)')
      .run(account, channel.toLowerCase(), Date.now());
  }

  recordLobby(channel: string, distinctUsers: number): void {
    this.db
      .prepare('INSERT INTO lobbies_detected (channel, distinct_users, at) VALUES (?, ?, ?)')
      .run(channel, distinctUsers, Date.now());
  }

  recordChat(channel: string, userLogin: string, text: string): void {
    this.db
      .prepare('INSERT INTO chat_messages (channel, user_login, text, at) VALUES (?, ?, ?, ?)')
      .run(channel, userLogin, text, Date.now());
  }

  recordAuth(account: string, phase: string, message?: string): void {
    this.db
      .prepare('INSERT INTO auth_events (account, phase, message, at) VALUES (?, ?, ?, ?)')
      .run(account, phase, message ?? null, Date.now());
  }

  pruneChatBefore(cutoffMs: number): number {
    const info = this.db.prepare('DELETE FROM chat_messages WHERE at < ?').run(cutoffMs);
    return info.changes;
  }

  deleteAllChat(): number {
    const info = this.db.prepare('DELETE FROM chat_messages').run();
    return info.changes;
  }

  vacuum(): void {
    this.db.exec('VACUUM');
  }

  counts(): StatsCounts {
    const streams = this.db.prepare('SELECT COUNT(*) AS c FROM streams_seen').get() as {
      c: number;
    };
    const joined = this.db
      .prepare("SELECT COUNT(*) AS c FROM channels_joined WHERE action = 'join'")
      .get() as { c: number };
    const plays = this.db.prepare('SELECT COUNT(*) AS c FROM plays_sent').get() as {
      c: number;
    };
    const lobbies = this.db.prepare('SELECT COUNT(*) AS c FROM lobbies_detected').get() as {
      c: number;
    };
    return {
      streamsSeen: streams.c,
      channelsJoined: joined.c,
      playsSent: plays.c,
      lobbiesDetected: lobbies.c,
    };
  }

  playsForChannel(channel: string): number {
    const r = this.db
      .prepare('SELECT COUNT(*) AS c FROM plays_sent WHERE channel = ?')
      .get(channel.toLowerCase()) as { c: number };
    return r.c;
  }

  /**
   * Number of `!play` rows recorded for `account` since midnight today in
   * `timezone`. Used by the daily play cap.
   */
  playsToday(account: string, timezone: string): number {
    const since = startOfTodayMs(timezone);
    const r = this.db
      .prepare('SELECT COUNT(*) AS c FROM plays_sent WHERE account = ? AND at >= ?')
      .get(account, since) as { c: number };
    return r.c;
  }

  aggregate(range: StatsRange): StatsResponse {
    const windowMs = rangeToMs[range] ?? 24 * 60 * 60 * 1000;
    const bucketMs = rangeBucketMs[range] ?? 60 * 60 * 1000;
    const since = Date.now() - windowMs;

    const plays = this.db
      .prepare('SELECT COUNT(*) AS c FROM plays_sent WHERE at >= ?')
      .get(since) as { c: number };
    const lobbies = this.db
      .prepare('SELECT COUNT(*) AS c FROM lobbies_detected WHERE at >= ?')
      .get(since) as { c: number };
    const chats = this.db
      .prepare('SELECT COUNT(*) AS c FROM chat_messages WHERE at >= ?')
      .get(since) as { c: number };

    // One grouped query per table (bucket index = (at - since) / bucketMs)
    // instead of ~30 buckets × 3 point queries (~90 executions per request).
    const now = Date.now();
    const bucketCounts = (table: string): Map<number, number> => {
      const rows = this.db
        .prepare(
          `SELECT CAST((at - ?) / ? AS INTEGER) AS b, COUNT(*) AS c FROM ${table} WHERE at >= ? AND at < ? GROUP BY b`,
        )
        .all(since, bucketMs, since, now) as { b: number; c: number }[];
      const m = new Map<number, number>();
      for (const r of rows) m.set(r.b, r.c);
      return m;
    };
    const playsByBucket = bucketCounts('plays_sent');
    const lobbiesByBucket = bucketCounts('lobbies_detected');
    const chatByBucket = bucketCounts('chat_messages');
    const buckets: StatsResponse['buckets'] = [];
    let bi = 0;
    for (let t = since; t < now; t += bucketMs, bi++) {
      buckets.push({
        at: new Date(t).toISOString(),
        plays: playsByBucket.get(bi) ?? 0,
        lobbies: lobbiesByBucket.get(bi) ?? 0,
        chatMessages: chatByBucket.get(bi) ?? 0,
      });
    }

    const top = this.db
      .prepare(
        'SELECT channel, COUNT(*) AS plays FROM plays_sent WHERE at >= ? GROUP BY channel ORDER BY plays DESC LIMIT 10',
      )
      .all(since) as { channel: string; plays: number }[];

    return {
      range,
      totals: { plays: plays.c, lobbies: lobbies.c, chatMessages: chats.c },
      buckets,
      topChannels: top,
      chatLogEnabled: false,
    };
  }
}
