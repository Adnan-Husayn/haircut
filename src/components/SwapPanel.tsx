import { useEffect, useState } from "react";
import { makeConnection } from "../lib/chain";
import { connect, detectWallets, disconnect, eagerConnect, signAndSend } from "../lib/wallet";
import { confirmSignature, estimateNetworkFee, explainFailure, prepareBuy, readBalances, simulate, type Balances, type PreparedSwap, type SimulationResult } from "../lib/swap";
import { PATIENT, solPriceUsd } from "../lib/jupiter";
import { readMultiplier, toDisplayAmount } from "../lib/scaled";
import { MIN_SWAP_USDC, SWAP_SIZES_USDC, XSTOCKS } from "../lib/tokens";

type Stage = "idle" | "preparing" | "simulated" | "sending" | "sent" | "error";

export default function SwapPanel() {
  const [connection] = useState(() => makeConnection());
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const connected = publicKey !== null;
  const wallets = detectWallets();
  const hasWallet = wallets.length > 0;
  const [choice, setChoice] = useState<string>("");

  useEffect(() => {
    eagerConnect().then((pk) => pk && setPublicKey(pk));
  }, []);

  useEffect(() => {
    if (!publicKey) { setBalances(null); return; }
    let cancelled = false;
    readBalances(connection, publicKey)
      .then((b) => !cancelled && setBalances(b))
      .catch(() => {/* balances are a convenience, not a gate */});
    return () => { cancelled = true; };
  }, [connection, publicKey]);

  async function onCopy() {
    if (!signature) return;
    try {
      await navigator.clipboard.writeText(signature);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard blocked; the signature is selectable on screen anyway */
    }
  }

  async function onDisconnect() {
    await disconnect().catch(() => {/* already gone */});
    setPublicKey(null);
    reset();
  }

  async function onConnect() {
    try {
      setPublicKey(await connect(choice || undefined));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const [symbol, setSymbol] = useState(XSTOCKS[0].symbol);
  const [amountText, setAmountText] = useState("10");
  const [stage, setStage] = useState<Stage>("idle");
  const [prepared, setPrepared] = useState<PreparedSwap | null>(null);
  const [sim, setSim] = useState<SimulationResult | null>(null);
  const [signature, setSignature] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [waiting, setWaiting] = useState<string | null>(null);
  const [balances, setBalances] = useState<Balances | null>(null);
  const [multiplier, setMultiplier] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const [feeLamports, setFeeLamports] = useState<number | null>(null);
  const [solUsd, setSolUsd] = useState<number | null>(null);

  const token = XSTOCKS.find((t) => t.symbol === symbol)!;

  const size = Number(amountText);
  const sizeValid = Number.isFinite(size) && size >= MIN_SWAP_USDC;
  const shortOfBalance = balances !== null && sizeValid && size > balances.usdc;
  const canQuote = sizeValid && !shortOfBalance;

  function setAmount(next: string) {
    setAmountText(next);
    reset();
  }

  /**
   * Balances are shown floored to the cent, never rounded.
   *
   * toFixed() rounds up, so a balance of 10.3651 displayed as "$10.37" would be
   * offered and then refused for exceeding itself. Flooring means the figure on
   * screen is always genuinely spendable.
   */
  const spendable = balances ? Math.floor(balances.usdc * 100) / 100 : null;

  /** "Max" therefore agrees with the balance shown. */
  function useMax() {
    if (spendable === null) return;
    setAmount(spendable.toFixed(2));
  }

  useEffect(() => {
    let cancelled = false;
    setMultiplier(null);
    readMultiplier(connection, token.mint)
      .then((m) => !cancelled && setMultiplier(m))
      .catch(() => !cancelled && setMultiplier(1));
    return () => { cancelled = true; };
  }, [connection, token.mint]);


  function reset() {
    setPrepared(null);
    setSim(null);
    setSignature(null);
    setCopied(false);
    setFeeLamports(null);
    setError(null);
    setWaiting(null);
    setStage("idle");
  }

  /** Quote, build and dry-run. Nothing is broadcast here. */
  async function onPrepare() {
    if (!publicKey) return;
    reset();
    setStage("preparing");
    try {
      const p = await prepareBuy(token, size, publicKey, {
        ...PATIENT,
        onRetry: ({ attempt, attempts, waitMs }) =>
          setWaiting(
            `Jupiter is rate-limiting. Waiting ${Math.round(waitMs / 1000)}s, ` +
            `then retrying (attempt ${attempt + 1} of ${attempts}).`,
          ),
      });
      setWaiting(null);
      setPrepared(p);

      // Priced alongside the dry run: a flat network fee is trivial on a large
      // order and dominant on a small one, so it is worth stating outright.
      estimateNetworkFee(connection, p.transaction).then(setFeeLamports);
      solPriceUsd().then(setSolUsd);

      const s = await simulate(connection, p.transaction);
      setSim(s);
      setStage("simulated");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStage("error");
    } finally {
      setWaiting(null);
    }
  }

  /** Only reachable once a simulation has actually succeeded. */
  async function onExecute() {
    if (!prepared || !sim?.ok) return;
    setStage("sending");
    try {
      const sig = await signAndSend(prepared.transaction);
      setSignature(sig);
      await confirmSignature(connection, sig);
      setStage("sent");
      readBalances(connection, publicKey!)
        .then(setBalances)
        .catch(() => {/* the swap already landed; the balance can lag */});
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStage("error");
    }
  }

  // Jupiter returns raw base units. A wallet displays raw x multiplier, and per
  // the xStocks docs that scaled figure is the one to show a person -- so this
  // used to disagree with Phantom by the multiplier, on the one screen where a
  // token amount is put in front of someone.
  const expectedTokens =
    prepared && multiplier !== null
      ? toDisplayAmount(prepared.expectedOut, token.decimals, multiplier)
      : null;
  const rawTokens = prepared ? Number(prepared.expectedOut) / 10 ** token.decimals : null;

  return (
    <div className="panel">
      <h2>Execute a swap</h2>
      <p className="note">
        Quote, build, then <strong>simulate against live state</strong> before anything is signed.
        A failing route or a missing token account shows up here, for free, rather than costing a
        transaction.
      </p>

      <div className="controls">
        <select value={symbol} onChange={(e) => { setSymbol(e.target.value); reset(); }}>
          {XSTOCKS.map((t) => (
            <option key={t.symbol} value={t.symbol}>{t.symbol}</option>
          ))}
        </select>
        <div className="amount">
          <span>$</span>
          <input
            type="number"
            min={MIN_SWAP_USDC}
            step="0.01"
            inputMode="decimal"
            aria-label="Amount of USDC to swap"
            value={amountText}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>

        <div className="presets">
          {SWAP_SIZES_USDC.map((preset) => (
            <button
              key={preset}
              type="button"
              className={size === preset ? "on" : ""}
              onClick={() => setAmount(String(preset))}
            >
              ${preset}
            </button>
          ))}
          {spendable !== null && spendable >= MIN_SWAP_USDC && (
            <button type="button" onClick={useMax}>Max</button>
          )}
        </div>

        {!connected ? (
          <>
            {wallets.length > 1 && (
              <select value={choice} onChange={(e) => setChoice(e.target.value)}>
                {wallets.map((w) => <option key={w.name} value={w.name}>{w.name}</option>)}
              </select>
            )}
            <button onClick={onConnect} disabled={!hasWallet}>
              {hasWallet
                ? `Connect ${choice || wallets[0].name}`
                : "No Solana wallet detected"}
            </button>
          </>
        ) : (
          <>
            <button
              onClick={onPrepare}
              disabled={!canQuote || stage === "preparing" || stage === "sending"}
            >
              {stage === "preparing" ? "simulating…" : "Quote & simulate"}
            </button>
            <button
              onClick={onExecute}
              disabled={!sim?.ok || stage === "sending" || stage === "sent"}
              className="primary"
            >
              {stage === "sending" ? "sending…" : "Execute"}
            </button>
            <button onClick={onDisconnect}>Disconnect</button>
            <span className="muted wallet-line">
              {publicKey.slice(0, 4)}…{publicKey.slice(-4)}
              {balances && (
                <>
                  {" · "}{balances.sol.toFixed(3)} SOL
                  {" · "}<b>${spendable?.toFixed(2)} USDC</b>
                </>
              )}
            </span>
          </>
        )}
      </div>

      {prepared && (
        <dl className="kv">
          <div>
            <dt>Route</dt>
            <dd>
              {prepared.isSplit ? (
                <ul className="legs">
                  {prepared.legs.map((leg) => (
                    <li key={leg.label}>
                      <span className="leg-bar" style={{ width: `${leg.percent}%` }} />
                      <span className="leg-name">{leg.label}</span>
                      <span className="leg-pct">{leg.percent}%</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <>
                  {prepared.route}
                  <span className="sub-note">routed through an intermediate token</span>
                </>
              )}
            </dd>
          </div>
          <div>
            <dt>Expected out</dt>
            <dd>
              {expectedTokens === null ? (
                <span className="muted">reading multiplier…</span>
              ) : (
                <>
                  {expectedTokens.toFixed(6)} {symbol}
                  {multiplier !== null && multiplier !== 1 && (
                    <span className="sub-note">
                      {rawTokens?.toFixed(6)} raw × {multiplier.toFixed(4)} scaled-UI multiplier
                    </span>
                  )}
                </>
              )}
            </dd>
          </div>
          <div>
            <dt>Price impact</dt>
            <dd>
              {(prepared.priceImpactPct * 100).toFixed(3)}%
              <span className="sub-note">you pay this — the cost of moving this pool</span>
            </dd>
          </div>
          <div>
            <dt>Slippage limit</dt>
            <dd>
              {(prepared.slippageBps / 100).toFixed(2)}%
              <span className="sub-note">a cap, not a cost — the trade fails past this</span>
            </dd>
          </div>
          <div>
            <dt>Network fee</dt>
            <dd>
              {feeLamports === null ? (
                <span className="muted">pricing…</span>
              ) : (
                <>
                  {(feeLamports / 1e9).toFixed(6)} SOL
                  <span className="sub-note">
                    {solUsd
                      ? `$${((feeLamports / 1e9) * solUsd).toFixed(4)} — ${(((feeLamports / 1e9) * solUsd / size) * 10_000).toFixed(1)} bps of this trade`
                      : "flat, so it dominates small trades and vanishes on large ones"}
                  </span>
                </>
              )}
            </dd>
          </div>
          <div>
            <dt>Simulation</dt>
            <dd>
              {sim === null && stage === "error" ? (
                <span className="alarm">failed — {error ?? "see below"}</span>
              ) : sim === null ? (
                <span className="muted">running…</span>
              ) : sim.ok ? (
                <span className="accent">
                  succeeded{sim.unitsConsumed ? ` · ${sim.unitsConsumed.toLocaleString()} CU` : ""}
                </span>
              ) : (
                <span className="alarm">failed — {explainFailure(sim)}</span>
              )}
            </dd>
          </div>
        </dl>
      )}

      {sim && !sim.ok && (
        <details className="logs">
          <summary>simulation logs ({sim.logs.length} lines)</summary>
          <pre>{sim.logs.join("\n")}</pre>
        </details>
      )}

      {signature && (
        <div className="receipt">
          <span className={`status${stage === "sent" ? " done" : ""}`}>
            {stage === "sent" ? "Confirmed" : "Sent · confirming"}
          </span>
          {/* The whole signature, not a truncation: this is the thing a person
              copies into an explorer or pastes into a submission. */}
          <a
            className="sig"
            href={`https://solscan.io/tx/${signature}`}
            target="_blank"
            rel="noreferrer"
          >
            {signature}
          </a>
          <button type="button" onClick={onCopy}>{copied ? "Copied" : "Copy"}</button>
        </div>
      )}

      {connected && !sizeValid && (
        <p className="note waiting">
          Enter an amount of at least ${MIN_SWAP_USDC.toFixed(2)} USDC.
        </p>
      )}

      {connected && shortOfBalance && spendable !== null && (
        <p className="note waiting">
          This wallet holds <strong>${spendable.toFixed(2)} USDC</strong> and you have asked to
          spend <strong>${size.toFixed(2)}</strong>. A buy spends USDC — SOL only covers the fee —
          so either lower the amount, press Max, or swap some SOL to USDC first (Phantom's own swap
          does it in one step).
        </p>
      )}

      {waiting && <p className="note waiting">{waiting}</p>}

      {error && <p className="err">{error}</p>}

      {!connected && (
        <p className="note" style={{ marginTop: ".8rem", marginBottom: 0 }}>
          {hasWallet
            ? "Connect a wallet to quote and simulate. Simulation costs nothing; only Execute moves funds."
            : "Install Phantom, Solflare or Backpack to quote and simulate."}
        </p>
      )}
    </div>
  );
}
