export interface TokenBucketOptions {
  capacity: number;
  refillWindowMs: number;
  now?: () => number;
}

export class TokenBucket {
  private tokens: number;
  private readonly capacity: number;
  private readonly ratePerMs: number;
  private lastRefill: number;
  private readonly now: () => number;

  constructor(opts: TokenBucketOptions) {
    if (opts.capacity <= 0) throw new Error('capacity must be > 0');
    if (opts.refillWindowMs <= 0) throw new Error('refillWindowMs must be > 0');
    this.capacity = opts.capacity;
    this.tokens = opts.capacity;
    this.ratePerMs = opts.capacity / opts.refillWindowMs;
    this.now = opts.now ?? Date.now;
    this.lastRefill = this.now();
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
