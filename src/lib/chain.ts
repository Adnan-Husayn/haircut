/**
 * Solana connection.
 *
 * The public mainnet-beta endpoint rate-limits aggressively under any real load.
 * Set RPC_HTTP (node) or VITE_RPC_HTTP (browser) to a Helius/QuickNode URL.
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

export function makeConnection(): Connection {
  return new Connection(rpcUrl(), { commitment: "confirmed" });
}
