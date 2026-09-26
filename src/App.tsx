import { useEffect, useState } from "react";
import CostHistory from "./components/CostHistory";
import CostTable from "./components/CostTable";
import OrderPlanner from "./components/OrderPlanner";
import StalenessPanel from "./components/StalenessPanel";
import SwapPanel from "./components/SwapPanel";
import { impliedMarketPrice, measureRoundTrip, tokenPrice, type RoundTrip } from "./lib/cost";
import { latestSnapshot, loadHistory, type HistoryPoint } from "./lib/history";
import { marketOpen, readFeeds, type PriceUpdate } from "./lib/pyth";
import { readMultipliers } from "./lib/scaled";
import { makeConnection } from "./lib/chain";
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
  const [multipliers, setMultipliers] = useState<Map<string, number>>(new Map());
  const [livePrice, setLivePrice] = useState<Map<string, number>>(new Map());

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

    // Needed before any per-token price can be compared with an oracle price.
    readMultipliers(makeConnection(), XSTOCKS.map((t) => t.mint))
      .then((m) => !cancelled && setMultipliers(m))
      .catch(() => {/* the premium column stays blank rather than wrong */});

    // The premium column compares a price against a live feed, so its price has
    // to be live too. The cost figures beside it are recorded, which is fine:
    // they are a different quantity. Comparing an hour-old trade with a feed
    // that updates every ten seconds measures the stock moving, not a premium.
    // One buy leg each, spaced out, and any failure leaves a dash.
    (async () => {
      const prices = new Map<string, number>();
      for (const token of XSTOCKS) {
        if (cancelled) return;
        try {
          prices.set(token.symbol, await tokenPrice(token));
          setLivePrice(new Map(prices));
        } catch {/* that row shows no premium */}
        await sleep(PAUSE_MS);
      }
    })();

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

  // The live company feed, by symbol. This is the maintained one; the token's own
  // feed stopped in September and is shown separately rather than compared against.
  const oraclePrice = new Map<string, number>();
  for (const token of XSTOCKS) {
    const feed = token.pythFeedId ? feeds.get(token.pythFeedId) : undefined;
    if (feed) oraclePrice.set(token.symbol, feed.price);
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
          venues the trade actually routes through. Against the oracle is a live quote read against
          Pyth's live company feed: what one share costs bought as a token, against what the oracle
          says that share is worth. That gap is the tokenization premium, and it sits on top of the
          execution cost, not inside it.
        </p>
        <CostTable
          trips={trips}
          liquidity={liquidity}
          oracle={oraclePrice}
          multipliers={multipliers}
          price={livePrice}
        />

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
          Recorded every 15 minutes since 13 September. The break between the 17th and the 24th is
          a logger that stopped, not a market that went quiet: these quotes cannot be reconstructed
          after the fact, so the gap stays. The spread between tokens persists, and each token's
          own cost moves, which is why a single quote is not an answer.
        </p>
        <CostHistory points={history} sizeUsdc={Math.max(...SIZES_USDC)} />
      </div>

      <SwapPanel />

      <div className="panel">
        <h2>The oracle prices the company, not the token</h2>
        <p className="note">
          Pyth publishes two feeds per name, read here directly from their price accounts on
          Solana, and the two are maintained nothing alike. The ages in the table below are live.
          The company feeds have run every few seconds through the US close, and have also sat
          still for a day at a time. The token's own feed publishes when somebody pays for it, and
          those ages have ranged from hours to weeks on the same afternoon. The redemption-rate
          feeds, which would price the gap between a token and the share behind it, have not
          published since July.
        </p>
        <p className="note">
          Pyth's receiver is permissionless: an account moves only while somebody pays to push a
          price into it. A small set of designated feeds are pushed continuously by many parties at
          once, and SOL/USD is one of them, which is why the control never goes stale. The equity
          and token feeds here are not in that set, so their freshness is whatever their publishers
          choose on the day, and nothing on the account says who those publishers are or whether
          they will continue. That is why this page measures the round trip rather than trusting a
          reference price.
        </p>
        <p className="note">
          A price account is a PDA of [shard, feed id], and the same feed exists at several shards
          with different publishers behind each. This page read only shard 0 until 16 September and
          reported the equity oracles as stopped, which was wrong: a shard nobody happens to be
          pushing still answers, with an old price and no error of any kind. Reads now sweep the
          shards and take the freshest, which is its own assumption, since the freshest shard can
          be one publisher who stops. Always read the age next to the price.
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
