import { readJson, readNullableString, requireMutationAuth, withProvider } from "@/server/api/json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const session = requireMutationAuth(request);
  return withProvider(session, async (provider) => {
    const body = await readJson(request);
    const preferred = readNullableString(body.threadId, "threadId", { maxLength: 128 }) ?? undefined;
    return { threadId: provider.newThread(preferred) };
  });
}
