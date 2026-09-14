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
