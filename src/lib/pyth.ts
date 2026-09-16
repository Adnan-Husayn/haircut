/**
 * Pyth price feed reading, used as the reference price for tokenized equities.
 *
 * This is deliberately NOT a dependency of the cost measurement. Round-trip cost
 * needs no reference price at all. Pyth is here so the page can show what the
 * oracle says next to what the trade actually costs.
 *
 * A feed is not one account. The price account is a PDA of [shard, feed id], and
 * the same feed exists at several shards maintained by different publishers. For
 * the equity feeds, shard 0 is abandoned: AAPL there last published 2026-08-14
 * and reads $305.92, while the same feed at shard 1 publishes every few seconds
 * and tracks the market to within a few basis points. Reading a fixed shard 0 is
 * therefore not "the oracle", it is one dead deployment of it, so every read here
 * sweeps the shards and takes the freshest account.
 *
 * SOL/USD is the control that proves the decoder is right: it is live on the same
 * program, and it also has an abandoned shard (2, last published 2024-04-11),
 * which is the same trap in a feed nobody would call stale.
 */
import { PublicKey } from "@solana/web3.js";
import { makeConnection } from "./chain";

/** Pyth push-oracle program on Solana mainnet. */
export const PYTH_PUSH_ORACLE = new PublicKey("pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT");
/** Program that owns the price update accounts. */
export const PYTH_RECEIVER = "rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ";

/** SOL/USD: actively updated, used to validate the decoder. */
export const SOL_USD_FEED_ID = "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d";

/**
 * Shards to search, cheapest-first in the sense that fewer is faster.
 * Swept to 8 while checking this: no feed in the basket has an account above 2.
 */
export const SHARDS = [0, 1, 2] as const;

export interface PriceUpdate {
  feedId: string;
  price: number;
  confidence: number;
  publishTime: Date;
  /** Hours since the feed last published. */
  ageHours: number;
  /** Which shard this reading came from. Different shards disagree. */
  shard: number;
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/**
 * Price feed account address for a feed id.
 * Seeds are [u16 little-endian shard, 32-byte feed id].
 */
export function priceFeedAccount(feedId: string, shard = 0): PublicKey {
  const shardSeed = new Uint8Array(2);
  new DataView(shardSeed.buffer).setUint16(0, shard, true);
  const [pda] = PublicKey.findProgramAddressSync(
    [shardSeed, hexToBytes(feedId)],
    PYTH_PUSH_ORACLE,
  );
  return pda;
}

/**
 * Decode a PriceUpdateV2 account.
 *
 * The field offset is located by searching for the feed id rather than assuming
 * a fixed header length: the account is 134 bytes where the documented fields
 * sum to 133, so the VerificationLevel encoding is not reliably one byte. Finding
 * the feed id is exact and survives that ambiguity.
 */
export function decodePriceUpdate(data: Uint8Array, feedId: string, shard = 0): PriceUpdate {
  const needle = hexToBytes(feedId);
  let offset = -1;
  outer: for (let i = 0; i + needle.length <= data.length; i++) {
    for (let j = 0; j < needle.length; j++) if (data[i + j] !== needle[j]) continue outer;
    offset = i;
    break;
  }
  if (offset < 0) throw new Error(`feed id ${feedId.slice(0, 12)}… not found in account data`);

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let p = offset + needle.length;
  const price = view.getBigInt64(p, true); p += 8;
  const conf = view.getBigUint64(p, true); p += 8;
  const expo = view.getInt32(p, true); p += 4;
  const publishTime = view.getBigInt64(p, true);

  const scale = 10 ** expo;
  const publish = new Date(Number(publishTime) * 1000);
  return {
    feedId,
    price: Number(price) * scale,
    confidence: Number(conf) * scale,
    publishTime: publish,
    ageHours: (Date.now() - publish.getTime()) / 3_600_000,
    shard,
  };
}

/**
 * Read many feeds in a single getMultipleAccounts call, taking the freshest
 * shard for each.
 *
 * Every (feed, shard) pair goes into one request, so sweeping costs no extra
 * round trips: 8 feeds across 3 shards is still one call. A missing entry means
 * no account exists for that feed at any shard we searched.
 */
export async function readFeeds(
  feedIds: string[],
  shards: readonly number[] = SHARDS,
): Promise<Map<string, PriceUpdate>> {
  const out = new Map<string, PriceUpdate>();
  if (feedIds.length === 0) return out;

  const pairs = feedIds.flatMap((id) => shards.map((shard) => ({ id, shard })));
  const infos = await makeConnection().getMultipleAccountsInfo(
    pairs.map((p) => priceFeedAccount(p.id, p.shard)),
  );

  infos.forEach((info, i) => {
    if (!info) return;
    const { id, shard } = pairs[i];
    try {
      const update = decodePriceUpdate(new Uint8Array(info.data), id, shard);
      const best = out.get(id);
      // Freshest wins. An abandoned shard must never mask a live one.
      if (!best || update.publishTime > best.publishTime) out.set(id, update);
    } catch {
      /* a feed that will not decode is reported as missing, never as fresh */
    }
  });
  return out;
}

/** Fetch and decode one feed, taking the freshest shard. Null if none exists. */
export async function readFeed(
  feedId: string,
  shards: readonly number[] = SHARDS,
): Promise<PriceUpdate | null> {
  return (await readFeeds([feedId], shards)).get(feedId) ?? null;
}

/**
 * Whether the underlying US equity market is open.
 *
 * Uses the Hermes *metadata* endpoint, which is still public. Only the price
 * endpoints moved behind auth.
 */
export async function marketOpen(equitySymbol: string): Promise<boolean | null> {
  try {
    const res = await fetch(
      `https://hermes.pyth.network/v2/price_feeds?query=${encodeURIComponent(equitySymbol)}&asset_type=equity`,
    );
    if (!res.ok) return null;
    const feeds = (await res.json()) as Array<{
      attributes?: { nasdaq_symbol?: string };
      market_hours?: { is_open?: boolean };
    }>;
    for (const f of feeds) {
      if (f.attributes?.nasdaq_symbol === equitySymbol) return f.market_hours?.is_open ?? null;
    }
  } catch {
    /* market state is decoration; never fail the page over it */
  }
  return null;
}
