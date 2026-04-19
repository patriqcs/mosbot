import { describe, it, expect, vi } from 'vitest';
import pino from 'pino';
import { LobbyDetector } from '../src/lobby/lobby-detector.js';
import { PlayScheduler } from '../src/lobby/play-scheduler.js';
import { TokenBucket } from '../src/ratelimit/bucket.js';
import { EventBus } from '../src/events/bus.js';
import type { ChatManager } from '../src/chat/chat-manager.js';

const silentLogger = pino({ level: 'silent' });

describe('full lobby flow: detect -> schedule -> send', () => {
  it('sends exactly one !play when the window fills and respects cooldown', async () => {
    const bus = new EventBus();
    const detector = new LobbyDetector({ windowMs: 30_000, minPlayers: 3, cooldownMs: 60_000 });
    const bucket = new TokenBucket({ capacity: 5, refillWindowMs: 30_000 });
    const send = vi.fn().mockResolvedValue(undefined);
    const chat = {
      send,
      joinedChannels: () => [],
      applyDiff: vi.fn(),
      connect: vi.fn(),
      disconnect: vi.fn(),
    } as unknown as ChatManager;

    const scheduler = new PlayScheduler({
      chat,
      bucket,
      detector,
      bus,
      logger: silentLogger,
      accountName: 'primary',
    });

    const playSpy = vi.fn();
    const lobbySpy = vi.fn();
    bus.on('play-sent', playSpy);
    bus.on('lobby-open', lobbySpy);

    detector.observe('alice', 'u1');
    detector.observe('alice', 'u2');
    const r = detector.observe('alice', 'u3');
    expect(r.triggered).toBe(true);

    const first = await scheduler.schedule('alice', r.distinctUsers);
    expect(first).toBe('sent');
    expect(send).toHaveBeenCalledWith('alice', '!play');
    expect(playSpy).toHaveBeenCalledTimes(1);
    expect(lobbySpy).toHaveBeenCalledTimes(1);

    const second = await scheduler.schedule('alice', 5);
    expect(second).toBe('cooldown');
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('reports throttled when the bucket is empty', async () => {
    const bus = new EventBus();
    const detector = new LobbyDetector({ windowMs: 30_000, minPlayers: 1, cooldownMs: 0 });
    const bucket = new TokenBucket({ capacity: 1, refillWindowMs: 30_000 });
    bucket.tryConsume();
    const chat = { send: vi.fn() } as unknown as ChatManager;
    const scheduler = new PlayScheduler({
      chat,
      bucket,
      detector,
      bus,
      logger: silentLogger,
      accountName: 'primary',
    });
    detector.observe('alice', 'u1');
    const outcome = await scheduler.schedule('alice', 1);
    expect(outcome).toBe('throttled');
  });
});
