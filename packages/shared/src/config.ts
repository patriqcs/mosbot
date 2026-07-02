import { z } from 'zod';

export const DiscoveryConfig = z
  .object({
    intervalMinutes: z.number().int().min(1).max(60).default(3),
    maxStreams: z.number().int().min(1).max(100).default(10),
    minViewers: z.number().int().min(0).default(30),
    maxViewers: z.number().int().min(1).nullable().default(null),
    language: z
      .string()
      .regex(/^[a-zA-Z]{2,3}(\s*,\s*[a-zA-Z]{2,3})*$/, 'expected ISO codes, e.g. "en" or "de,en"')
      .nullable()
      .default(null),
    sortBy: z.enum(['most-viewers', 'least-viewers']).default('most-viewers'),
  })
  // A maxViewers below minViewers makes every stream fall outside the band, so
  // discovery would silently return zero streams forever. Reject it up front.
  .refine((d) => d.maxViewers === null || d.maxViewers >= d.minViewers, {
    message: 'maxViewers must be >= minViewers',
    path: ['maxViewers'],
  });

export const LobbyConfig = z.object({
  windowSeconds: z.number().int().min(5).max(600).default(30),
  minPlayers: z.number().int().min(1).max(100).default(4),
  cooldownSeconds: z.number().int().min(0).max(3600).default(180),
});

export const RateLimitConfig = z.object({
  userChatBudgetPer30s: z.number().int().min(1).max(100).default(16),
  verifiedBot: z.boolean().default(false),
});

export const SafetyConfig = z
  .object({
    preSendJitterMs: z
      .object({
        min: z.number().int().min(0).max(60_000).default(1_500),
        max: z.number().int().min(0).max(60_000).default(6_000),
      })
      .refine((j) => j.min <= j.max, {
        message: 'min must be <= max',
        path: ['max'],
      })
      .default({ min: 1_500, max: 6_000 }),
    playProbability: z.number().min(0).max(1).default(0.8),
    scheduleJitterMinutes: z.number().int().min(0).max(60).default(5),
    // 0 disables the cap.
    maxPlaysPerDay: z.number().int().min(0).max(1000).default(40),
  })
  .default({
    preSendJitterMs: { min: 1_500, max: 6_000 },
    playProbability: 0.8,
    scheduleJitterMinutes: 5,
    maxPlaysPerDay: 40,
  });
export type SafetyConfig = z.infer<typeof SafetyConfig>;

export const ChannelsConfig = z.object({
  whitelist: z.array(z.string()).default([]),
  blacklist: z.array(z.string()).default([]),
  prefer: z.array(z.string()).default([]),
});

export const AccountConfig = z.object({
  name: z
    .string()
    .min(1)
    .regex(/^[a-zA-Z0-9_-]+$/),
  enabled: z.boolean().default(true),
  clientId: z.string().min(1),
});

export const ServerConfig = z.object({
  host: z.string().default('0.0.0.0'),
  port: z.number().int().min(1).max(65535).default(8787),
  // Whether to trust X-Forwarded-* headers for req.ip / req.protocol. Leave
  // `false` for a directly-exposed deployment (so req.ip is the real socket
  // peer and the login throttle can't be bypassed by spoofing the header).
  // Set `true` or a proxy IP/CIDR only when running behind a reverse proxy.
  trustProxy: z.union([z.boolean(), z.string()]).default(false),
  // Extra browser origins allowed to open the WebSocket event stream, besides
  // same-host. Needed when the dashboard is served from a different origin.
  allowedOrigins: z.array(z.string()).default([]),
  auth: z.object({
    username: z.string().min(1).default('admin'),
    passwordHash: z.string().min(1),
  }),
});

export const LoggingConfig = z.object({
  level: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
  rotateDays: z.number().int().min(1).max(365).default(14),
  chatLog: z.boolean().default(true),
  chatLogRetentionDays: z.number().int().min(1).max(365).default(14),
});

export const DatabaseConfig = z.object({
  path: z.string().min(1).default('/data/mosbot.db'),
});

const TIME_24H = /^([01]\d|2[0-3]):[0-5]\d$/;

const isValidTimezone = (tz: string): boolean => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

export const Weekday = z.enum(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);
export type Weekday = z.infer<typeof Weekday>;
export const WEEKDAYS: readonly Weekday[] = [
  'mon',
  'tue',
  'wed',
  'thu',
  'fri',
  'sat',
  'sun',
] as const;

export const TimeWindow = z
  .object({
    start: z.string().regex(TIME_24H, 'expected HH:MM in 24h format (e.g. "12:00")'),
    end: z.string().regex(TIME_24H, 'expected HH:MM in 24h format (e.g. "16:00")'),
  })
  .refine((w) => w.start !== w.end, {
    message: 'start and end must differ',
    path: ['end'],
  });
export type TimeWindow = z.infer<typeof TimeWindow>;

const ScheduleWindows = z.record(Weekday, TimeWindow).refine((o) => Object.keys(o).length >= 1, {
  message: 'windows must contain at least one day',
});

const buildAllDayWindows = (start: string, end: string): Record<Weekday, TimeWindow> =>
  Object.fromEntries(WEEKDAYS.map((d) => [d, { start, end }])) as Record<Weekday, TimeWindow>;

export const ScheduleConfig = z
  .object({
    enabled: z.boolean().optional(),
    timezone: z.string().min(1).optional(),
    // Legacy fields — kept ONLY so older configs that used a single global
    // start/end without `windows` migrate cleanly. New code should write
    // `windows` directly.
    start: z.string().regex(TIME_24H).optional(),
    end: z.string().regex(TIME_24H).optional(),
    windows: ScheduleWindows.optional(),
  })
  .transform((raw, ctx) => {
    const timezone = raw.timezone ?? 'UTC';
    if (!isValidTimezone(timezone)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['timezone'],
        message: 'invalid IANA timezone (e.g. "Europe/Berlin")',
      });
      return z.NEVER;
    }
    let windows = raw.windows;
    if (!windows) {
      if (raw.start !== undefined && raw.end !== undefined) {
        windows = buildAllDayWindows(raw.start, raw.end);
      } else {
        windows = buildAllDayWindows('12:00', '16:00');
      }
    }
    return {
      enabled: raw.enabled ?? true,
      timezone,
      windows,
    };
  });

export const AppConfig = z.object({
  discovery: DiscoveryConfig,
  lobby: LobbyConfig,
  ratelimit: RateLimitConfig,
  channels: ChannelsConfig,
  accounts: z
    .array(AccountConfig)
    .min(1)
    // Names key the token store and the /accounts/:name routes (first match
    // wins), so duplicates make the later account unreachable. Enforce uniqueness.
    .refine((a) => new Set(a.map((x) => x.name)).size === a.length, {
      message: 'account names must be unique',
    }),
  server: ServerConfig,
  logging: LoggingConfig,
  database: DatabaseConfig,
  schedule: ScheduleConfig.default({}),
  safety: SafetyConfig,
});

export type AppConfig = z.infer<typeof AppConfig>;
export type DiscoveryConfig = z.infer<typeof DiscoveryConfig>;
export type LobbyConfig = z.infer<typeof LobbyConfig>;
export type RateLimitConfig = z.infer<typeof RateLimitConfig>;
export type ChannelsConfig = z.infer<typeof ChannelsConfig>;
export type AccountConfig = z.infer<typeof AccountConfig>;
export type ServerConfig = z.infer<typeof ServerConfig>;
export type LoggingConfig = z.infer<typeof LoggingConfig>;
export type DatabaseConfig = z.infer<typeof DatabaseConfig>;
export type ScheduleConfig = z.infer<typeof ScheduleConfig>;
