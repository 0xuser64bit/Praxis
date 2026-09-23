import { PraxisInputError } from "../errors";

/**
 * A browser may send the model's reading. It may not send the key that
 * produced it. These names are refused at the edge so a request body — which
 * platforms log — cannot be the place a key lands.
 */
const CREDENTIAL_FIELD = /(api[-_]?key|authorization|x-goog-api-key|credential)/i;

export function rejectCredentialFields(body: Record<string, unknown>): void {
  // Top-level fields are the shape the client sends, but a key nested inside
  // `ownIntent` would ride the same logged request body to the server. Scan
  // nested objects too so no placement of a key survives the edge.
  const stack: unknown[] = [body];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || typeof current !== "object" || Array.isArray(current)) continue;
    for (const [key, value] of Object.entries(current as Record<string, unknown>)) {
      if (CREDENTIAL_FIELD.test(key)) {
        throw new PraxisInputError("Praxis does not accept an API key. Keep it in this browser.");
      }
      if (value && typeof value === "object") stack.push(value);
    }
  }
}

/** Raw model tool arguments. Absent means "use the shared parser". */
export function readOwnIntent(value: unknown): unknown | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PraxisInputError("ownIntent must be an object");
  }
  return value;
}

export function readOwnIntentFailed(value: unknown): boolean {
  if (value === undefined) return false;
  if (typeof value !== "boolean") {
    throw new PraxisInputError("ownIntentFailed must be a boolean");
  }
  return value;
}
