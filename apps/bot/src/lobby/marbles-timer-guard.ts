const WINDOW_MS = 12 * 60 * 1000;
const MAX_STREAMS = 3;

export interface MarblesTimerGuardOptions {
  now?: () => number;
  windowMs?: number;
  maxStreams?: number;
  initial?: Iterable<readonly [string, number]>;
  onRecord?: (channel: string, startedAt: number) => void;
  onExpire?: (channel: string) => void;
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
  private readonly maxStreams: number;
  private readonly onRecord?: (channel: string, startedAt: number) => void;
  private readonly onExpire?: (channel: string) => void;

  constructor(opts: MarblesTimerGuardOptions = {}) {
    this.now = opts.now ?? Date.now;
    this.windowMs = opts.windowMs ?? WINDOW_MS;
    this.maxStreams = opts.maxStreams ?? MAX_STREAMS;
    if (opts.onRecord) this.onRecord = opts.onRecord;
    if (opts.onExpire) this.onExpire = opts.onExpire;
    if (opts.initial) {
      for (const [ch, ts] of opts.initial) {
        this.lastSent.set(ch.toLowerCase(), ts);
      }
    }
  }

  canSend(channel: string): { allowed: boolean; activeCount: number; reason?: 'slot-taken' } {
    const ch = channel.toLowerCase();
    this.purge();
    if (this.lastSent.has(ch)) {
      return { allowed: true, activeCount: this.lastSent.size };
    }
    if (this.lastSent.size >= this.maxStreams) {
      return { allowed: false, activeCount: this.lastSent.size, reason: 'slot-taken' };
    }
    return { allowed: true, activeCount: this.lastSent.size };
  }

  record(channel: string): void {
    const ch = channel.toLowerCase();
    const ts = this.now();
    this.lastSent.set(ch, ts);
    this.onRecord?.(ch, ts);
  }

  active(): ActiveTimer[] {
    this.purge();
    return [...this.lastSent.entries()].map(([channel, startedAt]) => ({
      channel,
      startedAt,
      expiresAt: startedAt + this.windowMs,
    }));
  }

  private purge(): void {
    const cutoff = this.now() - this.windowMs;
    for (const [k, ts] of this.lastSent) {
      if (ts < cutoff) {
        this.lastSent.delete(k);
        this.onExpire?.(k);
      }
    }
  }
}
