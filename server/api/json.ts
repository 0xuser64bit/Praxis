import { parseUnits } from "@praxis/shared";

import { getPraxisServerProvider } from "../provider/praxisServer";
import { PraxisConfigError, PraxisInputError, PraxisNotFoundError } from "../errors";

export const routeRuntime = "nodejs";
export const routeDynamic = "force-dynamic";

export function jsonOk(value: unknown = { ok: true }): Response {
  return Response.json(toWire(value));
}

export function jsonError(error: unknown): Response {
  const status = error instanceof PraxisInputError
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
    { status },
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

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  const body = await request.text();
  if (!body.trim()) return {};
  const parsed = JSON.parse(body);
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
    maxPerTx: patch.maxPerTx === undefined ? undefined : parseUnits(readString(patch.maxPerTx, "patch.maxPerTx")),
    dailyLimit: patch.dailyLimit === undefined ? undefined : parseUnits(readString(patch.dailyLimit, "patch.dailyLimit")),
    expiryTs: patch.expiryTs === undefined ? undefined : readNumber(patch.expiryTs, "patch.expiryTs"),
    paused: patch.paused === undefined ? undefined : Boolean(patch.paused),
  };
}

export function readNumber(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new PraxisInputError(`${name} must be a safe integer`);
  }
  return value;
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
