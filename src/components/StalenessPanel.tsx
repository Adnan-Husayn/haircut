import type { PriceUpdate } from "../lib/pyth";
import { XSTOCKS } from "../lib/tokens";

/**
 * Oracle price against the market. A feed that last published weeks ago is not
 * merely "stale" -- the gap to the traded price is what it would cost anyone
 * pricing collateral or liquidations off it. That gap is the only thing on the
 * page allowed to use the alarm colour.
 */
export default function StalenessPanel({
  feeds,
  marketPrice,
}: {
  feeds: Map<string, PriceUpdate>;
  marketPrice: Map<string, number>;
}) {
  const rows = XSTOCKS.map((token) => {
    const feed = token.pythFeedId ? feeds.get(token.pythFeedId) : undefined;
    const market = marketPrice.get(token.symbol);
    const divergence = feed && market ? ((market - feed.price) / feed.price) * 100 : undefined;
    return { token, feed, market, divergence };
  })
    .filter((r) => r.feed)
    .sort((a, b) => Math.abs(b.divergence ?? 0) - Math.abs(a.divergence ?? 0));

  if (rows.length === 0) return <p className="muted">No feeds read yet.</p>;

  return (
    <div className="scroll">
      <table>
        <thead>
          <tr>
            <th>Underlying</th>
            <th>Oracle</th>
            <th>Market</th>
            <th>Divergence</th>
            <th>Feed age</th>
            <th className="route-col" style={{ textAlign: "left" }}>Last published</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ token, feed, market, divergence }, i) => {
            const hours = feed!.ageHours;
            return (
              <tr key={token.symbol} style={{ animationDelay: `${i * 45}ms` }}>
                <td data-label="Underlying" className="sym">{token.equity}</td>
                <td data-label="Oracle" className="c1">${feed!.price.toFixed(2)}</td>
                <td data-label="Market">
                  {market ? `$${market.toFixed(2)}` : <span className="c0">—</span>}
                </td>
                <td
                  data-label="Divergence"
                  className={divergence !== undefined && Math.abs(divergence) > 5 ? "alarm" : "muted"}
                >
                  {divergence !== undefined
                    ? `${divergence > 0 ? "+" : ""}${divergence.toFixed(1)}%`
                    : "—"}
                </td>
                <td data-label="Feed age" className={hours > 168 ? "alarm" : "muted"}>
                  {hours < 100 ? `${hours.toFixed(0)}h` : `${(hours / 24).toFixed(0)}d`}
                </td>
                <td data-label="Last published" className="route">
                  {feed!.publishTime.toISOString().slice(0, 16).replace("T", " ")} UTC
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
