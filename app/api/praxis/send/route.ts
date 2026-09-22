import {
  readJson,
  readNullableId,
  readString,
  withMutationProvider,
} from "@/server/api/json";
import { assertRateLimit } from "@/server/api/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return withMutationProvider(request, async (provider, session) => {
    // Two windows, because one message is not one unit of cost: a turn can
    // spend an LLM call, several Aegis simulations and two third-party
    // lookups. The minute window stops a burst; the hour window stops a
    // wallet from sitting at the burst ceiling all day.
    await assertRateLimit(request, {
      scope: "agent-send",
      identity: session.walletAddress,
      limit: 10,
      windowMs: 60_000,
    });
    await assertRateLimit(request, {
      scope: "agent-send-hourly",
      identity: session.walletAddress,
      limit: 120,
      windowMs: 3_600_000,
    });
    const body = await readJson(request);
    const threadId = readNullableId(body.threadId, "threadId");
    const text = readString(body.text, "text", { maxLength: 2_000 });
    return provider.send(threadId, text);
  });
}
