import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { routeByHost } from "./server/web/hostRouting";

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};

/** Production apex the /app → subdomain redirect applies to. */
function apexHostname(): string {
  try {
    const raw = process.env.NEXT_PUBLIC_SITE_URL ?? "";
    const hostname = new URL(raw).hostname.trim().toLowerCase();
    if (hostname) return hostname.replace(/^www\./, "");
  } catch {
    // Unset or malformed locally — fall through to the default.
  }
  return "usepraxis.fun";
}

export function proxy(req: NextRequest) {
  const route = routeByHost(req.headers.get("host"), req.nextUrl.pathname, apexHostname());

  if (route.type === "passthrough") return NextResponse.next();

  if (route.type === "rewrite") {
    const url = req.nextUrl.clone();
    url.pathname = route.pathname;
    return NextResponse.rewrite(url);
  }

  const url = req.nextUrl.clone();
  if (route.host) url.host = route.host;
  url.pathname = route.pathname;
  return NextResponse.redirect(url, 308);
}
