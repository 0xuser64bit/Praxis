import {
  readJson,
  readNullableString,
  readString,
  requireMutationAuth,
  withProvider,
} from "@/server/api/json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const session = requireMutationAuth(request);
  return withProvider(session, async (provider) => {
    const body = await readJson(request);
    const threadId = readNullableString(body.threadId, "threadId", { maxLength: 128 });
    const text = readString(body.text, "text", { maxLength: 2_000 });
    return provider.send(threadId, text);
  });
}
