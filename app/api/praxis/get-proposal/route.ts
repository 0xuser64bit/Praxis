import { readString, withReadProvider } from "@/server/api/json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withReadProvider(request, (provider) => {
    const id = readString(new URL(request.url).searchParams.get("id"), "id");
    return provider.getProposal(id);
  });
}
