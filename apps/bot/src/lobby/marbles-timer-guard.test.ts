import { describe, it, expect, vi } from 'vitest';
import { MarblesTimerGuard } from './marbles-timer-guard.js';

describe('MarblesTimerGuard', () => {
  it('blocks a 4th channel once 3 timers are active', () => {
    const g = new MarblesTimerGuard({ windowMs: 60_000, maxStreams: 3 });
    g.record('a');
    g.record('b');
    g.record('c');
    expect(g.canSend('d').allowed).toBe(false);
    expect(g.canSend('d').reason).toBe('slot-taken');
    expect(g.canSend('a').allowed).toBe(true);
  });

  it('skip moves a timer to skipped and frees the slot', () => {
    const onSkip = vi.fn();
    const g = new MarblesTimerGuard({ windowMs: 60_000, maxStreams: 3, onSkip });
    g.record('a');
    g.record('b');
    g.record('c');
    expect(g.skip('b')).toBe(true);
    expect(onSkip).toHaveBeenCalledWith('b', expect.any(Number));
    expect(g.canSend('d').allowed).toBe(true);
    expect(g.canSend('b').allowed).toBe(false);
    expect(g.canSend('b').reason).toBe('skipped');
    const skippedTimer = g.active().find((t) => t.channel === 'b');
    expect(skippedTimer?.skipped).toBe(true);
  });

  it('shortestRemaining returns active timer with smallest expiry', () => {
    let t = 1000;
    const g = new MarblesTimerGuard({
      windowMs: 60_000,
      maxStreams: 3,
      now: () => t,
    });
    g.record('a');
    t = 2000;
    g.record('b');
    t = 3000;
    g.record('c');
    expect(g.shortestRemaining()?.channel).toBe('a');
    g.skip('a');
    expect(g.shortestRemaining()?.channel).toBe('b');
  });

  it('purges skipped timers after window expires', () => {
    let t = 1000;
    const onExpire = vi.fn();
    const g = new MarblesTimerGuard({
      windowMs: 1_000,
      maxStreams: 3,
      now: () => t,
      onExpire,
    });
    g.record('a');
    g.skip('a');
    t = 5_000;
    expect(g.active()).toHaveLength(0);
    expect(onExpire).toHaveBeenCalledWith('a');
  });

  it('isActive distinguishes active from skipped/unknown channels', () => {
    const g = new MarblesTimerGuard({ windowMs: 60_000, maxStreams: 3 });
    g.record('a');
    g.record('b');
    g.skip('b');
    expect(g.isActive('a')).toBe(true);
    expect(g.isActive('b')).toBe(false);
    expect(g.isActive('c')).toBe(false);
  });

  it('record clears a skipped channel', () => {
    const g = new MarblesTimerGuard({ windowMs: 60_000, maxStreams: 3 });
    g.record('a');
    g.skip('a');
    expect(g.isSkipped('a')).toBe(true);
    g.record('a');
    expect(g.isSkipped('a')).toBe(false);
    expect(g.active().find((t) => t.channel === 'a')?.skipped).toBe(false);
  });
});
