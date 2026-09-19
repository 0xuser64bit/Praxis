import {
  readJson,
  readString,
  withMutationProvider,
} from "@/server/api/json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Remove a contact by address or label (case-insensitive, idempotent). */
export async function POST(request: Request) {
  return withMutationProvider(request, async (provider) => {
    const body = await readJson(request);
    const key = readString(body.key, "key", { maxLength: 64 });
    await provider.removeContact(key);
    return { ok: true };
  });
}
