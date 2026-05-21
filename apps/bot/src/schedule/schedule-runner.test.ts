import { describe, it, expect, beforeEach, vi } from 'vitest';
import pino from 'pino';
import { ScheduleConfig } from '@mosbot/shared';
import {
  ScheduleRunner,
  isInWindow,
  minutesInTimezone,
  weekdayIn,
} from './schedule-runner.js';

const silentLogger = pino({ level: 'silent' });

const makeOrchestrator = (): {
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
} => ({
  start: vi.fn(async () => undefined),
  stop: vi.fn(async () => undefined),
});

// Tuesday 2026-05-19 14:00:00 UTC
const REF_UTC = Date.parse('2026-05-19T14:00:00Z');

const WEEKDAYS_LIST = [
  'mon',
  'tue',
  'wed',
  'thu',
  'fri',
  'sat',
  'sun',
] as const;
type WD = (typeof WEEKDAYS_LIST)[number];

interface SchedOverride {
  enabled?: boolean;
  timezone?: string;
  // Convenience: when start/end set, build a same-time window for all 7 days
  // (matches the pre-windows-model test fixture).
  start?: string;
  end?: string;
  windows?: Partial<Record<WD, { start: string; end: string }>>;
}

const sched = (over: SchedOverride = {}): ScheduleConfig => {
  const start = over.start ?? '08:00';
  const end = over.end ?? '22:00';
  const defaultWindows = Object.fromEntries(
    WEEKDAYS_LIST.map((d) => [d, { start, end }]),
  ) as Record<WD, { start: string; end: string }>;
  return {
    enabled: over.enabled ?? true,
    timezone: over.timezone ?? 'UTC',
    windows: over.windows ?? defaultWindows,
  };
};

describe('ScheduleConfig schema', () => {
  it('accepts a new windows-shaped config', () => {
    const parsed = ScheduleConfig.parse({
      enabled: true,
      timezone: 'UTC',
      windows: {
        mon: { start: '12:00', end: '16:00' },
        wed: { start: '14:00', end: '18:00' },
      },
    });
    expect(parsed.windows.mon).toEqual({ start: '12:00', end: '16:00' });
    expect(parsed.windows.wed).toEqual({ start: '14:00', end: '18:00' });
    expect(parsed.windows.tue).toBeUndefined();
  });

  it('rejects an empty windows map', () => {
    const r = ScheduleConfig.safeParse({
      enabled: true,
      timezone: 'UTC',
      windows: {},
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0]?.message).toMatch(/at least one/i);
    }
  });

  it('rejects a window with start === end', () => {
    const r = ScheduleConfig.safeParse({
      enabled: true,
      timezone: 'UTC',
      windows: { mon: { start: '12:00', end: '12:00' } },
    });
    expect(r.success).toBe(false);
  });

  it('auto-migrates legacy start+end (no windows) to all 7 days', () => {
    const parsed = ScheduleConfig.parse({
      enabled: true,
      timezone: 'UTC',
      start: '08:00',
      end: '22:00',
    });
    expect(Object.keys(parsed.windows).sort()).toEqual(
      ['fri', 'mon', 'sat', 'sun', 'thu', 'tue', 'wed'],
    );
    expect(parsed.windows.mon).toEqual({ start: '08:00', end: '22:00' });
    expect(parsed.windows.sun).toEqual({ start: '08:00', end: '22:00' });
  });

  it('default (no fields) yields enabled=true, all 7 days 12:00-16:00, UTC', () => {
    const parsed = ScheduleConfig.parse({});
    expect(parsed.enabled).toBe(true);
    expect(parsed.timezone).toBe('UTC');
    expect(parsed.windows.mon).toEqual({ start: '12:00', end: '16:00' });
    expect(Object.keys(parsed.windows)).toHaveLength(7);
  });
});

describe('weekdayIn', () => {
  // REF_UTC = Tuesday 2026-05-19 14:00:00 UTC
  it('returns "tue" for a Tuesday 14:00 UTC', () => {
    expect(weekdayIn(REF_UTC, 'UTC')).toBe('tue');
  });

  it('returns "tue" for the same instant interpreted in Berlin (UTC+2 in May)', () => {
    expect(weekdayIn(REF_UTC, 'Europe/Berlin')).toBe('tue');
  });

  it('returns "tue" in New York (UTC-4 in May, 10:00 local — same day)', () => {
    expect(weekdayIn(REF_UTC, 'America/New_York')).toBe('tue');
  });

  it('returns the next day when timezone pushes the instant across midnight', () => {
    // 22:00 UTC Tuesday = 00:00 Wednesday in Berlin (UTC+2)
    const t = Date.parse('2026-05-19T22:00:00Z');
    expect(weekdayIn(t, 'Europe/Berlin')).toBe('wed');
    expect(weekdayIn(t, 'UTC')).toBe('tue');
  });

  it('returns the previous day when timezone pulls the instant back over midnight', () => {
    // 02:00 UTC Tuesday = 22:00 Monday in New York (UTC-4)
    const t = Date.parse('2026-05-19T02:00:00Z');
    expect(weekdayIn(t, 'America/New_York')).toBe('mon');
    expect(weekdayIn(t, 'UTC')).toBe('tue');
  });
});

describe('minutesInTimezone', () => {
  it('extracts HH:MM in UTC', () => {
    expect(minutesInTimezone(REF_UTC, 'UTC')).toBe(14 * 60);
  });

  it('extracts HH:MM in Europe/Berlin (DST: UTC+2)', () => {
    // 14:00 UTC in May = 16:00 CEST
    expect(minutesInTimezone(REF_UTC, 'Europe/Berlin')).toBe(16 * 60);
  });

  it('extracts HH:MM in America/New_York (DST: UTC-4)', () => {
    // 14:00 UTC in May = 10:00 EDT
    expect(minutesInTimezone(REF_UTC, 'America/New_York')).toBe(10 * 60);
  });
});

describe('isInWindow', () => {
  it('daytime: 08-22 includes 14:00 UTC', () => {
    expect(isInWindow(REF_UTC, sched({ start: '08:00', end: '22:00' }))).toBe(true);
  });

  it('daytime: 08-22 excludes 06:00 UTC', () => {
    const t = Date.parse('2026-05-19T06:00:00Z');
    expect(isInWindow(t, sched({ start: '08:00', end: '22:00' }))).toBe(false);
  });

  it('overnight: 22-06 excludes 14:00 UTC', () => {
    expect(isInWindow(REF_UTC, sched({ start: '22:00', end: '06:00' }))).toBe(false);
  });

  it('overnight: 22-06 includes 23:30 UTC', () => {
    const t = Date.parse('2026-05-19T23:30:00Z');
    expect(isInWindow(t, sched({ start: '22:00', end: '06:00' }))).toBe(true);
  });

  it('overnight: 22-06 includes 02:00 UTC (after midnight)', () => {
    const t = Date.parse('2026-05-19T02:00:00Z');
    expect(isInWindow(t, sched({ start: '22:00', end: '06:00' }))).toBe(true);
  });

  it('timezone matters: 22-06 Berlin excludes 14:00 UTC (=16:00 Berlin)', () => {
    expect(
      isInWindow(REF_UTC, sched({ start: '22:00', end: '06:00', timezone: 'Europe/Berlin' })),
    ).toBe(false);
  });

  it('timezone matters: 08-22 Berlin includes 22:00 UTC summer (=00:00 next-day Berlin, out)', () => {
    // 22:00 UTC May 19 = 00:00 May 20 CEST -> NOT in 08-22 window
    const t = Date.parse('2026-05-19T22:00:00Z');
    expect(
      isInWindow(t, sched({ start: '08:00', end: '22:00', timezone: 'Europe/Berlin' })),
    ).toBe(false);
  });

  it('end is exclusive: at exactly 22:00, returns false', () => {
    const t = Date.parse('2026-05-19T22:00:00Z');
    expect(isInWindow(t, sched({ start: '08:00', end: '22:00' }))).toBe(false);
  });

  it('start is inclusive: at exactly 08:00, returns true', () => {
    const t = Date.parse('2026-05-19T08:00:00Z');
    expect(isInWindow(t, sched({ start: '08:00', end: '22:00' }))).toBe(true);
  });

  // Per-day windows model: explicit weekday gating.
  it('per-day: bot is out on a weekday with no window', () => {
    // REF_UTC is Tuesday 14:00; provide only Mon window.
    const s = sched({ windows: { mon: { start: '08:00', end: '22:00' } } });
    expect(isInWindow(REF_UTC, s)).toBe(false);
  });

  it('per-day: bot runs only on selected weekdays', () => {
    // REF_UTC is Tuesday 14:00. Mon+Wed window, Tue absent.
    const s = sched({
      windows: {
        mon: { start: '12:00', end: '18:00' },
        wed: { start: '12:00', end: '18:00' },
      },
    });
    expect(isInWindow(REF_UTC, s)).toBe(false);
  });

  it('per-day overnight: yesterday spillover keeps bot running past midnight', () => {
    // Mon 22:00 - 06:00 only, Tue 02:00 UTC = still inside Mon's overnight shift.
    const t = Date.parse('2026-05-19T02:00:00Z'); // Tue 02:00 UTC
    const s = sched({ windows: { mon: { start: '22:00', end: '06:00' } } });
    expect(isInWindow(t, s)).toBe(true);
  });

  it('per-day overnight: spillover stops at yesterday-window end', () => {
    // Tue 06:00 UTC: Mon's overnight 22-06 has ended.
    const t = Date.parse('2026-05-19T06:00:00Z');
    const s = sched({ windows: { mon: { start: '22:00', end: '06:00' } } });
    expect(isInWindow(t, s)).toBe(false);
  });

  it('per-day: non-overnight today window stops at midnight (no spillover)', () => {
    // Mon 14-18 only. Tue 02:00 must NOT run.
    const t = Date.parse('2026-05-19T02:00:00Z');
    const s = sched({ windows: { mon: { start: '14:00', end: '18:00' } } });
    expect(isInWindow(t, s)).toBe(false);
  });
});

describe('ScheduleRunner', () => {
  let orch: ReturnType<typeof makeOrchestrator>;

  beforeEach(() => {
    orch = makeOrchestrator();
  });

  it('does nothing when disabled', async () => {
    const r = new ScheduleRunner({
      schedule: sched({ enabled: false }),
      orchestrator: orch,
      logger: silentLogger,
      now: () => REF_UTC,
      tickMs: 1000,
    });
    await r.start();
    expect(orch.start).not.toHaveBeenCalled();
    expect(orch.stop).not.toHaveBeenCalled();
    r.dispose();
  });

  it('hard-reconciles on start: in-window -> calls start()', async () => {
    const r = new ScheduleRunner({
      schedule: sched({ start: '08:00', end: '22:00' }),
      orchestrator: orch,
      logger: silentLogger,
      now: () => REF_UTC, // 14:00 UTC, in window
      tickMs: 1000,
    });
    await r.start();
    expect(orch.start).toHaveBeenCalledOnce();
    expect(orch.stop).not.toHaveBeenCalled();
    r.dispose();
  });

  it('hard-reconciles on start: out-of-window -> calls stop()', async () => {
    const r = new ScheduleRunner({
      schedule: sched({ start: '08:00', end: '22:00' }),
      orchestrator: orch,
      logger: silentLogger,
      now: () => Date.parse('2026-05-19T06:00:00Z'), // 06:00 UTC, out of window
      tickMs: 1000,
    });
    await r.start();
    expect(orch.start).not.toHaveBeenCalled();
    expect(orch.stop).toHaveBeenCalledOnce();
    r.dispose();
  });

  it('edge-only after initial: no calls if state did not change', async () => {
    let t = REF_UTC; // 14:00 UTC, in window
    const r = new ScheduleRunner({
      schedule: sched({ start: '08:00', end: '22:00' }),
      orchestrator: orch,
      logger: silentLogger,
      now: () => t,
      tickMs: 1000,
    });
    await r.start();
    expect(orch.start).toHaveBeenCalledTimes(1);

    // Advance 1 hour, still in window
    t += 60 * 60 * 1000;
    await r.tick();
    expect(orch.start).toHaveBeenCalledTimes(1); // no additional call
    expect(orch.stop).not.toHaveBeenCalled();
    r.dispose();
  });

  it('triggers stop() on falling edge (window ends)', async () => {
    let t = Date.parse('2026-05-19T21:59:00Z'); // 1 min before end
    const r = new ScheduleRunner({
      schedule: sched({ start: '08:00', end: '22:00' }),
      orchestrator: orch,
      logger: silentLogger,
      now: () => t,
      tickMs: 1000,
    });
    await r.start();
    expect(orch.start).toHaveBeenCalledTimes(1);

    t += 2 * 60 * 1000; // cross 22:00 boundary -> out of window
    await r.tick();
    expect(orch.stop).toHaveBeenCalledTimes(1);
    r.dispose();
  });

  it('triggers start() on rising edge (window begins)', async () => {
    let t = Date.parse('2026-05-19T07:59:00Z'); // 1 min before start
    const r = new ScheduleRunner({
      schedule: sched({ start: '08:00', end: '22:00' }),
      orchestrator: orch,
      logger: silentLogger,
      now: () => t,
      tickMs: 1000,
    });
    await r.start();
    expect(orch.stop).toHaveBeenCalledTimes(1); // initial: out of window

    t += 2 * 60 * 1000; // cross 08:00 boundary
    await r.tick();
    expect(orch.start).toHaveBeenCalledTimes(1);
    r.dispose();
  });

  it('manual override is preserved between edges: user-stop persists until next ON edge', async () => {
    let t = REF_UTC; // 14:00, in window
    const r = new ScheduleRunner({
      schedule: sched({ start: '08:00', end: '22:00' }),
      orchestrator: orch,
      logger: silentLogger,
      now: () => t,
      tickMs: 1000,
    });
    await r.start();
    expect(orch.start).toHaveBeenCalledTimes(1);

    // Tick at 14:30 (still in window) — no call, even if user manually stopped between
    t += 30 * 60 * 1000;
    await r.tick();
    expect(orch.start).toHaveBeenCalledTimes(1);
    expect(orch.stop).not.toHaveBeenCalled();
    r.dispose();
  });

  it('update() with newly enabled triggers hard reconcile', async () => {
    const r = new ScheduleRunner({
      schedule: sched({ enabled: false }),
      orchestrator: orch,
      logger: silentLogger,
      now: () => REF_UTC, // 14:00, would be in window
      tickMs: 1000,
    });
    await r.start();
    expect(orch.start).not.toHaveBeenCalled();

    await r.update(sched({ enabled: true, start: '08:00', end: '22:00' }));
    expect(orch.start).toHaveBeenCalledOnce();
    r.dispose();
  });

  it('update() with newly disabled stops triggering edges', async () => {
    let t = Date.parse('2026-05-19T21:59:00Z');
    const r = new ScheduleRunner({
      schedule: sched({ start: '08:00', end: '22:00' }),
      orchestrator: orch,
      logger: silentLogger,
      now: () => t,
      tickMs: 1000,
    });
    await r.start();
    expect(orch.start).toHaveBeenCalledOnce();

    await r.update(sched({ enabled: false, start: '08:00', end: '22:00' }));
    t += 2 * 60 * 1000; // cross 22:00 — would normally trigger stop()
    await r.tick();
    expect(orch.stop).not.toHaveBeenCalled();
    r.dispose();
  });

  it('update() with timezone change re-evaluates immediately', async () => {
    const r = new ScheduleRunner({
      schedule: sched({ start: '08:00', end: '22:00', timezone: 'UTC' }),
      orchestrator: orch,
      logger: silentLogger,
      now: () => REF_UTC, // 14:00 UTC -> in window
      tickMs: 1000,
    });
    await r.start();
    expect(orch.start).toHaveBeenCalledOnce();

    // Switch to a tz where REF_UTC is in the middle of the night
    await r.update(
      sched({ start: '08:00', end: '22:00', timezone: 'Pacific/Honolulu' }),
    );
    // 14:00 UTC = 04:00 HST (UTC-10) -> out of 08-22 window
    expect(orch.stop).toHaveBeenCalledOnce();
    r.dispose();
  });

  it('does not double-fire on the same edge', async () => {
    let t = Date.parse('2026-05-19T21:59:00Z');
    const r = new ScheduleRunner({
      schedule: sched({ start: '08:00', end: '22:00' }),
      orchestrator: orch,
      logger: silentLogger,
      now: () => t,
      tickMs: 1000,
    });
    await r.start();

    t += 2 * 60 * 1000; // cross 22:00
    await r.tick();
    expect(orch.stop).toHaveBeenCalledTimes(1);

    // Tick again at 22:02 — still out of window, no additional call
    t += 60 * 1000;
    await r.tick();
    expect(orch.stop).toHaveBeenCalledTimes(1);
    r.dispose();
  });
});
