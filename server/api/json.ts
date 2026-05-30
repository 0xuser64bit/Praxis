import { parseUnits } from "@praxis/shared";

import type { OwnerAction, UnsignedOwnerTransaction } from "../aegis/client";
import {
  getPraxisServerProvider,
  type PraxisServerProvider,
} from "../provider/praxisServer";
import { requireSession, type PraxisSession } from "../auth/session";
import {
  PraxisAuthError,
  PraxisConfigError,
  PraxisInputError,
  PraxisNotFoundError,
  PraxisRateLimitError,
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
          : 500;

  return Response.json(
    {
      error: error instanceof Error ? error.message : "Unexpected Praxis backend error",
      type: error instanceof Error ? error.name : "Error",
    },
    { ...init, status, headers: withNoStore(init.headers) },
  );
}

export async function withProvider<T>(
  session: PraxisSession,
  fn: (provider: PraxisServerProvider) => Promise<T> | T,
): Promise<Response> {
  try {
    const provider = await getPraxisServerProvider(session.walletAddress);
    return jsonOk(await fn(provider));
  } catch (error) {
    return jsonError(error);
  }
}

export async function withReadProvider<T>(
  request: Request,
  fn: (provider: PraxisServerProvider, session: PraxisSession) => Promise<T> | T,
): Promise<Response> {
  try {
    const session = requireReadAuth(request);
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
    const session = requireMutationAuth(request);
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
  return {
    maxPerTx: patch.maxPerTx === undefined ? undefined : readBaseUnits(patch.maxPerTx, "patch.maxPerTx"),
    dailyLimit: patch.dailyLimit === undefined ? undefined : readBaseUnits(patch.dailyLimit, "patch.dailyLimit"),
    expiryTs: patch.expiryTs === undefined ? undefined : readNumber(patch.expiryTs, "patch.expiryTs"),
    paused: patch.paused === undefined ? undefined : readBoolean(patch.paused, "patch.paused"),
  };
}

export function readTokenEnvelopeConfig(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PraxisInputError("config must be an object");
  }
  const config = value as Record<string, unknown>;
  return {
    tokenMint: readString(config.tokenMint, "config.tokenMint"),
    tokenMaxPerTx: readBaseUnits(config.tokenMaxPerTx, "config.tokenMaxPerTx"),
    tokenDailyLimit: readBaseUnits(config.tokenDailyLimit, "config.tokenDailyLimit"),
  };
}

export function readNumber(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new PraxisInputError(`${name} must be a safe integer`);
  }
  return value;
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
    default:
      throw new PraxisInputError("action.kind must be updatePolicy, allowList, revoke, or rotate");
  }
}

export function readUnsignedOwnerTransaction(value: Record<string, unknown>): UnsignedOwnerTransaction {
  return {
    transaction: readString(value.transaction, "transaction", { maxLength: 8_192 }),
    blockhash: readString(value.blockhash, "blockhash", { maxLength: 128 }),
    lastValidBlockHeight: readNumber(value.lastValidBlockHeight, "lastValidBlockHeight"),
  };
}

export function requireReadAuth(request: Request): PraxisSession {
  const session = requireSession(request);
  assertRateLimit(request, {
    scope: "read",
    identity: session.walletAddress,
    limit: 240,
    windowMs: 60_000,
  });
  return session;
}

export function requireMutationAuth(request: Request): PraxisSession {
  assertSameOrigin(request);
  const session = requireSession(request);
  assertRateLimit(request, {
    scope: "mutation",
    identity: session.walletAddress,
    limit: 40,
    windowMs: 60_000,
  });
  return session;
}

export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return;
  const expected = new URL(request.url).origin;
  if (origin !== expected) {
    throw new PraxisAuthError("Cross-origin Praxis API mutations are not allowed.");
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
