import type { RoundTrip } from "../lib/cost";
import { SIZES_USDC, XSTOCKS } from "../lib/tokens";

/** Colour by how much a round trip costs. Thresholds are judgement, not science. */
function costClass(bps: number): string {
  if (bps < 10) return "good";
  if (bps < 40) return "warn";
  return "bad";
}

function Cell({ trip }: { trip?: RoundTrip }) {
  if (!trip) return <td className="muted">—</td>;
  return (
    <td className={costClass(trip.roundTripBps)}>
      {trip.roundTripBps.toFixed(1)}
      <span className="muted" style={{ fontSize: ".75em" }}> bps</span>
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
            {SIZES_USDC.map((s) => (
              <th key={s}>${s.toLocaleString()}</th>
            ))}
            <th style={{ width: 90 }}>Relative</th>
            <th style={{ textAlign: "left" }}>Route at ${rankSize.toLocaleString()}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ token, group, rankBps, largest }) => (
            <tr key={token.symbol}>
              <td className="sym">{token.symbol}</td>
              <td className="muted">
                {liquidity.has(token.symbol)
                  ? `$${Math.round(liquidity.get(token.symbol)!).toLocaleString()}`
                  : "—"}
              </td>
              {SIZES_USDC.map((size) => (
                <Cell key={size} trip={group.find((t) => t.sizeUsdc === size)} />
              ))}
              <td>
                <div
                  className="bar"
                  style={{ width: `${isFinite(rankBps) ? (rankBps / worst) * 100 : 0}%` }}
                />
              </td>
              <td className="route">{largest?.buyRoute ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
