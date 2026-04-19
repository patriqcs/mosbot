import { describe, it, expect } from 'vitest';
import { LobbyDetector } from './lobby-detector.js';

describe('LobbyDetector', () => {
  const makeClock = () => {
    let t = 1_000_000;
    return {
      now: () => t,
      advance: (ms: number) => {
        t += ms;
      },
    };
  };

  it('requires minPlayers distinct users within the window to trigger', () => {
    const clock = makeClock();
    const d = new LobbyDetector({
      windowMs: 30_000,
      minPlayers: 3,
      cooldownMs: 60_000,
      now: clock.now,
    });
    expect(d.observe('#alice', 'u1').triggered).toBe(false);
    expect(d.observe('#alice', 'u2').triggered).toBe(false);
    const third = d.observe('#alice', 'u3');
    expect(third.triggered).toBe(true);
    expect(third.distinctUsers).toBe(3);
  });

  it('deduplicates users within the window', () => {
    const clock = makeClock();
    const d = new LobbyDetector({
      windowMs: 30_000,
      minPlayers: 3,
      cooldownMs: 60_000,
      now: clock.now,
    });
    d.observe('alice', 'u1');
    d.observe('alice', 'u1');
    const r = d.observe('alice', 'u1');
    expect(r.triggered).toBe(false);
  });

  it('expires entries past the window', () => {
    const clock = makeClock();
    const d = new LobbyDetector({
      windowMs: 10_000,
      minPlayers: 2,
      cooldownMs: 60_000,
      now: clock.now,
    });
    d.observe('a', 'u1');
    clock.advance(11_000);
    const r = d.observe('a', 'u2');
    expect(r.triggered).toBe(false);
    expect(r.distinctUsers).toBe(1);
  });

  it('respects cooldown after markSent', () => {
    const clock = makeClock();
    const d = new LobbyDetector({
      windowMs: 30_000,
      minPlayers: 2,
      cooldownMs: 60_000,
      now: clock.now,
    });
    d.observe('c', 'u1');
    d.observe('c', 'u2');
    d.markSent('c');
    expect(d.isOnCooldown('c')).toBe(true);
    const r = d.observe('c', 'u3');
    expect(r.triggered).toBe(false);
    clock.advance(60_001);
    expect(d.isOnCooldown('c')).toBe(false);
  });

  it('treats channel names case-insensitively', () => {
    const d = new LobbyDetector({ windowMs: 30_000, minPlayers: 1, cooldownMs: 60_000 });
    d.observe('Alice', 'U1');
    expect(d.isOnCooldown('alice')).toBe(false);
    d.markSent('ALICE');
    expect(d.isOnCooldown('alice')).toBe(true);
  });
});
