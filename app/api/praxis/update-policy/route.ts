import { readJson, readPolicyPatch, withProvider } from "@/server/api/json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await readJson(request);
  const patch = readPolicyPatch(body.patch);
  return withProvider(async (provider) => {
    await provider.updatePolicy(patch);
    return { ok: true };
  });
}
