/**
 * Host-based routing for the apex ↔ app-subdomain split.
 *
 * - `app.<apex>/` serves the product app (rewrite to `/app` internally).
 * - `app.<apex>/app/*` strips to `/*` (one canonical URL per page).
 * - `<apex>/app*` (and `www.<apex>/app*`) redirect to `app.<apex>/*`.
 * - `www.<apex>/*` redirects to `<apex>/*`.
 * - Everything else passes through, including `/api/*` on every host (app and
 *   API stay same-origin, so the session cookie and same-origin mutation guard
 *   keep working unchanged) and all preview / staging hosts (only the
 *   configured production apex is ever redirected).
 * - `localhost` passes through on paths; `app.localhost` gets app treatment
 *   for local testing.
 *
 * Pure string logic, no Node APIs — safe to import from edge middleware.
 * Query strings are not part of `pathname`; the middleware preserves them by
 * cloning the request URL.
 */

export type HostRoute =
  | { type: "passthrough" }
  | { type: "rewrite"; pathname: string }
  | { type: "redirect"; host: string | null; pathname: string };

const APP_LABEL = "app";
const WWW_LABEL = "www";

function hostnameOf(host: string | null): string {
  return (host ?? "").split(":")[0].trim().toLowerCase();
}

function isLocal(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "127.0.0.1" ||
    hostname === "::1"
  );
}

function appRoutes(pathname: string): HostRoute {
  if (pathname === "/") return { type: "rewrite", pathname: "/app" };
  if (pathname === "/app" || pathname.startsWith("/app/")) {
    return { type: "redirect", host: null, pathname: pathname.slice("/app".length) || "/" };
  }
  return { type: "passthrough" };
}

export function routeByHost(host: string | null, pathname: string, apex = "usepraxis.fun"): HostRoute {
  const hostname = hostnameOf(host);
  if (!hostname) return { type: "passthrough" };

  // Local dev: paths only, except app.localhost which previews the split.
  if (isLocal(hostname)) {
    if (hostname === `${APP_LABEL}.localhost`) return appRoutes(pathname);
    return { type: "passthrough" };
  }

  // The product subdomain.
  if (hostname === `${APP_LABEL}.${apex}`) return appRoutes(pathname);

  // Production apex (+ www): move /app to the subdomain, canonicalize www.
  if (hostname === apex || hostname === `${WWW_LABEL}.${apex}`) {
    if (pathname === "/app" || pathname.startsWith("/app/")) {
      return {
        type: "redirect",
        host: `${APP_LABEL}.${apex}`,
        pathname: pathname.slice("/app".length) || "/",
      };
    }
    if (hostname.startsWith(`${WWW_LABEL}.`)) {
      return { type: "redirect", host: apex, pathname };
    }
    return { type: "passthrough" };
  }

  // Preview / staging / unknown hosts: never redirect (no broken app.<hash> URLs).
  return { type: "passthrough" };
}
