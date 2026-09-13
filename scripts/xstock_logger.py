#!/usr/bin/env python3
"""
xStock execution-cost logger.

Polls Jupiter for real executable quotes on tokenized stocks at several trade
sizes and records what a buy ACTUALLY costs versus the quoted mid price.
Also records whether the underlying US equity market is open, via Pyth.

Run it now and leave it running: the weekend dislocation is the whole point,
and you cannot recover this data once NASDAQ reopens.

    python3 xstock_logger.py            # one pass
    python3 xstock_logger.py --loop 60  # every 60s, appends to xstock_log.csv
"""
import csv, json, os, subprocess, sys, time, urllib.parse
from datetime import datetime, timezone

USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
JUP = "https://lite-api.jup.ag"
PYTH = "https://hermes.pyth.network/v2/price_feeds"

# mint, decimals, pyth equity symbol
BASKET = {
    "AAPLx":  ("XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp", 8, "AAPL"),
    "TSLAx":  ("XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB", 8, "TSLA"),
    "NVDAx":  ("Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh", 8, "NVDA"),
    "SPYx":   ("XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W", 8, "SPY"),
    "MSTRx":  ("XsP7xzNPvEHS1m6qfanPUGjNmdnmsLKEoNAnHjdxxyZ", 8, "MSTR"),
    "METAx":  ("Xsa62P5mvPszXL1krVUnU5ar38bBSVcWAB6fmPCo5Zu", 8, "META"),
    "GOOGLx": ("XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN", 8, "GOOGL"),
    "AMZNx":  ("Xs3eBt7uRfJX8QUs4suhyU8p2M6DoUDrJyWBa8LLZsg", 8, "AMZN"),
}
SIZES_USDC = [100, 1_000, 10_000]
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "xstock_log.csv")


def get(url, params=None, timeout=25):
    """Fetch JSON via curl -- avoids macOS system-Python SSL cert issues."""
    if params:
        url = f"{url}?{urllib.parse.urlencode(params, doseq=True)}"
    out = subprocess.run(
        ["curl", "-sS", "-m", str(timeout), "-H", "User-Agent: xstock-logger/1.0", url],
        capture_output=True, text=True, check=True,
    ).stdout
    return json.loads(out)


def market_open(symbol):
    """Is the underlying US equity market open? Pyth metadata, no API key."""
    try:
        feeds = get(PYTH, {"query": symbol, "asset_type": "equity"})
        for f in feeds:
            if f.get("attributes", {}).get("nasdaq_symbol") == symbol:
                return f.get("market_hours", {}).get("is_open")
    except Exception:
        pass
    return None


def snapshot():
    rows = []
    ts = datetime.now(timezone.utc).isoformat(timespec="seconds")
    for sym, (mint, dec, equity) in BASKET.items():
        try:
            meta = get(f"{JUP}/tokens/v2/search", {"query": sym})
            mid = float(meta[0].get("usdPrice") or 0) if meta else 0.0
            liq = float(meta[0].get("liquidity") or 0) if meta else 0.0
        except Exception as e:
            print(f"  {sym}: metadata failed ({e})", file=sys.stderr)
            continue

        is_open = market_open(equity)

        for usd in SIZES_USDC:
            try:
                q = get(f"{JUP}/swap/v1/quote", {
                    "inputMint": USDC, "outputMint": mint,
                    "amount": usd * 1_000_000, "slippageBps": 50,
                })
                out_tokens = int(q["outAmount"]) / (10 ** dec)
                if out_tokens <= 0:
                    continue
                eff = usd / out_tokens
                # cost of execution vs quoted mid, in basis points
                prem_bps = ((eff - mid) / mid * 10_000) if mid else None
                route = " + ".join(
                    dict.fromkeys(h["swapInfo"]["label"] for h in q["routePlan"])
                )
                rows.append({
                    "ts": ts, "symbol": sym, "equity": equity,
                    "market_open": is_open, "size_usdc": usd,
                    "mid_price": round(mid, 4), "effective_price": round(eff, 4),
                    "exec_cost_bps": round(prem_bps, 2) if prem_bps is not None else "",
                    "price_impact_pct": round(float(q.get("priceImpactPct", 0)) * 100, 4),
                    "route": route, "liquidity_usd": round(liq, 0),
                })
            except Exception as e:
                print(f"  {sym} @ ${usd}: quote failed ({e})", file=sys.stderr)
    return rows


def write(rows):
    if not rows:
        return
    new = not os.path.exists(OUT)
    with open(OUT, "a", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        if new:
            w.writeheader()
        w.writerows(rows)


def main():
    interval = None
    if "--loop" in sys.argv:
        interval = int(sys.argv[sys.argv.index("--loop") + 1])
    while True:
        rows = snapshot()
        write(rows)
        state = rows[0]["market_open"] if rows else "?"
        print(f"\n{datetime.now(timezone.utc):%Y-%m-%d %H:%M:%S} UTC  "
              f"US market open: {state}  ({len(rows)} quotes -> {OUT})")
        print(f"{'sym':8}{'size':>9}{'mid':>11}{'effective':>11}{'cost bps':>10}  route")
        for r in rows:
            print(f"{r['symbol']:8}{r['size_usdc']:>9,}{r['mid_price']:>11,.2f}"
                  f"{r['effective_price']:>11,.2f}{r['exec_cost_bps']:>10}  {r['route']}")
        if interval is None:
            return
        time.sleep(interval)


if __name__ == "__main__":
    main()
