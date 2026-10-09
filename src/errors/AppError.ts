export class AppError extends Error {
  public readonly statusCode: number;
  // Machine-readable reason for the frontend when the status alone is ambiguous (two kinds of 409).
  public readonly code: string | undefined;
  // Extra fields for the response body, e.g. the entry a new one overlaps with.
  public meta: Record<string, unknown> | undefined;

  constructor(message: string, statusCode: number, code?: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
