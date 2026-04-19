import { describe, it, expect, vi } from 'vitest';
import { EventBus } from './bus.js';

describe('EventBus', () => {
  it('routes typed events to the correct listener', () => {
    const bus = new EventBus();
    const onJoin = vi.fn();
    const onChat = vi.fn();
    bus.on('join', onJoin);
    bus.on('chat', onChat);
    bus.emit({
      type: 'join',
      at: new Date().toISOString(),
      account: 'primary',
      channel: 'alice',
    });
    expect(onJoin).toHaveBeenCalledTimes(1);
    expect(onChat).not.toHaveBeenCalled();
  });

  it('delivers to onAny subscribers', () => {
    const bus = new EventBus();
    const spy = vi.fn();
    bus.onAny(spy);
    bus.emit({
      type: 'play-sent',
      at: new Date().toISOString(),
      account: 'primary',
      channel: 'bob',
    });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('returns an unsubscribe function', () => {
    const bus = new EventBus();
    const spy = vi.fn();
    const off = bus.on('join', spy);
    off();
    bus.emit({ type: 'join', at: '', account: 'a', channel: 'b' });
    expect(spy).not.toHaveBeenCalled();
  });
});
