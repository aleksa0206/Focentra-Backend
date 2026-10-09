import { AppError } from './AppError';

export class LockedError extends AppError {
  constructor(message = 'Account is temporarily locked') {
    super(message, 423, 'ACCOUNT_LOCKED');
  }
}
