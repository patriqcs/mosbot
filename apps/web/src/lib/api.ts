import type {
  BotStatus,
  StreamListItem,
  StatsResponse,
  StatsRange,
  DeviceCodeLoginResponse,
  ApiEnvelope,
} from '@mosbot/shared';

const unwrap = async <T>(res: Response): Promise<T> => {
  const json = (await res.json()) as ApiEnvelope<T>;
  if (!res.ok || !json.success) {
    throw new Error(json.error ?? `request failed (${res.status})`);
  }
  if (json.data === null) throw new Error('empty response');
  return json.data;
};

export const api = {
  login: async (username: string, password: string): Promise<{ username: string }> => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ username, password }),
    });
    return unwrap(res);
  },
  logout: async (): Promise<void> => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
  },
  me: async (): Promise<{ username: string }> => {
    const res = await fetch('/api/auth/me', { credentials: 'include' });
    return unwrap(res);
  },
  status: async (): Promise<BotStatus> => {
    const res = await fetch('/api/status', { credentials: 'include' });
    return unwrap(res);
  },
  streams: async (): Promise<StreamListItem[]> => {
    const res = await fetch('/api/streams', { credentials: 'include' });
    return unwrap(res);
  },
  stats: async (range: StatsRange): Promise<StatsResponse> => {
    const res = await fetch(`/api/stats?range=${range}`, { credentials: 'include' });
    return unwrap(res);
  },
  startBot: async (): Promise<{ running: boolean }> => {
    const res = await fetch('/api/bot/start', { method: 'POST', credentials: 'include' });
    return unwrap(res);
  },
  stopBot: async (): Promise<{ running: boolean }> => {
    const res = await fetch('/api/bot/stop', { method: 'POST', credentials: 'include' });
    return unwrap(res);
  },
  loginAccount: async (name: string): Promise<DeviceCodeLoginResponse> => {
    const res = await fetch(`/api/accounts/${encodeURIComponent(name)}/login`, {
      method: 'POST',
      credentials: 'include',
    });
    return unwrap(res);
  },
  logoutAccount: async (name: string): Promise<void> => {
    await fetch(`/api/accounts/${encodeURIComponent(name)}/logout`, {
      method: 'POST',
      credentials: 'include',
    });
  },
  setLogLevel: async (level: string): Promise<void> => {
    await fetch('/api/logs/level', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ level }),
    });
  },
  getConfig: async (): Promise<{ raw: string; path: string }> => {
    const res = await fetch('/api/config', { credentials: 'include' });
    return unwrap(res);
  },
  saveConfig: async (raw: string): Promise<{ restartRequired: boolean; path: string }> => {
    const res = await fetch('/api/config', {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw }),
    });
    return unwrap(res);
  },
};
