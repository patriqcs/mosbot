import type { Logger } from 'pino';
import type { ScheduleConfig, SafetyConfig } from '@mosbot/shared';

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
  /**
   * Optional safety reference; only `scheduleJitterMinutes` is consulted.
   * Passed by reference so hot-reload mutations show up on the next tick.
   */
  safety?: SafetyConfig | undefined;
}

const DEFAULT_TICK_MS = 30_000;

export const parseHHMM = (hhmm: string): number => {
  const [h, m] = hhmm.split(':');
  return Number(h) * 60 + Number(m);
};

const dateKeyInTz = (epochMs: number, timezone: string): string => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(epochMs));
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
};

// The calendar day before `dateKey` (YYYY-MM-DD), computed purely from the date
// string so it is DST-safe — unlike subtracting 24h of epoch time, which on the
// morning after a spring-forward lands two calendar days back.
const prevDateKey = (dateKey: string): string => {
  const [y, m, d] = dateKey.split('-').map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - 1);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${dt.getUTCFullYear()}-${p(dt.getUTCMonth() + 1)}-${p(dt.getUTCDate())}`;
};

// FNV-1a string hash → float in [0, 1). Deterministic across processes.
const seededFloat = (seed: string): number => {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h = (h ^ seed.charCodeAt(i)) * 16777619;
    h >>>= 0;
  }
  return (h % 1_000_000) / 1_000_000;
};

// Deterministic per-(date, weekday) offset in [-jitterMinutes, +jitterMinutes].
const jitterOffset = (dateKey: string, day: Weekday, jitterMinutes: number): number =>
  Math.round((seededFloat(`${dateKey}:${day}`) * 2 - 1) * jitterMinutes);

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
export const isInWindow = (
  epochMs: number,
  schedule: ScheduleConfig,
  jitterMinutes = 0,
): boolean => {
  const tz = schedule.timezone;
  const nowMin = minutesInTimezone(epochMs, tz);
  const today = weekdayIn(epochMs, tz);
  const todayKey = dateKeyInTz(epochMs, tz);
  const offsetFor = (dateKey: string, day: Weekday): number =>
    jitterMinutes > 0 ? jitterOffset(dateKey, day, jitterMinutes) : 0;

  // Today's window, anchored to today's local midnight (the nowMin frame). The
  // jitter offset shifts both edges equally in absolute-minute space; we do NOT
  // reclassify same-day vs overnight from the shifted HH:MM — that would flip a
  // near-midnight window and move the whole active period by ~24h.
  const todayWin = schedule.windows[today];
  if (todayWin) {
    const s = parseHHMM(todayWin.start);
    const e = parseHHMM(todayWin.end);
    if (s !== e) {
      const o = offsetFor(todayKey, today);
      const eAbs = e > s ? e : e + 1440; // overnight window ends next day
      if (nowMin >= s + o && nowMin < eAbs + o) return true;
    }
  }
  // Yesterday's window may extend into today's morning. Its offset uses
  // yesterday's date (DST-safe via prevDateKey) so the spillover end matches the
  // offset the pre-midnight half was shifted by — no window-length jump at
  // midnight. The current instant is nowMin + 1440 in yesterday's frame.
  const yesterday = DAY_BEFORE[today];
  const yesterdayWin = schedule.windows[yesterday];
  if (yesterdayWin) {
    const s = parseHHMM(yesterdayWin.start);
    const e = parseHHMM(yesterdayWin.end);
    if (s !== e) {
      const o = offsetFor(prevDateKey(todayKey), yesterday);
      const eAbs = e > s ? e : e + 1440;
      if (nowMin + 1440 >= s + o && nowMin + 1440 < eAbs + o) return true;
    }
  }
  return false;
};

export class ScheduleRunner {
  private readonly logger: Logger;
  private readonly orchestrator: OrchestratorLike;
  private readonly tickMs: number;
  private readonly now: () => number;
  private readonly safety: SafetyConfig | undefined;
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
    this.safety = deps.safety;
  }

  /**
   * Whether the bot should be running now, applying `safety.scheduleJitterMinutes`
   * per-day so start/end edges don't fire at the same wall-clock minute every
   * day. Jitter is evaluated inside isInWindow so overnight spillover stays
   * anchored to the window's own start date.
   */
  private inWindowNow(): boolean {
    const jitter = this.safety?.scheduleJitterMinutes ?? 0;
    return isInWindow(this.now(), this.schedule, jitter);
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
    const inWindow = this.inWindowNow();
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
    const inWindow = this.inWindowNow();
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
