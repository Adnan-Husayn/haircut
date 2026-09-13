import type { PriceUpdate } from "../lib/pyth";
import { XSTOCKS } from "../lib/tokens";

/**
 * Oracle price against the market. A feed that last published weeks ago is not
 * merely "stale" -- the gap to the traded price is what it would cost anyone
 * pricing collateral or liquidations off it.
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
    const divergence =
      feed && market ? ((market - feed.price) / feed.price) * 100 : undefined;
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
            <th style={{ textAlign: "left" }}>Last published</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ token, feed, market, divergence }) => {
            const hours = feed!.ageHours;
            const ageClass = hours > 168 ? "bad" : hours > 48 ? "warn" : "good";
            return (
              <tr key={token.symbol}>
                <td className="sym">{token.equity}</td>
                <td>${feed!.price.toFixed(2)}</td>
                <td>{market ? `$${market.toFixed(2)}` : <span className="muted">—</span>}</td>
                <td className={divergence !== undefined && Math.abs(divergence) > 5 ? "bad" : "muted"}>
                  {divergence !== undefined ? `${divergence > 0 ? "+" : ""}${divergence.toFixed(1)}%` : "—"}
                </td>
                <td className={ageClass}>
                  {hours < 100 ? `${hours.toFixed(0)}h` : `${(hours / 24).toFixed(0)}d`}
                </td>
                <td className="route">
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
