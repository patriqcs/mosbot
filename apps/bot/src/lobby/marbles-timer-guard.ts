const WINDOW_MS = 10 * 60 * 1000 + 5_000;
const MAX_ACTIVE = 3;

export interface MarblesTimerGuardOptions {
  now?: () => number;
  windowMs?: number;
  maxActive?: number;
}

export interface ActiveTimer {
  startedAt: number;
  expiresAt: number;
  channel?: string;
}

interface Entry {
  startedAt: number;
  channel?: string;
}

export class MarblesTimerGuard {
  private readonly entries: Entry[] = [];
  private readonly now: () => number;
  private readonly windowMs: number;
  private readonly maxActive: number;

  constructor(opts: MarblesTimerGuardOptions = {}) {
    this.now = opts.now ?? Date.now;
    this.windowMs = opts.windowMs ?? WINDOW_MS;
    this.maxActive = opts.maxActive ?? MAX_ACTIVE;
  }

  canSend(): { allowed: boolean; activeCount: number } {
    this.purge();
    return {
      allowed: this.entries.length < this.maxActive,
      activeCount: this.entries.length,
    };
  }

  record(channel?: string): void {
    const entry: Entry = { startedAt: this.now() };
    if (channel) entry.channel = channel;
    this.entries.push(entry);
  }

  active(): ActiveTimer[] {
    this.purge();
    return this.entries.map((e) => ({
      startedAt: e.startedAt,
      expiresAt: e.startedAt + this.windowMs,
      ...(e.channel ? { channel: e.channel } : {}),
    }));
  }

  private purge(): void {
    const cutoff = this.now() - this.windowMs;
    while (this.entries.length > 0 && this.entries[0]!.startedAt < cutoff) {
      this.entries.shift();
    }
  }
}
