/**
 * Swap execution.
 *
 * Deliberately staged: quote -> build -> SIMULATE -> send. The simulation step
 * is the same discipline as the arbitrage bot, which verifies a bundle against
 * live state before broadcasting. It catches a failing route, a missing token
 * account or an exhausted compute budget for free, before any money moves.
 */
import { PublicKey, VersionedTransaction, type Connection } from "@solana/web3.js";
import { buildSwapTransaction, PATIENT, quote, routeLabel, type Quote, type RetryOptions } from "./jupiter";
import { USDC_DECIMALS, USDC_MINT, type XStock } from "./tokens";

export interface PreparedSwap {
  quote: Quote;
  transaction: VersionedTransaction;
  route: string;
  /** Raw base units of the xStock the quote expects to deliver. */
  expectedOut: bigint;
  lastValidBlockHeight: number;
}

/**
 * Quote a buy and build the unsigned transaction for it. Nothing is sent.
 *
 * This is something the user asked for by clicking, so it waits out a
 * rate-limit window rather than failing in fifteen seconds.
 */
export async function prepareBuy(
  token: XStock,
  sizeUsdc: number,
  userPublicKey: string,
  retry: RetryOptions = PATIENT,
): Promise<PreparedSwap> {
  // Round to whole base units first. BigInt() throws outright on a fractional
  // number, so any amount with cents in it would have failed here.
  const inRaw = BigInt(Math.round(sizeUsdc * 10 ** USDC_DECIMALS));
  if (inRaw <= 0n) throw new Error("Enter an amount greater than zero.");

  const q = await quote(USDC_MINT, token.mint, inRaw, 50, retry);
  const built = await buildSwapTransaction(q, userPublicKey, retry);

  return {
    quote: q,
    transaction: VersionedTransaction.deserialize(base64ToBytes(built.swapTransaction)),
    route: routeLabel(q),
    expectedOut: BigInt(q.outAmount),
    lastValidBlockHeight: built.lastValidBlockHeight,
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Wait for a broadcast transaction to confirm, by polling.
 *
 * web3.js's confirmTransaction subscribes over a websocket. The RPC proxy
 * speaks HTTP only, so that subscription points at the public endpoint, and
 * when it does not arrive the UI sits on "sending..." forever while the
 * transaction has in fact already finalised -- which is exactly what happened
 * on the first real swap. Polling getSignatureStatuses uses the same proxied
 * HTTP path as everything else and cannot silently stall.
 */
export async function confirmSignature(
  connection: Connection,
  signature: string,
  timeoutMs = 90_000,
): Promise<"confirmed" | "finalized"> {
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    const { value } = await connection.getSignatureStatuses([signature]);
    const status = value[0];

    if (status?.err) {
      throw new Error(`The transaction failed on-chain: ${JSON.stringify(status.err)}`);
    }
    if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") {
      return status.confirmationStatus;
    }
    await sleep(2_000);
  }

  throw new Error(
    "Not confirmed within 90s. It may still land — the signature above links to the explorer.",
  );
}

export interface Balances {
  /** SOL, for fees. */
  sol: number;
  /** USDC, which is what a buy actually spends. */
  usdc: number;
}

/**
 * What the connected wallet can actually spend.
 *
 * Without this the panel happily offers to buy $100 of a stock with a wallet
 * holding no USDC at all, and the only feedback is a simulation failure.
 */
export async function readBalances(
  connection: Connection,
  owner: string,
): Promise<Balances> {
  const pubkey = new PublicKey(owner);
  const [lamports, tokens] = await Promise.all([
    connection.getBalance(pubkey),
    connection
      .getParsedTokenAccountsByOwner(pubkey, { mint: new PublicKey(USDC_MINT) })
      .catch(() => ({ value: [] as Array<{ account: { data: { parsed: { info: { tokenAmount: { uiAmount: number | null } } } } } }> })),
  ]);

  const usdc = tokens.value.reduce(
    (sum, t) => sum + (t.account.data.parsed.info.tokenAmount.uiAmount ?? 0),
    0,
  );
  return { sol: lamports / 1e9, usdc };
}

export interface SimulationResult {
  ok: boolean;
  /** Program error, when the simulation failed. */
  error?: string;
  logs: string[];
  unitsConsumed?: number;
}

/**
 * Dry-run against live state.
 *
 * `sigVerify` is off because the transaction is not signed yet, and
 * `replaceRecentBlockhash` keeps a slightly old blockhash from failing the
 * simulation for reasons unrelated to the swap itself.
 */
export async function simulate(
  connection: Connection,
  tx: VersionedTransaction,
  timeoutMs = 30_000,
): Promise<SimulationResult> {
  // An RPC call with no timeout can leave the UI claiming it is still working
  // forever. Fail loudly instead.
  const res = await Promise.race([
    connection.simulateTransaction(tx, {
      sigVerify: false,
      replaceRecentBlockhash: true,
      commitment: "confirmed",
    }),
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`Simulation did not answer within ${timeoutMs / 1000}s.`)),
        timeoutMs,
      ),
    ),
  ]);

  return {
    ok: res.value.err === null,
    error: res.value.err ? JSON.stringify(res.value.err) : undefined,
    logs: res.value.logs ?? [],
    unitsConsumed: res.value.unitsConsumed,
  };
}

/** Human-readable reason a simulation failed, pulled from the program logs. */
export function explainFailure(sim: SimulationResult): string {
  const insufficient = sim.logs.find((l) => /insufficient/i.test(l));
  if (insufficient) return insufficient.replace(/^Program log: /, "");
  const anyError = sim.logs.find((l) => /error|failed/i.test(l));
  if (anyError) return anyError.replace(/^Program log: /, "");
  return sim.error ?? "simulation failed without a log";
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
