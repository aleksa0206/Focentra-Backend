import { AppError } from './AppError';

export class GoneError extends AppError {
  constructor(message: string, code?: string) {
    super(message, 410, code);
  }
}
