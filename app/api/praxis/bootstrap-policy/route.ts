import { readJson, readPositiveBaseUnits, withMutationProvider } from "@/server/api/json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return withMutationProvider(request, async (provider) => {
    const body = await readJson(request);
    const fundLamports =
      body.fundLamports === undefined
        ? undefined
        : readPositiveBaseUnits(body.fundLamports, "fundLamports");
    await provider.bootstrapPolicy(fundLamports);
    return { ok: true };
  });
}
