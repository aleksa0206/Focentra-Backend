import { AppError } from './AppError';

export class TwoFactorRequiredError extends AppError {
  constructor(public readonly tempToken: string) {
    super('Two-factor authentication code required', 401);
  }
}
