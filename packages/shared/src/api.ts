import { z } from 'zod';
import { StreamInfo } from './events.js';

export const AccountStatus = z.object({
  name: z.string(),
  enabled: z.boolean(),
  loggedIn: z.boolean(),
  username: z.string().nullable(),
  tokenExpiresAt: z.string().nullable(),
  lastRefreshAt: z.string().nullable(),
});
export type AccountStatus = z.infer<typeof AccountStatus>;

export const BotStatus = z.object({
  running: z.boolean(),
  startedAt: z.string().nullable(),
  uptimeSeconds: z.number().int().nonnegative(),
  accounts: z.array(AccountStatus),
  counts: z.object({
    streamsSeen: z.number().int().nonnegative(),
    channelsJoined: z.number().int().nonnegative(),
    playsSent: z.number().int().nonnegative(),
    lobbiesDetected: z.number().int().nonnegative(),
  }),
});
export type BotStatus = z.infer<typeof BotStatus>;

export const StreamListItem = StreamInfo.extend({
  joined: z.boolean(),
  playsSent: z.number().int().nonnegative(),
  blacklisted: z.boolean(),
  whitelisted: z.boolean(),
});
export type StreamListItem = z.infer<typeof StreamListItem>;

export const StatsRange = z.enum(['24h', '7d', '30d']);
export type StatsRange = z.infer<typeof StatsRange>;

export const StatsBucket = z.object({
  at: z.string(),
  plays: z.number().int().nonnegative(),
  lobbies: z.number().int().nonnegative(),
  chatMessages: z.number().int().nonnegative(),
});
export type StatsBucket = z.infer<typeof StatsBucket>;

export const StatsResponse = z.object({
  range: StatsRange,
  totals: z.object({
    plays: z.number().int().nonnegative(),
    lobbies: z.number().int().nonnegative(),
    chatMessages: z.number().int().nonnegative(),
  }),
  buckets: z.array(StatsBucket),
  topChannels: z.array(
    z.object({
      channel: z.string(),
      plays: z.number().int().nonnegative(),
    }),
  ),
});
export type StatsResponse = z.infer<typeof StatsResponse>;

export const LogEntry = z.object({
  at: z.string(),
  level: z.string(),
  msg: z.string(),
  context: z.record(z.string(), z.unknown()).optional(),
});
export type LogEntry = z.infer<typeof LogEntry>;

export const DeviceCodeLoginResponse = z.object({
  userCode: z.string(),
  verificationUri: z.string().url(),
  expiresAt: z.string(),
  intervalSeconds: z.number().int().positive(),
});
export type DeviceCodeLoginResponse = z.infer<typeof DeviceCodeLoginResponse>;

export const ApiEnvelope = <T extends z.ZodTypeAny>(data: T) =>
  z.object({
    success: z.boolean(),
    data: data.nullable(),
    error: z.string().nullable(),
  });

export type ApiEnvelope<T> = {
  success: boolean;
  data: T | null;
  error: string | null;
};
