import type { AppConfig } from '@mosbot/shared';

const omitSchedule = (cfg: AppConfig): Record<string, unknown> =>
  Object.fromEntries(Object.entries(cfg).filter(([k]) => k !== 'schedule'));

/**
 * True iff the diff between two configs can be applied without restarting the
 * container — i.e. either nothing changed, or only the schedule block changed.
 * Any change outside `schedule` requires restart.
 */
export const canHotReload = (oldCfg: AppConfig, newCfg: AppConfig): boolean =>
  JSON.stringify(omitSchedule(oldCfg)) === JSON.stringify(omitSchedule(newCfg));
