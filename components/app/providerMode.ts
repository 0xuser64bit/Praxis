"use client";

export type ProviderMode = "api" | "mock" | "mock-disabled";

export function resolveProviderMode(): ProviderMode {
  const configured = process.env.NEXT_PUBLIC_PRAXIS_PROVIDER?.trim().toLowerCase();

  if (configured === "api") return "api";

  if (configured === "mock") {
    return isMockAllowed() ? "mock" : "mock-disabled";
  }

  return process.env.NODE_ENV === "production" ? "api" : "mock";
}

export function isApiMode(): boolean {
  return resolveProviderMode() === "api";
}

function isMockAllowed(): boolean {
  return process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_PRAXIS_ALLOW_MOCK === "1";
}
