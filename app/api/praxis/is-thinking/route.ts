import { readString, withProvider } from "@/server/api/json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const threadId = readString(new URL(request.url).searchParams.get("threadId"), "threadId");
  return withProvider((provider) => provider.isThinking(threadId));
}
