import { withMutationProvider } from "@/server/api/json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Stocklana C06: mechanical DCA cron. Fires every due schedule for the
 * signed-in wallet — each fire emits ONE transfer proposal through the same
 * simulate + policy-check path as a one-off buy. Never signs.
 *
 * Session-authenticated like every other mutation (single-writer affinity per
 * wallet comes from the provider mutex). Multi-wallet fan-out (one tick firing
 * every wallet's schedules) is a C11+ indexer job, not this route.
 */
export async function GET(request: Request) {
  return withMutationProvider(request, async (provider) => {
    const fired = await provider.fireDueSchedules(Date.now());
    return { fired };
  });
}
