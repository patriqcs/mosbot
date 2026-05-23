import type { Logger } from 'pino';
import type { DiscoveryConfig, StreamInfo } from '@mosbot/shared';

const GAME_NAME = 'Marbles On Stream';
const HELIX = 'https://api.twitch.tv/helix';

interface HelixGame {
  id: string;
  name: string;
}

interface HelixStreamRaw {
  user_id: string;
  user_login: string;
  user_name: string;
  game_id: string;
  title: string;
  viewer_count: number;
  language: string;
  thumbnail_url: string;
  started_at: string;
}

interface HelixUserRaw {
  id: string;
  login: string;
  display_name: string;
  profile_image_url: string;
}

export interface DiscoveryDeps {
  clientId: string;
  getAccessToken: () => Promise<string>;
  config: DiscoveryConfig;
  logger: Logger;
  profileImageTtlMs?: number;
  now?: () => number;
}

const DEFAULT_PROFILE_IMAGE_TTL_MS = 24 * 60 * 60 * 1000;

const toStreamInfo = (s: HelixStreamRaw): StreamInfo => ({
  userId: s.user_id,
  userLogin: s.user_login.toLowerCase(),
  userName: s.user_name,
  gameId: s.game_id,
  title: s.title,
  viewerCount: s.viewer_count,
  language: s.language,
  thumbnailUrl: s.thumbnail_url.replace('{width}', '320').replace('{height}', '180'),
  startedAt: s.started_at,
});

export class Discovery {
  private gameId: string | null = null;
  private readonly logger: Logger;
  private readonly profileImageCache = new Map<string, { url: string; expiresAt: number }>();
  private readonly profileImageTtlMs: number;
  private readonly now: () => number;

  constructor(private readonly deps: DiscoveryDeps) {
    this.logger = deps.logger.child({ module: 'discovery' });
    this.profileImageTtlMs = deps.profileImageTtlMs ?? DEFAULT_PROFILE_IMAGE_TTL_MS;
    this.now = deps.now ?? Date.now;
  }

  private async helix<T>(path: string): Promise<T> {
    const token = await this.deps.getAccessToken();
    const res = await fetch(`${HELIX}${path}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Client-Id': this.deps.clientId,
      },
    });
    if (!res.ok) {
      throw new Error(`helix ${path} ${res.status}: ${await res.text()}`);
    }
    return (await res.json()) as T;
  }

  async resolveGameId(): Promise<string> {
    if (this.gameId) return this.gameId;
    const json = await this.helix<{ data: HelixGame[] }>(
      `/games?name=${encodeURIComponent(GAME_NAME)}`,
    );
    const game = json.data[0];
    if (!game) throw new Error(`cannot resolve game id for "${GAME_NAME}"`);
    this.gameId = game.id;
    this.logger.info({ gameId: game.id }, 'resolved MOS game id');
    return game.id;
  }

  async fetchLiveStreamsForLogins(
    logins: string[],
    opts: { requireGameId?: string } = {},
  ): Promise<StreamInfo[]> {
    const uniq = [...new Set(logins.map((l) => l.toLowerCase()).filter(Boolean))];
    if (uniq.length === 0) return [];
    const out: StreamInfo[] = [];
    for (let i = 0; i < uniq.length; i += 100) {
      const batch = uniq.slice(i, i + 100);
      const params = new URLSearchParams();
      for (const login of batch) params.append('user_login', login);
      params.append('first', '100');
      const json = await this.helix<{ data: HelixStreamRaw[] }>(
        `/streams?${params.toString()}`,
      );
      for (const s of json.data) {
        if (opts.requireGameId && s.game_id !== opts.requireGameId) continue;
        out.push(toStreamInfo(s));
      }
    }
    return out;
  }

  async fetchLiveStreams(): Promise<StreamInfo[]> {
    const gameId = await this.resolveGameId();
    const { maxStreams, minViewers, maxViewers, language, sortBy } = this.deps.config;
    const collected: StreamInfo[] = [];
    let cursor: string | null = null;
    for (let guard = 0; guard < 10; guard++) {
      const params = new URLSearchParams({ game_id: gameId, first: '100' });
      if (language) {
        for (const l of language.split(',').map((s) => s.trim()).filter(Boolean)) {
          params.append('language', l);
        }
      }
      if (cursor) params.append('after', cursor);
      const json = await this.helix<{
        data: HelixStreamRaw[];
        pagination: { cursor?: string };
      }>(`/streams?${params.toString()}`);
      let reachedFloor = false;
      for (const s of json.data) {
        if (s.viewer_count < minViewers) {
          reachedFloor = true;
          break;
        }
        if (maxViewers !== null && s.viewer_count > maxViewers) continue;
        collected.push(toStreamInfo(s));
      }
      if (reachedFloor) break;
      cursor = json.pagination.cursor ?? null;
      if (!cursor || json.data.length === 0) break;
      if (sortBy === 'most-viewers' && collected.length >= maxStreams) break;
    }
    const sorted =
      sortBy === 'least-viewers'
        ? [...collected].sort((a, b) => a.viewerCount - b.viewerCount)
        : collected;
    return this.done(sorted.slice(0, maxStreams));
  }

  private done(collected: StreamInfo[]): StreamInfo[] {
    this.logger.debug({ count: collected.length }, 'discovery fetched streams');
    return collected;
  }

  /**
   * Fills `profileImageUrl` on each stream by calling Helix /users for any
   * userIds not currently in the 24h cache. Returns a new array with enriched
   * copies; never throws — best-effort.
   */
  async enrichProfileImages(streams: StreamInfo[]): Promise<StreamInfo[]> {
    if (streams.length === 0) return streams;
    const now = this.now();
    const needIds = new Set<string>();
    for (const s of streams) {
      const cached = this.profileImageCache.get(s.userId);
      if (!cached || cached.expiresAt <= now) needIds.add(s.userId);
    }
    if (needIds.size > 0) {
      const ids = [...needIds];
      for (let i = 0; i < ids.length; i += 100) {
        const batch = ids.slice(i, i + 100);
        const params = new URLSearchParams();
        for (const id of batch) params.append('id', id);
        try {
          const json = await this.helix<{ data: HelixUserRaw[] }>(
            `/users?${params.toString()}`,
          );
          const expiresAt = now + this.profileImageTtlMs;
          for (const u of json.data) {
            if (u.profile_image_url) {
              this.profileImageCache.set(u.id, { url: u.profile_image_url, expiresAt });
            }
          }
        } catch (err) {
          this.logger.warn({ err, count: batch.length }, 'profile image fetch failed');
        }
      }
    }
    return streams.map((s) => {
      const cached = this.profileImageCache.get(s.userId);
      return cached ? { ...s, profileImageUrl: cached.url } : s;
    });
  }
}
