/**
 * The recorded cost history.
 *
 * A logger has been round-tripping the basket every few minutes since the
 * project started. That series is the evidence this is a live phenomenon and
 * not a single lucky snapshot -- cost moves, and it moves most around the
 * market open and close.
 *
 * The CSV is copied into public/ at build time (see package.json prebuild) so
 * the deployed site ships its own evidence rather than refetching it.
 */

export interface HistoryPoint {
  ts: Date;
  symbol: string;
  marketOpen: boolean | null;
  sizeUsdc: number;
  roundTripBps: number;
  tokensOut: number;
  usdBack: number;
  buyRoute: string;
  sellRoute: string;
  buyImpactPct: number;
  sellImpactPct: number;
  liquidityUsd: number;
}

export interface Series {
  symbol: string;
  points: HistoryPoint[];
  min: number;
  max: number;
  first: number;
  last: number;
}

/** Minimal RFC4180-ish parser: handles quoted fields, which routes can contain. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.length > 1);
}

export function parseHistory(csv: string): HistoryPoint[] {
  const rows = parseCsv(csv);
  if (rows.length < 2) return [];
  const header = rows[0];
  const idx = (name: string) => header.indexOf(name);
  const iTs = idx("ts");
  const iSym = idx("symbol");
  const iOpen = idx("market_open");
  const iSize = idx("size_usdc");
  const iBps = idx("roundtrip_bps");
  const iTokens = idx("tokens_out");
  const iBack = idx("usd_back");
  const iBuyRoute = idx("buy_route");
  const iSellRoute = idx("sell_route");
  const iBuyImp = idx("buy_impact_pct");
  const iSellImp = idx("sell_impact_pct");
  const iLiq = idx("liquidity_usd");
  if (iTs < 0 || iSym < 0 || iBps < 0) return [];

  const out: HistoryPoint[] = [];
  for (const r of rows.slice(1)) {
    const bps = Number(r[iBps]);
    if (!Number.isFinite(bps)) continue;
    out.push({
      ts: new Date(r[iTs]),
      symbol: r[iSym],
      marketOpen: r[iOpen] === "True" ? true : r[iOpen] === "False" ? false : null,
      sizeUsdc: Number(r[iSize]),
      roundTripBps: bps,
      tokensOut: Number(r[iTokens]) || 0,
      usdBack: Number(r[iBack]) || 0,
      buyRoute: r[iBuyRoute] ?? "",
      sellRoute: r[iSellRoute] ?? "",
      buyImpactPct: Number(r[iBuyImp]) || 0,
      sellImpactPct: Number(r[iSellImp]) || 0,
      liquidityUsd: Number(r[iLiq]) || 0,
    });
  }
  return out;
}

/**
 * Timestamp of the newest tick that recorded every token at every size.
 *
 * About one tick in five is missing a token because a Jupiter quote failed.
 * Both the table and the series end at this tick so the page never shows two
 * different "current" numbers for the same token, and so the hero's
 * same-size-same-minute comparison is actually from one minute. Null when no
 * tick is complete, in which case callers fall back to the newest tick at all.
 */
export function newestCompleteTick(points: HistoryPoint[]): number | null {
  if (points.length === 0) return null;
  const expected = new Set(points.map((p) => `${p.symbol}@${p.sizeUsdc}`)).size;
  const counts = new Map<number, number>();
  for (const p of points) {
    const t = p.ts.getTime();
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  const complete = [...counts.entries()]
    .filter(([, n]) => n >= expected)
    .map(([t]) => t)
    .sort((a, b) => b - a);
  return complete[0] ?? null;
}

/** One series per token at a given trade size, oldest first. */
export function toSeries(points: HistoryPoint[], sizeUsdc: number): Series[] {
  // Stop at the same tick the table stops at, so "Now" agrees with it.
  const cutoff = newestCompleteTick(points);
  const bySymbol = new Map<string, HistoryPoint[]>();
  for (const p of points) {
    if (p.sizeUsdc !== sizeUsdc) continue;
    if (cutoff !== null && p.ts.getTime() > cutoff) continue;
    bySymbol.set(p.symbol, [...(bySymbol.get(p.symbol) ?? []), p]);
  }

  return [...bySymbol.entries()]
    .map(([symbol, pts]) => {
      const sorted = [...pts].sort((a, b) => a.ts.getTime() - b.ts.getTime());
      const values = sorted.map((p) => p.roundTripBps);
      return {
        symbol,
        points: sorted,
        min: Math.min(...values),
        max: Math.max(...values),
        first: values[0],
        last: values[values.length - 1],
      };
    })
    .sort((a, b) => a.last - b.last);
}

export async function loadHistory(): Promise<HistoryPoint[]> {
  try {
    const res = await fetch("/history.csv");
    if (!res.ok) return [];
    return parseHistory(await res.text());
  } catch {
    return [];
  }
}

/**
 * The most recent recorded snapshot, shaped like live measurements.
 *
 * The page seeds itself from this instead of firing 48 quotes on load. Quoting
 * everything on mount starved the rest of the app of API budget -- the free
 * Jupiter tier started returning 429 and the on-demand planner could not get a
 * quote at all. Recorded data paints instantly and costs nothing; live
 * measurement is then something the user asks for.
 */
export function latestSnapshot(points: HistoryPoint[]): {
  ts: Date | null;
  trips: RoundTripLike[];
  liquidity: Map<string, number>;
} {
  if (points.length === 0) return { ts: null, trips: [], liquidity: new Map() };

  // Take the newest *complete* tick, not simply the newest.
  //
  // A Jupiter quote fails often enough that about one tick in five is missing at
  // least one token, and seeding from a partial tick leaves a row of dashes in
  // the headline table. Ticks are 15 minutes apart, so stepping back costs a
  // little freshness and buys a table where every row is present and every row
  // is from the same instant. Falling back to the newest tick regardless means a
  // first run, with only a partial tick recorded, still paints something.
  const newest =
    newestCompleteTick(points) ?? Math.max(...points.map((p) => p.ts.getTime()));
  const latest = points.filter((p) => p.ts.getTime() === newest);

  const liquidity = new Map<string, number>();
  for (const p of latest) if (p.liquidityUsd) liquidity.set(p.symbol, p.liquidityUsd);

  return {
    ts: new Date(newest),
    liquidity,
    trips: latest.map((p) => ({
      symbol: p.symbol,
      sizeUsdc: p.sizeUsdc,
      rawTokens: 0n,
      tokensOut: p.tokensOut,
      usdBack: p.usdBack,
      roundTripBps: p.roundTripBps,
      buyRoute: p.buyRoute,
      sellRoute: p.sellRoute,
      buyImpactPct: p.buyImpactPct,
      sellImpactPct: p.sellImpactPct,
    })),
  };
}

/** Structurally a RoundTrip; rawTokens is meaningless for recorded rows. */
export type RoundTripLike = {
  symbol: string;
  sizeUsdc: number;
  rawTokens: bigint;
  tokensOut: number;
  usdBack: number;
  roundTripBps: number;
  buyRoute: string;
  sellRoute: string;
  buyImpactPct: number;
  sellImpactPct: number;
};
