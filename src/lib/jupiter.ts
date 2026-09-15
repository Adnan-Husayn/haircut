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
  /** Jupiter's INDEX price. Not the executable mid, so do not compute cost against it. */
  usdPrice?: number;
  liquidity?: number;
  holderCount?: number;
}

/**
 * Retry policy.
 *
 * Jupiter's free tier rate-limits per IP on a window of roughly a minute, so a
 * short retry budget gives up long before the window resets. Background work
 * (the cost table) should fail fast and leave the budget alone; a swap the user
 * explicitly asked for should wait it out.
 */
export interface RetryOptions {
  /** Maximum attempts, including the first. */
  attempts?: number;
  /** Give up once waiting this long in total would be exceeded. */
  maxTotalMs?: number;
  /** Called before each wait, so the UI can explain the pause. */
  onRetry?: (info: { attempt: number; attempts: number; waitMs: number; status: number }) => void;
}

const BACKGROUND: Required<Pick<RetryOptions, "attempts" | "maxTotalMs">> = {
  attempts: 4,
  maxTotalMs: 20_000,
};

/** A user-initiated action is worth outwaiting a rate-limit window for. */
export const PATIENT: RetryOptions = { attempts: 7, maxTotalMs: 80_000 };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** What went wrong, in words a person can act on. */
function describe(path: string, status: number, statusText: string): string {
  if (status === 429) {
    return `Jupiter's free API is rate-limiting this connection (429 on ${path}). ` +
      `It clears after about a minute.`;
  }
  if (status >= 500) return `Jupiter is having trouble (${status} on ${path}).`;
  return `${path} -> ${status} ${statusText}`;
}

function backoffMs(attempt: number, res?: Response): number {
  const header = Number(res?.headers.get("retry-after"));
  if (Number.isFinite(header) && header > 0) return Math.min(header * 1000, 30_000);
  // Exponential with jitter, so parallel callers do not retry in lockstep.
  const base = Math.min(1500 * 2 ** (attempt - 1), 20_000);
  return Math.round(base * (0.75 + Math.random() * 0.5));
}

/**
 * One HTTP call with retries. Returns only an ok response; anything else throws.
 *
 * A 4xx that is not 429 will not improve on retry, so it fails immediately --
 * note this throw is deliberately outside the network try/catch, which used to
 * swallow it and retry a hopeless request three more times.
 */
async function request(url: string, init: RequestInit, retry: RetryOptions = {}): Promise<Response> {
  const attempts = retry.attempts ?? BACKGROUND.attempts;
  const maxTotalMs = retry.maxTotalMs ?? BACKGROUND.maxTotalMs;
  const started = Date.now();
  const path = new URL(url).pathname;

  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    let res: Response | undefined;
    try {
      res = await fetch(url, init);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }

    if (res) {
      if (res.ok) return res;
      if (res.status !== 429 && res.status < 500) {
        throw new Error(describe(path, res.status, res.statusText));
      }
      lastError = new Error(describe(path, res.status, res.statusText));
    }

    if (attempt === attempts) break;

    const waitMs = backoffMs(attempt, res);
    if (Date.now() - started + waitMs > maxTotalMs) break;

    retry.onRetry?.({ attempt, attempts, waitMs, status: res?.status ?? 0 });
    await sleep(waitMs);
  }

  throw lastError ?? new Error(`${path} failed`);
}

async function getJson<T>(
  path: string,
  params: Record<string, string | number>,
  retry?: RetryOptions,
): Promise<T> {
  const url = `${BASE}${path}?${new URLSearchParams(
    Object.entries(params).map(([k, v]) => [k, String(v)]),
  )}`;
  const res = await request(url, {}, retry);
  return (await res.json()) as T;
}

/** A single executable quote. `amount` is in the INPUT mint's raw base units. */
export function quote(
  inputMint: string,
  outputMint: string,
  amount: number | bigint,
  slippageBps = 50,
  retry?: RetryOptions,
): Promise<Quote> {
  return getJson<Quote>(
    "/swap/v1/quote",
    { inputMint, outputMint, amount: amount.toString(), slippageBps },
    retry,
  );
}

export async function searchToken(query: string): Promise<TokenInfo | undefined> {
  const hits = await getJson<TokenInfo[]>("/tokens/v2/search", { query });
  return hits?.[0];
}

export interface RouteLeg {
  label: string;
  /** Share of the trade sent through this venue. */
  percent: number;
}

/**
 * The venue split behind a quote.
 *
 * Percentages only mean "share of the trade" when every step goes straight from
 * the input mint to the output mint -- a parallel split. A multi-hop route
 * chains through an intermediate mint, and each hop's percent is a share of
 * that hop, not of the trade, so summing them would invent a number. In that
 * case the venues are returned without percentages rather than with wrong ones.
 */
export function routeSplit(q: Quote): { legs: RouteLeg[]; isSplit: boolean } {
  const allDirect = q.routePlan.every(
    (s) => s.swapInfo.inputMint === q.inputMint && s.swapInfo.outputMint === q.outputMint,
  );

  if (!allDirect) {
    const labels = [...new Set(q.routePlan.map((s) => s.swapInfo.label))];
    return { legs: labels.map((label) => ({ label, percent: 0 })), isSplit: false };
  }

  const byVenue = new Map<string, number>();
  for (const step of q.routePlan) {
    byVenue.set(step.swapInfo.label, (byVenue.get(step.swapInfo.label) ?? 0) + step.percent);
  }
  const legs = [...byVenue]
    .map(([label, percent]) => ({ label, percent }))
    .sort((a, b) => b.percent - a.percent);

  return { legs, isSplit: true };
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
  retry?: RetryOptions,
): Promise<SwapBuild> {
  const res = await request(
    `${BASE}/swap/v1/swap`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quoteResponse, userPublicKey, wrapAndUnwrapSol: true }),
    },
    retry,
  );
  return (await res.json()) as SwapBuild;
}

/**
 * SOL in USD, for expressing a lamport fee against the size of a trade.
 *
 * Cached: this is needed once per prepared swap and the free tier is shared
 * with the quotes the rest of the page depends on.
 */
const SOL_MINT = "So11111111111111111111111111111111111111112";
const USDC_MINT_ADDR = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const PRICE_TTL_MS = 5 * 60 * 1000;

let cachedSolPrice: { usd: number; at: number } | null = null;

export async function solPriceUsd(): Promise<number | null> {
  if (cachedSolPrice && Date.now() - cachedSolPrice.at < PRICE_TTL_MS) {
    return cachedSolPrice.usd;
  }
  try {
    const q = await quote(SOL_MINT, USDC_MINT_ADDR, 1_000_000_000n);
    const usd = Number(q.outAmount) / 1e6;
    if (!Number.isFinite(usd) || usd <= 0) return null;
    cachedSolPrice = { usd, at: Date.now() };
    return usd;
  } catch {
    return null;
  }
}
