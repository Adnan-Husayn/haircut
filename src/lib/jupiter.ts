/**
 * Jupiter API client.
 *
 * Endpoints verified live against lite-api.jup.ag: quotes and swap-transaction
 * building both work with no API key.
 */

const BASE = "https://lite-api.jup.ag";

export interface RoutePlanStep {
  swapInfo: { label: string; inputMint: string; outputMint: string; inAmount: string; outAmount: string };
  percent: number;
}

export interface Quote {
  inputMint: string;
  outputMint: string;
  /** Raw base units in. */
  inAmount: string;
  /** Raw base units out. */
  outAmount: string;
  otherAmountThreshold: string;
  slippageBps: number;
  priceImpactPct: string;
  routePlan: RoutePlanStep[];
  contextSlot?: number;
}

export interface TokenInfo {
  id: string;
  symbol: string;
  decimals: number;
  /** Jupiter's INDEX price. Not the executable mid — do not compute cost against it. */
  usdPrice?: number;
  liquidity?: number;
  holderCount?: number;
}

const RETRIES = 4;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The public endpoint rate-limits under load, so retry transient failures. */
async function getJson<T>(path: string, params: Record<string, string | number>): Promise<T> {
  const url = `${BASE}${path}?${new URLSearchParams(
    Object.entries(params).map(([k, v]) => [k, String(v)]),
  )}`;

  let lastError: unknown;
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": "stocklana/1.0" } });
      if (res.ok) return (await res.json()) as T;
      // 4xx other than 429 will not improve on retry.
      if (res.status !== 429 && res.status < 500) {
        throw new Error(`${path} -> ${res.status} ${res.statusText}`);
      }
      lastError = new Error(`${path} -> ${res.status} ${res.statusText}`);
      if (res.status === 429) {
        // Respect Retry-After when the server sends it, else back off hard.
        const retryAfter = Number(res.headers.get("retry-after"));
        await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : attempt * 2500);
        continue;
      }
    } catch (err) {
      lastError = err;
    }
    if (attempt < RETRIES) await sleep(attempt * 600);
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/** A single executable quote. `amount` is in the INPUT mint's raw base units. */
export function quote(
  inputMint: string,
  outputMint: string,
  amount: number | bigint,
  slippageBps = 50,
): Promise<Quote> {
  return getJson<Quote>("/swap/v1/quote", {
    inputMint,
    outputMint,
    amount: amount.toString(),
    slippageBps,
  });
}

export async function searchToken(query: string): Promise<TokenInfo | undefined> {
  const hits = await getJson<TokenInfo[]>("/tokens/v2/search", { query });
  return hits?.[0];
}

/** Distinct venue labels in route order, e.g. "Whirlpool + Raydium CLMM". */
export function routeLabel(q: Quote): string {
  return [...new Set(q.routePlan.map((s) => s.swapInfo.label))].join(" + ");
}

export interface SwapBuild {
  swapTransaction: string;
  lastValidBlockHeight: number;
  prioritizationFeeLamports?: number;
}

/** Build (but do not send) the swap transaction for a quote. */
export async function buildSwapTransaction(
  quoteResponse: Quote,
  userPublicKey: string,
): Promise<SwapBuild> {
  const res = await fetch(`${BASE}/swap/v1/swap`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ quoteResponse, userPublicKey, wrapAndUnwrapSol: true }),
  });
  if (!res.ok) throw new Error(`/swap/v1/swap -> ${res.status} ${res.statusText}`);
  return res.json() as Promise<SwapBuild>;
}
