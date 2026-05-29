import { readJson, requireMutationAuth, withProvider } from "@/server/api/json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return withProvider(async (provider) => {
    requireMutationAuth(request);
    const body = await readJson(request);
    const preferred = typeof body.threadId === "string" ? body.threadId : undefined;
    return { threadId: provider.newThread(preferred) };
  });
}
