export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details: unknown;

  constructor(message: string, options: { statusCode: number; code: string; details?: unknown }) {
    super(message);
    this.name = "AppError";
    this.statusCode = options.statusCode;
    this.code = options.code;
    this.details = options.details ?? null;
  }
}
