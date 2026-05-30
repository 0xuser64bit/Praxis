import { withMutationProvider } from "@/server/api/json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return withMutationProvider(request, async (provider) => {
    await provider.deleteAgent();
    return { ok: true };
  });
}
