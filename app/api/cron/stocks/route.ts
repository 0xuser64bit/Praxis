import { jsonError, jsonOk, withMutationProvider } from "@/server/api/json";
import { assertCronAuthorized, hasBearerToken } from "@/server/api/cronAuth";
import { fireDueSchedulesForAllWallets } from "@/server/stocks/scheduleRunner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Fire every due recurring buy. Each fire emits ONE transfer proposal through
 * the same simulate + policy-check path as a one-off buy. Never signs — the
 * owner still signs every fire.
 *
 * Two callers, two auth modes:
 *
 * - **Scheduler** (`Authorization: Bearer $CRON_SECRET`): fans out across every
 *   wallet with stored state. This is the path that makes recurring buys real;
 *   without it a schedule only ever fired if its owner happened to hit this URL
 *   from a signed-in browser, which is to say: never.
 * - **Session** (cookie): fires the signed-in wallet's own schedules, for
 *   manual catch-up and for SDK callers.
 *
 * A request carrying a bearer token is always judged as the scheduler — it is
 * never silently downgraded to the session path, so a wrong or stale secret
 * fails loudly instead of quietly doing nothing.
 */
export async function GET(request: Request) {
  if (hasBearerToken(request)) {
    try {
      assertCronAuthorized(request);
      const summary = await fireDueSchedulesForAllWallets(Date.now());
      return jsonOk({ scope: "all-wallets", ...summary });
    } catch (error) {
      return jsonError(error);
    }
  }

  return withMutationProvider(request, async (provider) => {
    const fired = await provider.fireDueSchedules(Date.now());
    return { scope: "session", fired };
  });
}
