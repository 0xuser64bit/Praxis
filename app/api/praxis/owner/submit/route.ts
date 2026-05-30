import { readJson, readUnsignedOwnerTransaction, withMutationProvider } from "@/server/api/json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return withMutationProvider(request, async (provider) => {
    const body = await readJson(request);
    const signed = readUnsignedOwnerTransaction(body);
    return provider.submitOwnerAction(signed);
  });
}
