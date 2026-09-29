/**
 * Errors that are safe to show verbatim to the UI. Anything else (stack
 * traces, provider internals, raw HTTP bodies) must be logged server-side
 * only and converted to one of these before crossing the API boundary.
 */
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(message: string, statusCode = 400, code = "APP_ERROR") {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, 422, "VALIDATION_ERROR");
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Not found") {
    super(message, 404, "NOT_FOUND");
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "You do not have permission to do this.") {
    super(message, 403, "FORBIDDEN");
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, 409, "CONFLICT");
  }
}

export class RateLimitedError extends AppError {
  constructor(message = "Too many requests. Please wait and try again.") {
    super(message, 429, "RATE_LIMITED");
  }
}

/**
 * Raised by DeploymentProvider implementations. `providerName` lets the API
 * layer produce messages like "Coolify Principal returned an authentication
 * error" instead of a generic failure.
 */
export class ProviderError extends AppError {
  readonly providerName: string;

  constructor(message: string, providerName: string, statusCode = 502) {
    super(message, statusCode, "PROVIDER_ERROR");
    this.providerName = providerName;
  }
}

export function toClientError(error: unknown): { message: string; statusCode: number; code: string } {
  if (error instanceof AppError) {
    return { message: error.message, statusCode: error.statusCode, code: error.code };
  }
  return { message: "Something went wrong. Please try again.", statusCode: 500, code: "INTERNAL_ERROR" };
}
