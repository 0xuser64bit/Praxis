import bs58 from "bs58";

import { PraxisApiError, PraxisConfigError } from "./errors";
import type { PraxisSigner } from "./signer";
import type {
  ActionProposal,
  ActivityEntry,
  AddressBookEntry,
  AgentMessage,
  AllowListKind,
  BaseUnitString,
  OwnerAction,
  PolicyUpdate,
  PolicyView,
  SessionInfo,
  SignedOwnerTransaction,
  Thread,
  TokenEnvelopeConfig,
  UnsignedOwnerTransaction,
  WalletChallenge,
} from "./types";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface PraxisClientOptions {
  /** Base origin of the Praxis deployment, e.g. "http://localhost:3000". */
  baseUrl: string;
  /** Wallet signer for `connect()`. Optional if you only call public reads after an external login. */
  signer?: PraxisSigner;
  /** Custom fetch (defaults to global fetch). Required in runtimes without one. */
  fetch?: FetchLike;
  /** Per-request timeout in ms (default 20_000). */
  timeoutMs?: number;
}

/** Result of {@link PraxisClient.ask} — the agent's reply, distilled. */
export interface AskResult {
  threadId: string;
  /** The agent's reply message (prose / clarify / proposal / research blocks). */
  message: AgentMessage;
  /** Any action proposals the agent produced, hydrated for convenience. */
  proposals: ActionProposal[];
}

const API_PREFIX = "/api/praxis";

/**
 * Typed client for a hosted Praxis agent. The agent's LLM, scoped agent key, and
 * Aegis policy enforcement all live server-side; this SDK is an authenticated
 * client of the `/api/praxis/*` surface.
 *
 * ```ts
 * const praxis = new PraxisClient({ baseUrl, signer: keypairSigner(secret) });
 * await praxis.connect();
 * const { proposals } = await praxis.ask("send 0.5 SOL to maya");
 * if (proposals[0]?.check.allowed) await praxis.signProposal(proposals[0].id);
 * ```
 */
export class PraxisClient {
  private readonly baseUrl: string;
  private readonly signer?: PraxisSigner;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;
  /** Manual cookie jar — Node's fetch does not persist Set-Cookie across calls. */
  private sessionCookie?: string;

  constructor(options: PraxisClientOptions) {
    if (!options.baseUrl) throw new PraxisConfigError("baseUrl is required");
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.signer = options.signer;
    const resolvedFetch = options.fetch ?? (globalThis.fetch as FetchLike | undefined);
    if (!resolvedFetch) {
      throw new PraxisConfigError("No fetch available; pass options.fetch (Node <18 or non-browser runtime).");
    }
    this.fetchImpl = resolvedFetch;
    this.timeoutMs = options.timeoutMs ?? 20_000;
  }

  // --- auth ----------------------------------------------------------------

  /** The signer's wallet address, if a signer was provided. */
  get address(): string | undefined {
    return this.signer?.address;
  }

  /**
   * Run the wallet-ownership handshake: request a challenge, sign its message,
   * verify it, and store the resulting session cookie. Safe to call again to
   * refresh the session (each call issues a new challenge + cookie).
   */
  async connect(): Promise<SessionInfo> {
    if (!this.signer) {
      throw new PraxisConfigError("connect() requires a signer. Pass one to the constructor.");
    }
    const challenge = await this.post<WalletChallenge>("/auth/challenge", {
      address: this.signer.address,
    });
    const signature = await this.signer.signMessage(new TextEncoder().encode(challenge.message));
    return this.post<SessionInfo>("/auth/verify", {
      address: this.signer.address,
      nonce: challenge.nonce,
      signature: bs58.encode(signature),
    });
  }

  /**
   * Current session, or `null` if not signed in. The endpoint answers `200`
   * with `{ authenticated: false }` when signed out, so this normalizes both
   * that shape and a `401` to `null`.
   */
  async session(): Promise<SessionInfo | null> {
    try {
      const info = await this.get<SessionInfo>("/auth/session");
      return info && info.authenticated ? info : null;
    } catch (error) {
      if (error instanceof PraxisApiError && error.isAuth) return null;
      throw error;
    }
  }

  /**
   * Clear the session (server-side cookie + local jar). Idempotent: if there is
   * no active session, the local jar is still cleared and no error is thrown.
   */
  async logout(): Promise<void> {
    try {
      await this.request<unknown>("DELETE", "/auth/session");
    } catch (error) {
      // Already signed out (missing / expired session) is a successful logout.
      if (!(error instanceof PraxisApiError && error.isAuth)) throw error;
    } finally {
      this.sessionCookie = undefined;
    }
  }

  // --- conversation --------------------------------------------------------

  /** Send a line to the agent. Creates a thread when `threadId` is omitted. */
  send(text: string, threadId: string | null = null): Promise<{ threadId: string }> {
    return this.post<{ threadId: string }>("/send", { text, threadId });
  }

  /**
   * Send a line and return the agent's reply in one call. The API resolves
   * `send` only after the agent has finished, so this needs no polling.
   */
  async ask(text: string, threadId: string | null = null): Promise<AskResult> {
    const { threadId: tid } = await this.send(text, threadId);
    const thread = await this.getThread(tid);
    const message = lastAgentMessage(thread);
    if (!message) {
      throw new PraxisApiError(500, "Error", "Agent produced no reply message.");
    }
    const proposalIds = message.blocks
      .filter((b): b is Extract<typeof b, { type: "proposal" }> => b.type === "proposal")
      .map((b) => b.proposalId);
    const proposals = await Promise.all(proposalIds.map((id) => this.getProposal(id)));
    return { threadId: tid, message, proposals };
  }

  newThread(threadId?: string): Promise<{ threadId: string }> {
    return this.post<{ threadId: string }>("/new-thread", threadId ? { threadId } : {});
  }

  signProposal(proposalId: string): Promise<void> {
    return this.post<void>("/sign-proposal", { proposalId });
  }

  cancelProposal(proposalId: string): Promise<void> {
    return this.post<void>("/cancel-proposal", { proposalId });
  }

  // --- reads ---------------------------------------------------------------

  getThreads(): Promise<Thread[]> {
    return this.get<Thread[]>("/get-threads");
  }
  getThread(id: string): Promise<Thread> {
    return this.get<Thread>("/get-thread", { id });
  }
  getProposal(id: string): Promise<ActionProposal> {
    return this.get<ActionProposal>("/get-proposal", { id });
  }
  getPolicy(): Promise<PolicyView> {
    return this.get<PolicyView>("/get-policy");
  }
  getActivity(): Promise<ActivityEntry[]> {
    return this.get<ActivityEntry[]>("/get-activity");
  }
  getAddressBook(): Promise<AddressBookEntry[]> {
    return this.get<AddressBookEntry[]>("/get-address-book");
  }
  isThinking(threadId: string): Promise<boolean> {
    return this.get<boolean>("/is-thinking", { threadId });
  }
  getVersion(): Promise<number> {
    return this.get<number>("/get-version");
  }

  // --- policy / owner mutations (server-key mode) --------------------------

  bootstrapPolicy(fundLamports?: BaseUnitString): Promise<void> {
    return this.post<void>("/bootstrap-policy", fundLamports ? { fundLamports } : {});
  }
  /** Deposit SOL (lamports, base-unit string) from the owner into the vault. */
  fundVault(amount: BaseUnitString): Promise<void> {
    return this.post<void>("/fund-vault", { amount });
  }
  /** Withdraw SOL (lamports, base-unit string) from the vault to the owner. */
  withdrawVault(amount: BaseUnitString): Promise<void> {
    return this.post<void>("/withdraw-vault", { amount });
  }
  /** Tear the agent down — drain the vault and close the policy. Irreversible. */
  deleteAgent(): Promise<void> {
    return this.post<void>("/delete-agent", {});
  }
  updatePolicy(patch: PolicyUpdate): Promise<void> {
    return this.post<void>("/update-policy", { patch });
  }
  configureToken(config: TokenEnvelopeConfig): Promise<void> {
    return this.post<void>("/configure-token", { config });
  }
  prepareTokenAccounts(recipientAddresses?: string[]): Promise<void> {
    return this.post<void>("/prepare-token-accounts", recipientAddresses ? { recipientAddresses } : {});
  }
  revokeAgent(): Promise<void> {
    return this.post<void>("/revoke-agent", {});
  }
  rotateAgent(): Promise<void> {
    return this.post<void>("/rotate-agent", {});
  }
  addToAllowList(kind: AllowListKind, address: string): Promise<void> {
    return this.post<void>("/add-to-allow-list", { kind, address });
  }
  removeFromAllowList(kind: AllowListKind, address: string): Promise<void> {
    return this.post<void>("/remove-from-allow-list", { kind, address });
  }

  // --- owner wallet-signed transaction path --------------------------------

  /**
   * Build an unsigned owner transaction for the wallet to sign. The caller signs
   * the returned base64 `transaction` with a transaction-capable wallet, then
   * passes the result to {@link submitOwnerTransaction}. (The SDK's
   * `keypairSigner` signs sign-in messages only, not transactions.)
   */
  buildOwnerTransaction(action: OwnerAction): Promise<UnsignedOwnerTransaction> {
    return this.post<UnsignedOwnerTransaction>("/owner/build", { action });
  }
  /** Submit a wallet-signed owner transaction; resolves with its signature. */
  submitOwnerTransaction(signed: SignedOwnerTransaction): Promise<{ sig: string }> {
    return this.post<{ sig: string }>("/owner/submit", signed);
  }

  // --- transport -----------------------------------------------------------

  private get<T>(path: string, query?: Record<string, string>): Promise<T> {
    return this.request<T>("GET", path, { query });
  }

  private post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>("POST", path, { body });
  }

  private async request<T>(
    method: string,
    path: string,
    opts: { body?: unknown; query?: Record<string, string> } = {},
  ): Promise<T> {
    const url = new URL(this.baseUrl + API_PREFIX + path);
    for (const [k, v] of Object.entries(opts.query ?? {})) url.searchParams.set(k, v);

    const headers: Record<string, string> = { accept: "application/json" };
    if (opts.body !== undefined) headers["content-type"] = "application/json";
    if (this.sessionCookie) headers["cookie"] = this.sessionCookie;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await this.fetchImpl(url.toString(), {
        method,
        headers,
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        // Browser same-origin: let the HttpOnly cookie ride along.
        credentials: "include",
        signal: controller.signal,
      } as RequestInit);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new PraxisApiError(0, "TimeoutError", `Praxis request timed out after ${this.timeoutMs}ms`, {
          cause: error,
        });
      }
      if (error instanceof PraxisApiError) throw error;
      // Connection-level failures (DNS, ECONNREFUSED, TLS) surface uniformly as
      // a PraxisApiError so callers have a single error type to catch.
      const detail = error instanceof Error ? error.message : String(error);
      throw new PraxisApiError(0, "NetworkError", `Praxis request failed: ${detail}`, { cause: error });
    } finally {
      clearTimeout(timer);
    }

    this.captureCookie(res);

    const text = await res.text();
    const parsed = text ? safeJsonParse(text) : undefined;

    if (!res.ok) {
      const message =
        (parsed && typeof parsed === "object" && "error" in parsed && typeof parsed.error === "string"
          ? parsed.error
          : undefined) ?? `Praxis API error ${res.status}`;
      const type =
        parsed && typeof parsed === "object" && "type" in parsed && typeof parsed.type === "string"
          ? parsed.type
          : "Error";
      throw new PraxisApiError(res.status, type, message);
    }

    return parsed as T;
  }

  private captureCookie(res: Response): void {
    // Node 18.14+ exposes getSetCookie(); fall back to the combined header.
    const anyHeaders = res.headers as Headers & { getSetCookie?: () => string[] };
    const cookies = anyHeaders.getSetCookie?.() ?? splitSetCookie(res.headers.get("set-cookie"));
    for (const cookie of cookies) {
      const [pair] = cookie.split(";");
      if (pair && pair.trim().startsWith("praxis_session=")) {
        this.sessionCookie = pair.trim();
      }
    }
  }
}

function lastAgentMessage(thread: Thread): AgentMessage | undefined {
  for (let i = thread.messages.length - 1; i >= 0; i--) {
    const m = thread.messages[i];
    if (m.role === "agent") return m;
  }
  return undefined;
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function splitSetCookie(header: string | null): string[] {
  if (!header) return [];
  // Split on commas that precede a new cookie name=value pair, not commas inside
  // Expires dates ("Wed, 01 Jan ...").
  return header.split(/,(?=\s*[^;,\s]+=)/);
}
