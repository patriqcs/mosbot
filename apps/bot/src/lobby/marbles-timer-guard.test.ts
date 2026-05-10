import { describe, it, expect, vi } from 'vitest';
import { MarblesTimerGuard, MarblesTimerLimitError } from './marbles-timer-guard.js';

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

  it('skip marks a timer as skipped but keeps the slot occupied', () => {
    const onSkip = vi.fn();
    const g = new MarblesTimerGuard({ windowMs: 60_000, maxStreams: 3, onSkip });
    g.record('a');
    g.record('b');
    g.record('c');
    expect(g.skip('b')).toBe(true);
    expect(onSkip).toHaveBeenCalledWith('b', expect.any(Number));
    expect(g.canSend('d').allowed).toBe(false);
    expect(g.canSend('d').reason).toBe('slot-taken');
    expect(g.canSend('b').allowed).toBe(false);
    expect(g.canSend('b').reason).toBe('skipped');
    expect(g.slotsFree()).toBe(0);
    const skippedTimer = g.active().find((t) => t.channel === 'b');
    expect(skippedTimer?.skipped).toBe(true);
  });

  it('slotsFree shrinks with active and skipped combined', () => {
    const g = new MarblesTimerGuard({ windowMs: 60_000, maxStreams: 3 });
    expect(g.slotsFree()).toBe(3);
    g.record('a');
    expect(g.slotsFree()).toBe(2);
    g.record('b');
    g.skip('b');
    expect(g.slotsFree()).toBe(1);
  });

  it('expiring a skipped timer frees its slot', () => {
    let t = 1000;
    const g = new MarblesTimerGuard({
      windowMs: 1_000,
      maxStreams: 3,
      now: () => t,
    });
    g.record('a');
    g.record('b');
    g.record('c');
    g.skip('b');
    expect(g.slotsFree()).toBe(0);
    t = 5_000;
    expect(g.slotsFree()).toBe(3);
    expect(g.canSend('d').allowed).toBe(true);
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

  it('record returns the timestamp it stored', () => {
    let t = 12345;
    const g = new MarblesTimerGuard({ windowMs: 60_000, maxStreams: 3, now: () => t });
    expect(g.record('a')).toBe(12345);
    t = 99999;
    expect(g.record('b')).toBe(99999);
  });

  it('release frees a reserved slot and fires onExpire', () => {
    const onExpire = vi.fn();
    const g = new MarblesTimerGuard({ windowMs: 60_000, maxStreams: 3, onExpire });
    const ts = g.record('a');
    expect(g.slotsFree()).toBe(2);
    expect(g.release('a', ts)).toBe(true);
    expect(g.slotsFree()).toBe(3);
    expect(onExpire).toHaveBeenCalledWith('a');
  });

  it('release is a no-op if the timestamp does not match (newer reservation wins)', () => {
    let t = 1000;
    const g = new MarblesTimerGuard({ windowMs: 60_000, maxStreams: 3, now: () => t });
    const staleTs = g.record('a');
    t = 2000;
    const newTs = g.record('a');
    expect(g.release('a', staleTs)).toBe(false);
    expect(g.isActive('a')).toBe(true);
    expect(g.active().find((x) => x.channel === 'a')?.startedAt).toBe(newTs);
  });

  it('release is a no-op for an unknown channel', () => {
    const g = new MarblesTimerGuard({ windowMs: 60_000, maxStreams: 3 });
    expect(g.release('ghost', 123)).toBe(false);
  });

  it('record throws MarblesTimerLimitError when adding a new channel would exceed maxStreams', () => {
    const g = new MarblesTimerGuard({ windowMs: 60_000, maxStreams: 3 });
    g.record('a');
    g.record('b');
    g.record('c');
    expect(() => g.record('d')).toThrow(MarblesTimerLimitError);
    expect(g.active()).toHaveLength(3);
  });

  it('record still allows refreshing an already-active channel at cap', () => {
    const g = new MarblesTimerGuard({ windowMs: 60_000, maxStreams: 3 });
    g.record('a');
    g.record('b');
    g.record('c');
    expect(() => g.record('a')).not.toThrow();
    expect(g.active()).toHaveLength(3);
  });

  it('record allows re-activating a skipped channel at cap (net zero change)', () => {
    const g = new MarblesTimerGuard({ windowMs: 60_000, maxStreams: 3 });
    g.record('a');
    g.record('b');
    g.record('c');
    g.skip('b');
    expect(() => g.record('b')).not.toThrow();
    expect(g.isActive('b')).toBe(true);
    expect(g.active()).toHaveLength(3);
  });

  it('hard cap prevents 4th timer even under racy check-then-record pattern', async () => {
    const g = new MarblesTimerGuard({ windowMs: 60_000, maxStreams: 3 });
    g.record('a');
    g.record('b');

    const racyReserve = async (channel: string): Promise<number | 'rejected' | 'limit'> => {
      const gate = g.canSend(channel);
      if (!gate.allowed) return 'rejected';
      await Promise.resolve();
      try {
        return g.record(channel);
      } catch (err) {
        if (err instanceof MarblesTimerLimitError) return 'limit';
        throw err;
      }
    };

    const results = await Promise.all([racyReserve('c'), racyReserve('d'), racyReserve('e')]);
    expect(g.active()).toHaveLength(3);
    const accepted = results.filter((r) => typeof r === 'number');
    expect(accepted).toHaveLength(1);
    const blocked = results.filter((r) => r === 'limit');
    expect(blocked.length).toBeGreaterThanOrEqual(1);
  });
});
