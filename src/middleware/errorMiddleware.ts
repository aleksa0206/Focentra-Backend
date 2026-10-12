import type { Request, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import { AppError } from '../errors/AppError';
import { TwoFactorRequiredError } from '../errors/TwoFactorRequiredError';
import { ValidationError } from '../errors/ValidationError';
import { logger } from '../config/logger';

export function errorMiddleware(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof TwoFactorRequiredError) {
    res.status(err.statusCode).json({
      error: err.message,
      code: 'TWO_FACTOR_REQUIRED',
      tempToken: err.tempToken,
    });
    return;
  }

  // Query and path parameters are parsed with schema.parse() in controllers.
  if (err instanceof ZodError) {
    const details = err.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    }));
    res.status(400).json({
      error: details.map((d) => `${d.path}: ${d.message}`).join(', '),
      code: 'VALIDATION_FAILED',
      details,
    });
    return;
  }

  if (err instanceof ValidationError) {
    res.status(400).json({ error: err.message, code: 'VALIDATION_FAILED', details: err.details });
    return;
  }

  if (err instanceof AppError) {
    if ([401, 403, 423].includes(err.statusCode)) {
      logger.warn(
        { path: req.path, method: req.method, status: err.statusCode, userId: req.user?.userId },
        'Security-relevant denial'
      );
    }
    res
      .status(err.statusCode)
      .json({ error: err.message, ...(err.code && { code: err.code }), ...err.meta });
    return;
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      res.status(409).json({ error: 'A record with this value already exists', code: 'CONFLICT' });
      return;
    }
    if (err.code === 'P2025') {
      res.status(404).json({ error: 'Record not found', code: 'NOT_FOUND' });
      return;
    }
  }

  if (err && typeof err === 'object' && 'type' in err) {
    const type = (err as { type?: string }).type;
    if (type === 'entity.parse.failed') {
      res.status(400).json({ error: 'Malformed JSON body', code: 'VALIDATION_FAILED' });
      return;
    }
    if (type === 'entity.too.large') {
      res.status(413).json({ error: 'Request body too large' });
      return;
    }
  }

  logger.error({ err, path: req.path, method: req.method }, 'Unhandled error');
  res.status(500).json({ error: 'Internal server error' });
}
