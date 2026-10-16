import type { Request, Response, NextFunction } from 'express';
import * as rateLimitRepository from '../repositories/rateLimitRepository';
import { logger } from '../config/logger';

export function dbRateLimit(options: { name: string; windowMs: number; max: number }) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      // The route pattern (/invites/:token), not the URL: one bucket per endpoint, whatever the
      // id or token in it. App-level limiters have no route and count all requests of an IP.
      const count = await rateLimitRepository.hit(
        `${options.name}:${req.ip}:${req.route?.path ?? ''}`,
        options.windowMs
      );
      if (count > options.max) {
        res
          .status(429)
          .json({ error: 'Too many requests, please try again later.', code: 'RATE_LIMITED' });
        return;
      }
      next();
    } catch (err) {
      // Fail open: a database hiccup shouldn't take the API down, but it must not go unnoticed.
      // Account lockout still protects passwords while this happens.
      logger.error({ err, limiter: options.name }, 'Rate limiter failed, request let through');
      next();
    }
  };
}

export const generalRateLimiter = dbRateLimit({ name: 'general', windowMs: 15 * 60_000, max: 600 });
export const authRateLimiter = dbRateLimit({ name: 'auth', windowMs: 15 * 60_000, max: 10 });
