import { ApiError } from './errors';

/**
 * Small in-memory rate limiter keyed by caller-supplied strings (ip, email…).
 * State resets on restart and is per process, which is adequate for a single
 * instance; a shared store is the documented upgrade path.
 */
export interface Throttle {
  hit: (key: string) => void;
  clear: (key: string) => void;
  reset: () => void;
}

export function createThrottle(options: { windowMs: number; max: number; message: string }): Throttle {
  const attempts = new Map<string, { count: number; firstAt: number }>();
  return {
    hit(key) {
      const now = Date.now();
      const entry = attempts.get(key);
      if (!entry || now - entry.firstAt > options.windowMs) {
        attempts.set(key, { count: 1, firstAt: now });
        return;
      }
      entry.count += 1;
      if (entry.count > options.max) {
        throw new ApiError('RATE_LIMITED', options.message);
      }
    },
    clear(key) {
      attempts.delete(key);
    },
    reset() {
      attempts.clear();
    },
  };
}
