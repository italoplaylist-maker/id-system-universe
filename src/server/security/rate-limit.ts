import { RateLimitedError } from "@/lib/errors";

/**
 * Fixed-window in-memory rate limiter. Good enough for a single-instance
 * admin panel (this is exactly how it will be deployed on Coolify); if this
 * ever runs multi-instance, swap the Map for a shared store (Redis) behind
 * the same `consume()` signature.
 */
const buckets = new Map<string, { count: number; resetAt: number }>();

export function consumeRateLimit(key: string, limit: number, windowMs: number): void {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return;
  }

  if (bucket.count >= limit) {
    throw new RateLimitedError();
  }

  bucket.count += 1;
}

// Periodic cleanup so the map doesn't grow unbounded on a long-lived process.
setInterval(
  () => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
  },
  5 * 60 * 1000,
).unref();
