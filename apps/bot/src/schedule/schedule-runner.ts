import type { Logger } from 'pino';
import type { ScheduleConfig } from '@mosbot/shared';

export interface OrchestratorLike {
  start(): Promise<void>;
  stop(): Promise<void>;
}

export interface ScheduleRunnerDeps {
  schedule: ScheduleConfig;
  orchestrator: OrchestratorLike;
  logger: Logger;
  tickMs?: number;
  now?: () => number;
}

const DEFAULT_TICK_MS = 30_000;

const parseHHMM = (hhmm: string): number => {
  const [h, m] = hhmm.split(':');
  return Number(h) * 60 + Number(m);
};

export type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

const WEEKDAY_BY_INTL: Record<string, Weekday> = {
  Mon: 'mon',
  Tue: 'tue',
  Wed: 'wed',
  Thu: 'thu',
  Fri: 'fri',
  Sat: 'sat',
  Sun: 'sun',
};

export const weekdayIn = (epochMs: number, timezone: string): Weekday => {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
  });
  const short = fmt.format(new Date(epochMs));
  const w = WEEKDAY_BY_INTL[short];
  if (!w) throw new Error(`unexpected weekday output: ${short}`);
  return w;
};

export const minutesInTimezone = (epochMs: number, timezone: string): number => {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(new Date(epochMs));
  let h = 0;
  let m = 0;
  for (const p of parts) {
    if (p.type === 'hour') h = Number(p.value);
    else if (p.type === 'minute') m = Number(p.value);
  }
  // Intl can emit "24" for midnight in some locales — normalise to 0.
  if (h === 24) h = 0;
  return h * 60 + m;
};

const DAY_BEFORE: Record<Weekday, Weekday> = {
  mon: 'sun',
  tue: 'mon',
  wed: 'tue',
  thu: 'wed',
  fri: 'thu',
  sat: 'fri',
  sun: 'sat',
};

/**
 * True if the bot should be running at `epochMs` according to `schedule`.
 *
 * Per-day windows model. For each instant, the runner checks:
 *   1) Today's window (if set): standard start <= now < end, with overnight
 *      windows (start > end) running from start until midnight on today.
 *   2) Yesterday's overnight spillover: if yesterday's window crosses midnight,
 *      we are still inside it as long as now < yesterday.end.
 *
 * The spillover rule preserves the legacy "22:00–06:00 every night" semantics
 * after auto-migration: each day's overnight window naturally extends into the
 * following morning, even when day-specific windows differ.
 */
export const isInWindow = (epochMs: number, schedule: ScheduleConfig): boolean => {
  const tz = schedule.timezone;
  const nowMin = minutesInTimezone(epochMs, tz);
  const today = weekdayIn(epochMs, tz);
  const todayWin = schedule.windows[today];
  if (todayWin) {
    const s = parseHHMM(todayWin.start);
    const e = parseHHMM(todayWin.end);
    if (s !== e) {
      if (s < e) {
        if (nowMin >= s && nowMin < e) return true;
      } else if (nowMin >= s) {
        // overnight, pre-midnight portion of today's window
        return true;
      }
    }
  }
  // Yesterday's overnight window may extend into today's morning.
  const yesterday = DAY_BEFORE[today];
  const yesterdayWin = schedule.windows[yesterday];
  if (yesterdayWin) {
    const s = parseHHMM(yesterdayWin.start);
    const e = parseHHMM(yesterdayWin.end);
    if (s > e && nowMin < e) return true;
  }
  return false;
};

export class ScheduleRunner {
  private readonly logger: Logger;
  private readonly orchestrator: OrchestratorLike;
  private readonly tickMs: number;
  private readonly now: () => number;
  private schedule: ScheduleConfig;
  private timer: NodeJS.Timeout | null = null;
  private lastInWindow: boolean | null = null;
  private started = false;

  constructor(deps: ScheduleRunnerDeps) {
    this.logger = deps.logger.child({ module: 'schedule-runner' });
    this.orchestrator = deps.orchestrator;
    this.tickMs = deps.tickMs ?? DEFAULT_TICK_MS;
    this.now = deps.now ?? Date.now;
    this.schedule = deps.schedule;
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    await this.reconcileHard();
    this.scheduleInterval();
  }

  dispose(): void {
    this.started = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async update(next: ScheduleConfig): Promise<void> {
    const prev = this.schedule;
    this.schedule = next;
    this.logger.info(
      {
        enabled: next.enabled,
        timezone: next.timezone,
        windows: next.windows,
      },
      'schedule updated',
    );
    if (!this.started) return;
    if (prev.enabled && !next.enabled) {
      // newly disabled: stop edge-driven reconciliation, leave bot in current state
      this.lastInWindow = null;
      return;
    }
    // any other change (newly enabled, time change, tz change) triggers a hard reconcile
    await this.reconcileHard();
  }

  async tick(): Promise<void> {
    if (!this.started) return;
    if (!this.schedule.enabled) return;
    const inWindow = isInWindow(this.now(), this.schedule);
    if (this.lastInWindow === null) {
      // No prior reference state — treat this tick as the hard reconcile.
      this.lastInWindow = inWindow;
      await this.applyState(inWindow);
      return;
    }
    if (inWindow === this.lastInWindow) return;
    this.lastInWindow = inWindow;
    await this.applyState(inWindow);
  }

  private async reconcileHard(): Promise<void> {
    if (!this.schedule.enabled) {
      this.lastInWindow = null;
      return;
    }
    const inWindow = isInWindow(this.now(), this.schedule);
    this.lastInWindow = inWindow;
    await this.applyState(inWindow);
  }

  private async applyState(inWindow: boolean): Promise<void> {
    try {
      if (inWindow) {
        await this.orchestrator.start();
        this.logger.info(
          { schedule: this.schedule },
          'schedule: in window -> orchestrator.start()',
        );
      } else {
        await this.orchestrator.stop();
        this.logger.info(
          { schedule: this.schedule },
          'schedule: out of window -> orchestrator.stop()',
        );
      }
    } catch (err) {
      this.logger.error({ err, inWindow }, 'schedule reconcile failed');
    }
  }

  private scheduleInterval(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick().catch((err) => {
        this.logger.error({ err }, 'tick failed');
      });
    }, this.tickMs);
    this.timer.unref?.();
  }
}
