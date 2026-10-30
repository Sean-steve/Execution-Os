/**
 * Server-Side Rate Limiter & Abuse Prevention Middleware (EOS-007)
 * Implements sliding window rate limiting per user/device and sensitive endpoint throttling.
 */

import { Request, Response, NextFunction } from 'express';
import { RateLimitExceededError } from './errors';

export interface RateLimitOptions {
  windowMs: number; // Window duration in milliseconds (e.g. 60000 = 1 minute)
  maxRequests: number; // Max requests allowed per window
  keyGenerator?: (req: Request) => string;
}

interface RequestRecord {
  timestamps: number[];
}

export class RateLimiter {
  private records: Map<string, RequestRecord> = new Map();
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    // Periodically clean up stale client entries
    if (typeof setInterval !== 'undefined') {
      this.cleanupInterval = setInterval(() => this.cleanup(), 120000);
      if (this.cleanupInterval.unref) {
        this.cleanupInterval.unref();
      }
    }
  }

  createMiddleware(options: RateLimitOptions) {
    const { windowMs, maxRequests, keyGenerator } = options;

    return (req: Request, res: Response, next: NextFunction) => {
      const key = keyGenerator
        ? keyGenerator(req)
        : (req.user?.userId || (req.headers['x-user-id'] as string) || (req.headers['x-device-id'] as string) || req.ip || 'anonymous');

      const now = Date.now();
      const windowStart = now - windowMs;

      let record = this.records.get(key);
      if (!record) {
        record = { timestamps: [] };
        this.records.set(key, record);
      }

      // Filter timestamps inside current window
      record.timestamps = record.timestamps.filter(ts => ts > windowStart);

      const remaining = Math.max(0, maxRequests - record.timestamps.length);
      res.setHeader('X-RateLimit-Limit', maxRequests.toString());
      res.setHeader('X-RateLimit-Remaining', Math.max(0, remaining - 1).toString());
      res.setHeader('X-RateLimit-Reset', Math.ceil((now + windowMs) / 1000).toString());

      if (record.timestamps.length >= maxRequests) {
        const retryAfterSec = Math.ceil((record.timestamps[0] + windowMs - now) / 1000);
        res.setHeader('Retry-After', retryAfterSec.toString());
        return next(
          new RateLimitExceededError(`Rate limit exceeded. Maximum ${maxRequests} requests allowed per ${windowMs / 1000}s.`, {
            limit: maxRequests,
            windowMs,
            retryAfterSec,
            key,
          })
        );
      }

      record.timestamps.push(now);
      next();
    };
  }

  private cleanup() {
    const now = Date.now();
    const maxWindow = 3600000; // 1 hour max retention
    for (const [key, record] of this.records.entries()) {
      record.timestamps = record.timestamps.filter(ts => ts > now - maxWindow);
      if (record.timestamps.length === 0) {
        this.records.delete(key);
      }
    }
  }

  clear() {
    this.records.clear();
  }
}

export const defaultRateLimiter = new RateLimiter();
