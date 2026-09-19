import { withApi } from "@/server/api/json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Unauthenticated liveness probe for hosts and load balancers
 * (see docs/DEPLOY.md). No session, no chain I/O — a 200 here means the
 * function bundle boots and routes; anything deeper is a read-route concern.
 */
export async function GET() {
  return withApi(async () => ({ ok: true }));
}
