import type { NextConfig } from "next";

/**
 * Baseline security headers applied to every response. The high-value, non-
 * breaking hardening: no framing (clickjacking), no MIME sniffing, HSTS, a tight
 * referrer/permissions posture, and a CSP locked down on the directives that
 * don't need per-request nonces (frame-ancestors, object-src, base-uri,
 * form-action, connect/img/font origins).
 *
 * script-src intentionally keeps 'unsafe-inline'/'unsafe-eval' because the App
 * Router injects inline bootstrap scripts; a strict, nonce-based script-src is
 * the follow-up. The browser only ever calls same-origin /api/praxis/*, so
 * connect-src 'self' is safe (Gemini and the Solana RPC are server-side).
 */
const CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "img-src 'self' data: blob:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "connect-src 'self'",
  "font-src 'self' data:",
].join("; ");

const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: CSP },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
];

const nextConfig: NextConfig = {
  // Drop the `X-Powered-By: Next.js` fingerprint.
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
