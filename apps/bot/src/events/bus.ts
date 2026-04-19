import { EventEmitter } from 'node:events';
import type { BotEvent } from '@mosbot/shared';

type Handler<T extends BotEvent['type']> = (ev: Extract<BotEvent, { type: T }>) => void;

export class EventBus {
  private readonly emitter = new EventEmitter({ captureRejections: false });

  constructor() {
    this.emitter.setMaxListeners(50);
  }

  emit(event: BotEvent): void {
    this.emitter.emit(event.type, event);
    this.emitter.emit('*', event);
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
