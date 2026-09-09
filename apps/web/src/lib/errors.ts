import { ApiError } from "../api";

/** Backend error categories the UI knows how to speak about in plain English. */
export type ErrorCode =
  | "VALIDATION_ERROR"
  | "VALIDATION"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "PERMISSION"
  | "NOT_FOUND"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "PROVIDER_UNAVAILABLE"
  | "PROVIDER_REAUTH_REQUIRED"
  | "MODEL_UNAVAILABLE"
  | "MISSING_CONTEXT"
  | "EXECUTION_BLOCKED"
  | "INTERNAL_ERROR";

export interface FriendlyError {
  code: string;
  /** Short, human sentence. Never a stack trace, SQL, token or provider dump. */
  message: string;
  /** Optional second line with what the user can do. */
  hint?: string;
  /** Only true when repeating the request is safe. */
  retryable: boolean;
  requestId?: string;
}

const COPY: Record<string, { message: string; hint?: string; retryable: boolean }> = {
  VALIDATION_ERROR: { message: "Some details need fixing before Tubo can continue.", retryable: false },
  VALIDATION: { message: "Some details need fixing before Tubo can continue.", retryable: false },
  UNAUTHENTICATED: { message: "Your session expired.", hint: "Sign in again to continue.", retryable: false },
  FORBIDDEN: { message: "You do not have access to this.", retryable: false },
  PERMISSION: { message: "This action is not permitted in this workspace.", retryable: false },
  NOT_FOUND: { message: "We couldn't find this.", hint: "It may have been removed or never existed.", retryable: false },
  CONFLICT: { message: "This changed somewhere else while you were working.", hint: "Refresh to see the current state.", retryable: true },
  RATE_LIMITED: { message: "Too many requests in a short time.", hint: "Wait a moment and try again.", retryable: true },
  PROVIDER_UNAVAILABLE: { message: "A connected service is temporarily unavailable. Your Tubo state was not changed.", retryable: true },
  PROVIDER_REAUTH_REQUIRED: { message: "This connection needs to be re-authorised before Tubo can read from it.", hint: "Reconnect it in Settings.", retryable: false },
  MODEL_UNAVAILABLE: { message: "The reasoning model is unavailable right now. Nothing was changed.", retryable: true },
  MISSING_CONTEXT: { message: "Tubo cannot safely recommend this change yet because the required state could not be verified.", retryable: false },
  EXECUTION_BLOCKED: { message: "This action was not executed. Additional approval or evidence is required.", retryable: false },
  INTERNAL_ERROR: { message: "Something went wrong while processing this request.", retryable: true },
};

/** Provider-specific phrasing, e.g. "HubSpot is temporarily unavailable." */
export function providerUnavailable(provider: string): FriendlyError {
  return {
    code: "PROVIDER_UNAVAILABLE",
    message: `${provider} is temporarily unavailable. Your Tubo state was not changed.`,
    retryable: true,
  };
}

/** Convert any thrown value into safe, user-facing copy. */
export function toFriendlyError(err: unknown): FriendlyError {
  if (err instanceof ApiError) {
    const copy = COPY[err.code];
    if (copy) return { code: err.code, ...copy };
    if (err.status === 401 || err.status === 403) return { code: "UNAUTHENTICATED", ...COPY["UNAUTHENTICATED"]! };
    if (err.status === 404) return { code: "NOT_FOUND", ...COPY["NOT_FOUND"]! };
    if (err.status === 429) return { code: "RATE_LIMITED", ...COPY["RATE_LIMITED"]! };
    if (err.status >= 500) return { code: "INTERNAL_ERROR", ...COPY["INTERNAL_ERROR"]! };
    return { code: err.code, message: "Tubo could not complete that request.", retryable: false };
  }
  if (err instanceof TypeError) {
    return { code: "NETWORK", message: "Tubo could not reach its service.", hint: "Check your connection and try again.", retryable: true };
  }
  return { code: "INTERNAL_ERROR", ...COPY["INTERNAL_ERROR"]! };
}

export function errorMessage(err: unknown): string {
  return toFriendlyError(err).message;
}
