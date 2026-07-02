export interface TokenBucketOptions {
  capacity: number;
  refillWindowMs: number;
  now?: () => number;
}

export class TokenBucket {
  private tokens: number;
  private capacity: number;
  private refillWindowMs: number;
  private ratePerMs: number;
  private lastRefill: number;
  private readonly now: () => number;

  constructor(opts: TokenBucketOptions) {
    if (opts.capacity <= 0) throw new Error('capacity must be > 0');
    if (opts.refillWindowMs <= 0) throw new Error('refillWindowMs must be > 0');
    this.capacity = opts.capacity;
    this.tokens = opts.capacity;
    this.refillWindowMs = opts.refillWindowMs;
    this.ratePerMs = opts.capacity / opts.refillWindowMs;
    this.now = opts.now ?? Date.now;
    this.lastRefill = this.now();
  }

  update(opts: Partial<Pick<TokenBucketOptions, 'capacity' | 'refillWindowMs'>>): void {
    // Settle tokens accrued so far at the CURRENT rate before changing it,
    // otherwise the whole un-refilled interval would be repriced at the new
    // rate (losing earned tokens when slowing down, over-crediting when
    // speeding up).
    this.refill();
    if (opts.capacity !== undefined) {
      if (opts.capacity <= 0) throw new Error('capacity must be > 0');
      this.capacity = opts.capacity;
      if (this.tokens > this.capacity) this.tokens = this.capacity;
    }
    if (opts.refillWindowMs !== undefined) {
      if (opts.refillWindowMs <= 0) throw new Error('refillWindowMs must be > 0');
      this.refillWindowMs = opts.refillWindowMs;
    }
    // Rate is capacity per window; recompute after either input changes so a
    // capacity-only update (the hot-reload path in orchestrator) keeps the
    // "refill `capacity` tokens every `refillWindowMs`" invariant.
    this.ratePerMs = this.capacity / this.refillWindowMs;
  }

  private refill(): void {
    const n = this.now();
    const elapsed = n - this.lastRefill;
    if (elapsed <= 0) return;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.ratePerMs);
    this.lastRefill = n;
  }

  tryConsume(cost = 1): boolean {
    this.refill();
    if (this.tokens + 1e-9 < cost) return false;
    this.tokens -= cost;
    return true;
  }

  available(): number {
    this.refill();
    return this.tokens;
  }
}
