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

// Above this many tracked channels, sweep out dead states on the next observe.
// Far higher than the realistic count of concurrently active Marbles lobbies,
// so the sweep is rare; it only bounds growth from churn (discovery cycling
// through ever-changing channels over a long-running session).
const PRUNE_THRESHOLD = 256;

export class LobbyDetector {
  private readonly channels = new Map<string, ChannelState>();
  private windowMs: number;
  private minPlayers: number;
  private cooldownMs: number;
  private readonly now: () => number;

  constructor(opts: LobbyDetectorOptions) {
    if (opts.windowMs <= 0) throw new Error('windowMs must be > 0');
    if (opts.minPlayers < 1) throw new Error('minPlayers must be >= 1');
    this.windowMs = opts.windowMs;
    this.minPlayers = opts.minPlayers;
    this.cooldownMs = opts.cooldownMs;
    this.now = opts.now ?? Date.now;
  }

  update(opts: Partial<Pick<LobbyDetectorOptions, 'windowMs' | 'minPlayers' | 'cooldownMs'>>): void {
    if (opts.windowMs !== undefined) {
      if (opts.windowMs <= 0) throw new Error('windowMs must be > 0');
      this.windowMs = opts.windowMs;
    }
    if (opts.minPlayers !== undefined) {
      if (opts.minPlayers < 1) throw new Error('minPlayers must be >= 1');
      this.minPlayers = opts.minPlayers;
    }
    if (opts.cooldownMs !== undefined) {
      this.cooldownMs = opts.cooldownMs;
    }
  }

  observe(channel: string, user: string): { triggered: boolean; distinctUsers: number } {
    const ch = channel.toLowerCase();
    const u = user.toLowerCase();
    if (this.channels.size > PRUNE_THRESHOLD) this.pruneDead();
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

  hasObservedLobby(channel: string): boolean {
    const state = this.channels.get(channel.toLowerCase());
    if (!state) return false;
    const cutoff = this.now() - this.windowMs;
    let distinct = 0;
    for (const ts of state.recent.values()) {
      if (ts >= cutoff) distinct++;
    }
    return distinct >= this.minPlayers;
  }

  reset(channel?: string): void {
    if (channel) this.channels.delete(channel.toLowerCase());
    else this.channels.clear();
  }

  /** Number of tracked channel states (for tests/diagnostics). */
  size(): number {
    return this.channels.size;
  }

  /**
   * Drop states for channels that are off cooldown and have no in-window
   * activity left — they carry no information and would otherwise accumulate
   * forever as discovery cycles through channels.
   */
  private pruneDead(): void {
    const t = this.now();
    const cutoff = t - this.windowMs;
    for (const [ch, state] of this.channels) {
      if (t < state.cooldownUntil) continue;
      let alive = false;
      for (const ts of state.recent.values()) {
        if (ts >= cutoff) {
          alive = true;
          break;
        }
      }
      if (!alive) this.channels.delete(ch);
    }
  }
}
