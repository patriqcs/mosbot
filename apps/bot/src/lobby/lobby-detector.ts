export interface LobbyDetectorOptions {
  windowMs: number;
  minPlayers: number;
  cooldownMs: number;
  now?: () => number;
}

interface ChannelState {
  recent: Map<string, number>;
  cooldownUntil: number;
}

export class LobbyDetector {
  private readonly channels = new Map<string, ChannelState>();
  private readonly windowMs: number;
  private readonly minPlayers: number;
  private readonly cooldownMs: number;
  private readonly now: () => number;

  constructor(opts: LobbyDetectorOptions) {
    if (opts.windowMs <= 0) throw new Error('windowMs must be > 0');
    if (opts.minPlayers < 1) throw new Error('minPlayers must be >= 1');
    this.windowMs = opts.windowMs;
    this.minPlayers = opts.minPlayers;
    this.cooldownMs = opts.cooldownMs;
    this.now = opts.now ?? Date.now;
  }

  observe(channel: string, user: string): { triggered: boolean; distinctUsers: number } {
    const ch = channel.toLowerCase();
    const u = user.toLowerCase();
    const state = this.channels.get(ch) ?? { recent: new Map(), cooldownUntil: 0 };
    const t = this.now();
    if (t < state.cooldownUntil) {
      this.channels.set(ch, state);
      return { triggered: false, distinctUsers: 0 };
    }
    const cutoff = t - this.windowMs;
    for (const [k, ts] of state.recent) {
      if (ts < cutoff) state.recent.delete(k);
    }
    state.recent.set(u, t);
    this.channels.set(ch, state);
    const distinctUsers = state.recent.size;
    return { triggered: distinctUsers >= this.minPlayers, distinctUsers };
  }

  markSent(channel: string): void {
    const ch = channel.toLowerCase();
    const state = this.channels.get(ch) ?? { recent: new Map(), cooldownUntil: 0 };
    state.recent.clear();
    state.cooldownUntil = this.now() + this.cooldownMs;
    this.channels.set(ch, state);
  }

  isOnCooldown(channel: string): boolean {
    const state = this.channels.get(channel.toLowerCase());
    if (!state) return false;
    return this.now() < state.cooldownUntil;
  }

  reset(channel?: string): void {
    if (channel) this.channels.delete(channel.toLowerCase());
    else this.channels.clear();
  }
}
