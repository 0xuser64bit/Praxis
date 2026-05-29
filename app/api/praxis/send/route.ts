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
  return withProvider(async (provider) => {
    requireMutationAuth(request);
    const body = await readJson(request);
    const threadId = readNullableString(body.threadId, "threadId");
    const text = readString(body.text, "text");
    return provider.send(threadId, text);
  });
}
