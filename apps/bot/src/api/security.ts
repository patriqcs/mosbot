import { timingSafeEqual } from 'node:crypto';

/** Constant-time string comparison that does not leak length via early exit. */
export const safeStringEqual = (a: string, b: string): boolean => {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  // Compare against a fixed-length digest space so differing lengths still run
  // a full comparison (timingSafeEqual throws on length mismatch otherwise).
  const len = Math.max(ab.length, bb.length, 1);
  const pa = Buffer.alloc(len);
  const pb = Buffer.alloc(len);
  ab.copy(pa);
  bb.copy(pb);
  const equal = timingSafeEqual(pa, pb);
  return equal && ab.length === bb.length;
};

/**
 * Whether a WebSocket upgrade `origin` is allowed. WebSocket handshakes are not
 * covered by the same-origin policy or SameSite cookies, so without this check
 * any site the logged-in admin visits could open ws://host/api/stream and read
 * the event stream (cross-site WebSocket hijacking).
 *
 * Allows: a missing origin (native/non-browser clients like curl/Docker probes),
 * same-host origins on any port, and any explicitly configured origin.
 */
export const isAllowedOrigin = (
  origin: string | undefined,
  host: string | undefined,
  allowedOrigins: readonly string[] = [],
): boolean => {
  if (!origin) return true; // non-browser clients send no Origin header
  if (allowedOrigins.includes(origin)) return true;
  let originHost: string;
  try {
    originHost = new URL(origin).hostname;
  } catch {
    return false;
  }
  if (!host) return false;
  // host header may include a port (e.g. "192.168.1.10:8787")
  const reqHost = host.split(':')[0];
  return originHost === reqHost;
};

export interface LoginThrottleOptions {
  /** Max failed attempts within the window before lockout. */
  maxAttempts: number;
  /** Sliding window / lockout duration in ms. */
  windowMs: number;
  now?: () => number;
}

/**
 * Per-key (IP) failed-login throttle. Counts failures within a sliding window
 * and blocks once `maxAttempts` is reached until the window elapses. A success
 * clears the key.
 */
export class LoginThrottle {
  private readonly attempts = new Map<string, number[]>();
  private readonly maxAttempts: number;
  private readonly windowMs: number;
  private readonly now: () => number;

  constructor(opts: LoginThrottleOptions) {
    this.maxAttempts = opts.maxAttempts;
    this.windowMs = opts.windowMs;
    this.now = opts.now ?? Date.now;
  }

  private prune(key: string): number[] {
    const cutoff = this.now() - this.windowMs;
    const kept = (this.attempts.get(key) ?? []).filter((t) => t > cutoff);
    if (kept.length > 0) this.attempts.set(key, kept);
    else this.attempts.delete(key);
    return kept;
  }

  /** True if the key is currently locked out. */
  isBlocked(key: string): boolean {
    return this.prune(key).length >= this.maxAttempts;
  }

  /** Record a failed attempt. */
  recordFailure(key: string): void {
    const kept = this.prune(key);
    kept.push(this.now());
    this.attempts.set(key, kept);
  }

  /** Clear all recorded failures for a key (call on successful login). */
  reset(key: string): void {
    this.attempts.delete(key);
  }

  /** Seconds until the oldest in-window attempt expires (for Retry-After). */
  retryAfterSeconds(key: string): number {
    const kept = this.prune(key);
    if (kept.length === 0) return 0;
    const oldest = Math.min(...kept);
    return Math.max(0, Math.ceil((oldest + this.windowMs - this.now()) / 1000));
  }
}
