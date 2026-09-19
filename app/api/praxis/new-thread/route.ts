import { readJson, readNullableId, withMutationProvider } from "@/server/api/json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return withMutationProvider(request, async (provider) => {
    const body = await readJson(request);
    const preferred = readNullableId(body.threadId, "threadId") ?? undefined;
    const threadId = provider.newThread(preferred);
    await provider.flushPersistence();
    return { threadId };
  });
}
