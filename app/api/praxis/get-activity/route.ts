import { requireReadAuth, withProvider } from "@/server/api/json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withProvider(requireReadAuth(request), (provider) => provider.refreshActivity());
}
