import { readJson, readNullableString, readString, withProvider } from "@/server/api/json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await readJson(request);
  const threadId = readNullableString(body.threadId, "threadId");
  const text = readString(body.text, "text");
  return withProvider((provider) => provider.send(threadId, text));
}
