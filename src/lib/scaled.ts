/**
 * Token-2022 scaled-UI multipliers.
 *
 * xStocks use the `scaledUiAmount` extension to apply dividends and stock
 * splits without moving balances: the share-equivalent amount is
 * `raw × multiplier`, and per the xStocks documentation the scaled amount is
 * the one a user should be shown.
 *
 * This is display-only, and deliberately so. The round-trip cost metric quotes
 * both legs in raw base units precisely so the multiplier cancels; applying it
 * there would be wrong. It matters exactly where a token amount is put in front
 * of a person -- which is why a wallet shows a different number than a naive
 * `raw / 10^decimals` does.
 */
import { PublicKey, type Connection } from "@solana/web3.js";

interface ScaledUiAmountState {
  multiplier?: string | number;
  newMultiplier?: string | number;
  newMultiplierEffectiveTimestamp?: string | number;
}

interface ParsedExtension {
  extension?: string;
  state?: ScaledUiAmountState;
}

const num = (v: string | number | undefined): number | undefined => {
  if (v === undefined) return undefined;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
};

/** Pick the multiplier in force from a parsed mint's extension list. */
function fromExtensions(extensions: ParsedExtension[]): number {
  const scaled = extensions.find((e) => e.extension === "scaledUiAmountConfig");
  if (!scaled?.state) return 1;

  const current = num(scaled.state.multiplier) ?? 1;
  const next = num(scaled.state.newMultiplier);
  const effectiveAt = num(scaled.state.newMultiplierEffectiveTimestamp);

  if (next !== undefined && effectiveAt !== undefined && Date.now() / 1000 >= effectiveAt) {
    return next;
  }
  return current;
}

/**
 * Multipliers for many mints in one request.
 *
 * The page needs every multiplier before it can put a per-token price next to an
 * oracle price, and one call keeps that off the critical path. A mint that will
 * not parse falls back to 1, which is the identity and cannot silently distort a
 * price.
 */
export async function readMultipliers(
  connection: Connection,
  mints: string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (mints.length === 0) return out;

  const infos = await connection.getMultipleParsedAccounts(mints.map((m) => new PublicKey(m)));
  infos.value.forEach((info, i) => {
    const data = info?.data;
    if (!data || !("parsed" in data)) return;
    out.set(mints[i], fromExtensions(data.parsed?.info?.extensions ?? []));
  });
  return out;
}

/**
 * The multiplier in force right now, or 1 when the mint has no such extension.
 *
 * A pending multiplier only applies once its effective timestamp has passed,
 * so both are read and the timestamp decides.
 */
export async function readMultiplier(
  connection: Connection,
  mint: string,
): Promise<number> {
  const info = await connection.getParsedAccountInfo(new PublicKey(mint));
  const data = info.value?.data;
  if (!data || !("parsed" in data)) return 1;

  const extensions: ParsedExtension[] = data.parsed?.info?.extensions ?? [];
  const scaled = extensions.find((e) => e.extension === "scaledUiAmountConfig");
  if (!scaled?.state) return 1;

  const current = num(scaled.state.multiplier) ?? 1;
  const next = num(scaled.state.newMultiplier);
  const effectiveAt = num(scaled.state.newMultiplierEffectiveTimestamp);

  if (next !== undefined && effectiveAt !== undefined && Date.now() / 1000 >= effectiveAt) {
    return next;
  }
  return current;
}

/** Raw base units to the share-equivalent amount a wallet would display. */
export function toDisplayAmount(raw: bigint, decimals: number, multiplier: number): number {
  return (Number(raw) / 10 ** decimals) * multiplier;
}
