"use client";

/**
 * Solana Explorer transaction URL honoring the configured cluster. The app is
 * devnet-first (see onboarding + docs/DEPLOY.md); without `?cluster=devnet`
 * every link renders mainnet and 404s the transaction.
 */
export function explorerTxUrl(sig: string): string {
  const cluster = (process.env.NEXT_PUBLIC_SOLANA_CLUSTER ?? "devnet").trim().toLowerCase();
  const base = `https://explorer.solana.com/tx/${encodeURIComponent(sig)}`;
  return cluster === "mainnet-beta" ? base : `${base}?cluster=${encodeURIComponent(cluster)}`;
}
