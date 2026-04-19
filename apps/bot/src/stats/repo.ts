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
      .prepare(
        'INSERT INTO channels_joined (account, channel, action, at) VALUES (?, ?, ?, ?)',
      )
      .run(account, channel, action, Date.now());
  }

  recordPlay(account: string, channel: string): void {
    this.db
      .prepare('INSERT INTO plays_sent (account, channel, at) VALUES (?, ?, ?)')
      .run(account, channel, Date.now());
  }

  recordLobby(channel: string, distinctUsers: number): void {
    this.db
      .prepare(
        'INSERT INTO lobbies_detected (channel, distinct_users, at) VALUES (?, ?, ?)',
      )
      .run(channel, distinctUsers, Date.now());
  }

  recordChat(channel: string, userLogin: string, text: string): void {
    this.db
      .prepare(
        'INSERT INTO chat_messages (channel, user_login, text, at) VALUES (?, ?, ?, ?)',
      )
      .run(channel, userLogin, text, Date.now());
  }

  recordAuth(account: string, phase: string, message?: string): void {
    this.db
      .prepare(
        'INSERT INTO auth_events (account, phase, message, at) VALUES (?, ?, ?, ?)',
      )
      .run(account, phase, message ?? null, Date.now());
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
    const lobbies = this.db
      .prepare('SELECT COUNT(*) AS c FROM lobbies_detected')
      .get() as { c: number };
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

  aggregate(range: StatsRange): StatsResponse {
    const windowMs = rangeToMs[range];
    const bucketMs = rangeBucketMs[range];
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

    const buckets: StatsResponse['buckets'] = [];
    for (let t = since; t < Date.now(); t += bucketMs) {
      const to = t + bucketMs;
      const p = this.db
        .prepare('SELECT COUNT(*) AS c FROM plays_sent WHERE at >= ? AND at < ?')
        .get(t, to) as { c: number };
      const l = this.db
        .prepare('SELECT COUNT(*) AS c FROM lobbies_detected WHERE at >= ? AND at < ?')
        .get(t, to) as { c: number };
      const m = this.db
        .prepare('SELECT COUNT(*) AS c FROM chat_messages WHERE at >= ? AND at < ?')
        .get(t, to) as { c: number };
      buckets.push({
        at: new Date(t).toISOString(),
        plays: p.c,
        lobbies: l.c,
        chatMessages: m.c,
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
    };
  }
}
