import { readJson, readNullableString, withMutationProvider } from "@/server/api/json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return withMutationProvider(request, async (provider) => {
    const body = await readJson(request);
    const preferred = readNullableString(body.threadId, "threadId", { maxLength: 128 }) ?? undefined;
    const threadId = provider.newThread(preferred);
    await provider.flushPersistence();
    return { threadId };
  });
}
