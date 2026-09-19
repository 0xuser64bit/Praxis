import { withReadProvider } from "@/server/api/json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * List this wallet's recurring-buy schedules. Each fire emits one transfer
 * proposal through the same policy checks as a one-off buy — nothing signs
 * itself. Bigints cross as decimal strings (see server/api/json toWire).
 */
export async function GET(request: Request) {
  return withReadProvider(request, (provider) => provider.getSchedules());
}
