import { withProvider } from "@/server/api/json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  return withProvider(async (provider) => {
    await provider.revokeAgent();
    return { ok: true };
  });
}
