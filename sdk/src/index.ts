/**
 * @usepraxis/sdk — typed client for a hosted Praxis agent.
 *
 * Praxis turns natural language into Aegis-policy-enforced Solana actions. This
 * SDK authenticates with a Solana wallet and drives the agent over the
 * `/api/praxis/*` surface. The LLM, scoped agent key, and on-chain enforcement
 * all stay server-side — the SDK never holds those secrets.
 */

export { PraxisClient } from "./client";
export type { PraxisClientOptions, AskResult, FetchLike } from "./client";

export { keypairSigner } from "./signer";
export type { PraxisSigner, SecretKeyInput } from "./signer";

export { PraxisApiError, PraxisConfigError } from "./errors";

export {
  toBaseUnits,
  fromBaseUnits,
  humanToBaseUnits,
  baseUnitsToHuman,
} from "./units";

export * from "./types";
