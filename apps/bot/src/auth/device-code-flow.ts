import { z } from 'zod';

const TWITCH_DEVICE_URL = 'https://id.twitch.tv/oauth2/device';
const TWITCH_TOKEN_URL = 'https://id.twitch.tv/oauth2/token';

export const DeviceCodeResponse = z.object({
  device_code: z.string(),
  user_code: z.string(),
  verification_uri: z.string().url(),
  expires_in: z.number().int().positive(),
  interval: z.number().int().positive(),
});
export type DeviceCodeResponse = z.infer<typeof DeviceCodeResponse>;

export const TokenResponse = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  expires_in: z.number().int().positive(),
  token_type: z.string(),
  scope: z.array(z.string()).optional(),
});
export type TokenResponse = z.infer<typeof TokenResponse>;

export const TokenErrorResponse = z.object({
  error: z.string(),
  message: z.string().optional(),
  status: z.number().int().optional(),
});

export interface DeviceCodeFlowDeps {
  fetch?: typeof fetch;
}

export class DeviceCodeFlow {
  private readonly fetch: typeof fetch;

  constructor(deps: DeviceCodeFlowDeps = {}) {
    this.fetch = deps.fetch ?? globalThis.fetch;
  }

  async start(clientId: string, scopes: string[]): Promise<DeviceCodeResponse> {
    const body = new URLSearchParams({
      client_id: clientId,
      scopes: scopes.join(' '),
    });
    const res = await this.fetch(TWITCH_DEVICE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) {
      throw new Error(`device-code start failed: ${res.status} ${await res.text()}`);
    }
    return DeviceCodeResponse.parse(await res.json());
  }

  async pollOnce(
    clientId: string,
    deviceCode: string,
    scopes: string[],
  ): Promise<
    | { kind: 'pending' }
    | { kind: 'slow_down' }
    | { kind: 'expired' }
    | { kind: 'denied' }
    | { kind: 'ok'; token: TokenResponse }
    | { kind: 'error'; message: string }
  > {
    const body = new URLSearchParams({
      client_id: clientId,
      scopes: scopes.join(' '),
      device_code: deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    });
    const res = await this.fetch(TWITCH_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const json = (await res.json()) as unknown;
    if (res.ok) {
      const parsed = TokenResponse.safeParse(json);
      if (!parsed.success) return { kind: 'error', message: 'malformed token response' };
      return { kind: 'ok', token: parsed.data };
    }
    const err = TokenErrorResponse.safeParse(json);
    const code = err.success ? err.data.message ?? err.data.error : String(res.status);
    if (code === 'authorization_pending') return { kind: 'pending' };
    if (code === 'slow_down') return { kind: 'slow_down' };
    if (code === 'expired_token' || code === 'expired_code') return { kind: 'expired' };
    if (code === 'access_denied') return { kind: 'denied' };
    return { kind: 'error', message: code };
  }
}
