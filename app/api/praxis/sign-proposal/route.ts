import { readJson, readString, requireMutationAuth, withProvider } from "@/server/api/json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return withProvider(async (provider) => {
    requireMutationAuth(request);
    const body = await readJson(request);
    const proposalId = readString(body.proposalId, "proposalId");
    await provider.signProposal(proposalId);
    return { ok: true };
  });
}
