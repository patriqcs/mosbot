import { describe, it, expect } from 'vitest';
import { safeStringEqual, isAllowedOrigin, LoginThrottle } from './security.js';

describe('safeStringEqual', () => {
  it('returns true for identical strings', () => {
    expect(safeStringEqual('admin', 'admin')).toBe(true);
  });
  it('returns false for differing strings of equal length', () => {
    expect(safeStringEqual('admin', 'admir')).toBe(false);
  });
  it('returns false for differing lengths', () => {
    expect(safeStringEqual('admin', 'administrator')).toBe(false);
    expect(safeStringEqual('', 'x')).toBe(false);
  });
  it('handles empty strings', () => {
    expect(safeStringEqual('', '')).toBe(true);
  });
});

describe('isAllowedOrigin', () => {
  it('allows a missing origin (non-browser clients)', () => {
    expect(isAllowedOrigin(undefined, '192.168.1.10:8787')).toBe(true);
  });
  it('allows a same-host origin on a different port', () => {
    expect(isAllowedOrigin('http://192.168.1.10:5173', '192.168.1.10:8787')).toBe(true);
  });
  it('allows a same-host IPv6 literal origin (bracketed host header)', () => {
    expect(isAllowedOrigin('http://[::1]:5173', '[::1]:8787')).toBe(true);
    expect(isAllowedOrigin('http://[2001:db8::1]', '[2001:db8::1]:8787')).toBe(true);
  });
  it('rejects a foreign origin', () => {
    expect(isAllowedOrigin('http://evil.example', '192.168.1.10:8787')).toBe(false);
  });
  it('allows an explicitly configured origin', () => {
    expect(
      isAllowedOrigin('https://dash.example', '192.168.1.10:8787', ['https://dash.example']),
    ).toBe(true);
  });
  it('rejects a malformed origin', () => {
    expect(isAllowedOrigin('not-a-url', '192.168.1.10:8787')).toBe(false);
  });
});

describe('LoginThrottle', () => {
  const makeClock = () => {
    let t = 1_000_000;
    return { now: () => t, advance: (ms: number) => (t += ms) };
  };

  it('blocks after maxAttempts failures within the window', () => {
    const clock = makeClock();
    const th = new LoginThrottle({ maxAttempts: 3, windowMs: 60_000, now: clock.now });
    expect(th.isBlocked('ip')).toBe(false);
    th.recordFailure('ip');
    th.recordFailure('ip');
    expect(th.isBlocked('ip')).toBe(false);
    th.recordFailure('ip');
    expect(th.isBlocked('ip')).toBe(true);
  });

  it('unblocks after the window elapses', () => {
    const clock = makeClock();
    const th = new LoginThrottle({ maxAttempts: 2, windowMs: 60_000, now: clock.now });
    th.recordFailure('ip');
    th.recordFailure('ip');
    expect(th.isBlocked('ip')).toBe(true);
    clock.advance(60_001);
    expect(th.isBlocked('ip')).toBe(false);
  });

  it('reset clears failures (used on successful login)', () => {
    const clock = makeClock();
    const th = new LoginThrottle({ maxAttempts: 2, windowMs: 60_000, now: clock.now });
    th.recordFailure('ip');
    th.recordFailure('ip');
    th.reset('ip');
    expect(th.isBlocked('ip')).toBe(false);
  });

  it('tracks keys independently', () => {
    const clock = makeClock();
    const th = new LoginThrottle({ maxAttempts: 1, windowMs: 60_000, now: clock.now });
    th.recordFailure('a');
    expect(th.isBlocked('a')).toBe(true);
    expect(th.isBlocked('b')).toBe(false);
  });

  it('reports a positive retry-after while blocked', () => {
    const clock = makeClock();
    const th = new LoginThrottle({ maxAttempts: 1, windowMs: 60_000, now: clock.now });
    th.recordFailure('ip');
    expect(th.retryAfterSeconds('ip')).toBeGreaterThan(0);
    expect(th.retryAfterSeconds('ip')).toBeLessThanOrEqual(60);
  });
});
