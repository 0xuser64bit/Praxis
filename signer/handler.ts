import { createPrivateKey, sign as edSign, timingSafeEqual } from "node:crypto";

import { Keypair, PublicKey } from "@solana/web3.js";

import { describeAegisAgentTransfer } from "../server/agent/agentTxPolicy";
import { logger } from "../server/observability/logger";

export interface SignerConfig {
  keypair: Keypair;
  programId: PublicKey;
  token: string;
  /**
   * Signatures allowed per {@link RATE_WINDOW_MS}. The agent key is the single
   * credential that can move value out of every vault this deployment serves
   * (each bounded by its own on-chain policy), so a leaked bearer token should
   * meet a ceiling here rather than only at the daily caps. Default is far
   * above real traffic — one owner signing proposals by hand — and far below
   * what draining every served vault would take.
   */
  maxSignaturesPerMinute?: number;
}

const RATE_WINDOW_MS = 60_000;
const DEFAULT_MAX_SIGNATURES_PER_MINUTE = 60;

/** Sign raw bytes with an ed25519 keypair — the same signature `Keypair` produces. */
export function signEd25519(keypair: Keypair, message: Uint8Array): Buffer {
  const seed = Buffer.from(keypair.secretKey.subarray(0, 32));
  const pkcs8 = Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]);
  const key = createPrivateKey({ key: pkcs8, format: "der", type: "pkcs8" });
  return edSign(null, Buffer.from(message), key);
}

function bearerOk(request: Request, expected: string): boolean {
  if (!expected) return false;
  const header = request.headers.get("authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice(7) : "";
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

/**
 * The signer service request handler. Holds the agent key and signs only Aegis
 * `agent_transfer` / `agent_transfer_spl` messages, authenticated by a bearer
 * token, rate-limited, and audited. Returned as a plain
 * `(Request) => Response` so it is unit-tested without binding a port.
 *
 * Every outcome is logged: this process is the only place that observes every
 * use of the agent key, and the log is what makes "what did the agent sign
 * while the token was leaked" an answerable question.
 */
export function createSignerHandler(config: SignerConfig) {
  const maxPerWindow = config.maxSignaturesPerMinute ?? DEFAULT_MAX_SIGNATURES_PER_MINUTE;
  const agent = config.keypair.publicKey.toBase58();
  let windowStart = 0;
  let windowCount = 0;

  /** Fixed window. The signer is one process by design, so this is exact. */
  function withinRateLimit(now: number): boolean {
    if (now - windowStart >= RATE_WINDOW_MS) {
      windowStart = now;
      windowCount = 0;
    }
    windowCount += 1;
    return windowCount <= maxPerWindow;
  }

  return async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/") {
      return json({ ok: true, agent });
    }

    if (request.method !== "POST" || url.pathname !== "/sign") {
      return json({ error: "not found" }, 404);
    }

    if (!bearerOk(request, config.token)) {
      logger.warn("signer.unauthorized", { agent });
      return json({ error: "unauthorized" }, 401);
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json({ error: "invalid json" }, 400);
    }

    const message = body && typeof body === "object" ? (body as { message?: unknown }).message : undefined;
    if (typeof message !== "string" || !message) {
      return json({ error: "message (base64) is required" }, 400);
    }

    let bytes: Uint8Array;
    try {
      bytes = Uint8Array.from(Buffer.from(message, "base64"));
    } catch {
      return json({ error: "message must be base64" }, 400);
    }

    const transfer = describeAegisAgentTransfer(bytes, config.programId);
    if (!transfer) {
      logger.warn("signer.refused", { agent, reason: "not a single Aegis agent transfer" });
      return json({ error: "policy: only a single Aegis agent_transfer is signable" }, 403);
    }

    if (!withinRateLimit(Date.now())) {
      logger.warn("signer.rate_limited", { agent, maxPerWindow, ...transfer });
      return json({ error: "signer rate limit exceeded" }, 429);
    }

    const signature = signEd25519(config.keypair, bytes).toString("base64");
    logger.info("signer.signed", { agent, ...transfer });
    return json({ signature });
  };
}
