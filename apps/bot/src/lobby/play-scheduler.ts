import type { Logger } from 'pino';
import type { SafetyConfig } from '@mosbot/shared';
import type { EventBus } from '../events/bus.js';
import type { ChatManager } from '../chat/chat-manager.js';
import type { TokenBucket } from '../ratelimit/bucket.js';
import type { LobbyDetector } from './lobby-detector.js';
import { MarblesTimerLimitError, type MarblesTimerGuard } from './marbles-timer-guard.js';

export interface PlayQuotaStats {
  playsToday(account: string, timezone: string): number;
}

export interface PlaySchedulerDeps {
  chat: ChatManager;
  bucket: TokenBucket;
  detector: LobbyDetector;
  timerGuard: MarblesTimerGuard;
  bus: EventBus;
  logger: Logger;
  accountName: string;
  /**
   * Anti-detection safety settings. Read live on each schedule() call — when
   * the value is mutated via Object.assign on hot-reload, subsequent calls see
   * the new numbers without needing a new PlayScheduler instance.
   */
  safety: SafetyConfig;
  /** Optional, used by the daily play cap. Without it, the cap is disabled. */
  stats?: PlayQuotaStats | undefined;
  /** Timezone whose midnight defines the "day" for maxPlaysPerDay. */
  timezone?: string | undefined;
  /** Random number generator in [0,1); defaults to Math.random. Injectable for tests. */
  rng?: (() => number) | undefined;
  /** Awaitable sleep. Defaults to setTimeout-based. Injectable for tests. */
  delay?: ((ms: number) => Promise<void>) | undefined;
}

const PLAY_MESSAGE = '!play';

const defaultDelay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export type PlayOutcome =
  | 'sent'
  | 'throttled'
  | 'cooldown'
  | 'timer-limit'
  | 'skipped-probabilistic'
  | 'daily-cap';

export class PlayScheduler {
  private readonly logger: Logger;
  private readonly rng: () => number;
  private readonly delay: (ms: number) => Promise<void>;

  constructor(private readonly deps: PlaySchedulerDeps) {
    this.logger = deps.logger.child({ module: 'play-scheduler' });
    this.rng = deps.rng ?? Math.random;
    this.delay = deps.delay ?? defaultDelay;
  }

  async schedule(channel: string, distinctUsers: number): Promise<PlayOutcome> {
    const { chat, bucket, detector, timerGuard, bus, accountName, safety, stats } =
      this.deps;
    if (detector.isOnCooldown(channel)) return 'cooldown';
    const gate = timerGuard.canSend(channel);
    if (!gate.allowed) {
      const msg =
        gate.reason === 'skipped'
          ? 'channel marked as skipped, dropping !play'
          : 'marbles 3-stream limit: new channel would become the 4th, dropping !play';
      this.logger.warn(
        {
          channel,
          activeTimers: gate.activeCount,
          activeChannels: timerGuard.active().map((t) => t.channel),
          reason: gate.reason,
        },
        msg,
      );
      return 'timer-limit';
    }
    // Probabilistic skip: drop a fraction of detected lobbies on purpose so
    // the bot does not deterministically join every single one.
    if (safety.playProbability < 1 && this.rng() >= safety.playProbability) {
      this.logger.info(
        { channel, playProbability: safety.playProbability },
        'probabilistic skip: dropping !play this round',
      );
      return 'skipped-probabilistic';
    }
    // Hard daily cap per account. 0 means unlimited.
    if (safety.maxPlaysPerDay > 0 && stats) {
      const tz = this.deps.timezone ?? 'UTC';
      const today = stats.playsToday(accountName, tz);
      if (today >= safety.maxPlaysPerDay) {
        this.logger.warn(
          { channel, account: accountName, today, cap: safety.maxPlaysPerDay },
          'daily play cap reached, dropping !play',
        );
        return 'daily-cap';
      }
    }
    if (!bucket.tryConsume(1)) {
      this.logger.warn({ channel }, 'rate-limited, dropping !play');
      return 'throttled';
    }
    let reservedAt: number;
    try {
      reservedAt = timerGuard.record(channel);
    } catch (err) {
      if (err instanceof MarblesTimerLimitError) {
        this.logger.warn(
          {
            channel,
            activeChannels: timerGuard.active().map((t) => t.channel),
          },
          'marbles hard cap reached at record time, dropping !play',
        );
        return 'timer-limit';
      }
      throw err;
    }
    // Pre-send jitter: random delay between trigger and !play to break the
    // deterministic "lobby detected -> immediate send" pattern that game-side
    // analytics can fingerprint.
    const { min, max } = safety.preSendJitterMs;
    if (max > 0) {
      const delayMs = Math.round(min + (max - min) * this.rng());
      await this.delay(delayMs);
    }
    try {
      await chat.send(channel, PLAY_MESSAGE);
    } catch (err) {
      timerGuard.release(channel, reservedAt);
      this.logger.error({ channel, err }, 'failed to send !play');
      return 'throttled';
    }
    detector.markSent(channel);
    const active = timerGuard.active();
    this.logger.info(
      { channel, activeCount: active.length, activeChannels: active.map((t) => t.channel) },
      '!play sent, marbles timer started/reset',
    );
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
