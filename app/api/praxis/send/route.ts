import {
  readJson,
  readNullableString,
  readString,
  withMutationProvider,
} from "@/server/api/json";
import { assertRateLimit } from "@/server/api/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return withMutationProvider(request, async (provider, session) => {
    assertRateLimit(request, {
      scope: "agent-send",
      identity: session.walletAddress,
      limit: 10,
      windowMs: 60_000,
    });
    const body = await readJson(request);
    const threadId = readNullableString(body.threadId, "threadId", { maxLength: 128 });
    const text = readString(body.text, "text", { maxLength: 2_000 });
    return provider.send(threadId, text);
  });
}
