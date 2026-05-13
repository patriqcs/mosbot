import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import pino from 'pino';
import { Discovery } from './discovery.js';

const silent = pino({ level: 'silent' });

const makeDeps = () => ({
  clientId: 'cid',
  getAccessToken: async () => 'tok',
  config: {
    intervalMinutes: 3,
    maxStreams: 10,
    minViewers: 30,
    language: null,
    sortBy: 'most-viewers' as const,
  },
  logger: silent,
});

const helixStream = (login: string, viewerCount = 5) => ({
  user_id: 'u-' + login,
  user_login: login,
  user_name: login,
  game_id: '12345',
  title: 't',
  viewer_count: viewerCount,
  language: 'en',
  thumbnail_url: 'https://x/{width}x{height}',
  started_at: '2026-05-13T00:00:00Z',
});

describe('Discovery.fetchLiveStreamsForLogins', () => {
  const origFetch = globalThis.fetch;
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  it('returns [] for empty input without calling helix', async () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const d = new Discovery(makeDeps());
    expect(await d.fetchLiveStreamsForLogins([])).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('queries /streams with user_login params, no game_id and no minViewers filter', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [helixStream('alice', 2), helixStream('bob', 0)] }),
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const d = new Discovery(makeDeps());
    const out = await d.fetchLiveStreamsForLogins(['Alice', 'BOB', 'alice']);

    expect(out.map((s) => s.userLogin).sort()).toEqual(['alice', 'bob']);
    const [url] = fetchSpy.mock.calls[0];
    expect(url).toContain('/streams?');
    expect(url).toContain('user_login=alice');
    expect(url).toContain('user_login=bob');
    expect(url).not.toContain('game_id');
  });

  it('batches in chunks of 100', async () => {
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [] }) });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const logins = Array.from({ length: 150 }, (_, i) => `user${i}`);
    const d = new Discovery(makeDeps());
    await d.fetchLiveStreamsForLogins(logins);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
