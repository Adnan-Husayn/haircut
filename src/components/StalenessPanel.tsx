import type { PriceUpdate } from "../lib/pyth";
import { XSTOCKS } from "../lib/tokens";

/**
 * Two Pyth feeds per row, and they are not in the same condition.
 *
 * Equity.US.{SYMBOL}/USD prices the company. It publishes every few seconds,
 * around the clock, and keeps moving after the US close. Crypto.{SYMBOL}X/USD
 * prices the token you would actually buy, and it stopped on 12 September 2026.
 *
 * The age of the token feed is the alarm, not the price gap: a feed that has not
 * published in days is unusable regardless of how far it has drifted, and the
 * drift is only the visible consequence.
 */
function age(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 100) return `${hours.toFixed(0)}h`;
  return `${(hours / 24).toFixed(0)}d`;
}

export default function StalenessPanel({
  feeds,
  marketPrice,
}: {
  feeds: Map<string, PriceUpdate>;
  marketPrice: Map<string, number>;
}) {
  const rows = XSTOCKS.map((token) => {
    const equity = token.pythFeedId ? feeds.get(token.pythFeedId) : undefined;
    const tokenFeed = token.tokenFeedId ? feeds.get(token.tokenFeedId) : undefined;
    const market = marketPrice.get(token.symbol);
    // Drift is measured against the company feed, which is the live one.
    const drift =
      tokenFeed && equity ? ((equity.price - tokenFeed.price) / tokenFeed.price) * 100 : undefined;
    return { token, equity, tokenFeed, market, drift };
  })
    .filter((r) => r.equity || r.tokenFeed)
    .sort((a, b) => Math.abs(b.drift ?? 0) - Math.abs(a.drift ?? 0));

  if (rows.length === 0) return <p className="muted">No feeds read yet.</p>;

  return (
    <div className="scroll">
      <table>
        <thead>
          <tr>
            <th>Underlying</th>
            <th>Company feed</th>
            <th>Age</th>
            <th>Token feed</th>
            <th>Age</th>
            <th>Drift</th>
            <th className="route-col" style={{ textAlign: "left" }}>Token feed last published</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ token, equity, tokenFeed, drift }, i) => (
            <tr key={token.symbol} style={{ animationDelay: `${i * 45}ms` }}>
              <td data-label="Underlying" className="sym">{token.equity}</td>

              <td data-label="Company feed" className="c1">
                {equity ? `$${equity.price.toFixed(2)}` : <span className="c0">—</span>}
              </td>
              <td data-label="Company feed age" className="good">
                {equity ? age(equity.ageHours) : "—"}
              </td>

              <td data-label="Token feed">
                {tokenFeed ? `$${tokenFeed.price.toFixed(2)}` : <span className="c0">—</span>}
              </td>
              <td
                data-label="Token feed age"
                className={tokenFeed && tokenFeed.ageHours > 24 ? "alarm" : "muted"}
              >
                {tokenFeed ? age(tokenFeed.ageHours) : "—"}
              </td>

              <td data-label="Drift" className="muted">
                {drift !== undefined ? `${drift > 0 ? "+" : ""}${drift.toFixed(1)}%` : "—"}
              </td>

              <td data-label="Token feed last published" className="route">
                {tokenFeed
                  ? `${tokenFeed.publishTime.toISOString().slice(0, 16).replace("T", " ")} UTC`
                  : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
