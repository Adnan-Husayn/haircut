/**
 * Proof of life. Run: npm run probe
 *
 * Measures round-trip execution cost for every xStock at every size and prints
 * the table. Should reproduce what scripts/xstock_logger.py records, which is the
 * parity check between the TypeScript and Python paths.
 *
 * Exits non-zero if the numbers are not economically sane, so this doubles as a
 * regression test for the cost maths.
 */
import { measureRoundTrip, assertSane, type RoundTrip } from "../src/lib/cost";
import { searchToken } from "../src/lib/jupiter";
import { SIZES_USDC, XSTOCKS } from "../src/lib/tokens";

const PAUSE_MS = 1100;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const trips: RoundTrip[] = [];
  const liquidity = new Map<string, number>();

  for (const token of XSTOCKS) {
    try {
      const info = await searchToken(token.symbol);
      if (info?.liquidity) liquidity.set(token.symbol, info.liquidity);
    } catch {
      /* liquidity is decoration; never fail the probe over it */
    }
    await sleep(PAUSE_MS);

    for (const size of SIZES_USDC) {
      try {
        trips.push(await measureRoundTrip(token, size));
      } catch (err) {
        console.error(`  ${token.symbol} @ $${size}: ${err instanceof Error ? err.message : err}`);
      }
      await sleep(PAUSE_MS);
    }
  }

  const expected = XSTOCKS.length * SIZES_USDC.length;
  if (trips.length === 0) {
    console.error(
      `\ncollected 0 of ${expected} quotes; every request failed. ` +
        `Nothing was measured, so nothing is verified.`,
    );
    process.exit(1);
  }

  console.log(`\nround-trip execution cost at ${new Date().toISOString()}`);
  console.log(`collected ${trips.length}/${expected} quotes\n`);
  console.log(
    "token".padEnd(8) +
      "liquidity".padStart(12) +
      SIZES_USDC.map((s) => `$${s.toLocaleString()}`.padStart(11)).join("") +
      "   worst-size route",
  );

  // Rank on the largest CONFIGURED size so every token is compared like for like.
  // A token missing that quote sorts last rather than being ranked on a smaller trade.
  const rankSize = Math.max(...SIZES_USDC);
  const bySymbol = [...new Set(trips.map((t) => t.symbol))];
  const ranked = bySymbol
    .map((symbol) => {
      const group = trips.filter((t) => t.symbol === symbol);
      const atRankSize = group.find((t) => t.sizeUsdc === rankSize);
      const largest = group.reduce((a, b) => (a.sizeUsdc > b.sizeUsdc ? a : b));
      return { symbol, group, largest, rankBps: atRankSize?.roundTripBps ?? Infinity };
    })
    .sort((a, b) => a.rankBps - b.rankBps);

  for (const { symbol, group, largest } of ranked) {
    const liq = liquidity.get(symbol);
    const cells = SIZES_USDC.map((size) => {
      const hit = group.find((t) => t.sizeUsdc === size);
      return (hit ? `${hit.roundTripBps.toFixed(1)}bps` : "—").padStart(11);
    }).join("");
    const liqCell = (liq ? `$${Math.round(liq).toLocaleString()}` : "—").padStart(12);
    console.log(symbol.padEnd(8) + liqCell + cells + `   ${largest.buyRoute}`);
  }

  const largestSize = Math.max(...SIZES_USDC);
  const atLargest = trips.filter((t) => t.sizeUsdc === largestSize);
  if (atLargest.length > 1) {
    const lo = Math.min(...atLargest.map((t) => t.roundTripBps));
    const hi = Math.max(...atLargest.map((t) => t.roundTripBps));
    console.log(
      `\nat $${largestSize.toLocaleString()}: ${lo.toFixed(1)}bps → ${hi.toFixed(1)}bps ` +
        `(${(hi / lo).toFixed(1)}x spread between the cheapest and dearest token)`,
    );
  }

  const problems = assertSane(trips);
  if (problems.length) {
    console.error(`\n${problems.length} sanity problem(s):`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  if (trips.length < expected) {
    console.error(
      `\nincomplete: ${expected - trips.length} of ${expected} quotes failed. ` +
        `Sanity held for what was collected, but the table has gaps.`,
    );
    process.exit(1);
  }
  console.log("\nsanity: all round trips positive and monotonic in size");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
