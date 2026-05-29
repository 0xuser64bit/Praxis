import {
  readJson,
  readPolicyPatch,
  requireMutationAuth,
  withProvider,
} from "@/server/api/json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return withProvider(async (provider) => {
    requireMutationAuth(request);
    const body = await readJson(request);
    const patch = readPolicyPatch(body.patch);
    await provider.updatePolicy(patch);
    return { ok: true };
  });
}
