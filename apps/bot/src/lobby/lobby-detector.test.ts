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

  it('hasObservedLobby reflects whether minPlayers distinct users posted within the window', () => {
    const clock = { t: 0, advance(ms: number) { this.t += ms; } };
    const d = new LobbyDetector({
      windowMs: 30_000,
      minPlayers: 3,
      cooldownMs: 60_000,
      now: () => clock.t,
    });
    expect(d.hasObservedLobby('a')).toBe(false);
    d.observe('a', 'u1');
    d.observe('a', 'u2');
    expect(d.hasObservedLobby('a')).toBe(false);
    d.observe('a', 'u3');
    expect(d.hasObservedLobby('a')).toBe(true);
    clock.advance(30_001);
    expect(d.hasObservedLobby('a')).toBe(false);
  });

  it('hasObservedLobby returns false for unknown channel', () => {
    const d = new LobbyDetector({ windowMs: 30_000, minPlayers: 1, cooldownMs: 60_000 });
    expect(d.hasObservedLobby('nobody')).toBe(false);
  });

  it('update() lowers minPlayers and the next observation triggers immediately', () => {
    const clock = makeClock();
    const d = new LobbyDetector({
      windowMs: 30_000,
      minPlayers: 5,
      cooldownMs: 60_000,
      now: clock.now,
    });
    expect(d.observe('a', 'u1').triggered).toBe(false);
    expect(d.observe('a', 'u2').triggered).toBe(false);
    d.update({ minPlayers: 2 });
    // u1 and u2 are still within window; next observation re-evaluates with new threshold
    // u3 makes it 3 distinct, > new threshold of 2
    expect(d.observe('a', 'u3').triggered).toBe(true);
  });

  it('update() shrinks window and previously-observed users expire faster', () => {
    const clock = makeClock();
    const d = new LobbyDetector({
      windowMs: 30_000,
      minPlayers: 3,
      cooldownMs: 60_000,
      now: clock.now,
    });
    d.observe('a', 'u1');
    clock.advance(5_000);
    d.observe('a', 'u2');
    // shrink window to 1s
    d.update({ windowMs: 1_000 });
    // u1 (5s ago) and u2 (just now) — only u2 should remain valid
    const r = d.observe('a', 'u3');
    expect(r.distinctUsers).toBe(2); // u2 + u3
    expect(r.triggered).toBe(false);
  });

  it('update() extends cooldown', () => {
    const clock = makeClock();
    const d = new LobbyDetector({
      windowMs: 30_000,
      minPlayers: 2,
      cooldownMs: 10_000,
      now: clock.now,
    });
    d.observe('c', 'u1');
    d.observe('c', 'u2');
    d.markSent('c');
    expect(d.isOnCooldown('c')).toBe(true);
    clock.advance(11_000);
    expect(d.isOnCooldown('c')).toBe(false);
    // markSent again with longer cooldown
    d.update({ cooldownMs: 60_000 });
    d.markSent('c');
    clock.advance(11_000);
    expect(d.isOnCooldown('c')).toBe(true); // still in 60s cooldown
  });

  it('update() rejects invalid values', () => {
    const d = new LobbyDetector({ windowMs: 30_000, minPlayers: 2, cooldownMs: 10_000 });
    expect(() => d.update({ windowMs: 0 })).toThrow();
    expect(() => d.update({ minPlayers: 0 })).toThrow();
  });
});
