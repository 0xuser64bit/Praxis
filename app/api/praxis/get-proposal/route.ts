import { readId, withReadProvider } from "@/server/api/json";
import { PraxisNotFoundError } from "@/server/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withReadProvider(request, async (provider) => {
    const id = readId(new URL(request.url).searchParams.get("id"), "id");
    await provider.reconcileSubmittedProposals();
    const proposal = provider.getProposal(id);
    if (!proposal) throw new PraxisNotFoundError(`unknown proposal ${id}`);
    return proposal;
  });
}
