import { readJson, readString, withProvider } from "@/server/api/json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await readJson(request);
  const proposalId = readString(body.proposalId, "proposalId");
  return withProvider(async (provider) => {
    await provider.cancelProposal(proposalId);
    return { ok: true };
  });
}
