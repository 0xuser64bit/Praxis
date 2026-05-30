import {
  readJson,
  readStringArray,
  withMutationProvider,
} from "@/server/api/json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return withMutationProvider(request, async (provider) => {
    const body = await readJson(request);
    const recipientAddresses = readStringArray(body.recipientAddresses, "recipientAddresses", {
      maxItems: 32,
      maxLength: 64,
    });
    await provider.prepareTokenAccounts(recipientAddresses);
    return { ok: true };
  });
}
