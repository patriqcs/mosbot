import { z } from 'zod';

export const DiscoveryConfig = z.object({
  intervalMinutes: z.number().int().min(1).max(60).default(3),
  maxStreams: z.number().int().min(1).max(100).default(10),
  minViewers: z.number().int().min(0).default(30),
  language: z
    .string()
    .regex(/^[a-zA-Z]{2,3}(\s*,\s*[a-zA-Z]{2,3})*$/, 'expected ISO codes, e.g. "en" or "de,en"')
    .nullable()
    .default(null),
  sortBy: z.enum(['most-viewers', 'least-viewers']).default('most-viewers'),
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

export const ChannelsConfig = z.object({
  whitelist: z.array(z.string()).default([]),
  blacklist: z.array(z.string()).default([]),
  prefer: z.array(z.string()).default([]),
});

export const AccountConfig = z.object({
  name: z.string().min(1).regex(/^[a-zA-Z0-9_-]+$/),
  enabled: z.boolean().default(true),
  clientId: z.string().min(1),
});

export const ServerConfig = z.object({
  host: z.string().default('0.0.0.0'),
  port: z.number().int().min(1).max(65535).default(8787),
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

export const ScheduleConfig = z
  .object({
    enabled: z.boolean().default(false),
    start: z
      .string()
      .regex(TIME_24H, 'expected HH:MM in 24h format (e.g. "08:00")')
      .default('08:00'),
    end: z
      .string()
      .regex(TIME_24H, 'expected HH:MM in 24h format (e.g. "22:00")')
      .default('22:00'),
    timezone: z
      .string()
      .min(1)
      .refine(isValidTimezone, 'invalid IANA timezone (e.g. "Europe/Berlin")')
      .default('UTC'),
  })
  .refine((s) => s.start !== s.end, {
    message: 'start and end must differ',
    path: ['end'],
  });

export const AppConfig = z.object({
  discovery: DiscoveryConfig,
  lobby: LobbyConfig,
  ratelimit: RateLimitConfig,
  channels: ChannelsConfig,
  accounts: z.array(AccountConfig).min(1),
  server: ServerConfig,
  logging: LoggingConfig,
  database: DatabaseConfig,
  schedule: ScheduleConfig.default({
    enabled: false,
    start: '08:00',
    end: '22:00',
    timezone: 'UTC',
  }),
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
