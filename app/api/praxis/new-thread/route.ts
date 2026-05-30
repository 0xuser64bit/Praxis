import { readJson, readNullableString, requireMutationAuth, withProvider } from "@/server/api/json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return withProvider(async (provider) => {
    requireMutationAuth(request);
    const body = await readJson(request);
    const preferred = readNullableString(body.threadId, "threadId", { maxLength: 128 }) ?? undefined;
    return { threadId: provider.newThread(preferred) };
  });
}
