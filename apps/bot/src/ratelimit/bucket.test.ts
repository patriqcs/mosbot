import { describe, it, expect } from 'vitest';
import { TokenBucket } from './bucket.js';

const makeClock = () => {
  let t = 0;
  return { now: () => t, advance: (ms: number) => (t += ms) };
};

describe('TokenBucket', () => {
  it('starts full', () => {
    const clock = makeClock();
    const b = new TokenBucket({ capacity: 5, refillWindowMs: 1000, now: clock.now });
    for (let i = 0; i < 5; i++) expect(b.tryConsume()).toBe(true);
    expect(b.tryConsume()).toBe(false);
  });

  it('refills proportionally to elapsed time', () => {
    const clock = makeClock();
    const b = new TokenBucket({ capacity: 10, refillWindowMs: 1000, now: clock.now });
    for (let i = 0; i < 10; i++) b.tryConsume();
    expect(b.tryConsume()).toBe(false);
    clock.advance(500);
    expect(b.available()).toBeGreaterThan(4);
    expect(b.tryConsume(4)).toBe(true);
  });

  it('caps refill at capacity', () => {
    const clock = makeClock();
    const b = new TokenBucket({ capacity: 5, refillWindowMs: 1000, now: clock.now });
    clock.advance(5_000);
    expect(b.available()).toBe(5);
  });

  it('rejects invalid config', () => {
    expect(() => new TokenBucket({ capacity: 0, refillWindowMs: 1 })).toThrow();
    expect(() => new TokenBucket({ capacity: 1, refillWindowMs: 0 })).toThrow();
  });
});
