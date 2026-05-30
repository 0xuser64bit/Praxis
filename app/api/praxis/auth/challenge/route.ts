import {
  assertSameOrigin,
  jsonError,
  jsonOk,
  readJson,
  readString,
} from "@/server/api/json";
import { assertRateLimit } from "@/server/api/rateLimit";
import { createWalletChallenge } from "@/server/auth/challenge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    await assertRateLimit(request, { scope: "auth-challenge", limit: 20, windowMs: 60_000 });
    const body = await readJson(request);
    const address = readString(body.address, "address", { maxLength: 64 });
    return jsonOk(createWalletChallenge(address, request));
  } catch (error) {
    return jsonError(error);
  }
}
