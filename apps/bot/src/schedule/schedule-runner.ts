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

export const isInWindow = (epochMs: number, schedule: ScheduleConfig): boolean => {
  const nowMin = minutesInTimezone(epochMs, schedule.timezone);
  const startMin = parseHHMM(schedule.start);
  const endMin = parseHHMM(schedule.end);
  if (startMin === endMin) return false;
  if (startMin < endMin) {
    return nowMin >= startMin && nowMin < endMin;
  }
  return nowMin >= startMin || nowMin < endMin;
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
        start: next.start,
        end: next.end,
        timezone: next.timezone,
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
