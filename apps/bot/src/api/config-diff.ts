import type { AppConfig } from '@mosbot/shared';

/**
 * True iff the diff between two configs can be applied without restarting the
 * container — i.e. either nothing changed, or only the schedule block changed.
 * Any change outside `schedule` requires restart.
 */
export const canHotReload = (oldCfg: AppConfig, newCfg: AppConfig): boolean => {
  const { schedule: _oldSched, ...oldRest } = oldCfg;
  const { schedule: _newSched, ...newRest } = newCfg;
  return JSON.stringify(oldRest) === JSON.stringify(newRest);
};
