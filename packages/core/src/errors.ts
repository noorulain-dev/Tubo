export type ErrorCode =
  | "VALIDATION"
  | "AUTHENTICATION"
  | "PERMISSION"
  | "MISSING_CONTEXT"
  | "PROVIDER_ERROR"
  | "RATE_LIMIT"
  | "TIMEOUT"
  | "DUPLICATE"
  | "POLICY_BLOCK"
  | "EXECUTION_ERROR"
  | "EMAIL_NOT_VERIFIED";

const STATUS_FOR_CODE: Record<ErrorCode, number> = {
  VALIDATION: 400,
  AUTHENTICATION: 401,
  PERMISSION: 403,
  MISSING_CONTEXT: 422,
  PROVIDER_ERROR: 502,
  RATE_LIMIT: 429,
  TIMEOUT: 504,
  DUPLICATE: 409,
  POLICY_BLOCK: 422,
  EXECUTION_ERROR: 500,
  EMAIL_NOT_VERIFIED: 403,
};

export interface AppErrorOptions {
  code: ErrorCode;
  message: string;
  status?: number;
  details?: unknown;
  cause?: unknown;
  retryable?: boolean;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;
  readonly retryable: boolean;
  override readonly cause?: unknown;

  constructor(opts: AppErrorOptions) {
    super(opts.message);
    this.name = "AppError";
    this.code = opts.code;
    this.status = opts.status ?? STATUS_FOR_CODE[opts.code];
    this.details = opts.details;
    this.retryable = opts.retryable ?? false;
    if (opts.cause !== undefined) {
      this.cause = opts.cause;
    }
  }

  /** Alias for the HTTP status code (backward-compatible with `status`). */
  get statusCode(): number {
    return this.status;
  }

  /** Safe, non-secret details meant for the client (backward-compatible with `details`). */
  get safeDetails(): unknown {
    return this.details;
  }
}

export class ValidationError extends AppError {
  constructor(message: string, opts: Omit<AppErrorOptions, "code" | "message"> = {}) {
    super({ code: "VALIDATION", message, ...opts });
    this.name = "ValidationError";
  }
}

export class AuthenticationError extends AppError {
  constructor(message: string, opts: Omit<AppErrorOptions, "code" | "message"> = {}) {
    super({ code: "AUTHENTICATION", message, ...opts });
    this.name = "AuthenticationError";
  }
}

export class PermissionError extends AppError {
  constructor(message: string, opts: Omit<AppErrorOptions, "code" | "message"> = {}) {
    super({ code: "PERMISSION", message, ...opts });
    this.name = "PermissionError";
  }
}

export class MissingContextError extends AppError {
  constructor(message: string, opts: Omit<AppErrorOptions, "code" | "message"> = {}) {
    super({ code: "MISSING_CONTEXT", message, ...opts });
    this.name = "MissingContextError";
  }
}

export class ProviderError extends AppError {
  constructor(message: string, opts: Omit<AppErrorOptions, "code" | "message"> = {}) {
    super({ code: "PROVIDER_ERROR", message, ...opts });
    this.name = "ProviderError";
  }
}

export class RateLimitError extends AppError {
  constructor(message: string, opts: Omit<AppErrorOptions, "code" | "message"> = {}) {
    super({ code: "RATE_LIMIT", message, retryable: true, ...opts });
    this.name = "RateLimitError";
  }
}

export class TimeoutError extends AppError {
  constructor(message: string, opts: Omit<AppErrorOptions, "code" | "message"> = {}) {
    super({ code: "TIMEOUT", message, retryable: true, ...opts });
    this.name = "TimeoutError";
  }
}

export class DuplicateError extends AppError {
  constructor(message: string, opts: Omit<AppErrorOptions, "code" | "message"> = {}) {
    super({ code: "DUPLICATE", message, ...opts });
    this.name = "DuplicateError";
  }
}

export class PolicyBlockError extends AppError {
  constructor(message: string, opts: Omit<AppErrorOptions, "code" | "message"> = {}) {
    super({ code: "POLICY_BLOCK", message, ...opts });
    this.name = "PolicyBlockError";
  }
}

export class ExecutionError extends AppError {
  constructor(message: string, opts: Omit<AppErrorOptions, "code" | "message"> = {}) {
    super({ code: "EXECUTION_ERROR", message, ...opts });
    this.name = "ExecutionError";
  }
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}

export function errorCode(err: unknown): ErrorCode | undefined {
  return isAppError(err) ? err.code : undefined;
}
