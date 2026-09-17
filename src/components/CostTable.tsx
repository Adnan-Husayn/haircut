import type { RoundTrip } from "../lib/cost";
import { SIZES_USDC, XSTOCKS } from "../lib/tokens";

/** Cost gets one visual channel: black until a trade is genuinely dear, then red. */
function costClass(bps: number): string {
  if (bps < 5) return "c1";
  if (bps < 15) return "c2";
  if (bps < 40) return "c3";
  return "c4";
}

/** Bars are read against a fixed 80 bps span so a row's length means the same thing every day. */
const BAR_SPAN_BPS = 80;
const HOT_BPS = 50;

const money = (n: number) => `$${n.toLocaleString()}`;

/**
 * What a share costs through the token, against what the oracle says the share
 * is worth. The gap is the premium for holding it in tokenized form.
 *
 * The multiplier is load-bearing here, in the opposite direction to everywhere
 * else on this page. Round-trip cost quotes both legs raw so the multiplier
 * cancels; a price is a single leg, so it does not cancel and must be applied.
 * `impliedMarketPrice` divides by `raw / 10^decimals`, so it is a price per raw
 * unit, and one raw unit is `multiplier` shares. Skipping this step makes every
 * row report its own multiplier as if it were a market premium, with TSLAx at
 * exactly 1.0 sitting at zero and looking like confirmation.
 *
 * Shown as a percentage, not bps, so it cannot be mistaken for a cost figure.
 */
function Premium({
  implied,
  oracle,
  multiplier,
}: {
  implied?: number;
  oracle?: number;
  multiplier?: number;
}) {
  if (implied === undefined || oracle === undefined || oracle <= 0 || !multiplier) {
    return <span className="c0">—</span>;
  }
  const perShare = implied / multiplier;
  const pct = ((perShare - oracle) / oracle) * 100;
  const shown = Math.abs(pct) < 0.005 ? 0 : pct;
  return (
    <span className="value">
      {shown > 0 ? "+" : shown < 0 ? "−" : ""}
      {Math.abs(shown).toFixed(2)}
      <span className="unit">%</span>
    </span>
  );
}

function Figure({ trip }: { trip?: RoundTrip }) {
  if (!trip) return <span className="c0">—</span>;
  return (
    <>
      <span className={costClass(trip.roundTripBps)}>{trip.roundTripBps.toFixed(1)}</span>
      <span className="unit">bps</span>
    </>
  );
}

function Bar({ bps, span }: { bps: number; span: number }) {
  return (
    <span className="bar-track">
      <span className="bar-fill" style={{ width: `${Math.min((bps / span) * 100, 100)}%` }} />
    </span>
  );
}

export default function CostTable({
  trips,
  liquidity,
  oracle,
  multipliers,
  price,
}: {
  trips: RoundTrip[];
  liquidity: Map<string, number>;
  /** Live company price per symbol, from the Pyth feed that is actually maintained. */
  oracle: Map<string, number>;
  /** Scaled-UI multiplier by mint. Without it a price per token is not a price per share. */
  multipliers: Map<string, number>;
  /** Live token price by symbol, read at the same time as the oracle feed. */
  price: Map<string, number>;
}) {
  const sizes = [...SIZES_USDC].sort((a, b) => a - b);
  const rankSize = sizes[sizes.length - 1];
  const secondary = sizes.slice(0, -1);

  const rows = XSTOCKS.map((token) => {
    const group = trips.filter((t) => t.symbol === token.symbol);
    const atRank = group.find((t) => t.sizeUsdc === rankSize);
    return { token, group, rankBps: atRank?.roundTripBps ?? Infinity, largest: atRank };
  })
    .filter((r) => r.group.length > 0)
    .sort((a, b) => a.rankBps - b.rankBps);

  // Never clip: if something ever costs more than the nominal span, widen it.
  const worst = Math.max(...rows.map((r) => (isFinite(r.rankBps) ? r.rankBps : 0)), 0);
  const span = Math.max(BAR_SPAN_BPS, worst);

  return (
    <div className="scroll">
      <table className="cost">
        <thead>
          <tr>
            <th>Token</th>
            <th className="liq-col">Liquidity</th>
            {secondary.map((s) => <th key={s}>{money(s)}</th>)}
            <th>{money(rankSize)}</th>
            <th className="prem-col">vs oracle</th>
            <th className="phone-bar" />
            <th className="route-col" style={{ textAlign: "left" }}>
              Route at {money(rankSize)}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ token, group, rankBps, largest }, i) => (
            <tr
              key={token.symbol}
              data-hot={isFinite(rankBps) && rankBps >= HOT_BPS}
              style={{ animationDelay: `${i * 45}ms` }}
            >
              <td className="sym">{token.symbol}</td>
              <td className="liq muted">
                {liquidity.has(token.symbol)
                  ? money(Math.round(liquidity.get(token.symbol)!))
                  : "—"}
              </td>

              {secondary.map((size, j) => (
                <td key={size} className={`secondary sec-${j}`} data-label={money(size)}>
                  <span className="value"><Figure trip={group.find((t) => t.sizeUsdc === size)} /></span>
                </td>
              ))}

              <td className="primary" data-label={money(rankSize)}>
                <span className="figure"><Figure trip={largest} /></span>
                {isFinite(rankBps) && <Bar bps={rankBps} span={span} />}
              </td>

              <td className="premium" data-label="vs oracle">
                <Premium
                  implied={price.get(token.symbol)}
                  oracle={oracle.get(token.symbol)}
                  multiplier={multipliers.get(token.mint)}
                />
              </td>

              {/* Phone only: the bar gets the full width of the screen, which is the
                  only width at which the spread between tokens is actually visible. */}
              <td className="phone-bar">
                {isFinite(rankBps) && <Bar bps={rankBps} span={span} />}
              </td>

              <td className="route">{largest?.buyRoute ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
