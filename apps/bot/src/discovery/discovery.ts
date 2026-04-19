import type { ApiClient, HelixStream } from '@twurple/api';
import type { Logger } from 'pino';
import type { DiscoveryConfig, StreamInfo } from '@mosbot/shared';

const GAME_NAME = 'Marbles On Stream';

export interface DiscoveryDeps {
  api: ApiClient;
  config: DiscoveryConfig;
  logger: Logger;
}

const toStreamInfo = (s: HelixStream): StreamInfo => ({
  userId: s.userId,
  userLogin: s.userName.toLowerCase(),
  userName: s.userDisplayName,
  gameId: s.gameId,
  title: s.title,
  viewerCount: s.viewers,
  language: s.language,
  thumbnailUrl: s.getThumbnailUrl(320, 180),
  startedAt: s.startDate.toISOString(),
});

export class Discovery {
  private gameId: string | null = null;
  private readonly logger: Logger;

  constructor(private readonly deps: DiscoveryDeps) {
    this.logger = deps.logger.child({ module: 'discovery' });
  }

  async resolveGameId(): Promise<string> {
    if (this.gameId) return this.gameId;
    const game = await this.deps.api.games.getGameByName(GAME_NAME);
    if (!game) throw new Error(`cannot resolve game id for "${GAME_NAME}"`);
    this.gameId = game.id;
    this.logger.info({ gameId: game.id }, 'resolved MOS game id');
    return game.id;
  }

  async fetchLiveStreams(): Promise<StreamInfo[]> {
    const gameId = await this.resolveGameId();
    const { maxStreams, minViewers, language } = this.deps.config;
    const collected: StreamInfo[] = [];
    const it = this.deps.api.streams.getStreamsPaginated({
      game: gameId,
      ...(language ? { language: [language] } : {}),
    });
    for await (const stream of it) {
      if (stream.viewers < minViewers) break;
      collected.push(toStreamInfo(stream));
      if (collected.length >= maxStreams) break;
    }
    this.logger.debug({ count: collected.length }, 'discovery fetched streams');
    return collected;
  }
}
