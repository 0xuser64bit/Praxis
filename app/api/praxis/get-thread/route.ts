import { readString, withProvider } from "@/server/api/json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const id = readString(new URL(request.url).searchParams.get("id"), "id");
  return withProvider((provider) => provider.getThread(id));
}
