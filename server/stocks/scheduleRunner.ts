import { PublicKey } from "@solana/web3.js";

import { errorFields, logger } from "../observability/logger";
import { getPraxisServerProvider } from "../provider/praxisServer";
import { getStateRepository } from "../provider/stateRepository";

/**
 * The scheduled-buy job.
 *
 * A recurring buy is a promise the product makes on the user's behalf ("I'll
 * propose each buy for your signature"), and until this existed nothing kept
 * it: the only way a schedule could fire was for the owner to personally hit
 * an authenticated endpoint at the right moment. Schedules were created,
 * listed in the UI, and never fired.
 *
 * This walks every wallet with stored state and fires whatever is due.
 * Firing only ever *emits a proposal* — the same simulate + policy-check path
 * as a one-off buy — and never signs. Nothing moves without the owner.
 */

/** Upper bound on wallets visited per tick, so one run can't fan out forever. */
const MAX_WALLETS_PER_RUN = 500;

export interface ScheduleRunSummary {
  /** Wallets inspected this tick. */
  wallets: number;
  /** Wallets that had at least one schedule fire. */
  walletsFired: number;
  /** Total proposals emitted. */
  proposals: number;
  /** Wallets skipped because firing threw (isolated; the run continues). */
  failures: number;
}

/**
 * Fire due schedules for every wallet with stored state.
 *
 * Per-wallet failures are isolated and logged: one wallet with an unreachable
 * RPC, an unconfigured token, or a config guard that fails closed (e.g. the
 * shared-agent-key check) must not stop every other wallet's schedule.
 */
export async function fireDueSchedulesForAllWallets(
  nowMs: number = Date.now(),
  limit: number = MAX_WALLETS_PER_RUN,
): Promise<ScheduleRunSummary> {
  const ownerKeys = await getStateRepository().listOwnerKeys(limit);
  const summary: ScheduleRunSummary = { wallets: 0, walletsFired: 0, proposals: 0, failures: 0 };

  for (const ownerKey of ownerKeys) {
    // Owner keys are wallet addresses; the `default` sentinel used when no
    // wallet is configured has no policy to schedule against.
    if (!isWalletAddress(ownerKey)) continue;
    summary.wallets++;
    try {
      const provider = await getPraxisServerProvider(ownerKey);
      // Cheap pre-check: most wallets have nothing due, and building proposals
      // costs RPC round-trips per fire.
      if (!provider.getSchedules().some((schedule) => schedule.nextFireTs <= nowMs)) continue;

      const fired = await provider.fireDueSchedules(nowMs);
      if (fired.length === 0) continue;
      summary.walletsFired++;
      summary.proposals += fired.length;
      logger.info("schedules.fired", {
        ownerKey,
        count: fired.length,
        blocked: fired.filter((f) => !f.allowed).length,
      });
    } catch (error) {
      summary.failures++;
      logger.warn("schedules.wallet_failed", { ownerKey, ...errorFields(error) });
    }
  }

  logger.info("schedules.run_complete", { ...summary });
  return summary;
}

function isWalletAddress(value: string): boolean {
  try {
    new PublicKey(value);
    return true;
  } catch {
    return false;
  }
}
