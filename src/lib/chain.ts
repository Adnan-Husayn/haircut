/**
 * Solana connection.
 *
 * The public mainnet-beta endpoint rate-limits aggressively under load, so
 * anything doing real work wants a keyed provider.
 *
 * SECURITY: anything named VITE_* is inlined into the client bundle at build
 * time and is therefore public. The key must never reach the browser, so the
 * deployed page does not hold one -- it posts to a same-origin proxy
 * (api/rpc.ts) that holds the key server-side and forwards only the RPC
 * methods this application actually calls.
 *
 *   browser, deployed  ->  /api/rpc  ->  keyed provider
 *   browser, local dev ->  VITE_RPC_HTTP directly (convenience only)
 *   node scripts       ->  RPC_HTTP from .env
 */
import { Connection } from "@solana/web3.js";

const PUBLIC_FALLBACK = "https://api.mainnet-beta.solana.com";
const PUBLIC_WS = "wss://api.mainnet-beta.solana.com/";
const PROXY_PATH = "/api/rpc";

const inBrowser = typeof window !== "undefined" && typeof window.location !== "undefined";

export function rpcUrl(): string {
  const fromVite =
    typeof import.meta !== "undefined"
      ? (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_RPC_HTTP
      : undefined;
  if (fromVite) return fromVite;

  // Deployed browser: no credential here, so go through the proxy.
  if (inBrowser) return new URL(PROXY_PATH, window.location.origin).toString();

  const fromNode = typeof process !== "undefined" ? process.env?.RPC_HTTP : undefined;
  return fromNode ?? PUBLIC_FALLBACK;
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
  const endpoint = rpcUrl();

  // The proxy speaks HTTP only. Left to itself web3.js would derive a websocket
  // URL on this same origin, where nothing is listening, and confirming a swap
  // would hang. Subscriptions go to the public websocket instead -- one socket,
  // no credential required.
  if (endpoint.endsWith(PROXY_PATH)) {
    return new Connection(endpoint, { commitment: "confirmed", wsEndpoint: PUBLIC_WS });
  }
  return new Connection(endpoint, { commitment: "confirmed" });
}
