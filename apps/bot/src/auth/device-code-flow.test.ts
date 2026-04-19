import { describe, it, expect, vi } from 'vitest';
import { DeviceCodeFlow } from './device-code-flow.js';

const makeResponse = (status: number, body: unknown): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }) as unknown as Response;

describe('DeviceCodeFlow', () => {
  it('starts a device-code exchange', async () => {
    const fetch = vi.fn().mockResolvedValue(
      makeResponse(200, {
        device_code: 'dc',
        user_code: 'ABCD-EFGH',
        verification_uri: 'https://twitch.tv/activate',
        expires_in: 1800,
        interval: 5,
      }),
    );
    const flow = new DeviceCodeFlow({ fetch });
    const res = await flow.start('client', ['chat:read']);
    expect(res.user_code).toBe('ABCD-EFGH');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('maps authorization_pending to pending', async () => {
    const fetch = vi.fn().mockResolvedValue(
      makeResponse(400, { error: 'authorization_pending' }),
    );
    const flow = new DeviceCodeFlow({ fetch });
    const outcome = await flow.pollOnce('c', 'd', ['chat:read']);
    expect(outcome.kind).toBe('pending');
  });

  it('returns ok with parsed token on success', async () => {
    const fetch = vi.fn().mockResolvedValue(
      makeResponse(200, {
        access_token: 'a',
        refresh_token: 'r',
        expires_in: 14_400,
        token_type: 'bearer',
        scope: ['chat:read'],
      }),
    );
    const flow = new DeviceCodeFlow({ fetch });
    const outcome = await flow.pollOnce('c', 'd', ['chat:read']);
    expect(outcome.kind).toBe('ok');
    if (outcome.kind === 'ok') expect(outcome.token.access_token).toBe('a');
  });

  it('maps expired_token / access_denied', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(makeResponse(400, { error: 'expired_token' }))
      .mockResolvedValueOnce(makeResponse(400, { error: 'access_denied' }));
    const flow = new DeviceCodeFlow({ fetch });
    expect((await flow.pollOnce('c', 'd', [])).kind).toBe('expired');
    expect((await flow.pollOnce('c', 'd', [])).kind).toBe('denied');
  });
});
