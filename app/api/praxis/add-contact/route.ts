import {
  readJson,
  readString,
  withMutationProvider,
} from "@/server/api/json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Save (or rename) an address-book contact. Labels have no signing power. */
export async function POST(request: Request) {
  return withMutationProvider(request, async (provider) => {
    const body = await readJson(request);
    const label = readString(body.label, "label", { maxLength: 64 });
    const address = readString(body.address, "address", { maxLength: 64 });
    await provider.addContact(label, address);
    return { ok: true };
  });
}
