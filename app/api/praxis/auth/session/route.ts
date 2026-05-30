import { assertSameOrigin, jsonError, jsonOk } from "@/server/api/json";
import {
  clearSessionCookie,
  readSession,
  requireSession,
} from "@/server/auth/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const session = readSession(request);
    return jsonOk({
      authenticated: Boolean(session),
      walletAddress: session?.walletAddress,
      expiresAt: session?.expiresAt,
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    assertSameOrigin(request);
    requireSession(request);
    return jsonOk(
      { authenticated: false },
      { headers: { "set-cookie": clearSessionCookie(request) } },
    );
  } catch (error) {
    return jsonError(error);
  }
}
