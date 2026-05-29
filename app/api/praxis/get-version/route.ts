import { withProvider } from "@/server/api/json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return withProvider((provider) => provider.getVersion());
}
