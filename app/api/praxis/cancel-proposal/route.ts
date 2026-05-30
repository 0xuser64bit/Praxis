import { readJson, readString, requireMutationAuth, withProvider } from "@/server/api/json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const session = requireMutationAuth(request);
  return withProvider(session, async (provider) => {
    const body = await readJson(request);
    const proposalId = readString(body.proposalId, "proposalId");
    await provider.cancelProposal(proposalId);
    return { ok: true };
  });
}
