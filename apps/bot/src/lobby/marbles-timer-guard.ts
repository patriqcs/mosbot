const WINDOW_MS = 10 * 60 * 1000;
const MAX_CONCURRENT_STREAMS = 3;

export interface MarblesTimerGuardOptions {
  now?: () => number;
  windowMs?: number;
  maxConcurrent?: number;
}

export interface ActiveTimer {
  channel: string;
  startedAt: number;
  expiresAt: number;
}

export class MarblesTimerGuard {
  private readonly lastSent = new Map<string, number>();
  private readonly now: () => number;
  private readonly windowMs: number;
  private readonly maxConcurrent: number;

  constructor(opts: MarblesTimerGuardOptions = {}) {
    this.now = opts.now ?? Date.now;
    this.windowMs = opts.windowMs ?? WINDOW_MS;
    this.maxConcurrent = opts.maxConcurrent ?? MAX_CONCURRENT_STREAMS;
  }

  canSend(channel: string): { allowed: boolean; activeCount: number } {
    const ch = channel.toLowerCase();
    this.purge();
    if (this.lastSent.has(ch)) {
      return { allowed: true, activeCount: this.lastSent.size };
    }
    if (this.lastSent.size >= this.maxConcurrent) {
      return { allowed: false, activeCount: this.lastSent.size };
    }
    return { allowed: true, activeCount: this.lastSent.size };
  }

  record(channel: string): void {
    this.lastSent.set(channel.toLowerCase(), this.now());
  }

  active(): ActiveTimer[] {
    this.purge();
    const out: ActiveTimer[] = [];
    for (const [channel, startedAt] of this.lastSent) {
      out.push({ channel, startedAt, expiresAt: startedAt + this.windowMs });
    }
    return out;
  }

  private purge(): void {
    const cutoff = this.now() - this.windowMs;
    for (const [k, ts] of this.lastSent) {
      if (ts < cutoff) this.lastSent.delete(k);
    }
  }
}
