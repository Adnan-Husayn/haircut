import { useState } from "react";
import { measureRoundTrip, type RoundTrip } from "../lib/cost";
import { XSTOCKS } from "../lib/tokens";

/**
 * Turns the measurement into a decision.
 *
 * The table tells you what everything costs. What a person actually wants to
 * know is "I have $N to put into equities -- what does this trade cost me, and
 * is there a cheaper way to get the same exposure?" With an 18x spread between
 * the cheapest and dearest token, that second question has a real answer.
 */
export default function OrderPlanner({ trips }: { trips: RoundTrip[] }) {
  const [amount, setAmount] = useState(2500);
  const [symbol, setSymbol] = useState("AAPLx");
  const [busy, setBusy] = useState(false);
  const [chosen, setChosen] = useState<RoundTrip | null>(null);
  const [alternative, setAlternative] = useState<RoundTrip | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** Cheapest token in the live table, as a candidate alternative. */
  function cheapestOther(): string | null {
    const largest = Math.max(...trips.map((t) => t.sizeUsdc), 0);
    const candidates = trips
      .filter((t) => t.sizeUsdc === largest && t.symbol !== symbol)
      .sort((a, b) => a.roundTripBps - b.roundTripBps);
    return candidates[0]?.symbol ?? null;
  }

  async function onCheck() {
    const size = Math.round(amount);
    if (!Number.isFinite(size) || size < 1) {
      setError("Enter an amount of at least $1.");
      return;
    }
    setBusy(true);
    setError(null);
    setChosen(null);
    setAlternative(null);
    try {
      const token = XSTOCKS.find((t) => t.symbol === symbol)!;
      setChosen(await measureRoundTrip(token, size));

      const altSymbol = cheapestOther();
      if (altSymbol) {
        const alt = XSTOCKS.find((t) => t.symbol === altSymbol)!;
        setAlternative(await measureRoundTrip(alt, size));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const dollars = (t: RoundTrip) => (t.roundTripBps / 10_000) * t.sizeUsdc;
  const saving = chosen && alternative ? dollars(chosen) - dollars(alternative) : 0;

  return (
    <div className="panel">
      <h2>What will my trade actually cost?</h2>
      <p className="note">
        Quoted live at your exact size, then compared against the cheapest token in the table,
        because the gap between them is worth more than most people's fee savings.
      </p>

      <div className="controls">
        <span className="label">I want to trade</span>
        <div className="amount">
          <span>$</span>
          <input
            type="number"
            min={1}
            step={100}
            value={amount}
            onChange={(e) => { setAmount(Number(e.target.value)); setChosen(null); setAlternative(null); }}
          />
        </div>
        <span className="label">of</span>
        <select value={symbol} onChange={(e) => { setSymbol(e.target.value); setChosen(null); setAlternative(null); }}>
          {XSTOCKS.map((t) => <option key={t.symbol} value={t.symbol}>{t.symbol}</option>)}
        </select>
        <button onClick={onCheck} disabled={busy} className="primary">
          {busy ? "quoting…" : "Check cost"}
        </button>
      </div>

      {chosen && (
        <div className="verdict">
          <p>
            <strong>{chosen.symbol}</strong> costs{" "}
            <span className={`big ${chosen.roundTripBps > 40 ? "c4" : "c3"}`}>
              ${dollars(chosen).toFixed(2)}
            </span>{" "}
            on ${chosen.sizeUsdc.toLocaleString()}: {chosen.roundTripBps.toFixed(1)} bps in and out,
            routing through {chosen.buyRoute}.
          </p>
          {alternative && saving > 0.01 && (
            <p>
              <strong>{alternative.symbol}</strong> would cost{" "}
              <span className="big accent">${dollars(alternative).toFixed(2)}</span> for the same size.
              Switching saves <strong className="accent">${saving.toFixed(2)}</strong>
              {dollars(alternative) > 0 && ` (${(dollars(chosen) / dollars(alternative)).toFixed(1)}x cheaper)`}.
            </p>
          )}
          {alternative && saving <= 0.01 && (
            <p className="muted">
              {chosen.symbol} is already the cheapest of the pair at this size.
            </p>
          )}
          <p className="muted" style={{ fontSize: ".8rem", marginTop: ".9rem" }}>
            Different companies, so not the same exposure. But if the goal is equity exposure
            rather than one specific name, the cost difference is real money.
          </p>
        </div>
      )}

      {error && <p className="err">{error}</p>}
    </div>
  );
}
