import { readJson, readOwnerAction, withMutationProvider } from "@/server/api/json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return withMutationProvider(request, async (provider) => {
    const body = await readJson(request);
    const action = readOwnerAction(body.action);
    return provider.buildOwnerAction(action);
  });
}
