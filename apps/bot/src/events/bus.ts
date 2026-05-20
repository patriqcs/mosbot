import { EventEmitter } from 'node:events';
import type { BotEvent } from '@mosbot/shared';

type Handler<T extends BotEvent['type']> = (ev: Extract<BotEvent, { type: T }>) => void;

export interface EventBusOptions {
  /**
   * Sliding window in ms for chat-event dedup. 0 disables.
   * Multi-account bots see the same chat message once per joined account,
   * so we drop echoes within this window keyed by channel|user|text.
   */
  chatDedupWindowMs?: number;
  now?: () => number;
}

const DEFAULT_CHAT_DEDUP_WINDOW_MS = 2000;
const DEDUP_CLEANUP_THRESHOLD = 256;

export class EventBus {
  private readonly emitter = new EventEmitter({ captureRejections: false });
  private readonly chatDedupWindowMs: number;
  private readonly now: () => number;
  private readonly chatDedupSeen = new Map<string, number>();

  constructor(options: EventBusOptions = {}) {
    this.emitter.setMaxListeners(50);
    this.chatDedupWindowMs = options.chatDedupWindowMs ?? DEFAULT_CHAT_DEDUP_WINDOW_MS;
    this.now = options.now ?? Date.now;
  }

  emit(event: BotEvent): void {
    if (event.type === 'chat' && this.chatDedupWindowMs > 0) {
      const now = this.now();
      const key = `${event.channel}|${event.user}|${event.text}`;
      const expiresAt = this.chatDedupSeen.get(key);
      if (expiresAt !== undefined && expiresAt > now) return;
      this.chatDedupSeen.set(key, now + this.chatDedupWindowMs);
      if (this.chatDedupSeen.size > DEDUP_CLEANUP_THRESHOLD) {
        this.purgeExpiredDedup(now);
      }
    }
    this.emitter.emit(event.type, event);
    this.emitter.emit('*', event);
  }

  private purgeExpiredDedup(now: number): void {
    for (const [k, exp] of this.chatDedupSeen) {
      if (exp <= now) this.chatDedupSeen.delete(k);
    }
  }

  on<T extends BotEvent['type']>(type: T, handler: Handler<T>): () => void {
    const wrapper = (ev: BotEvent): void => handler(ev as Extract<BotEvent, { type: T }>);
    this.emitter.on(type, wrapper);
    return () => this.emitter.off(type, wrapper);
  }

  onAny(handler: (ev: BotEvent) => void): () => void {
    this.emitter.on('*', handler);
    return () => this.emitter.off('*', handler);
  }
}
