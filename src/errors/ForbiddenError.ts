import { AppError } from './AppError';

export class ForbiddenError extends AppError {
  constructor(message = 'Access denied', code?: string) {
    super(message, 403, code);
  }
}
