import { withProvider } from "@/server/api/json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return withProvider((provider) => ({
    version: provider.getVersion(),
    transport: "poll",
    pollRoute: "/api/praxis/get-version",
  }));
}
