import {
  assertSameOrigin,
  jsonError,
  jsonOk,
  readJson,
  readString,
} from "@/server/api/json";
import { createWalletChallenge } from "@/server/auth/challenge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const body = await readJson(request);
    const address = readString(body.address, "address", { maxLength: 64 });
    return jsonOk(createWalletChallenge(address, request));
  } catch (error) {
    return jsonError(error);
  }
}
