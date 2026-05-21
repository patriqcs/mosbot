import { describe, it, expect, vi, beforeEach } from 'vitest';
import pino from 'pino';
import type { SafetyConfig } from '@mosbot/shared';
import { PlayScheduler } from './play-scheduler.js';
import { LobbyDetector } from './lobby-detector.js';
import { MarblesTimerGuard } from './marbles-timer-guard.js';
import { TokenBucket } from '../ratelimit/bucket.js';
import { EventBus } from '../events/bus.js';
import type { ChatManager } from '../chat/chat-manager.js';
import type { StatsRepo } from '../stats/repo.js';

const silentLogger = pino({ level: 'silent' });

const safety = (over: Partial<SafetyConfig> = {}): SafetyConfig => ({
  preSendJitterMs: { min: 0, max: 0 },
  playProbability: 1,
  scheduleJitterMinutes: 0,
  maxPlaysPerDay: 0,
  ...over,
});

interface BuildOpts {
  cooldownMs?: number;
  capacity?: number;
  send?: ReturnType<typeof vi.fn>;
  safetyCfg?: SafetyConfig;
  rng?: () => number;
  delay?: (ms: number) => Promise<void>;
  stats?: Pick<StatsRepo, 'playsToday'>;
  timezone?: string;
}

const build = (opts: BuildOpts = {}) => {
  const bus = new EventBus();
  const detector = new LobbyDetector({
    windowMs: 30_000,
    minPlayers: 1,
    cooldownMs: opts.cooldownMs ?? 0,
  });
  const bucket = new TokenBucket({ capacity: opts.capacity ?? 10, refillWindowMs: 30_000 });
  const send = opts.send ?? vi.fn().mockResolvedValue(undefined);
  const chat = { send } as unknown as ChatManager;
  const scheduler = new PlayScheduler({
    chat,
    bucket,
    detector,
    timerGuard: new MarblesTimerGuard(),
    bus,
    logger: silentLogger,
    accountName: 'primary',
    safety: opts.safetyCfg ?? safety(),
    rng: opts.rng,
    delay: opts.delay,
    stats: opts.stats,
    timezone: opts.timezone,
  });
  return { scheduler, send, bus, detector, bucket };
};

describe('PlayScheduler: probabilistic skip', () => {
  it('returns "skipped-probabilistic" when rng > playProbability', async () => {
    const { scheduler, send } = build({
      safetyCfg: safety({ playProbability: 0.5 }),
      rng: () => 0.7, // > 0.5 -> skip
    });
    const r = await scheduler.schedule('alice', 5);
    expect(r).toBe('skipped-probabilistic');
    expect(send).not.toHaveBeenCalled();
  });

  it('sends when rng <= playProbability', async () => {
    const { scheduler, send } = build({
      safetyCfg: safety({ playProbability: 0.5 }),
      rng: () => 0.3, // <= 0.5 -> send
    });
    const r = await scheduler.schedule('alice', 5);
    expect(r).toBe('sent');
    expect(send).toHaveBeenCalledOnce();
  });

  it('playProbability=1 always sends', async () => {
    const { scheduler, send } = build({
      safetyCfg: safety({ playProbability: 1 }),
      rng: () => 0.999,
    });
    const r = await scheduler.schedule('alice', 5);
    expect(r).toBe('sent');
    expect(send).toHaveBeenCalledOnce();
  });

  it('playProbability=0 never sends', async () => {
    const { scheduler, send } = build({
      safetyCfg: safety({ playProbability: 0 }),
      rng: () => 0,
    });
    const r = await scheduler.schedule('alice', 5);
    expect(r).toBe('skipped-probabilistic');
    expect(send).not.toHaveBeenCalled();
  });
});

describe('PlayScheduler: maxPlaysPerDay quota', () => {
  let playsTodayMock: ReturnType<typeof vi.fn>;
  let stats: Pick<StatsRepo, 'playsToday'>;

  beforeEach(() => {
    playsTodayMock = vi.fn();
    stats = { playsToday: playsTodayMock } as unknown as Pick<StatsRepo, 'playsToday'>;
  });

  it('returns "daily-cap" when the account already hit maxPlaysPerDay', async () => {
    playsTodayMock.mockReturnValue(40);
    const { scheduler, send } = build({
      safetyCfg: safety({ maxPlaysPerDay: 40 }),
      stats,
      timezone: 'UTC',
    });
    const r = await scheduler.schedule('alice', 5);
    expect(r).toBe('daily-cap');
    expect(send).not.toHaveBeenCalled();
    expect(playsTodayMock).toHaveBeenCalledWith('primary', 'UTC');
  });

  it('sends when playsToday is below the cap', async () => {
    playsTodayMock.mockReturnValue(10);
    const { scheduler, send } = build({
      safetyCfg: safety({ maxPlaysPerDay: 40 }),
      stats,
    });
    const r = await scheduler.schedule('alice', 5);
    expect(r).toBe('sent');
    expect(send).toHaveBeenCalledOnce();
  });

  it('maxPlaysPerDay=0 disables the cap (never queries stats)', async () => {
    const { scheduler, send } = build({
      safetyCfg: safety({ maxPlaysPerDay: 0 }),
      stats,
    });
    const r = await scheduler.schedule('alice', 5);
    expect(r).toBe('sent');
    expect(send).toHaveBeenCalledOnce();
    expect(playsTodayMock).not.toHaveBeenCalled();
  });
});

describe('PlayScheduler: pre-send jitter', () => {
  it('awaits a delay drawn from [min, max] before sending', async () => {
    const delaySpy = vi.fn().mockResolvedValue(undefined);
    const { scheduler, send } = build({
      safetyCfg: safety({ preSendJitterMs: { min: 1000, max: 5000 } }),
      rng: () => 0.5, // midpoint: 3000ms
      delay: delaySpy,
    });
    await scheduler.schedule('alice', 5);
    expect(delaySpy).toHaveBeenCalledOnce();
    const calledWithMs = delaySpy.mock.calls[0]![0] as number;
    expect(calledWithMs).toBeGreaterThanOrEqual(1000);
    expect(calledWithMs).toBeLessThanOrEqual(5000);
    expect(calledWithMs).toBe(3000); // (5000-1000)*0.5 + 1000
    // Delay happens before send (delay invocation order < send invocation order):
    const delayOrder = delaySpy.mock.invocationCallOrder[0]!;
    const sendOrder = send.mock.invocationCallOrder[0]!;
    expect(delayOrder).toBeLessThan(sendOrder);
  });

  it('does not delay when min and max are both 0', async () => {
    const delaySpy = vi.fn().mockResolvedValue(undefined);
    const { scheduler, send } = build({
      safetyCfg: safety({ preSendJitterMs: { min: 0, max: 0 } }),
      delay: delaySpy,
    });
    await scheduler.schedule('alice', 5);
    expect(delaySpy).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledOnce();
  });
});
