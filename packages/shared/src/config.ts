import { z } from 'zod';

export const DiscoveryConfig = z.object({
  intervalMinutes: z.number().int().min(1).max(60).default(3),
  maxStreams: z.number().int().min(1).max(100).default(20),
  minViewers: z.number().int().min(0).default(30),
  language: z.string().min(2).max(5).nullable().default(null),
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

export const AppConfig = z.object({
  discovery: DiscoveryConfig,
  lobby: LobbyConfig,
  ratelimit: RateLimitConfig,
  channels: ChannelsConfig,
  accounts: z.array(AccountConfig).min(1),
  server: ServerConfig,
  logging: LoggingConfig,
  database: DatabaseConfig,
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
