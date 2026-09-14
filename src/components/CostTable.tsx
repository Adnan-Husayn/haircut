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
}: {
  trips: RoundTrip[];
  liquidity: Map<string, number>;
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
