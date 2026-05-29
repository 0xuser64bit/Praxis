import { readJson, withProvider } from "@/server/api/json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await readJson(request);
  const preferred = typeof body.threadId === "string" ? body.threadId : undefined;
  return withProvider((provider) => ({ threadId: provider.newThread(preferred) }));
}
