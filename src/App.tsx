import { useEffect, useState } from "react";
import CostHistory from "./components/CostHistory";
import CostTable from "./components/CostTable";
import OrderPlanner from "./components/OrderPlanner";
import StalenessPanel from "./components/StalenessPanel";
import SwapPanel from "./components/SwapPanel";
import { impliedMarketPrice, measureRoundTrip, type RoundTrip } from "./lib/cost";
import { latestSnapshot, loadHistory, type HistoryPoint } from "./lib/history";
import { marketOpen, readFeeds, type PriceUpdate } from "./lib/pyth";
import { SIZES_USDC, XSTOCKS } from "./lib/tokens";

const PAUSE_MS = 250;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The size the page leads with, and the size everything is ranked on. */
const RANK_SIZE = Math.max(...SIZES_USDC);

const costInDollars = (t: RoundTrip) => (t.roundTripBps / 10_000) * t.sizeUsdc;

/** Cheapest against dearest at the headline size, or null until data arrives. */
function spread(trips: RoundTrip[]) {
  const atRank = trips
    .filter((t) => t.sizeUsdc === RANK_SIZE)
    .sort((a, b) => a.roundTripBps - b.roundTripBps);
  if (atRank.length < 2) return null;

  const best = atRank[0];
  const worst = atRank[atRank.length - 1];
  if (best.roundTripBps <= 0) return null;

  return {
    size: RANK_SIZE,
    bestSymbol: best.symbol,
    worstSymbol: worst.symbol,
    bestCost: costInDollars(best),
    worstCost: costInDollars(worst),
    ratio: Math.round(worst.roundTripBps / best.roundTripBps),
  };
}

export default function App() {
  const [trips, setTrips] = useState<RoundTrip[]>([]);
  const [liquidity, setLiquidity] = useState<Map<string, number>>(new Map());
  const [feeds, setFeeds] = useState<Map<string, PriceUpdate>>(new Map());
  const [isOpen, setIsOpen] = useState<boolean | null>(null);
  const [history, setHistory] = useState<HistoryPoint[]>([]);

  /** When the displayed table was recorded; null once it has been refreshed live. */
  const [recordedAt, setRecordedAt] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [done, setDone] = useState(0);
  const [failed, setFailed] = useState(0);

  const total = XSTOCKS.length * SIZES_USDC.length;

  // Paint from recorded data. Quoting the whole basket on mount exhausted the
  // free Jupiter tier and left nothing for the on-demand planner.
  useEffect(() => {
    let cancelled = false;

    marketOpen("AAPL").then((v) => !cancelled && setIsOpen(v));

    // Both families in one call: the company feed and the token's own feed.
    // The comparison between them is the point of the panel.
    const feedIds = XSTOCKS.flatMap((t) => [t.pythFeedId, t.tokenFeedId]).filter(
      (id): id is string => !!id,
    );
    readFeeds(feedIds)
      .then((m) => !cancelled && setFeeds(m))
      .catch(() => {/* panel stays empty */});

    loadHistory().then((h) => {
      if (cancelled) return;
      setHistory(h);
      const snap = latestSnapshot(h);
      if (snap.trips.length) {
        setTrips(snap.trips as RoundTrip[]);
        setLiquidity(snap.liquidity);
        setRecordedAt(snap.ts);
      }
    });

    return () => { cancelled = true; };
  }, []);

  /** Re-measure everything live, on request. */
  async function refreshLive() {
    setRefreshing(true);
    setDone(0);
    setFailed(0);
    const fresh: RoundTrip[] = [];
    for (const token of XSTOCKS) {
      for (const size of SIZES_USDC) {
        try {
          fresh.push(await measureRoundTrip(token, size));
          setTrips([...fresh]);
        } catch {
          setFailed((n) => n + 1);
        }
        setDone((n) => n + 1);
        await sleep(PAUSE_MS);
      }
    }
    setRecordedAt(null);
    setRefreshing(false);
  }

  const marketPrice = new Map<string, number>();
  for (const token of XSTOCKS) {
    const implied = impliedMarketPrice(trips, token.symbol);
    if (implied) marketPrice.set(token.symbol, implied);
  }

  // The hero is the whole argument in one figure: the dearest and cheapest way
  // to put the same money into equities, in the same minute.
  const headline = spread(trips);

  return (
    <div className="wrap">
      <header className="masthead">
        <div className="left">
          <h1>Haircut</h1>
          <p className="tagline">
            Every tokenized stock takes one. Buy ${RANK_SIZE.toLocaleString()}, sell back exactly
            what you got, and count what never came home. That gap is the haircut, and nothing
            tells you how big it is before you trade.
          </p>
        </div>
        <div className="right">
          {headline ? (
            <>
              <div className="kick">
                Same ${headline.size.toLocaleString()} · same minute · {headline.ratio}× apart
              </div>
              <div className="headline-figure">
                ${headline.worstCost.toFixed(2)}
                <span className="gloss">
                  {headline.worstSymbol} round trip. The identical trade in {headline.bestSymbol}{" "}
                  costs ${headline.bestCost.toFixed(2)}.
                </span>
              </div>
            </>
          ) : (
            <div className="kick">measuring…</div>
          )}
        </div>
      </header>
      <p className="sub">
        Measured, not quoted: buy $N of the token, then immediately sell the exact amount
        received. Whatever does not come back is the haircut: what entering and exiting actually
        cost you.
      </p>

      <div className="panel">
        <h2>
          Round-trip execution cost{" "}
          {isOpen === null ? null : (
            <span className={`pill ${isOpen ? "open" : "closed"}`}>
              US market {isOpen ? "open" : "closed"}
            </span>
          )}
        </h2>
        <p className="note">
          xStocks trade 24/7; the market pricing them does not. Cost is measured across whichever
          venues the trade actually routes through.
        </p>
        <CostTable trips={trips} liquidity={liquidity} />

        <div className="provenance">
          <span className={recordedAt ? "muted" : "good"}>
            {refreshing
              ? `measuring live… ${done}/${total}${failed ? ` · ${failed} failed` : ""}`
              : recordedAt
                ? `recorded ${recordedAt.toISOString().slice(5, 16).replace("T", " ")} UTC`
                : `measured live${failed ? ` · ${failed} of ${total} quotes failed` : ""}`}
          </span>
          <button onClick={refreshLive} disabled={refreshing}>
            {refreshing ? "measuring…" : "Re-measure live"}
          </button>
        </div>
      </div>

      <OrderPlanner trips={trips} />

      <div className="panel">
        <h2>Cost is not a constant</h2>
        <p className="note">
          Recorded continuously since the project started. The spread between tokens persists, and
          each token's own cost moves, which is why a single quote is not an answer.
        </p>
        <CostHistory points={history} sizeUsdc={Math.max(...SIZES_USDC)} />
      </div>

      <SwapPanel />

      <div className="panel">
        <h2>The oracle prices the company, not the token</h2>
        <p className="note">
          Pyth publishes two feeds per name, read here directly from their price accounts on
          Solana. The company feed is live and keeps moving after the US close. The feed for the
          token itself stopped on 12 September, and the redemption-rate feeds that would price the
          gap between a token and a share stopped about eight weeks ago. Nobody is paying to keep
          the tokenized-asset feeds current, which is the reason this page measures the round trip
          instead of trusting a reference price.
        </p>
        <p className="note">
          A price account is a PDA of [shard, feed id], and the same feed exists at several shards.
          Shard 0 of the company feeds is abandoned and still answers, with a month-old price and
          no error of any kind. This page had that wrong until 16 September: it read shard 0 and
          reported a dead deployment as a dead oracle. Every read now sweeps the shards and takes
          the freshest. SOL/USD is the control, and it has the same trap at shard 2.
        </p>
        <StalenessPanel feeds={feeds} marketPrice={marketPrice} />
      </div>

      <p className="foot">
        Cost is measured by round trip, so no reference price is needed. That matters because
        xStocks carry Token-2022 scaled-UI multipliers for dividends and splits, and those cancel
        when both legs are quoted in raw base units.
      </p>
    </div>
  );
}
