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

export interface DiscoveryDeps {
  clientId: string;
  getAccessToken: () => Promise<string>;
  config: DiscoveryConfig;
  logger: Logger;
}

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

  constructor(private readonly deps: DiscoveryDeps) {
    this.logger = deps.logger.child({ module: 'discovery' });
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

  async fetchLiveStreams(): Promise<StreamInfo[]> {
    const gameId = await this.resolveGameId();
    const { maxStreams, minViewers, language } = this.deps.config;
    const collected: StreamInfo[] = [];
    let cursor: string | null = null;
    for (let guard = 0; guard < 10; guard++) {
      const params = new URLSearchParams({ game_id: gameId, first: '100' });
      if (language) params.append('language', language);
      if (cursor) params.append('after', cursor);
      const json = await this.helix<{
        data: HelixStreamRaw[];
        pagination: { cursor?: string };
      }>(`/streams?${params.toString()}`);
      for (const s of json.data) {
        if (s.viewer_count < minViewers) return this.done(collected);
        collected.push(toStreamInfo(s));
        if (collected.length >= maxStreams) return this.done(collected);
      }
      cursor = json.pagination.cursor ?? null;
      if (!cursor || json.data.length === 0) break;
    }
    return this.done(collected);
  }

  private done(collected: StreamInfo[]): StreamInfo[] {
    this.logger.debug({ count: collected.length }, 'discovery fetched streams');
    return collected;
  }
}
