import { parseUnits } from "@praxis/shared";

import type { OwnerAction, UnsignedOwnerTransaction } from "../aegis/client";
import { errorFields, logger, reportError } from "../observability/logger";
import {
  getPraxisServerProvider,
  type PraxisServerProvider,
} from "../provider/praxisServer";
import { requireSession, type PraxisSession } from "../auth/session";
import {
  PraxisAuthError,
  PraxisConfigError,
  PraxisConflictError,
  PraxisError,
  PraxisInputError,
  PraxisNotFoundError,
  PraxisRateLimitError,
  type PraxisErrorBody,
} from "../errors";
import { assertRateLimit } from "./rateLimit";

export const routeRuntime = "nodejs";
export const routeDynamic = "force-dynamic";
const U64_MAX = 2n ** 64n - 1n;
const MAX_JSON_BODY_BYTES = 64 * 1024;

export function jsonOk(value: unknown = { ok: true }, init: ResponseInit = {}): Response {
  return Response.json(toWire(value), { ...init, headers: withNoStore(init.headers) });
}

export function jsonError(error: unknown, init: ResponseInit = {}): Response {
  const status = error instanceof PraxisAuthError
    ? 401
    : error instanceof PraxisInputError
    ? 400
    : error instanceof PraxisConfigError
      ? 503
      : error instanceof PraxisNotFoundError
        ? 404
        : error instanceof PraxisRateLimitError
          ? 429
          : error instanceof PraxisConflictError
            ? 409
            : 500;

  // Unexpected (5xx) failures are reported for alerting; expected 4xx client
  // errors are not, to keep the signal clean. 503s are config problems worth a
  // warning but not an error page.
  if (status >= 500 && status !== 503) {
    reportError(error, { httpStatus: status });
  } else if (status === 503) {
    logger.warn("praxis.config_error", errorFields(error));
  }

  // Config (503) failures frequently name internal env vars in their message.
  // That detail is for operators (already logged above), not end users — return
  // a generic, non-leaky note to the client instead.
  const clientMessage =
    status === 503
      ? "Praxis is temporarily unavailable due to a server configuration issue. Please try again shortly."
      : error instanceof Error
        ? error.message
        : "Unexpected Praxis backend error";

  // The message is prose and may be reworded; `code` is the stable contract a
  // client branches on (see PraxisErrorCode), and `details` carries the facts
  // it would otherwise have to parse back out of the message.
  const body: PraxisErrorBody = {
    error: clientMessage,
    type: error instanceof Error ? error.name : "Error",
    code: error instanceof PraxisError ? error.code : "internal_error",
  };
  // Config details name internal env vars; those stay in the operator log.
  if (error instanceof PraxisError && error.details && status !== 503) {
    body.details = error.details;
  }

  return Response.json(body, { ...init, status, headers: withNoStore(init.headers) });
}

export async function withReadProvider<T>(
  request: Request,
  fn: (provider: PraxisServerProvider, session: PraxisSession) => Promise<T> | T,
): Promise<Response> {
  try {
    const session = await requireReadAuth(request);
    const provider = await getPraxisServerProvider(session.walletAddress);
    return jsonOk(await fn(provider, session));
  } catch (error) {
    return jsonError(error);
  }
}

export async function withMutationProvider<T>(
  request: Request,
  fn: (provider: PraxisServerProvider, session: PraxisSession) => Promise<T> | T,
): Promise<Response> {
  try {
    const session = await requireMutationAuth(request);
    const provider = await getPraxisServerProvider(session.walletAddress);
    return jsonOk(await fn(provider, session));
  } catch (error) {
    return jsonError(error);
  }
}

export async function withApi<T>(fn: () => Promise<T> | T): Promise<Response> {
  try {
    return jsonOk(await fn());
  } catch (error) {
    return jsonError(error);
  }
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength && Number(declaredLength) > MAX_JSON_BODY_BYTES) {
    throw new PraxisInputError(`Request body must be ${MAX_JSON_BODY_BYTES} bytes or smaller`);
  }

  const body = await request.text();
  if (Buffer.byteLength(body, "utf8") > MAX_JSON_BODY_BYTES) {
    throw new PraxisInputError(`Request body must be ${MAX_JSON_BODY_BYTES} bytes or smaller`);
  }
  if (!body.trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new PraxisInputError("Request body must be valid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new PraxisInputError("JSON body must be an object");
  }
  return parsed as Record<string, unknown>;
}

export function readString(value: unknown, name: string, opts: { maxLength?: number } = {}): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new PraxisInputError(`${name} must be a non-empty string`);
  }
  const trimmed = value.trim();
  if (opts.maxLength !== undefined && trimmed.length > opts.maxLength) {
    throw new PraxisInputError(`${name} must be ${opts.maxLength} characters or fewer`);
  }
  return trimmed;
}

export function readNullableString(value: unknown, name: string, opts: { maxLength?: number } = {}): string | null {
  if (value === null || value === undefined) return null;
  return readString(value, name, opts);
}

/** Nullable variant of {@link readId} for optional thread references. */
export function readNullableId(value: unknown, name: string): string | null {
  if (value === null || value === undefined) return null;
  return readId(value, name);
}

export function readStringArray(
  value: unknown,
  name: string,
  opts: { maxLength?: number; maxItems?: number } = {},
): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new PraxisInputError(`${name} must be an array`);
  }
  if (opts.maxItems !== undefined && value.length > opts.maxItems) {
    throw new PraxisInputError(`${name} must have ${opts.maxItems} items or fewer`);
  }
  return value.map((item, index) => readString(item, `${name}[${index}]`, { maxLength: opts.maxLength }));
}

export function readPolicyPatch(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PraxisInputError("patch must be an object");
  }
  const patch = value as Record<string, unknown>;
  const maxPerTx =
    patch.maxPerTx === undefined ? undefined : readBaseUnits(patch.maxPerTx, "patch.maxPerTx");
  const dailyLimit =
    patch.dailyLimit === undefined ? undefined : readBaseUnits(patch.dailyLimit, "patch.dailyLimit");
  if (maxPerTx !== undefined && maxPerTx <= 0n) {
    throw new PraxisInputError("patch.maxPerTx must be greater than zero");
  }
  if (dailyLimit !== undefined && dailyLimit <= 0n) {
    throw new PraxisInputError("patch.dailyLimit must be greater than zero");
  }
  const expiryTs =
    patch.expiryTs === undefined ? undefined : readNonNegativeNumber(patch.expiryTs, "patch.expiryTs");
  if (expiryTs !== undefined && expiryTs <= Math.floor(Date.now() / 1000)) {
    throw new PraxisInputError("patch.expiryTs must be in the future");
  }
  return {
    maxPerTx,
    dailyLimit,
    expiryTs,
    paused: patch.paused === undefined ? undefined : readBoolean(patch.paused, "patch.paused"),
  };
}

export function readTokenEnvelopeConfig(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PraxisInputError("config must be an object");
  }
  const config = value as Record<string, unknown>;
  const tokenMaxPerTx = readBaseUnits(config.tokenMaxPerTx, "config.tokenMaxPerTx");
  const tokenDailyLimit = readBaseUnits(config.tokenDailyLimit, "config.tokenDailyLimit");
  if (tokenMaxPerTx <= 0n || tokenDailyLimit <= 0n) {
    throw new PraxisInputError("token caps must be greater than zero");
  }
  return {
    tokenMint: readString(config.tokenMint, "config.tokenMint", { maxLength: 64 }),
    tokenMaxPerTx,
    tokenDailyLimit,
  };
}

export function readNumber(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new PraxisInputError(`${name} must be a safe integer`);
  }
  return value;
}

export function readNonNegativeNumber(value: unknown, name: string): number {
  const parsed = readNumber(value, name);
  if (parsed < 0) {
    throw new PraxisInputError(`${name} must be a non-negative safe integer`);
  }
  return parsed;
}

export function readBoolean(value: unknown, name: string): boolean {
  if (typeof value !== "boolean") {
    throw new PraxisInputError(`${name} must be a boolean`);
  }
  return value;
}

export function readBaseUnits(value: unknown, name: string): bigint {
  const units = parseUnits(readString(value, name));
  if (units < 0n || units > U64_MAX) {
    throw new PraxisInputError(`${name} must be an unsigned 64-bit integer base-unit string`);
  }
  return units;
}

/** Base units that must be strictly positive (vault funding, withdrawals, caps). */
export function readPositiveBaseUnits(value: unknown, name: string): bigint {
  const units = readBaseUnits(value, name);
  if (units <= 0n) {
    throw new PraxisInputError(`${name} must be greater than zero`);
  }
  return units;
}

const ID_PATTERN = /^[A-Za-z0-9_-]+$/;

/**
 * Opaque client/thread/proposal identifiers. Restricts charset so IDs are safe
 * as filesystem names, URL params, and log tokens (no path traversal, no
 * control characters). Generated IDs (`t-…`, `p-…`, `m-…`, `a-…`) all match.
 */
export function readId(value: unknown, name: string, opts: { maxLength?: number } = {}): string {
  const id = readString(value, name, { maxLength: opts.maxLength ?? 128 });
  if (!ID_PATTERN.test(id)) {
    throw new PraxisInputError(`${name} must match [A-Za-z0-9_-]`);
  }
  return id;
}

export function readAllowListKind(value: unknown) {
  if (value === "programs" || value === "recipients" || value === "mints") return value;
  throw new PraxisInputError("kind must be programs, recipients, or mints");
}

export function readOwnerAction(value: unknown): OwnerAction {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PraxisInputError("action must be an object");
  }
  const action = value as Record<string, unknown>;
  switch (action.kind) {
    case "bootstrapPolicy":
      return {
        kind: "bootstrapPolicy",
        fundLamports:
          action.fundLamports === undefined
            ? undefined
            : readBaseUnits(action.fundLamports, "action.fundLamports"),
      };
    case "fundVault": {
      const amount = readBaseUnits(action.amount, "action.amount");
      if (amount <= 0n) {
        throw new PraxisInputError("action.amount must be greater than zero");
      }
      return { kind: "fundVault", amount };
    }
    case "withdrawVault": {
      const amount = readBaseUnits(action.amount, "action.amount");
      if (amount <= 0n) {
        throw new PraxisInputError("action.amount must be greater than zero");
      }
      return { kind: "withdrawVault", amount };
    }
    case "closePolicy":
      return { kind: "closePolicy" };
    case "revoke":
      return { kind: "revoke" };
    case "rotate":
      return { kind: "rotate" };
    case "updatePolicy":
      return { kind: "updatePolicy", patch: readPolicyPatch(action.patch) };
    case "allowList": {
      if (action.mode !== "add" && action.mode !== "remove") {
        throw new PraxisInputError("action.mode must be add or remove");
      }
      return {
        kind: "allowList",
        listKind: readAllowListKind(action.listKind),
        address: readString(action.address, "action.address", { maxLength: 64 }),
        mode: action.mode,
      };
    }
    case "configureToken": {
      const config = readTokenEnvelopeConfig({
        tokenMint: action.tokenMint,
        tokenMaxPerTx: action.tokenMaxPerTx,
        tokenDailyLimit: action.tokenDailyLimit,
      });
      if (config.tokenMaxPerTx <= 0n || config.tokenDailyLimit <= 0n) {
        throw new PraxisInputError("token caps must be greater than zero");
      }
      return {
        kind: "configureToken",
        tokenMint: config.tokenMint,
        tokenMaxPerTx: config.tokenMaxPerTx,
        tokenDailyLimit: config.tokenDailyLimit,
      };
    }
    case "prepareTokenAccounts": {
      const raw = action.recipientAddresses;
      if (raw === undefined) {
        return { kind: "prepareTokenAccounts", recipientAddresses: [] };
      }
      if (!Array.isArray(raw)) {
        throw new PraxisInputError("action.recipientAddresses must be an array of addresses");
      }
      return {
        kind: "prepareTokenAccounts",
        recipientAddresses: raw.map((item, index) =>
          readString(item, `action.recipientAddresses[${index}]`, { maxLength: 64 }),
        ),
      };
    }
    default:
      throw new PraxisInputError(
        "action.kind must be bootstrapPolicy, fundVault, withdrawVault, closePolicy, updatePolicy, allowList, revoke, rotate, configureToken, or prepareTokenAccounts",
      );
  }
}

export function readUnsignedOwnerTransaction(value: Record<string, unknown>): UnsignedOwnerTransaction {
  return {
    transaction: readString(value.transaction, "transaction", { maxLength: 8_192 }),
    blockhash: readString(value.blockhash, "blockhash", { maxLength: 128 }),
    lastValidBlockHeight: readNonNegativeNumber(value.lastValidBlockHeight, "lastValidBlockHeight"),
    draft: readString(value.draft, "draft", { maxLength: 1_024 }),
  };
}

export async function requireReadAuth(request: Request): Promise<PraxisSession> {
  const session = requireSession(request);
  await assertRateLimit(request, {
    scope: "read",
    identity: session.walletAddress,
    limit: 240,
    windowMs: 60_000,
  });
  return session;
}

export async function requireMutationAuth(request: Request): Promise<PraxisSession> {
  assertSameOrigin(request);
  const session = requireSession(request);
  await assertRateLimit(request, {
    scope: "mutation",
    identity: session.walletAddress,
    limit: 40,
    windowMs: 60_000,
  });
  return session;
}

export function assertSameOrigin(request: Request) {
  const expected = new URL(request.url).origin;
  const origin = request.headers.get("origin");
  if (origin) {
    if (origin !== expected) {
      throw new PraxisAuthError("Cross-origin Praxis API mutations are not allowed.");
    }
    return;
  }
  // Headerless POSTs (curl, some wallets): fall back to Sec-Fetch-Site and
  // Referer before relying on SameSite cookies alone.
  const fetchSite = request.headers.get("sec-fetch-site")?.toLowerCase();
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
    throw new PraxisAuthError("Cross-origin Praxis API mutations are not allowed.");
  }
  const referer = request.headers.get("referer");
  if (referer) {
    try {
      if (new URL(referer).origin !== expected) {
        throw new PraxisAuthError("Cross-origin Praxis API mutations are not allowed.");
      }
    } catch (error) {
      if (error instanceof PraxisAuthError) throw error;
      throw new PraxisAuthError("Cross-origin Praxis API mutations are not allowed.");
    }
  }
}

function withNoStore(headers: ResponseInit["headers"]): Headers {
  const out = new Headers(headers);
  out.set("cache-control", "no-store");
  return out;
}

function toWire(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(toWire);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, toWire(item)]),
    );
  }
  return value;
}
