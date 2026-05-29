import { requireMutationAuth, withProvider } from "@/server/api/json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return withProvider(async (provider) => {
    requireMutationAuth(request);
    await provider.rotateAgent();
    return { ok: true };
  });
}
