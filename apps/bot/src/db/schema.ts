import { sqliteTable, integer, text, index } from 'drizzle-orm/sqlite-core';

export const streamsSeen = sqliteTable(
  'streams_seen',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    userLogin: text('user_login').notNull(),
    userName: text('user_name').notNull(),
    viewerCount: integer('viewer_count').notNull(),
    language: text('language').notNull(),
    seenAt: integer('seen_at').notNull(),
  },
  (t) => ({
    seenAtIdx: index('streams_seen_at_idx').on(t.seenAt),
    loginIdx: index('streams_seen_login_idx').on(t.userLogin),
  }),
);

export const channelsJoined = sqliteTable(
  'channels_joined',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    account: text('account').notNull(),
    channel: text('channel').notNull(),
    action: text('action').notNull(),
    at: integer('at').notNull(),
  },
  (t) => ({
    atIdx: index('channels_joined_at_idx').on(t.at),
  }),
);

export const playsSent = sqliteTable(
  'plays_sent',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    account: text('account').notNull(),
    channel: text('channel').notNull(),
    at: integer('at').notNull(),
  },
  (t) => ({
    atIdx: index('plays_sent_at_idx').on(t.at),
    channelIdx: index('plays_sent_channel_idx').on(t.channel),
  }),
);

export const lobbiesDetected = sqliteTable(
  'lobbies_detected',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    channel: text('channel').notNull(),
    distinctUsers: integer('distinct_users').notNull(),
    at: integer('at').notNull(),
  },
  (t) => ({
    atIdx: index('lobbies_at_idx').on(t.at),
  }),
);

export const chatMessages = sqliteTable(
  'chat_messages',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    channel: text('channel').notNull(),
    userLogin: text('user_login').notNull(),
    text: text('text').notNull(),
    at: integer('at').notNull(),
  },
  (t) => ({
    atIdx: index('chat_at_idx').on(t.at),
  }),
);

export const authEvents = sqliteTable('auth_events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  account: text('account').notNull(),
  phase: text('phase').notNull(),
  message: text('message'),
  at: integer('at').notNull(),
});

export const sessionKeys = sqliteTable('session_keys', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  createdAt: integer('created_at').notNull(),
});
