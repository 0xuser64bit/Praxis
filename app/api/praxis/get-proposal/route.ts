import { readString, withReadProvider } from "@/server/api/json";
import { PraxisNotFoundError } from "@/server/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withReadProvider(request, (provider) => {
    const id = readString(new URL(request.url).searchParams.get("id"), "id");
    const proposal = provider.getProposal(id);
    if (!proposal) throw new PraxisNotFoundError(`unknown proposal ${id}`);
    return proposal;
  });
}
