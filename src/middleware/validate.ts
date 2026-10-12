import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { ValidationError } from '../errors/ValidationError';

export function validate(schema: z.ZodType) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      const details = result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      }));
      const message = details.map((d) => `${d.path}: ${d.message}`).join(', ');
      return next(new ValidationError(message, details));
    }

    req.body = result.data;
    next();
  };
}
