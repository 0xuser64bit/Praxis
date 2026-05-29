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
  return withProvider(async (provider) => {
    requireMutationAuth(request);
    const body = await readJson(request);
    const kind = readAllowListKind(body.kind);
    const address = readString(body.address, "address");
    await provider.removeFromAllowList(kind, address);
    return { ok: true };
  });
}
