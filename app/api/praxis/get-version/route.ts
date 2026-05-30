import { withReadProvider } from "@/server/api/json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withReadProvider(request, (provider) => provider.getVersion());
}
