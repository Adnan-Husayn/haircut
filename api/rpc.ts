/**
 * Server-side Solana RPC proxy.
 *
 * The browser needs a keyed RPC endpoint to read Pyth price accounts, but any
 * VITE_* variable is inlined into the public bundle at build time -- shipping
 * the key that way publishes it. So the key stays here, in a server-only
 * environment variable, and the browser talks to this same-origin path instead.
 *
 * A proxy that forwards anything is an open relay for whoever finds it, so
 * only the methods this application actually calls are forwarded. Everything
 * else is refused before it reaches the upstream provider.
 */

export const config = { runtime: "edge" };

const PUBLIC_FALLBACK = "https://api.mainnet-beta.solana.com";

/** Exactly what the page and the swap flow call, and nothing else. */
const ALLOWED_METHODS = new Set([
  // staleness panel
  "getAccountInfo",
  "getMultipleAccounts",
  // swap: build, dry-run, broadcast, confirm
  "getLatestBlockhash",
  "getFeeForMessage",
  "simulateTransaction",
  "sendTransaction",
  "getSignatureStatuses",
  // balances and housekeeping web3.js performs on its own
  "getBalance",
  "getTokenAccountBalance",
  "getTokenAccountsByOwner",
  "getMinimumBalanceForRentExemption",
  "getSlot",
  "getBlockHeight",
  "getEpochInfo",
  "getVersion",
]);

const MAX_BODY_BYTES = 128 * 1024;
const MAX_BATCH = 20;

type RpcCall = { method?: unknown };

function refuse(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return refuse("This endpoint accepts JSON-RPC over POST only.", 405);
  }

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    return refuse("Request body is too large.", 413);
  }

  let payload: RpcCall | RpcCall[];
  try {
    payload = JSON.parse(raw);
  } catch {
    return refuse("Request body is not valid JSON.", 400);
  }

  const calls = Array.isArray(payload) ? payload : [payload];
  if (calls.length === 0 || calls.length > MAX_BATCH) {
    return refuse(`A batch must contain between 1 and ${MAX_BATCH} calls.`, 400);
  }

  for (const call of calls) {
    if (typeof call?.method !== "string" || !ALLOWED_METHODS.has(call.method)) {
      return refuse(
        `Method ${String(call?.method)} is not available through this endpoint.`,
        403,
      );
    }
  }

  const upstream = process.env.RPC_HTTP || PUBLIC_FALLBACK;

  const response = await fetch(upstream, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: raw,
  });

  // Pass the provider's own status through: a 429 must stay a 429 so web3.js
  // backs off rather than trying to parse a rate-limit page as a result.
  return new Response(response.body, {
    status: response.status,
    headers: {
      "content-type": response.headers.get("content-type") ?? "application/json",
      "cache-control": "no-store",
    },
  });
}
