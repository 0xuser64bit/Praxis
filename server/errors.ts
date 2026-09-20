/**
 * Typed Praxis errors.
 *
 * Every error carries a stable machine-readable {@link PraxisErrorCode} in
 * addition to its human message. The message is for a person and may be
 * reworded at any time; the code is the contract clients branch on. Anything
 * that used to `String.includes(...)` a backend message is a bug waiting for
 * the next copy edit.
 *
 * `details` carries the structured facts a client needs to act on the error
 * (e.g. which policy address is missing) so it never has to regex them back
 * out of prose.
 */

export type PraxisErrorCode =
  /** Server misconfiguration — operator-actionable, surfaced as 503. */
  | "config_error"
  /** No valid session, or the session does not authorize this action. */
  | "unauthorized"
  /** The request body/params failed validation. */
  | "invalid_input"
  /** A referenced resource does not exist (generic). */
  | "not_found"
  /** The signed-in wallet has no Aegis policy account yet — first-run onboarding. */
  | "policy_not_found"
  /** Rate limit exceeded. */
  | "rate_limited"
  /** A concurrent writer changed this wallet's state first (optimistic-concurrency). */
  | "conflict"
  /** Anything unclassified. */
  | "internal_error";

export type PraxisErrorDetails = Record<string, string | number | boolean>;

export abstract class PraxisError extends Error {
  abstract readonly code: PraxisErrorCode;
  readonly details?: PraxisErrorDetails;

  constructor(message: string, details?: PraxisErrorDetails) {
    super(message);
    this.details = details;
  }
}

export class PraxisConfigError extends PraxisError {
  readonly code = "config_error" as const;
  constructor(message: string, details?: PraxisErrorDetails) {
    super(message, details);
    this.name = "PraxisConfigError";
  }
}

export class PraxisAuthError extends PraxisError {
  readonly code = "unauthorized" as const;
  constructor(message: string, details?: PraxisErrorDetails) {
    super(message, details);
    this.name = "PraxisAuthError";
  }
}

export class PraxisInputError extends PraxisError {
  readonly code = "invalid_input" as const;
  constructor(message: string, details?: PraxisErrorDetails) {
    super(message, details);
    this.name = "PraxisInputError";
  }
}

export class PraxisNotFoundError extends PraxisError {
  readonly code: PraxisErrorCode;
  constructor(message: string, details?: PraxisErrorDetails, code: PraxisErrorCode = "not_found") {
    super(message, details);
    this.name = "PraxisNotFoundError";
    this.code = code;
  }
}

/**
 * The signed-in wallet has no Aegis policy account. Not an error condition in
 * the product sense — it is the first-run state, and the app renders vault
 * onboarding for it. `details.policyAddress` is the PDA the wallet will own.
 */
export class PraxisPolicyNotFoundError extends PraxisNotFoundError {
  constructor(policyAddress: string) {
    super(
      `Aegis policy account not found: ${policyAddress}`,
      { policyAddress },
      "policy_not_found",
    );
    this.name = "PraxisPolicyNotFoundError";
  }
}

/**
 * A compare-and-swap on a wallet's stored state lost to a concurrent writer.
 *
 * Internal by design: callers resolve it by reloading the newest state and
 * re-deciding, never by surfacing it to a user. If one ever escapes to the
 * HTTP layer it answers 409 rather than a misleading 500.
 */
export class PraxisConflictError extends PraxisError {
  readonly code = "conflict" as const;
  constructor(message = "Praxis state was modified by a concurrent writer.") {
    super(message);
    this.name = "PraxisConflictError";
  }
}

export class PraxisRateLimitError extends PraxisError {
  readonly code = "rate_limited" as const;
  constructor(message: string, details?: PraxisErrorDetails) {
    super(message, details);
    this.name = "PraxisRateLimitError";
  }
}

/** The wire shape of an error response body. */
export interface PraxisErrorBody {
  error: string;
  type: string;
  code: PraxisErrorCode;
  details?: PraxisErrorDetails;
}
