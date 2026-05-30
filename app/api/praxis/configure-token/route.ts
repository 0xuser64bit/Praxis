import {
  readJson,
  readTokenEnvelopeConfig,
  withMutationProvider,
} from "@/server/api/json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return withMutationProvider(request, async (provider) => {
    const body = await readJson(request);
    const config = readTokenEnvelopeConfig(body.config);
    await provider.configureToken(config);
    return { ok: true };
  });
}
