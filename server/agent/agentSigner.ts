import { Keypair, PublicKey, Transaction } from "@solana/web3.js";

import { fetchWithTimeout } from "../api/timeout";
import { PraxisConfigError } from "../errors";

/**
 * The agent signing boundary. Production custody keeps the agent private key out
 * of the app process entirely (behind {@link HttpRemoteAgentSigner}); local and
 * devnet use the in-process keypair. Selected purely by env, so flipping custody
 * on is a config change, not a code change.
 */
export interface AgentSigner {
  readonly publicKey: PublicKey;
  /** Add the agent's signature to a built transaction and return it. */
  signTransaction(tx: Transaction): Promise<Transaction>;
}

/** In-process keypair signer. Default for local/devnet. */
export class LocalKeypairSigner implements AgentSigner {
  constructor(private readonly keypair: Keypair) {}

  get publicKey(): PublicKey {
    return this.keypair.publicKey;
  }

  async signTransaction(tx: Transaction): Promise<Transaction> {
    tx.sign(this.keypair);
    return tx;
  }
}

interface RemoteSignerResponse {
  signature?: unknown;
  error?: unknown;
}

/**
 * Remote signer: holds no private key. Posts the transaction message to an
 * external signer service (which holds the key behind a network boundary) and
 * applies the returned ed25519 signature. Fails CLOSED — a signing failure
 * throws and the action is rejected; it never falls back to a local key.
 */
export class HttpRemoteAgentSigner implements AgentSigner {
  constructor(
    private readonly url: string,
    public readonly publicKey: PublicKey,
    private readonly token: string,
    private readonly timeoutMs = 8_000,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async signTransaction(tx: Transaction): Promise<Transaction> {
    const message = tx.serializeMessage();
    const res = await fetchWithTimeout(
      this.url,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ message: message.toString("base64") }),
      },
      { ms: this.timeoutMs, label: "Agent signer" },
      this.fetchImpl,
    );

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new PraxisConfigError(`Agent signer rejected the request (${res.status})${detail ? `: ${detail}` : ""}`);
    }

    const body = (await res.json()) as RemoteSignerResponse;
    if (typeof body.signature !== "string") {
      throw new PraxisConfigError("Agent signer did not return a signature.");
    }
    const signature = Buffer.from(body.signature, "base64");
    if (signature.length !== 64) {
      throw new PraxisConfigError("Agent signer returned a malformed signature.");
    }

    // addSignature verifies the signature against the message, so a wrong key or
    // tampered signature throws here rather than producing an invalid tx.
    tx.addSignature(this.publicKey, signature);
    return tx;
  }
}

/**
 * Resolve the configured agent signer, or undefined if none is configured.
 * Remote takes precedence when `PRAXIS_AGENT_SIGNER_URL` is set. A raw in-process
 * keypair is refused in production unless explicitly opted in, so the custody
 * boundary is the default for production.
 */
export function resolveAgentSigner(agentKeypair?: Keypair): AgentSigner | undefined {
  const url = process.env.PRAXIS_AGENT_SIGNER_URL?.trim();
  if (url) {
    const publicKey = process.env.PRAXIS_AGENT_PUBLIC_KEY?.trim();
    const token = process.env.PRAXIS_AGENT_SIGNER_TOKEN?.trim();
    if (!publicKey) {
      throw new PraxisConfigError("PRAXIS_AGENT_PUBLIC_KEY is required when PRAXIS_AGENT_SIGNER_URL is set.");
    }
    if (!token) {
      throw new PraxisConfigError("PRAXIS_AGENT_SIGNER_TOKEN is required when PRAXIS_AGENT_SIGNER_URL is set.");
    }
    return new HttpRemoteAgentSigner(url, parseAgentPublicKey(publicKey), token);
  }

  if (agentKeypair) {
    if (process.env.NODE_ENV === "production" && process.env.PRAXIS_ALLOW_LOCAL_AGENT_KEY !== "1") {
      throw new PraxisConfigError(
        "Refusing a raw agent keypair in production. Configure PRAXIS_AGENT_SIGNER_URL for remote custody, " +
          "or set PRAXIS_ALLOW_LOCAL_AGENT_KEY=1 to explicitly allow an in-process key.",
      );
    }
    return new LocalKeypairSigner(agentKeypair);
  }

  return undefined;
}

export function requireAgentSigner(agentKeypair?: Keypair): AgentSigner {
  const signer = resolveAgentSigner(agentKeypair);
  if (!signer) {
    throw new PraxisConfigError(
      "Configure the agent signer: set PRAXIS_AGENT_SIGNER_URL (remote custody) or PRAXIS_AGENT_KEYPAIR / PRAXIS_AGENT_KEYPAIR_PATH.",
    );
  }
  return signer;
}

/**
 * The next agent public key for rotation. Only the public key is ever needed to
 * register a new `agent_authority`, so remote custody supplies it directly via
 * `PRAXIS_NEXT_AGENT_PUBLIC_KEY` without exposing the next private key.
 */
export function resolveNextAgentPublicKey(nextAgentKeypair?: Keypair): PublicKey | undefined {
  const configured = process.env.PRAXIS_NEXT_AGENT_PUBLIC_KEY?.trim();
  if (configured) return parseAgentPublicKey(configured);
  return nextAgentKeypair?.publicKey;
}

function parseAgentPublicKey(value: string): PublicKey {
  try {
    return new PublicKey(value);
  } catch {
    throw new PraxisConfigError("PRAXIS_AGENT_PUBLIC_KEY must be a valid Solana public key.");
  }
}
