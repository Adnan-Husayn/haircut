/**
 * Solana connection.
 *
 * The public mainnet-beta endpoint rate-limits aggressively under load, so
 * scripts should set RPC_HTTP (loaded from .env via `node --env-file`).
 *
 * SECURITY: anything named VITE_* is inlined into the client bundle at build
 * time and is therefore public. Do NOT set VITE_RPC_HTTP in a deployed build
 * unless the key is meant to be world-readable. The browser only needs a single
 * getMultipleAccounts call for the staleness panel, which the public endpoint
 * serves comfortably -- leaving VITE_RPC_HTTP unset in production is the correct
 * default. It exists for local development convenience only.
 */
import { Connection } from "@solana/web3.js";

const PUBLIC_FALLBACK = "https://api.mainnet-beta.solana.com";

export function rpcUrl(): string {
  const fromVite =
    typeof import.meta !== "undefined"
      ? (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_RPC_HTTP
      : undefined;
  const fromNode = typeof process !== "undefined" ? process.env?.RPC_HTTP : undefined;
  return fromVite ?? fromNode ?? PUBLIC_FALLBACK;
}

export function isPublicFallback(): boolean {
  return rpcUrl() === PUBLIC_FALLBACK;
}

/**
 * RPC endpoint with any credential removed, safe to print or screenshot.
 * Providers put the key in a query param (Helius `?api-key=`) or in the path
 * (QuickNode), so strip both.
 */
export function rpcDisplay(): string {
  const raw = rpcUrl();
  try {
    const url = new URL(raw);
    const redactedParams = [...url.searchParams.keys()].length > 0 ? "?<redacted>" : "";
    const path = url.pathname !== "/" ? "/<redacted>" : "";
    return `${url.protocol}//${url.host}${path}${redactedParams}`;
  } catch {
    return "<unparseable rpc url>";
  }
}

export function makeConnection(): Connection {
  return new Connection(rpcUrl(), { commitment: "confirmed" });
}
