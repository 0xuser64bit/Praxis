import {
  readJson,
  readStringArray,
  requireMutationAuth,
  withProvider,
} from "@/server/api/json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const session = requireMutationAuth(request);
  return withProvider(session, async (provider) => {
    const body = await readJson(request);
    const recipientAddresses = readStringArray(body.recipientAddresses, "recipientAddresses", {
      maxItems: 32,
      maxLength: 64,
    });
    await provider.prepareTokenAccounts(recipientAddresses);
    return { ok: true };
  });
}
