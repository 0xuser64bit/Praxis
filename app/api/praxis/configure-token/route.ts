import {
  readJson,
  readTokenEnvelopeConfig,
  requireMutationAuth,
  withProvider,
} from "@/server/api/json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return withProvider(async (provider) => {
    requireMutationAuth(request);
    const body = await readJson(request);
    const config = readTokenEnvelopeConfig(body.config);
    await provider.configureToken(config);
    return { ok: true };
  });
}
