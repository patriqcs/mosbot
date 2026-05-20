import { ChatClient, type ChatMessage } from '@twurple/chat';
import type { Logger } from 'pino';
import type { AuthProvider } from '@twurple/auth';
import type { ChatBadge } from '@mosbot/shared';
import type { EventBus } from '../events/bus.js';

export interface ChatManagerDeps {
  name: string;
  authProvider: AuthProvider;
  logger: Logger;
  bus: EventBus;
}

export interface ChatJoinOptions {
  staggerMs?: number;
  batchSize?: number;
}

export class ChatManager {
  private readonly client: ChatClient;
  private readonly logger: Logger;
  private readonly bus: EventBus;
  private readonly joined = new Set<string>();
  private readonly account: string;
  private onMessageHandler: ((channel: string, user: string, text: string) => void) | null = null;

  constructor(deps: ChatManagerDeps) {
    this.logger = deps.logger.child({ module: 'chat', account: deps.name });
    this.bus = deps.bus;
    this.account = deps.name;
    this.client = new ChatClient({
      authProvider: deps.authProvider,
      requestMembershipEvents: false,
      isAlwaysMod: false,
    });
    this.client.onMessage((channel, user, text, msg) => {
      this.handleMessage(channel, user, text, msg, false);
    });
    this.client.onAction((channel, user, text, msg) => {
      this.handleMessage(channel, user, text, msg, true);
    });
  }

  private handleMessage(
    channel: string,
    user: string,
    text: string,
    msg: ChatMessage,
    isAction: boolean,
  ): void {
    const ch = channel.replace(/^#/, '').toLowerCase();
    const userLogin = user.toLowerCase();
    const badges: ChatBadge[] = [];
    for (const [set, version] of msg.userInfo.badges) {
      badges.push({ set, version });
    }
    const emoteOffsets: Record<string, string[]> = {};
    for (const [id, ranges] of msg.emoteOffsets) {
      emoteOffsets[id] = ranges;
    }
    this.bus.emit({
      type: 'chat',
      at: new Date().toISOString(),
      channel: ch,
      user: userLogin,
      displayName: msg.userInfo.displayName || user,
      text,
      color: msg.userInfo.color,
      badges,
      emoteOffsets,
      isAction,
      isFirstMessage: msg.isFirst,
    });
    this.onMessageHandler?.(ch, userLogin, text);
  }

  onMessage(handler: (channel: string, user: string, text: string) => void): void {
    this.onMessageHandler = handler;
  }

  async connect(): Promise<void> {
    await this.client.connect();
  }

  async disconnect(): Promise<void> {
    this.client.quit();
  }

  joinedChannels(): string[] {
    return [...this.joined];
  }

  async send(channel: string, text: string): Promise<void> {
    await this.client.say(channel, text);
  }

  async applyDiff(
    join: string[],
    part: string[],
    opts: ChatJoinOptions = {},
  ): Promise<void> {
    const batchSize = opts.batchSize ?? 20;
    const staggerMs = opts.staggerMs ?? 10_000;
    for (const ch of part) {
      try {
        await this.client.part(ch);
        this.joined.delete(ch);
        this.bus.emit({
          type: 'part',
          at: new Date().toISOString(),
          account: this.account,
          channel: ch,
        });
      } catch (err) {
        this.logger.warn({ channel: ch, err }, 'part failed');
      }
    }
    for (let i = 0; i < join.length; i += batchSize) {
      const batch = join.slice(i, i + batchSize);
      await Promise.all(
        batch.map(async (ch) => {
          try {
            await this.client.join(ch);
            this.joined.add(ch);
            this.bus.emit({
              type: 'join',
              at: new Date().toISOString(),
              account: this.account,
              channel: ch,
            });
          } catch (err) {
            this.logger.warn({ channel: ch, err }, 'join failed');
          }
        }),
      );
      if (i + batchSize < join.length) await sleep(staggerMs);
    }
  }
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));
