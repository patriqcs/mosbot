import { RefreshingAuthProvider, exchangeCode } from '@twurple/auth';
import type { AccessToken } from '@twurple/auth';
import { ApiClient } from '@twurple/api';
import type { Logger } from 'pino';
import type { AuthEvent } from '@mosbot/shared';
import type { EventBus } from '../events/bus.js';
import { DeviceCodeFlow } from './device-code-flow.js';
import type { DeviceCodeResponse } from './device-code-flow.js';
import type { StoredToken, TokenStore } from './token-store.js';

const SCOPES = ['chat:read', 'chat:edit', 'user:read:email'];

export interface AccountRuntime {
  name: string;
  clientId: string;
  provider: RefreshingAuthProvider;
  api: ApiClient;
  userId: string;
  userLogin: string;
}

export interface PendingDeviceLogin {
  clientId: string;
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  intervalSeconds: number;
  expiresAt: number;
}

export interface AuthManagerDeps {
  store: TokenStore;
  bus: EventBus;
  logger: Logger;
  dcf?: DeviceCodeFlow;
  now?: () => number;
}

const toAccessToken = (t: StoredToken): AccessToken => ({
  accessToken: t.accessToken,
  refreshToken: t.refreshToken,
  scope: t.scopes,
  expiresIn: Math.max(0, Math.floor((t.expiresAt - Date.now()) / 1000)),
  obtainmentTimestamp: t.obtainedAt,
});

export class AuthManager {
  private readonly store: TokenStore;
  private readonly bus: EventBus;
  private readonly logger: Logger;
  private readonly dcf: DeviceCodeFlow;
  private readonly now: () => number;
  private readonly pending = new Map<string, PendingDeviceLogin>();
  private readonly accounts = new Map<string, AccountRuntime>();

  constructor(deps: AuthManagerDeps) {
    this.store = deps.store;
    this.bus = deps.bus;
    this.logger = deps.logger.child({ module: 'auth' });
    this.dcf = deps.dcf ?? new DeviceCodeFlow();
    this.now = deps.now ?? Date.now;
  }

  get(accountName: string): AccountRuntime | undefined {
    return this.accounts.get(accountName);
  }

  all(): AccountRuntime[] {
    return [...this.accounts.values()];
  }

  getPending(accountName: string): PendingDeviceLogin | undefined {
    return this.pending.get(accountName);
  }

  async tryRestore(accountName: string, clientId: string): Promise<boolean> {
    const stored = this.store.load(accountName);
    if (!stored) return false;
    try {
      await this.bindAccount(accountName, clientId, stored);
      return true;
    } catch (err) {
      this.logger.warn({ account: accountName, err }, 'failed to restore account');
      return false;
    }
  }

  async beginDeviceLogin(accountName: string, clientId: string): Promise<DeviceCodeResponse> {
    const res = await this.dcf.start(clientId, SCOPES);
    const entry: PendingDeviceLogin = {
      clientId,
      deviceCode: res.device_code,
      userCode: res.user_code,
      verificationUri: res.verification_uri,
      intervalSeconds: res.interval,
      expiresAt: this.now() + res.expires_in * 1000,
    };
    this.pending.set(accountName, entry);
    this.emit({
      type: 'auth',
      at: new Date().toISOString(),
      account: accountName,
      phase: 'device-code',
      userCode: res.user_code,
      verificationUri: res.verification_uri,
    });
    void this.pollToCompletion(accountName).catch((err) => {
      this.logger.error({ err, account: accountName }, 'device-code polling crashed');
    });
    return res;
  }

  private async pollToCompletion(accountName: string): Promise<void> {
    const pending = this.pending.get(accountName);
    if (!pending) return;
    let interval = pending.intervalSeconds;
    while (this.pending.get(accountName) === pending) {
      if (this.now() > pending.expiresAt) {
        this.pending.delete(accountName);
        this.emit({
          type: 'auth',
          at: new Date().toISOString(),
          account: accountName,
          phase: 'failure',
          message: 'device code expired',
        });
        return;
      }
      await sleep(interval * 1000);
      const outcome = await this.dcf.pollOnce(
        pending.clientId,
        pending.deviceCode,
        SCOPES,
      );
      if (outcome.kind === 'pending') continue;
      if (outcome.kind === 'slow_down') {
        interval += 5;
        continue;
      }
      if (outcome.kind === 'ok') {
        this.pending.delete(accountName);
        const token: StoredToken = {
          accessToken: outcome.token.access_token,
          refreshToken: outcome.token.refresh_token,
          expiresAt: this.now() + outcome.token.expires_in * 1000,
          obtainedAt: this.now(),
          scopes: outcome.token.scope ?? SCOPES,
        };
        this.store.save(accountName, token);
        await this.bindAccount(accountName, pending.clientId, token);
        this.emit({
          type: 'auth',
          at: new Date().toISOString(),
          account: accountName,
          phase: 'authorized',
        });
        return;
      }
      this.pending.delete(accountName);
      this.emit({
        type: 'auth',
        at: new Date().toISOString(),
        account: accountName,
        phase: 'failure',
        message: outcome.kind === 'error' ? outcome.message : outcome.kind,
      });
      return;
    }
  }

  cancelDeviceLogin(accountName: string): void {
    this.pending.delete(accountName);
  }

  private async bindAccount(
    accountName: string,
    clientId: string,
    token: StoredToken,
  ): Promise<void> {
    let resolvedUserId = token.userId;
    let resolvedUserLogin = token.userLogin;
    if (!resolvedUserId || !resolvedUserLogin) {
      const me = await this.resolveUser(clientId, token.accessToken);
      resolvedUserId = me.id;
      resolvedUserLogin = me.login;
    }

    const provider = new RefreshingAuthProvider({
      clientId,
      clientSecret: '',
      appImpliedScopes: SCOPES,
    });
    provider.onRefresh((_, refreshed) => {
      this.persistRefresh(accountName, refreshed);
    });
    await provider.addUserForToken(
      {
        ...toAccessToken(token),
        userId: resolvedUserId,
      } as unknown as AccessToken,
      ['chat'],
    );
    const api = new ApiClient({ authProvider: provider });
    const rt: AccountRuntime = {
      name: accountName,
      clientId,
      provider,
      api,
      userId: resolvedUserId,
      userLogin: resolvedUserLogin,
    };
    this.accounts.set(accountName, rt);
    const updated: StoredToken = { ...token, userId: resolvedUserId, userLogin: resolvedUserLogin };
    this.store.save(accountName, updated);
    this.logger.info({ account: accountName, user: resolvedUserLogin }, 'account authorized');
  }

  private persistRefresh(accountName: string, access: AccessToken): void {
    const existing = this.store.load(accountName);
    const token: StoredToken = {
      accessToken: access.accessToken,
      refreshToken: access.refreshToken ?? existing?.refreshToken ?? '',
      expiresAt:
        access.obtainmentTimestamp + (access.expiresIn ?? 4 * 60 * 60) * 1000,
      obtainedAt: access.obtainmentTimestamp,
      scopes: access.scope,
      ...(existing?.userId !== undefined ? { userId: existing.userId } : {}),
      ...(existing?.userLogin !== undefined ? { userLogin: existing.userLogin } : {}),
    };
    this.store.save(accountName, token);
    this.emit({
      type: 'auth',
      at: new Date().toISOString(),
      account: accountName,
      phase: 'refresh',
    });
  }

  private emit(ev: AuthEvent): void {
    this.bus.emit(ev);
  }

  private async resolveUser(
    clientId: string,
    accessToken: string,
  ): Promise<{ id: string; login: string }> {
    const res = await fetch('https://api.twitch.tv/helix/users', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Client-Id': clientId,
      },
    });
    if (!res.ok) {
      throw new Error(`helix/users ${res.status}: ${await res.text()}`);
    }
    const json = (await res.json()) as { data?: Array<{ id: string; login: string }> };
    const first = json.data?.[0];
    if (!first) throw new Error('helix/users returned no user');
    return { id: first.id, login: first.login };
  }

  logout(accountName: string): void {
    this.accounts.delete(accountName);
    this.pending.delete(accountName);
    this.store.clear(accountName);
  }
}

export const __exchangeCodeShim = exchangeCode;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));
