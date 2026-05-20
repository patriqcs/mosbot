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

  describe('chat dedup', () => {
    const makeChat = (overrides: Partial<{ channel: string; user: string; text: string }> = {}) => ({
      type: 'chat' as const,
      at: new Date().toISOString(),
      channel: overrides.channel ?? 'alice',
      user: overrides.user ?? 'bob',
      displayName: 'Bob',
      text: overrides.text ?? 'hi',
      color: undefined,
      badges: [],
      emoteOffsets: {},
      isAction: false,
      isFirstMessage: false,
    });

    it('drops echoes of the same channel|user|text within the window', () => {
      let now = 1_000;
      const bus = new EventBus({ chatDedupWindowMs: 2000, now: () => now });
      const spy = vi.fn();
      bus.on('chat', spy);
      bus.emit(makeChat());
      now += 500;
      bus.emit(makeChat());
      now += 1499;
      bus.emit(makeChat());
      expect(spy).toHaveBeenCalledTimes(1);
    });

    it('allows the same message again after the window expires', () => {
      let now = 1_000;
      const bus = new EventBus({ chatDedupWindowMs: 2000, now: () => now });
      const spy = vi.fn();
      bus.on('chat', spy);
      bus.emit(makeChat());
      now += 2001;
      bus.emit(makeChat());
      expect(spy).toHaveBeenCalledTimes(2);
    });

    it('treats different channels, users, or texts as distinct', () => {
      const bus = new EventBus({ chatDedupWindowMs: 2000, now: () => 1 });
      const spy = vi.fn();
      bus.on('chat', spy);
      bus.emit(makeChat({ channel: 'a', user: 'u', text: 'x' }));
      bus.emit(makeChat({ channel: 'b', user: 'u', text: 'x' }));
      bus.emit(makeChat({ channel: 'a', user: 'v', text: 'x' }));
      bus.emit(makeChat({ channel: 'a', user: 'u', text: 'y' }));
      expect(spy).toHaveBeenCalledTimes(4);
    });

    it('does not dedup non-chat events', () => {
      const bus = new EventBus({ chatDedupWindowMs: 2000, now: () => 1 });
      const spy = vi.fn();
      bus.on('join', spy);
      bus.emit({ type: 'join', at: '', account: 'a', channel: 'c' });
      bus.emit({ type: 'join', at: '', account: 'a', channel: 'c' });
      expect(spy).toHaveBeenCalledTimes(2);
    });

    it('is disabled when chatDedupWindowMs is 0', () => {
      const bus = new EventBus({ chatDedupWindowMs: 0, now: () => 1 });
      const spy = vi.fn();
      bus.on('chat', spy);
      bus.emit(makeChat());
      bus.emit(makeChat());
      expect(spy).toHaveBeenCalledTimes(2);
    });
  });
});
