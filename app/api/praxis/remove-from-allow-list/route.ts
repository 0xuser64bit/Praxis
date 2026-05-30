import {
  readAllowListKind,
  readJson,
  readString,
  requireMutationAuth,
  withProvider,
} from "@/server/api/json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const session = requireMutationAuth(request);
  return withProvider(session, async (provider) => {
    const body = await readJson(request);
    const kind = readAllowListKind(body.kind);
    const address = readString(body.address, "address");
    await provider.removeFromAllowList(kind, address);
    return { ok: true };
  });
}
