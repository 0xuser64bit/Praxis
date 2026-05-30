import { createPrivateKey, sign as edSign, timingSafeEqual } from "node:crypto";

import { Keypair, PublicKey } from "@solana/web3.js";

import { isAegisAgentTransferMessage } from "../server/agent/agentTxPolicy";

export interface SignerConfig {
  keypair: Keypair;
  programId: PublicKey;
  token: string;
}

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
 * token. Returned as a plain `(Request) => Response` so it is unit-tested without
 * binding a port.
 */
export function createSignerHandler(config: SignerConfig) {
  return async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/") {
      return json({ ok: true, agent: config.keypair.publicKey.toBase58() });
    }

    if (request.method !== "POST" || url.pathname !== "/sign") {
      return json({ error: "not found" }, 404);
    }

    if (!bearerOk(request, config.token)) {
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

    if (!isAegisAgentTransferMessage(bytes, config.programId)) {
      return json({ error: "policy: only a single Aegis agent_transfer is signable" }, 403);
    }

    const signature = signEd25519(config.keypair, bytes).toString("base64");
    return json({ signature });
  };
}
