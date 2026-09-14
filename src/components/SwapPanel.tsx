import { useEffect, useState } from "react";
import { makeConnection } from "../lib/chain";
import { connect, disconnect, eagerConnect, getProvider, signAndSend, walletName } from "../lib/wallet";
import { explainFailure, prepareBuy, readBalances, simulate, type Balances, type PreparedSwap, type SimulationResult } from "../lib/swap";
import { PATIENT } from "../lib/jupiter";
import { SWAP_SIZES_USDC, XSTOCKS } from "../lib/tokens";

type Stage = "idle" | "preparing" | "simulated" | "sending" | "sent" | "error";

export default function SwapPanel() {
  const [connection] = useState(() => makeConnection());
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const connected = publicKey !== null;
  const hasWallet = getProvider() !== null;

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

  async function onDisconnect() {
    await disconnect().catch(() => {/* already gone */});
    setPublicKey(null);
    reset();
  }

  async function onConnect() {
    try {
      setPublicKey(await connect());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const [symbol, setSymbol] = useState(XSTOCKS[0].symbol);
  const [size, setSize] = useState<number>(10);
  const [stage, setStage] = useState<Stage>("idle");
  const [prepared, setPrepared] = useState<PreparedSwap | null>(null);
  const [sim, setSim] = useState<SimulationResult | null>(null);
  const [signature, setSignature] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [waiting, setWaiting] = useState<string | null>(null);
  const [balances, setBalances] = useState<Balances | null>(null);

  const token = XSTOCKS.find((t) => t.symbol === symbol)!;

  function reset() {
    setPrepared(null);
    setSim(null);
    setSignature(null);
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
      const bh = await connection.getLatestBlockhash();
      await connection.confirmTransaction({ signature: sig, ...bh }, "confirmed");
      setStage("sent");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStage("error");
    }
  }

  const expectedTokens = prepared
    ? Number(prepared.expectedOut) / 10 ** token.decimals
    : null;

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
        <select value={size} onChange={(e) => { setSize(Number(e.target.value)); reset(); }}>
          {SWAP_SIZES_USDC.map((s) => (
            <option key={s} value={s}>${s.toLocaleString()} USDC</option>
          ))}
        </select>

        {!connected ? (
          <button onClick={onConnect} disabled={!hasWallet}>
            {hasWallet ? `Connect ${walletName()}` : "No wallet detected"}
          </button>
        ) : (
          <>
            <button onClick={onPrepare} disabled={stage === "preparing" || stage === "sending"}>
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
                  {" · "}<b>${balances.usdc.toFixed(2)} USDC</b>
                </>
              )}
            </span>
          </>
        )}
      </div>

      {prepared && (
        <dl className="kv">
          <div><dt>Route</dt><dd>{prepared.route}</dd></div>
          <div><dt>Expected out</dt><dd>{expectedTokens?.toFixed(6)} {symbol}</dd></div>
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
        <p className="accent" style={{ marginTop: "1rem", fontFamily: "var(--mono)", fontSize: ".8rem" }}>
          {stage === "sent" ? "confirmed" : "sent"} —{" "}
          <a href={`https://solscan.io/tx/${signature}`} target="_blank" rel="noreferrer">
            {signature.slice(0, 24)}…
          </a>
        </p>
      )}

      {connected && balances && balances.usdc < size && (
        <p className="note waiting">
          This wallet holds <strong>${balances.usdc.toFixed(2)} USDC</strong>, and a buy spends
          USDC — SOL only covers the fee. Either pick a smaller size, or swap some SOL to USDC
          first (Phantom's own swap does it in one step).
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
