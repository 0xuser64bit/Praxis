/**
 * A stable, machine-readable classification of a backend failure. Branch on
 * this rather than on `message`, which is human prose and free to change.
 * `client_error` is synthesized SDK-side for failures with no HTTP response
 * (timeout, DNS, TLS).
 */
export type PraxisErrorCode =
  | "config_error"
  | "unauthorized"
  | "invalid_input"
  | "not_found"
  /** The wallet has no Aegis policy account yet — call `bootstrapPolicy`. */
  | "policy_not_found"
  | "rate_limited"
  /** A concurrent writer changed this wallet's state first; reload and retry. */
  | "conflict"
  | "internal_error"
  | "client_error";

/**
 * Thrown when the Praxis API returns a non-2xx response. The backend's error
 * envelope is `{ error, type, code, details? }` with a meaningful HTTP status
 * (400 input, 401 auth, 404 not-found, 429 rate-limit, 503 config, 500 other).
 */
export class PraxisApiError extends Error {
  readonly status: number;
  /** The backend error class name, e.g. "PraxisAuthError", "PraxisRateLimitError". */
  readonly type: string;
  /** Stable error classification — the field to branch on. */
  readonly code: PraxisErrorCode;
  /** Structured facts about the failure, e.g. `{ policyAddress }` for `policy_not_found`. */
  readonly details?: Record<string, string | number | boolean>;

  constructor(
    status: number,
    type: string,
    message: string,
    options?: {
      cause?: unknown;
      code?: PraxisErrorCode;
      details?: Record<string, string | number | boolean>;
    },
  ) {
    super(message, options);
    this.name = "PraxisApiError";
    this.status = status;
    this.type = type;
    this.code = options?.code ?? codeFromStatus(status);
    this.details = options?.details;
    // Restore prototype chain for instanceof across transpile targets.
    Object.setPrototypeOf(this, PraxisApiError.prototype);
  }

  get isAuth(): boolean {
    return this.status === 401;
  }
  get isRateLimited(): boolean {
    return this.status === 429;
  }
  get isInput(): boolean {
    return this.status === 400;
  }
  /** Resource not found (404). */
  get isNotFound(): boolean {
    return this.status === 404;
  }
  /** Server reported a configuration problem (503) — usually transient. */
  get isConfig(): boolean {
    return this.status === 503;
  }
  /** The request timed out client-side before any HTTP response. */
  get isTimeout(): boolean {
    return this.status === 0 && this.type === "TimeoutError";
  }
  /** A connection-level failure (DNS, refused, TLS) before any HTTP response. */
  get isNetwork(): boolean {
    return this.status === 0 && this.type === "NetworkError";
  }
  /** Any server-side failure (HTTP >= 500). */
  get isServer(): boolean {
    return this.status >= 500;
  }
  /** The wallet has no Aegis policy yet — the first-run state, not a fault. */
  get isPolicyNotFound(): boolean {
    return this.code === "policy_not_found";
  }
  /** A concurrent writer won; the call is safe to retry after a reload. */
  get isConflict(): boolean {
    return this.code === "conflict";
  }
}

/** Fallback classification for responses from an older backend with no `code`. */
function codeFromStatus(status: number): PraxisErrorCode {
  if (status === 400) return "invalid_input";
  if (status === 401) return "unauthorized";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  if (status === 429) return "rate_limited";
  if (status === 503) return "config_error";
  if (status === 0) return "client_error";
  return "internal_error";
}

/** Thrown for SDK-side misconfiguration (no fetch, no signer, bad key, …). */
export class PraxisConfigError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "PraxisConfigError";
    Object.setPrototypeOf(this, PraxisConfigError.prototype);
  }
}
