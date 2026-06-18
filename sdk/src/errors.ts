/**
 * Thrown when the Praxis API returns a non-2xx response. The backend's error
 * envelope is `{ error: string, type: string }` with a meaningful HTTP status
 * (400 input, 401 auth, 404 not-found, 429 rate-limit, 503 config, 500 other).
 */
export class PraxisApiError extends Error {
  readonly status: number;
  /** The backend error class name, e.g. "PraxisAuthError", "PraxisRateLimitError". */
  readonly type: string;

  constructor(status: number, type: string, message: string) {
    super(message);
    this.name = "PraxisApiError";
    this.status = status;
    this.type = type;
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
  /** Any server-side failure (HTTP >= 500). */
  get isServer(): boolean {
    return this.status >= 500;
  }
}

/** Thrown for SDK-side misconfiguration (no fetch, no signer, bad key, …). */
export class PraxisConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PraxisConfigError";
    Object.setPrototypeOf(this, PraxisConfigError.prototype);
  }
}
