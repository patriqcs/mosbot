import { describe, it, expect } from 'vitest';
import { WEEKDAYS } from '@mosbot/shared';
import { normalizeEditableConfig } from './normalize-config';

describe('normalizeEditableConfig', () => {
  it('returns null for non-object input', () => {
    expect(normalizeEditableConfig(null)).toBeNull();
    expect(normalizeEditableConfig(undefined)).toBeNull();
    expect(normalizeEditableConfig('string')).toBeNull();
    expect(normalizeEditableConfig(42)).toBeNull();
  });

  it('migrates legacy schedule.start/end to per-weekday windows', () => {
    const raw = {
      schedule: {
        enabled: false,
        start: '08:00',
        end: '22:00',
        timezone: 'UTC',
      },
    };
    const out = normalizeEditableConfig(raw)!;
    expect(out.schedule.enabled).toBe(false);
    expect(out.schedule.timezone).toBe('UTC');
    for (const d of WEEKDAYS) {
      expect(out.schedule.windows[d]).toEqual({ start: '08:00', end: '22:00' });
    }
    // legacy keys must not leak into the migrated config
    expect((out.schedule as unknown as Record<string, unknown>).start).toBeUndefined();
    expect((out.schedule as unknown as Record<string, unknown>).end).toBeUndefined();
  });

  it('keeps an existing windows object intact', () => {
    const raw = {
      schedule: {
        enabled: true,
        timezone: 'Europe/Berlin',
        windows: {
          mon: { start: '10:00', end: '12:00' },
          wed: { start: '14:00', end: '16:00' },
        },
      },
    };
    const out = normalizeEditableConfig(raw)!;
    expect(out.schedule.timezone).toBe('Europe/Berlin');
    expect(out.schedule.windows.mon).toEqual({ start: '10:00', end: '12:00' });
    expect(out.schedule.windows.wed).toEqual({ start: '14:00', end: '16:00' });
    expect(out.schedule.windows.tue).toBeUndefined();
  });

  it('fills schedule default when block is missing', () => {
    const out = normalizeEditableConfig({})!;
    expect(out.schedule.enabled).toBe(true);
    expect(typeof out.schedule.timezone).toBe('string');
    expect(out.schedule.timezone.length).toBeGreaterThan(0);
    for (const d of WEEKDAYS) {
      expect(out.schedule.windows[d]).toBeDefined();
    }
  });

  it('fills safety default when block is missing', () => {
    const out = normalizeEditableConfig({})!;
    expect(out.safety.preSendJitterMs.min).toBeGreaterThanOrEqual(0);
    expect(out.safety.preSendJitterMs.max).toBeGreaterThanOrEqual(
      out.safety.preSendJitterMs.min,
    );
    expect(out.safety.playProbability).toBeGreaterThan(0);
    expect(out.safety.playProbability).toBeLessThanOrEqual(1);
    expect(out.safety.scheduleJitterMinutes).toBeGreaterThanOrEqual(0);
    expect(out.safety.maxPlaysPerDay).toBeGreaterThanOrEqual(0);
  });

  it('preserves the existing safety block when present', () => {
    const raw = {
      safety: {
        preSendJitterMs: { min: 100, max: 200 },
        playProbability: 0.5,
        scheduleJitterMinutes: 3,
        maxPlaysPerDay: 25,
      },
    };
    const out = normalizeEditableConfig(raw)!;
    expect(out.safety).toEqual(raw.safety);
  });

  it('passes through other sections untouched', () => {
    const raw = {
      discovery: { intervalMinutes: 5 },
      lobby: { windowSeconds: 60 },
      channels: { whitelist: ['foo'] },
    };
    const out = normalizeEditableConfig(raw)!;
    expect((out as unknown as { discovery: { intervalMinutes: number } }).discovery
      .intervalMinutes).toBe(5);
    expect((out as unknown as { lobby: { windowSeconds: number } }).lobby
      .windowSeconds).toBe(60);
    expect((out as unknown as { channels: { whitelist: string[] } }).channels
      .whitelist).toEqual(['foo']);
  });
});
