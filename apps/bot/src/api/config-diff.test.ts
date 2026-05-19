import { describe, it, expect } from 'vitest';
import type { AppConfig } from '@mosbot/shared';
import { diffSections } from './config-diff.js';

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

const clone = (cfg: AppConfig): AppConfig => JSON.parse(JSON.stringify(cfg)) as AppConfig;

describe('diffSections', () => {
  it('returns empty lists when nothing changed', () => {
    expect(diffSections(baseConfig, clone(baseConfig))).toEqual({
      hotReloadable: [],
      restartRequired: [],
    });
  });

  it('detects schedule change as hot-reloadable', () => {
    const next = clone(baseConfig);
    next.schedule.enabled = true;
    expect(diffSections(baseConfig, next).hotReloadable).toContain('schedule');
    expect(diffSections(baseConfig, next).restartRequired).toEqual([]);
  });

  it('detects discovery change as hot-reloadable', () => {
    const next = clone(baseConfig);
    next.discovery.intervalMinutes = 5;
    expect(diffSections(baseConfig, next).hotReloadable).toEqual(['discovery']);
    expect(diffSections(baseConfig, next).restartRequired).toEqual([]);
  });

  it('detects lobby change as hot-reloadable', () => {
    const next = clone(baseConfig);
    next.lobby.minPlayers = 6;
    expect(diffSections(baseConfig, next).hotReloadable).toEqual(['lobby']);
  });

  it('detects ratelimit change as hot-reloadable', () => {
    const next = clone(baseConfig);
    next.ratelimit.userChatBudgetPer30s = 20;
    expect(diffSections(baseConfig, next).hotReloadable).toEqual(['ratelimit']);
  });

  it('detects channels change as hot-reloadable', () => {
    const next = clone(baseConfig);
    next.channels.whitelist = ['someuser'];
    expect(diffSections(baseConfig, next).hotReloadable).toEqual(['channels']);
  });

  it('detects server.auth change as hot-reloadable', () => {
    const next = clone(baseConfig);
    next.server.auth.passwordHash = 'newhash';
    expect(diffSections(baseConfig, next).hotReloadable).toEqual(['server.auth']);
    expect(diffSections(baseConfig, next).restartRequired).toEqual([]);
  });

  it('detects logging.level / chatLog / retention change as hot-reloadable', () => {
    const next = clone(baseConfig);
    next.logging.level = 'debug';
    next.logging.chatLog = false;
    next.logging.chatLogRetentionDays = 7;
    expect(diffSections(baseConfig, next).hotReloadable).toEqual(['logging']);
    expect(diffSections(baseConfig, next).restartRequired).toEqual([]);
  });

  it('detects logging.rotateDays change as restart-required only', () => {
    const next = clone(baseConfig);
    next.logging.rotateDays = 30;
    expect(diffSections(baseConfig, next).hotReloadable).toEqual([]);
    expect(diffSections(baseConfig, next).restartRequired).toEqual(['logging.rotate']);
  });

  it('detects logging mixed change (rotateDays + level) as both', () => {
    const next = clone(baseConfig);
    next.logging.level = 'debug';
    next.logging.rotateDays = 30;
    const diff = diffSections(baseConfig, next);
    expect(diff.hotReloadable).toContain('logging');
    expect(diff.restartRequired).toContain('logging.rotate');
  });

  it('detects accounts mutation as restart-required', () => {
    const next = clone(baseConfig);
    next.accounts.push({ name: 'second', enabled: false, clientId: 'cid' });
    expect(diffSections(baseConfig, next).restartRequired).toEqual(['accounts']);
    expect(diffSections(baseConfig, next).hotReloadable).toEqual([]);
  });

  it('detects server.host change as restart-required (server.bind)', () => {
    const next = clone(baseConfig);
    next.server.host = '127.0.0.1';
    expect(diffSections(baseConfig, next).restartRequired).toEqual(['server.bind']);
  });

  it('detects server.port change as restart-required (server.bind)', () => {
    const next = clone(baseConfig);
    next.server.port = 9000;
    expect(diffSections(baseConfig, next).restartRequired).toEqual(['server.bind']);
  });

  it('detects database change as restart-required', () => {
    const next = clone(baseConfig);
    next.database.path = '/data/new.db';
    expect(diffSections(baseConfig, next).restartRequired).toEqual(['database']);
  });

  it('combines multiple changes correctly', () => {
    const next = clone(baseConfig);
    next.schedule.enabled = true;
    next.discovery.intervalMinutes = 5;
    next.accounts.push({ name: 'second', enabled: false, clientId: 'cid' });
    const diff = diffSections(baseConfig, next);
    expect(diff.hotReloadable.sort()).toEqual(['discovery', 'schedule']);
    expect(diff.restartRequired).toEqual(['accounts']);
  });

  it('ignores server.auth change when also host changed (both flagged)', () => {
    const next = clone(baseConfig);
    next.server.host = '127.0.0.1';
    next.server.auth.passwordHash = 'newhash';
    const diff = diffSections(baseConfig, next);
    expect(diff.hotReloadable).toContain('server.auth');
    expect(diff.restartRequired).toContain('server.bind');
  });
});
