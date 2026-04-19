import { z } from 'zod';

export const StreamInfo = z.object({
  userId: z.string(),
  userLogin: z.string(),
  userName: z.string(),
  gameId: z.string(),
  title: z.string(),
  viewerCount: z.number().int().nonnegative(),
  language: z.string(),
  thumbnailUrl: z.string().url(),
  startedAt: z.string(),
});
export type StreamInfo = z.infer<typeof StreamInfo>;

export const DiscoveryEvent = z.object({
  type: z.literal('discovery'),
  at: z.string(),
  streams: z.array(StreamInfo),
  joined: z.array(z.string()),
  parted: z.array(z.string()),
});

export const JoinEvent = z.object({
  type: z.literal('join'),
  at: z.string(),
  account: z.string(),
  channel: z.string(),
});

export const PartEvent = z.object({
  type: z.literal('part'),
  at: z.string(),
  account: z.string(),
  channel: z.string(),
});

export const ChatEvent = z.object({
  type: z.literal('chat'),
  at: z.string(),
  channel: z.string(),
  user: z.string(),
  text: z.string(),
});

export const PlaySentEvent = z.object({
  type: z.literal('play-sent'),
  at: z.string(),
  account: z.string(),
  channel: z.string(),
});

export const LobbyOpenEvent = z.object({
  type: z.literal('lobby-open'),
  at: z.string(),
  channel: z.string(),
  distinctUsers: z.number().int().nonnegative(),
});

export const AuthEvent = z.object({
  type: z.literal('auth'),
  at: z.string(),
  account: z.string(),
  phase: z.enum(['device-code', 'pending', 'authorized', 'refresh', 'failure']),
  userCode: z.string().optional(),
  verificationUri: z.string().optional(),
  message: z.string().optional(),
});

export const ErrorEvent = z.object({
  type: z.literal('error'),
  at: z.string(),
  source: z.string(),
  message: z.string(),
});

export const BotEvent = z.discriminatedUnion('type', [
  DiscoveryEvent,
  JoinEvent,
  PartEvent,
  ChatEvent,
  PlaySentEvent,
  LobbyOpenEvent,
  AuthEvent,
  ErrorEvent,
]);
export type BotEvent = z.infer<typeof BotEvent>;
export type DiscoveryEvent = z.infer<typeof DiscoveryEvent>;
export type JoinEvent = z.infer<typeof JoinEvent>;
export type PartEvent = z.infer<typeof PartEvent>;
export type ChatEvent = z.infer<typeof ChatEvent>;
export type PlaySentEvent = z.infer<typeof PlaySentEvent>;
export type LobbyOpenEvent = z.infer<typeof LobbyOpenEvent>;
export type AuthEvent = z.infer<typeof AuthEvent>;
export type ErrorEvent = z.infer<typeof ErrorEvent>;
