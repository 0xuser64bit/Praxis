import { createClient } from "redis";

import { fetchWithTimeout, type FetchLike } from "../api/timeout";
import { logger } from "../observability/logger";

/**
 * Single-use storage for wallet sign-in nonces.
 *
 * A challenge signature must be redeemable exactly once. The in-memory store
 * enforces that per process, which is no guarantee at all on serverless: an
 * attacker who captures one valid (address, nonce, signature) triple can
 * replay it against a different instance for the whole five-minute TTL and
 * mint a second session.
 *
 * Unlike the rate limiter, which fails OPEN because a limiter outage must not
 * take down the API, a replay guard fails CLOSED. If an operator configured a
 * shared store they declared they need cross-instance replay resistance;
 * silently degrading to per-instance nonces during an outage would hand back
 * exactly the hole they configured it to close.
 */
export interface NonceStore {
  /**
   * Atomically claim `nonce`. Returns true for the first caller and false for
   * every replay. Throws if the store cannot answer — never guesses.
   */
  consume(nonce: string, ttlSeconds: number): Promise<boolean>;
}

const KEY_PREFIX = "praxis:nonce:";
const MAX_MEMORY_NONCES = 10_000;

/**
 * Process-local store. Correct on a single instance; on multiple instances it
 * only narrows the replay window rather than closing it, which is why
 * production should configure Redis (see docs/ARCHITECTURE.md).
 */
export class MemoryNonceStore implements NonceStore {
  private readonly used = new Map<string, number>();

  async consume(nonce: string, ttlSeconds: number): Promise<boolean> {
    const now = Date.now();
    this.prune(now);
    if (this.used.has(nonce)) return false;
    if (this.used.size >= MAX_MEMORY_NONCES) {
      // Refuse rather than evict a live nonce, which would re-open replay.
      throw new Error("Too many in-flight wallet sign-in challenges.");
    }
    this.used.set(nonce, now + ttlSeconds * 1000);
    return true;
  }

  private prune(now: number) {
    for (const [nonce, expiresAt] of this.used) {
      if (expiresAt <= now) this.used.delete(nonce);
    }
  }
}

/** Upstash-compatible REST store (also Vercel KV). `SET key 1 NX EX ttl`. */
export class RedisNonceStore implements NonceStore {
  constructor(
    private readonly url: string,
    private readonly token: string,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  async consume(nonce: string, ttlSeconds: number): Promise<boolean> {
    const res = await fetchWithTimeout(
      `${this.url}/set/${encodeURIComponent(KEY_PREFIX + nonce)}/1`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${this.token}`, "content-type": "application/json" },
        body: JSON.stringify(["NX", "EX", String(ttlSeconds)]),
      },
      { ms: 2_000, label: "nonce store" },
      this.fetchImpl,
    );
    if (!res.ok) {
      throw new Error(`nonce store responded ${res.status}`);
    }
    // SET NX returns "OK" when it created the key, null when it already existed.
    const body = (await res.json()) as { result?: unknown };
    return body?.result === "OK";
  }
}

/** Command surface used by the native-RESP store; injectable for tests. */
export interface NonceCommands {
  set(
    key: string,
    value: string,
    options: { NX: true; EX: number },
  ): Promise<string | null>;
}

/** Native-RESP store for self-hosted Redis (`REDIS_URL`). */
export class RespNonceStore implements NonceStore {
  constructor(private readonly cmds: NonceCommands) {}

  async consume(nonce: string, ttlSeconds: number): Promise<boolean> {
    const result = await this.cmds.set(KEY_PREFIX + nonce, "1", { NX: true, EX: ttlSeconds });
    return result === "OK";
  }
}

let sharedResp: Promise<NonceCommands> | undefined;

function sharedRespClient(url: string): Promise<NonceCommands> {
  if (!sharedResp) {
    sharedResp = (async () => {
      const client = createClient({ url });
      client.on("error", (err) =>
        logger.warn("nonce.resp_error", { error: err instanceof Error ? err.message : String(err) }),
      );
      await client.connect();
      return client as unknown as NonceCommands;
    })();
    sharedResp.catch(() => {
      sharedResp = undefined;
    });
  }
  return sharedResp;
}

export function createRespNonceStore(url: string, commands?: NonceCommands): NonceStore {
  if (commands) return new RespNonceStore(commands);
  return new RespNonceStore({
    set: async (key, value, options) => (await sharedRespClient(url)).set(key, value, options),
  });
}

let cached: NonceStore | undefined;

function redisCreds(): { url: string; token: string } | undefined {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim() || process.env.KV_REST_API_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim() || process.env.KV_REST_API_TOKEN?.trim();
  return url && token ? { url, token } : undefined;
}

/**
 * Pick a store from the environment, mirroring the rate limiter's selection so
 * one Redis configuration serves both.
 */
export function getNonceStore(): NonceStore {
  if (cached) return cached;
  const respUrl = process.env.REDIS_URL?.trim();
  if (respUrl) {
    cached = createRespNonceStore(respUrl);
    return cached;
  }
  const creds = redisCreds();
  if (creds) {
    cached = new RedisNonceStore(creds.url, creds.token);
    return cached;
  }
  cached = new MemoryNonceStore();
  return cached;
}

export function resetNonceStoreForTests(store?: NonceStore) {
  cached = store;
  sharedResp = undefined;
}
