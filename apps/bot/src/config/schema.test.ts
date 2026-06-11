import { describe, it, expect } from 'vitest';
import { AppConfig, DiscoveryConfig } from '@mosbot/shared';

// A minimal valid AppConfig input; individual tests override one slice.
const baseInput = {
  discovery: { minViewers: 30, maxViewers: null },
  lobby: {},
  ratelimit: {},
  channels: {},
  accounts: [{ name: 'primary', clientId: 'cid' }],
  server: { auth: { passwordHash: 'hash' } },
  logging: {},
  database: {},
  schedule: { windows: { mon: { start: '08:00', end: '22:00' } } },
  safety: {},
} as const;

describe('DiscoveryConfig viewer bounds', () => {
  it('accepts maxViewers >= minViewers', () => {
    const r = DiscoveryConfig.safeParse({ minViewers: 30, maxViewers: 100 });
    expect(r.success).toBe(true);
  });

  it('accepts a null maxViewers (no upper bound)', () => {
    const r = DiscoveryConfig.safeParse({ minViewers: 30, maxViewers: null });
    expect(r.success).toBe(true);
  });

  it('rejects maxViewers below minViewers', () => {
    const r = DiscoveryConfig.safeParse({ minViewers: 30, maxViewers: 5 });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0]?.message).toContain('maxViewers must be >= minViewers');
    }
  });
});

describe('AppConfig account uniqueness', () => {
  it('accepts distinct account names', () => {
    const r = AppConfig.safeParse({
      ...baseInput,
      accounts: [
        { name: 'a', clientId: 'c1' },
        { name: 'b', clientId: 'c2' },
      ],
    });
    expect(r.success).toBe(true);
  });

  it('rejects duplicate account names', () => {
    const r = AppConfig.safeParse({
      ...baseInput,
      accounts: [
        { name: 'dup', clientId: 'c1' },
        { name: 'dup', clientId: 'c2' },
      ],
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.message.includes('account names must be unique'))).toBe(
        true,
      );
    }
  });
});
