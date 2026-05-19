import { describe, it, expect } from 'vitest';
import type { AppConfig } from '@mosbot/shared';
import { canHotReload } from './config-diff.js';

const baseConfig: AppConfig = {
  discovery: {
    intervalMinutes: 3,
    maxStreams: 10,
    minViewers: 30,
    language: null,
    sortBy: 'most-viewers',
  },
  lobby: { windowSeconds: 30, minPlayers: 4, cooldownSeconds: 180 },
  ratelimit: { userChatBudgetPer30s: 16, verifiedBot: false },
  channels: { whitelist: [], blacklist: [], prefer: [] },
  accounts: [{ name: 'primary', enabled: true, clientId: 'cid' }],
  server: {
    host: '0.0.0.0',
    port: 8787,
    auth: { username: 'admin', passwordHash: 'hash' },
  },
  logging: { level: 'info', rotateDays: 14, chatLog: true, chatLogRetentionDays: 14 },
  database: { path: '/data/mosbot.db' },
  schedule: { enabled: false, start: '08:00', end: '22:00', timezone: 'UTC' },
};

describe('canHotReload', () => {
  it('returns true when only the schedule block changed', () => {
    const next: AppConfig = {
      ...baseConfig,
      schedule: { ...baseConfig.schedule, enabled: true },
    };
    expect(canHotReload(baseConfig, next)).toBe(true);
  });

  it('returns false when only a non-schedule block changed', () => {
    const next: AppConfig = {
      ...baseConfig,
      discovery: { ...baseConfig.discovery, intervalMinutes: 5 },
    };
    expect(canHotReload(baseConfig, next)).toBe(false);
  });

  it('returns false when schedule and another block both changed', () => {
    const next: AppConfig = {
      ...baseConfig,
      schedule: { ...baseConfig.schedule, enabled: true },
      discovery: { ...baseConfig.discovery, intervalMinutes: 5 },
    };
    expect(canHotReload(baseConfig, next)).toBe(false);
  });

  it('returns true when nothing changed (save without edits is hot-reload-safe)', () => {
    const next: AppConfig = JSON.parse(JSON.stringify(baseConfig)) as AppConfig;
    expect(canHotReload(baseConfig, next)).toBe(true);
  });
});
