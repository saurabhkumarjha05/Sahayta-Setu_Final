/**
 * In-memory sliding-window rate limiter with per-key windows.
 * Abstracted behind a clean interface so it can easily move to Redis later.
 */

class MemoryRateLimiter {
  constructor() {
    this.hits = new Map(); // key -> [timestamps]
    // Periodically clean up stale entries every 5 minutes
    this.cleanupInterval = setInterval(() => this.cleanup(), 5 * 60 * 1000);
    if (this.cleanupInterval.unref) {
      this.cleanupInterval.unref();
    }
  }

  check(key, maxRequests, windowMs) {
    const now = Date.now();
    const windowStart = now - windowMs;

    let timestamps = this.hits.get(key) || [];
    // Filter timestamps within current window
    timestamps = timestamps.filter((t) => t > windowStart);

    if (timestamps.length >= maxRequests) {
      const oldestInWindow = timestamps[0];
      const retryAfterSeconds = Math.max(1, Math.ceil((oldestInWindow + windowMs - now) / 1000));
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds
      };
    }

    timestamps.push(now);
    this.hits.set(key, timestamps);

    return {
      allowed: true,
      remaining: maxRequests - timestamps.length,
      retryAfterSeconds: 0
    };
  }

  reset(key) {
    this.hits.delete(key);
  }

  cleanup() {
    const now = Date.now();
    for (const [key, timestamps] of this.hits.entries()) {
      const active = timestamps.filter((t) => t > now - 60 * 60 * 1000);
      if (active.length === 0) {
        this.hits.delete(key);
      } else {
        this.hits.set(key, active);
      }
    }
  }
}

const limiter = new MemoryRateLimiter();

/**
 * Express middleware generator for rate limiting
 */
function createRateLimiter({ keyGenerator, maxRequests, windowMs, message }) {
  return (req, res, next) => {
    const key = keyGenerator ? keyGenerator(req) : `${req.ip || 'ip'}:${req.baseUrl || ''}${req.path}`;
    if (!key) return next();

    const result = limiter.check(key, maxRequests, windowMs);
    res.setHeader('X-RateLimit-Limit', maxRequests);
    res.setHeader('X-RateLimit-Remaining', result.remaining);

    if (!result.allowed) {
      res.setHeader('Retry-After', result.retryAfterSeconds);
      return res.status(429).json({
        error: message || 'Too many requests. Please try again later.',
        code: 'RATE_LIMIT_EXCEEDED',
        retryAfter: result.retryAfterSeconds
      });
    }

    next();
  };
}

module.exports = {
  limiter,
  createRateLimiter
};
