import type { RoundTrip } from "../lib/cost";
import { SIZES_USDC, XSTOCKS } from "../lib/tokens";

/**
 * Cost as intensity of one hue rather than a green/amber/red rainbow.
 *
 * Cost is a single quantity, so it gets a single visual channel. Dim means
 * cheap and unremarkable; the accent is spent only where a trade is genuinely
 * expensive, which is what a reader should look at first.
 */
function costClass(bps: number): string {
  if (bps < 5) return "c1";
  if (bps < 15) return "c2";
  if (bps < 40) return "c3";
  return "c4";
}

function Cell({ trip, label }: { trip?: RoundTrip; label: string }) {
  if (!trip) return <td data-label={label} className="c0">—</td>;
  return (
    <td data-label={label} className={costClass(trip.roundTripBps)}>
      {trip.roundTripBps.toFixed(1)}
      <span className="unit">bps</span>
    </td>
  );
}

export default function CostTable({
  trips,
  liquidity,
}: {
  trips: RoundTrip[];
  liquidity: Map<string, number>;
}) {
  const rankSize = Math.max(...SIZES_USDC);

  const rows = XSTOCKS.map((token) => {
    const group = trips.filter((t) => t.symbol === token.symbol);
    const atRank = group.find((t) => t.sizeUsdc === rankSize);
    return { token, group, rankBps: atRank?.roundTripBps ?? Infinity, largest: atRank };
  })
    .filter((r) => r.group.length > 0)
    .sort((a, b) => a.rankBps - b.rankBps);

  const worst = Math.max(...rows.map((r) => (isFinite(r.rankBps) ? r.rankBps : 0)), 1);

  return (
    <div className="scroll">
      <table>
        <thead>
          <tr>
            <th>Token</th>
            <th>Liquidity</th>
            {SIZES_USDC.map((s) => <th key={s}>${s.toLocaleString()}</th>)}
            <th style={{ width: 88 }}>Relative</th>
            <th className="route-col" style={{ textAlign: "left" }}>
              Route at ${rankSize.toLocaleString()}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ token, group, rankBps, largest }, i) => (
            <tr key={token.symbol} style={{ animationDelay: `${i * 45}ms` }}>
              <td data-label="Token" className="sym">{token.symbol}</td>
              <td data-label="Liquidity" className="muted">
                {liquidity.has(token.symbol)
                  ? `$${Math.round(liquidity.get(token.symbol)!).toLocaleString()}`
                  : "—"}
              </td>
              {SIZES_USDC.map((size) => (
                <Cell
                  key={size}
                  label={`$${size.toLocaleString()}`}
                  trip={group.find((t) => t.sizeUsdc === size)}
                />
              ))}
              <td data-label="Relative" className="hide-sm">
                <div
                  className="bar"
                  style={{ width: `${isFinite(rankBps) ? (rankBps / worst) * 100 : 0}%` }}
                />
              </td>
              <td data-label="Route" className="route">{largest?.buyRoute ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
