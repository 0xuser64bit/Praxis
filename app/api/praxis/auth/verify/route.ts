import {
  assertSameOrigin,
  jsonError,
  jsonOk,
  readJson,
  readString,
} from "@/server/api/json";
import { verifyWalletChallenge } from "@/server/auth/challenge";
import { createSessionCookie } from "@/server/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const body = await readJson(request);
    const walletAddress = verifyWalletChallenge({
      address: readString(body.address, "address", { maxLength: 64 }),
      nonce: readString(body.nonce, "nonce", { maxLength: 128 }),
      signature: readString(body.signature, "signature", { maxLength: 128 }),
    }, request);
    return jsonOk(
      { authenticated: true, walletAddress },
      { headers: { "set-cookie": createSessionCookie(walletAddress, request) } },
    );
  } catch (error) {
    return jsonError(error);
  }
}
