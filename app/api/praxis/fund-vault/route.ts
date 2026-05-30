import { readBaseUnits, readJson, withMutationProvider } from "@/server/api/json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return withMutationProvider(request, async (provider) => {
    const body = await readJson(request);
    const amount = readBaseUnits(body.amount, "amount");
    await provider.fundVault(amount);
    return { ok: true };
  });
}
