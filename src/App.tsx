import { useEffect, useState } from "react";
import CostTable from "./components/CostTable";
import StalenessPanel from "./components/StalenessPanel";
import { measureRoundTrip, type RoundTrip } from "./lib/cost";
import { searchToken } from "./lib/jupiter";
import { marketOpen, readFeeds, type PriceUpdate } from "./lib/pyth";
import { SIZES_USDC, XSTOCKS } from "./lib/tokens";

const PAUSE_MS = 250;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function App() {
  const [trips, setTrips] = useState<RoundTrip[]>([]);
  const [liquidity, setLiquidity] = useState<Map<string, number>>(new Map());
  const [marketPrice, setMarketPrice] = useState<Map<string, number>>(new Map());
  const [feeds, setFeeds] = useState<Map<string, PriceUpdate>>(new Map());
  const [isOpen, setIsOpen] = useState<boolean | null>(null);
  const [done, setDone] = useState(0);
  const [failed, setFailed] = useState(0);
  const [finished, setFinished] = useState(false);

  const total = XSTOCKS.length * SIZES_USDC.length;

  useEffect(() => {
    let cancelled = false;

    (async () => {
      // Market state and the oracle snapshot are cheap; do them first so the
      // page says something useful while the quotes stream in.
      marketOpen("AAPL").then((v) => !cancelled && setIsOpen(v));

      const feedIds = XSTOCKS.map((t) => t.pythFeedId).filter((id): id is string => !!id);
      readFeeds(feedIds)
        .then((m) => !cancelled && setFeeds(m))
        .catch(() => {/* panel simply stays empty */});

      for (const token of XSTOCKS) {
        if (cancelled) return;
        try {
          const info = await searchToken(token.symbol);
          if (!cancelled && info) {
            if (info.liquidity) {
              setLiquidity((m) => new Map(m).set(token.symbol, info.liquidity!));
            }
            if (info.usdPrice) {
              setMarketPrice((m) => new Map(m).set(token.symbol, info.usdPrice!));
            }
          }
        } catch {
          /* decoration only */
        }

        for (const size of SIZES_USDC) {
          if (cancelled) return;
          try {
            const trip = await measureRoundTrip(token, size);
            if (!cancelled) {
              setTrips((prev) => [...prev, trip]);
              setDone((n) => n + 1);
            }
          } catch {
            if (!cancelled) {
              setFailed((n) => n + 1);
              setDone((n) => n + 1);
            }
          }
          await sleep(PAUSE_MS);
        }
      }
      if (!cancelled) setFinished(true);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="wrap">
      <h1>What a tokenized stock actually costs to trade</h1>
      <p className="sub">
        Every figure below is measured, not quoted: buy $N of the token, then immediately sell the
        exact amount received. Whatever does not come back is what entering and exiting cost.
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
          xStocks trade 24/7; the market pricing them does not. Cost is quoted live from Jupiter
          across whichever venues the trade actually routes through.
        </p>
        <CostTable trips={trips} liquidity={liquidity} />
        {!finished && (
          <p className="progress">
            measuring… {done}/{total} round trips
            {failed > 0 ? ` · ${failed} failed` : ""}
          </p>
        )}
        {finished && failed > 0 && (
          <p className="err">
            {failed} of {total} quotes failed, so the table has gaps. Usually rate limiting — reload
            to retry.
          </p>
        )}
      </div>

      <div className="panel">
        <h2>The on-chain oracle for these stocks has stopped updating</h2>
        <p className="note">
          Pyth equity feeds read directly from their price accounts on Solana. The decoder is
          validated against SOL/USD on the same program, which returns current to the second.
        </p>
        <StalenessPanel feeds={feeds} marketPrice={marketPrice} />
      </div>

      <p className="foot">
        Cost measured by round trip so no reference price is needed — and because xStocks carry
        Token-2022 scaled-UI multipliers for dividends and splits, which cancel when both legs are
        quoted in raw base units.
      </p>
    </div>
  );
}
