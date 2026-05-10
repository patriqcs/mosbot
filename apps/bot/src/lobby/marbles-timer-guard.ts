const WINDOW_MS = 12 * 60 * 1000;
const MAX_STREAMS = 3;

export interface MarblesTimerGuardOptions {
  now?: () => number;
  windowMs?: number;
  maxStreams?: number;
  initial?: Iterable<readonly [string, number]>;
  initialSkipped?: Iterable<readonly [string, number]>;
  onRecord?: (channel: string, startedAt: number) => void;
  onExpire?: (channel: string) => void;
  onSkip?: (channel: string, startedAt: number) => void;
}

export interface ActiveTimer {
  channel: string;
  startedAt: number;
  expiresAt: number;
  skipped: boolean;
}

export class MarblesTimerGuard {
  private readonly lastSent = new Map<string, number>();
  private readonly skipped = new Map<string, number>();
  private readonly now: () => number;
  private readonly windowMs: number;
  private readonly maxStreams: number;
  private readonly onRecord?: (channel: string, startedAt: number) => void;
  private readonly onExpire?: (channel: string) => void;
  private readonly onSkip?: (channel: string, startedAt: number) => void;

  constructor(opts: MarblesTimerGuardOptions = {}) {
    this.now = opts.now ?? Date.now;
    this.windowMs = opts.windowMs ?? WINDOW_MS;
    this.maxStreams = opts.maxStreams ?? MAX_STREAMS;
    if (opts.onRecord) this.onRecord = opts.onRecord;
    if (opts.onExpire) this.onExpire = opts.onExpire;
    if (opts.onSkip) this.onSkip = opts.onSkip;
    if (opts.initial) {
      for (const [ch, ts] of opts.initial) {
        this.lastSent.set(ch.toLowerCase(), ts);
      }
    }
    if (opts.initialSkipped) {
      for (const [ch, ts] of opts.initialSkipped) {
        this.skipped.set(ch.toLowerCase(), ts);
      }
    }
  }

  canSend(channel: string): {
    allowed: boolean;
    activeCount: number;
    reason?: 'slot-taken' | 'skipped';
  } {
    const ch = channel.toLowerCase();
    this.purge();
    if (this.skipped.has(ch)) {
      return { allowed: false, activeCount: this.lastSent.size, reason: 'skipped' };
    }
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
    this.skipped.delete(ch);
    this.onRecord?.(ch, ts);
  }

  skip(channel: string): boolean {
    const ch = channel.toLowerCase();
    this.purge();
    const startedAt = this.lastSent.get(ch);
    if (startedAt === undefined) return false;
    this.lastSent.delete(ch);
    this.skipped.set(ch, startedAt);
    this.onSkip?.(ch, startedAt);
    return true;
  }

  isSkipped(channel: string): boolean {
    this.purge();
    return this.skipped.has(channel.toLowerCase());
  }

  isActive(channel: string): boolean {
    this.purge();
    return this.lastSent.has(channel.toLowerCase());
  }

  active(): ActiveTimer[] {
    this.purge();
    const out: ActiveTimer[] = [];
    for (const [channel, startedAt] of this.lastSent) {
      out.push({ channel, startedAt, expiresAt: startedAt + this.windowMs, skipped: false });
    }
    for (const [channel, startedAt] of this.skipped) {
      out.push({ channel, startedAt, expiresAt: startedAt + this.windowMs, skipped: true });
    }
    return out;
  }

  shortestRemaining(): ActiveTimer | null {
    this.purge();
    let best: ActiveTimer | null = null;
    for (const [channel, startedAt] of this.lastSent) {
      const t: ActiveTimer = {
        channel,
        startedAt,
        expiresAt: startedAt + this.windowMs,
        skipped: false,
      };
      if (!best || t.expiresAt < best.expiresAt) best = t;
    }
    return best;
  }

  private purge(): void {
    const cutoff = this.now() - this.windowMs;
    for (const [k, ts] of this.lastSent) {
      if (ts < cutoff) {
        this.lastSent.delete(k);
        this.onExpire?.(k);
      }
    }
    for (const [k, ts] of this.skipped) {
      if (ts < cutoff) {
        this.skipped.delete(k);
        this.onExpire?.(k);
      }
    }
  }
}
