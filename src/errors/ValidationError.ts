import { AppError } from './AppError';

export type ValidationIssue = { path: string; message: string };

export class ValidationError extends AppError {
  constructor(
    message: string,
    public readonly details?: ValidationIssue[]
  ) {
    super(message, 400);
  }
}
