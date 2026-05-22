import { type Weekday, WEEKDAYS } from '@mosbot/shared';

interface TimeWindow {
  start: string;
  end: string;
}

export interface NormalizedSchedule {
  enabled: boolean;
  timezone: string;
  windows: Partial<Record<Weekday, TimeWindow>>;
}

export interface NormalizedSafety {
  preSendJitterMs: { min: number; max: number };
  playProbability: number;
  scheduleJitterMinutes: number;
  maxPlaysPerDay: number;
}

export interface NormalizedConfig extends Record<string, unknown> {
  schedule: NormalizedSchedule;
  safety: NormalizedSafety;
}

const DEFAULT_SAFETY: NormalizedSafety = {
  preSendJitterMs: { min: 1500, max: 6000 },
  playProbability: 0.8,
  scheduleJitterMinutes: 5,
  maxPlaysPerDay: 40,
};

const detectBrowserTimezone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
};

const buildAllDayWindows = (start: string, end: string): Record<Weekday, TimeWindow> =>
  Object.fromEntries(WEEKDAYS.map((d) => [d, { start, end }])) as Record<
    Weekday,
    TimeWindow
  >;

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const normalizeSchedule = (raw: unknown): NormalizedSchedule => {
  const fallback: NormalizedSchedule = {
    enabled: true,
    timezone: detectBrowserTimezone(),
    windows: buildAllDayWindows('12:00', '16:00'),
  };
  if (!isPlainObject(raw)) return fallback;

  const enabled = typeof raw.enabled === 'boolean' ? raw.enabled : fallback.enabled;
  const timezone =
    typeof raw.timezone === 'string' && raw.timezone.length > 0
      ? raw.timezone
      : fallback.timezone;

  const rawWindows = raw.windows;
  if (isPlainObject(rawWindows)) {
    const windows: Partial<Record<Weekday, TimeWindow>> = {};
    for (const d of WEEKDAYS) {
      const w = rawWindows[d];
      if (
        isPlainObject(w) &&
        typeof w.start === 'string' &&
        typeof w.end === 'string'
      ) {
        windows[d] = { start: w.start, end: w.end };
      }
    }
    return { enabled, timezone, windows };
  }

  if (typeof raw.start === 'string' && typeof raw.end === 'string') {
    return { enabled, timezone, windows: buildAllDayWindows(raw.start, raw.end) };
  }

  return { enabled, timezone, windows: fallback.windows };
};

const normalizeSafety = (raw: unknown): NormalizedSafety => {
  if (!isPlainObject(raw)) return { ...DEFAULT_SAFETY };
  const jitterRaw = isPlainObject(raw.preSendJitterMs) ? raw.preSendJitterMs : {};
  const min = typeof jitterRaw.min === 'number' ? jitterRaw.min : DEFAULT_SAFETY.preSendJitterMs.min;
  const max = typeof jitterRaw.max === 'number' ? jitterRaw.max : DEFAULT_SAFETY.preSendJitterMs.max;
  return {
    preSendJitterMs: { min, max },
    playProbability:
      typeof raw.playProbability === 'number'
        ? raw.playProbability
        : DEFAULT_SAFETY.playProbability,
    scheduleJitterMinutes:
      typeof raw.scheduleJitterMinutes === 'number'
        ? raw.scheduleJitterMinutes
        : DEFAULT_SAFETY.scheduleJitterMinutes,
    maxPlaysPerDay:
      typeof raw.maxPlaysPerDay === 'number'
        ? raw.maxPlaysPerDay
        : DEFAULT_SAFETY.maxPlaysPerDay,
  };
};

export const normalizeEditableConfig = (raw: unknown): NormalizedConfig | null => {
  if (!isPlainObject(raw)) return null;
  return {
    ...raw,
    schedule: normalizeSchedule(raw.schedule),
    safety: normalizeSafety(raw.safety),
  };
};
