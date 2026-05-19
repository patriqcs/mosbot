import type { AppConfig } from '@mosbot/shared';

export type HotReloadableSection =
  | 'discovery'
  | 'lobby'
  | 'ratelimit'
  | 'channels'
  | 'schedule'
  | 'logging'
  | 'server.auth';

export type RestartRequiredSection =
  | 'accounts'
  | 'server.bind'
  | 'database'
  | 'logging.rotate';

export interface SectionDiff {
  hotReloadable: HotReloadableSection[];
  restartRequired: RestartRequiredSection[];
}

const eq = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * Compute which top-level config sections changed between old and new, and
 * classify each change as either applicable via hot-reload or requiring a
 * container restart.
 *
 * `logging` is special: rotateDays needs restart (pino-roll is set up once),
 * while level/chatLog/chatLogRetentionDays can be hot-reloaded. A single save
 * touching both yields entries in both lists.
 */
export const diffSections = (oldCfg: AppConfig, newCfg: AppConfig): SectionDiff => {
  const hotReloadable: HotReloadableSection[] = [];
  const restartRequired: RestartRequiredSection[] = [];

  if (!eq(oldCfg.discovery, newCfg.discovery)) hotReloadable.push('discovery');
  if (!eq(oldCfg.lobby, newCfg.lobby)) hotReloadable.push('lobby');
  if (!eq(oldCfg.ratelimit, newCfg.ratelimit)) hotReloadable.push('ratelimit');
  if (!eq(oldCfg.channels, newCfg.channels)) hotReloadable.push('channels');
  if (!eq(oldCfg.schedule, newCfg.schedule)) hotReloadable.push('schedule');
  if (!eq(oldCfg.server.auth, newCfg.server.auth)) hotReloadable.push('server.auth');

  const oldLoggingHot = { ...oldCfg.logging, rotateDays: 0 };
  const newLoggingHot = { ...newCfg.logging, rotateDays: 0 };
  if (!eq(oldLoggingHot, newLoggingHot)) hotReloadable.push('logging');
  if (oldCfg.logging.rotateDays !== newCfg.logging.rotateDays) {
    restartRequired.push('logging.rotate');
  }

  if (!eq(oldCfg.accounts, newCfg.accounts)) restartRequired.push('accounts');

  if (oldCfg.server.host !== newCfg.server.host || oldCfg.server.port !== newCfg.server.port) {
    restartRequired.push('server.bind');
  }

  if (!eq(oldCfg.database, newCfg.database)) restartRequired.push('database');

  return { hotReloadable, restartRequired };
};
