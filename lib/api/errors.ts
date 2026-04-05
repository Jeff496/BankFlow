export type LogLevel = "warn" | "error";

export abstract class AppError extends Error {
  abstract statusCode: number;
  abstract code: string;
  abstract logLevel: LogLevel;
  public context?: Record<string, unknown>;

  constructor(message: string, context?: Record<string, unknown>) {
    super(message);
    this.name = this.constructor.name;
    this.context = context;
  }
}

export class AuthError extends AppError {
  statusCode = 401;
  code = "AUTH_REQUIRED";
  logLevel = "warn" as const;
}

export class ForbiddenError extends AppError {
  statusCode = 403;
  code = "FORBIDDEN";
  logLevel: LogLevel = "warn";
}

/** Specifically for Postgres 42501 (RLS denial). Distinct from generic Forbidden. */
export class RLSDeniedError extends ForbiddenError {
  code = "RLS_DENIED";
  // Override: log at error level so RLS policy bugs surface
  logLevel: LogLevel = "error";
}

export class NotFoundError extends AppError {
  statusCode = 404;
  code = "NOT_FOUND";
  logLevel = "warn" as const;
}

export class ValidationError extends AppError {
  statusCode = 422;
  code = "VALIDATION_FAILED";
  logLevel = "warn" as const;
}

export class ConflictError extends AppError {
  statusCode = 409;
  code = "CONFLICT";
  logLevel = "warn" as const;
}

export class RateLimitError extends AppError {
  statusCode = 429;
  code = "RATE_LIMITED";
  logLevel = "warn" as const;
}

export class ExternalServiceError extends AppError {
  statusCode = 502;
  code = "EXTERNAL_SERVICE_ERROR";
  logLevel = "error" as const;
}

export class InternalError extends AppError {
  statusCode = 500;
  code = "INTERNAL_ERROR";
  logLevel = "error" as const;
}
