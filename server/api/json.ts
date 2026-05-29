import { parseUnits } from "@praxis/shared";
import { timingSafeEqual } from "node:crypto";

import { getPraxisServerProvider } from "../provider/praxisServer";
import {
  PraxisAuthError,
  PraxisConfigError,
  PraxisInputError,
  PraxisNotFoundError,
} from "../errors";

export const routeRuntime = "nodejs";
export const routeDynamic = "force-dynamic";
const U64_MAX = 2n ** 64n - 1n;
const DEMO_TOKEN_HEADER = "x-praxis-demo-token";

export function jsonOk(value: unknown = { ok: true }): Response {
  return Response.json(toWire(value), { headers: noStoreHeaders() });
}

export function jsonError(error: unknown): Response {
  const status = error instanceof PraxisAuthError
    ? 401
    : error instanceof PraxisInputError
    ? 400
    : error instanceof PraxisConfigError
      ? 503
      : error instanceof PraxisNotFoundError
        ? 404
        : 500;

  return Response.json(
    {
      error: error instanceof Error ? error.message : "Unexpected Praxis backend error",
      type: error instanceof Error ? error.name : "Error",
    },
    { status, headers: noStoreHeaders() },
  );
}

export async function withProvider<T>(fn: (provider: ReturnType<typeof getPraxisServerProvider>) => Promise<T> | T): Promise<Response> {
  try {
    const provider = getPraxisServerProvider();
    return jsonOk(await fn(provider));
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
  const body = await request.text();
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

export function readString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new PraxisInputError(`${name} must be a non-empty string`);
  }
  return value.trim();
}

export function readNullableString(value: unknown, name: string): string | null {
  if (value === null || value === undefined) return null;
  return readString(value, name);
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

export function requireMutationAuth(request: Request) {
  const configured = process.env.PRAXIS_DEMO_MUTATION_TOKEN?.trim();
  if (!configured) {
    throw new PraxisAuthError(
      "Praxis API mutations are disabled. Set PRAXIS_DEMO_MUTATION_TOKEN for local demos, or add wallet/session auth for production.",
    );
  }

  assertSameOrigin(request);
  const presented = request.headers.get(DEMO_TOKEN_HEADER)?.trim() ?? "";
  if (!safeEqual(presented, configured)) {
    throw new PraxisAuthError("Missing or invalid Praxis demo mutation token.");
  }
}

function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return;
  const expected = new URL(request.url).origin;
  if (origin !== expected) {
    throw new PraxisAuthError("Cross-origin Praxis API mutations are not allowed.");
  }
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function noStoreHeaders(): HeadersInit {
  return { "cache-control": "no-store" };
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
