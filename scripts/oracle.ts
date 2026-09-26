/**
 * Oracle staleness check. Run: npm run oracle
 *
 * Verifies the Pyth decoder and reports the freshest reading for each feed,
 * naming the shard it came from. Shards disagree because each has its own
 * publishers pushing into it, so a per-shard breakdown is the point here.
 *
 * SOL/USD is the control: if it does not come back fresh, the decoder is wrong
 * and nothing below this line means anything.
 */
import { readFeed, priceFeedAccount, SOL_USD_FEED_ID } from "../src/lib/pyth";
import { isPublicFallback, rpcDisplay } from "../src/lib/chain";
import { XSTOCKS } from "../src/lib/tokens";

const FRESH_HOURS = 1;

async function main() {
  console.log(`rpc: ${rpcDisplay()}${isPublicFallback() ? "  (public fallback, expect rate limits)" : ""}\n`);

  const control = await readFeed(SOL_USD_FEED_ID);
  if (!control) {
    console.error("SOL/USD control account not found; cannot trust any reading below.");
    process.exit(1);
  }
  console.log(
    `control  SOL/USD   $${control.price.toFixed(2).padStart(10)}   ` +
      `${control.ageHours.toFixed(1)}h old   shard ${control.shard}   ` +
      `${priceFeedAccount(SOL_USD_FEED_ID, control.shard).toBase58()}`,
  );
  if (control.ageHours > FRESH_HOURS) {
    console.error(
      `\nControl feed is ${control.ageHours.toFixed(1)}h stale. Either the decoder is wrong ` +
        `or Pyth is down; do not report equity staleness from this run.`,
    );
    process.exit(1);
  }
  console.log("control is fresh, decoder verified\n");

  for (const token of XSTOCKS) {
    if (!token.pythFeedId) {
      console.log(`${token.equity.padEnd(8)} no feed id recorded`);
      continue;
    }
    try {
      const feed = await readFeed(token.pythFeedId);
      if (!feed) {
        console.log(`${token.equity.padEnd(8)} no on-chain account at any shard`);
        continue;
      }
      const flag = feed.ageHours > 24 ? "  <-- STALE" : "";
      console.log(
        `${token.equity.padEnd(8)} $${feed.price.toFixed(2).padStart(10)}   ` +
          `${feed.ageHours.toFixed(1)}h old   shard ${feed.shard}   ` +
          `last ${feed.publishTime.toISOString().slice(0, 16).replace("T", " ")}${flag}`,
      );
    } catch (err) {
      console.error(`${token.equity.padEnd(8)} ${err instanceof Error ? err.message : err}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
