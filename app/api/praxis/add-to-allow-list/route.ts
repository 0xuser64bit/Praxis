import { readJson, readString, withProvider } from "@/server/api/json";
import type { AllowListKind } from "@praxis/shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await readJson(request);
  const kind = readAllowListKind(body.kind);
  const address = readString(body.address, "address");
  return withProvider(async (provider) => {
    await provider.addToAllowList(kind, address);
    return { ok: true };
  });
}

function readAllowListKind(value: unknown): AllowListKind {
  if (value === "programs" || value === "recipients" || value === "mints") return value;
  throw new Error("kind must be programs, recipients, or mints");
}
