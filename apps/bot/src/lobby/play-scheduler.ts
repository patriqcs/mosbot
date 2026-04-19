import type { Logger } from 'pino';
import type { EventBus } from '../events/bus.js';
import type { ChatManager } from '../chat/chat-manager.js';
import type { TokenBucket } from '../ratelimit/bucket.js';
import type { LobbyDetector } from './lobby-detector.js';

export interface PlaySchedulerDeps {
  chat: ChatManager;
  bucket: TokenBucket;
  detector: LobbyDetector;
  bus: EventBus;
  logger: Logger;
  accountName: string;
}

const PLAY_MESSAGE = '!play';

export class PlayScheduler {
  private readonly logger: Logger;

  constructor(private readonly deps: PlaySchedulerDeps) {
    this.logger = deps.logger.child({ module: 'play-scheduler' });
  }

  async schedule(channel: string, distinctUsers: number): Promise<'sent' | 'throttled' | 'cooldown'> {
    const { chat, bucket, detector, bus, accountName } = this.deps;
    if (detector.isOnCooldown(channel)) return 'cooldown';
    if (!bucket.tryConsume(1)) {
      this.logger.warn({ channel }, 'rate-limited, dropping !play');
      return 'throttled';
    }
    try {
      await chat.send(channel, PLAY_MESSAGE);
    } catch (err) {
      this.logger.error({ channel, err }, 'failed to send !play');
      return 'throttled';
    }
    detector.markSent(channel);
    bus.emit({
      type: 'lobby-open',
      at: new Date().toISOString(),
      channel,
      distinctUsers,
    });
    bus.emit({
      type: 'play-sent',
      at: new Date().toISOString(),
      account: accountName,
      channel,
    });
    return 'sent';
  }
}
