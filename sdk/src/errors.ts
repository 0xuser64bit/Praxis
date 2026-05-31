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
}

/** Thrown for SDK-side misconfiguration (no fetch, no signer, bad key, …). */
export class PraxisConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PraxisConfigError";
    Object.setPrototypeOf(this, PraxisConfigError.prototype);
  }
}
