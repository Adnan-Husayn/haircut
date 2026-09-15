/**
 * Pyth price feed reading, used to show how stale the on-chain equity oracle is.
 *
 * This is deliberately NOT a dependency of the cost measurement. Round-trip cost
 * needs no reference price. Pyth is here because what it reveals is itself a
 * finding: the on-chain equity feeds are not being maintained.
 *
 * Measured while building: the AAPL feed last published 2026-08-14, roughly 710
 * hours stale, while SOL/USD on the same program was current to the second. The
 * SOL feed is the control that proves the decoder is right.
 *
 * Pyth's 24/7 synthetic equity feeds have no on-chain account at any shard, and
 * the Hermes price endpoints now require auth, so there is no free live reference
 * price for tokenized equities.
 */
import { PublicKey } from "@solana/web3.js";
import { makeConnection } from "./chain";

/** Pyth push-oracle program on Solana mainnet. */
export const PYTH_PUSH_ORACLE = new PublicKey("pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT");
/** Program that owns the price update accounts. */
export const PYTH_RECEIVER = "rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ";

/** SOL/USD: actively updated, used to validate the decoder. */
export const SOL_USD_FEED_ID = "ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d";

export interface PriceUpdate {
  feedId: string;
  price: number;
  confidence: number;
  publishTime: Date;
  /** Hours since the feed last published. */
  ageHours: number;
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
export function decodePriceUpdate(data: Uint8Array, feedId: string): PriceUpdate {
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
  };
}

/**
 * Read many feeds in a single getMultipleAccounts call.
 *
 * Used by the browser, where the staleness panel should cost one RPC request
 * rather than one per token. Returns a map keyed by feed id; a missing entry
 * means no account exists at that shard.
 */
export async function readFeeds(
  feedIds: string[],
  shard = 0,
): Promise<Map<string, PriceUpdate>> {
  const out = new Map<string, PriceUpdate>();
  if (feedIds.length === 0) return out;

  const addresses = feedIds.map((id) => priceFeedAccount(id, shard));
  const infos = await makeConnection().getMultipleAccountsInfo(addresses);

  infos.forEach((info, i) => {
    if (!info) return;
    try {
      out.set(feedIds[i], decodePriceUpdate(new Uint8Array(info.data), feedIds[i]));
    } catch {
      /* a feed that will not decode is reported as missing, never as fresh */
    }
  });
  return out;
}

/** Fetch and decode a feed. Returns null when no account exists for that shard. */
export async function readFeed(feedId: string, shard = 0): Promise<PriceUpdate | null> {
  const address = priceFeedAccount(feedId, shard);
  const info = await makeConnection().getAccountInfo(address);
  if (!info) return null;
  return decodePriceUpdate(new Uint8Array(info.data), feedId);
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
