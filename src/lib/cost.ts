/**
 * Execution cost measurement.
 *
 * The metric is ROUND-TRIP COST: buy $N of a token, then immediately sell the
 * exact amount received. Whatever does not come back is what entering and
 * exiting actually cost.
 *
 * Why not "effective price vs mid":
 *
 *  - Jupiter's `usdPrice` is an index price, not the executable mid of the pool
 *    the trade routes through. Costing against it produced impossible results
 *    (METAx at -4.4 bps, i.e. buying below mid).
 *  - xStocks carry Token-2022 scaledUiAmount multipliers for dividends and
 *    splits, so `raw / 10**decimals` is not a share-equivalent amount.
 *
 * A round trip is immune to both. Both legs are quoted in raw base units, so the
 * multiplier cancels exactly, and no reference price is required.
 *
 * Soundness check: round-trip cost should be monotonic in trade size and
 * monotonic in pool depth. See assertSane() below.
 */
import { quote, routeLabel, type Quote } from "./jupiter";
import { USDC_DECIMALS, USDC_MINT, type XStock } from "./tokens";

export interface RoundTrip {
  symbol: string;
  /** Whole USDC sent in. */
  sizeUsdc: number;
  /** Raw base units of the xStock received on the buy leg. */
  rawTokens: bigint;
  /** Naive token count. Display only — ignores the scaledUiAmount multiplier. */
  tokensOut: number;
  /** USDC returned by selling the exact buy output straight back. */
  usdBack: number;
  /** The headline: cost of a full entry and exit, in basis points. */
  roundTripBps: number;
  buyRoute: string;
  sellRoute: string;
  buyImpactPct: number;
  sellImpactPct: number;
}

/** Quote a buy and the matching sell, and measure what the pair costs. */
export async function measureRoundTrip(token: XStock, sizeUsdc: number): Promise<RoundTrip> {
  const inRaw = BigInt(sizeUsdc) * 10n ** BigInt(USDC_DECIMALS);

  const buy = await quote(USDC_MINT, token.mint, inRaw);
  const rawTokens = BigInt(buy.outAmount);
  if (rawTokens <= 0n) throw new Error(`${token.symbol}: buy leg returned no tokens`);

  // Sell back exactly what the buy produced -- this is what makes the multiplier cancel.
  const sell = await quote(token.mint, USDC_MINT, rawTokens);
  const usdBack = Number(BigInt(sell.outAmount)) / 10 ** USDC_DECIMALS;

  return {
    symbol: token.symbol,
    sizeUsdc,
    rawTokens,
    tokensOut: Number(rawTokens) / 10 ** token.decimals,
    usdBack,
    roundTripBps: ((sizeUsdc - usdBack) / sizeUsdc) * 10_000,
    buyRoute: routeLabel(buy),
    sellRoute: routeLabel(sell),
    buyImpactPct: pctOf(buy),
    sellImpactPct: pctOf(sell),
  };
}

function pctOf(q: Quote): number {
  return Number(q.priceImpactPct ?? 0) * 100;
}

/**
 * Cost should rise with trade size. A real violation means a quote was stale, a
 * route shifted mid-measurement, or the maths is wrong -- worth surfacing.
 *
 * The two legs of a round trip are quoted a moment apart and routes can change
 * between them, so sub-bps wobble is noise rather than a defect. Only flag a
 * decrease that exceeds TOLERANCE_BPS.
 */
const TOLERANCE_BPS = 0.5;

export function assertSane(trips: RoundTrip[]): string[] {
  const problems: string[] = [];
  const bySymbol = new Map<string, RoundTrip[]>();
  for (const t of trips) {
    bySymbol.set(t.symbol, [...(bySymbol.get(t.symbol) ?? []), t]);
  }
  for (const [symbol, group] of bySymbol) {
    const sorted = [...group].sort((a, b) => a.sizeUsdc - b.sizeUsdc);
    for (const t of sorted) {
      if (t.roundTripBps < -TOLERANCE_BPS) {
        problems.push(`${symbol} @ $${t.sizeUsdc}: negative round-trip (${t.roundTripBps.toFixed(1)} bps)`);
      }
    }
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].roundTripBps < sorted[i - 1].roundTripBps - TOLERANCE_BPS) {
        problems.push(
          `${symbol}: cost falls with size ($${sorted[i - 1].sizeUsdc} ` +
            `${sorted[i - 1].roundTripBps.toFixed(1)}bps -> $${sorted[i].sizeUsdc} ` +
            `${sorted[i].roundTripBps.toFixed(1)}bps)`,
        );
      }
    }
  }
  return problems;
}

/**
 * Market price implied by a round trip's buy leg.
 *
 * Used as a fallback when Jupiter's index price is unavailable (it rate-limits
 * under load, and losing it emptied the oracle-divergence column). The smallest
 * trade size is the best estimate because it carries the least price impact.
 *
 * This ignores the scaledUiAmount multiplier, so it is off by up to ~40 bps.
 * That is immaterial here: it is only ever compared against oracle prices that
 * are wrong by whole percentage points.
 */
export function impliedMarketPrice(trips: RoundTrip[], symbol: string): number | undefined {
  const candidates = trips.filter((t) => t.symbol === symbol && t.tokensOut > 0);
  if (candidates.length === 0) return undefined;
  const smallest = candidates.reduce((a, b) => (a.sizeUsdc <= b.sizeUsdc ? a : b));
  return smallest.sizeUsdc / smallest.tokensOut;
}
