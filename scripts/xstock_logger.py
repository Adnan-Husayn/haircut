#!/usr/bin/env python3
"""
xStock execution-cost logger.

Primary metric is ROUND-TRIP COST: buy $N of a tokenized stock and immediately sell
it back. Whatever you don't get back is what entering and exiting actually cost you.

Why round-trip rather than "effective price vs mid":

  - Jupiter's `usdPrice` is an INDEX price, not the executable mid of the pool the
    trade routes through. Comparing against it produced impossible results
    (METAx at -4.4 bps -- buying below mid).
  - xStocks use the Token-2022 scaledUiAmount extension for dividends and splits,
    so `raw / 10**decimals` is NOT the share-equivalent amount. Multipliers are
    material and move: SPYx 1.0039, AAPLx ~1.0019-1.0027, METAx 1.0016, TSLAx 1.0000.
  - In a round trip both legs are denominated in raw base units, so the multiplier
    cancels exactly and no oracle or reference price is needed.

Sanity check that the metric is sound: round-trip cost is monotonic in pool depth.
SPYx ($4.6M liquidity) 3.9 bps -> METAx ($266k) 42.5 bps.

    python3 scripts/xstock_logger.py            # one snapshot
    python3 scripts/xstock_logger.py --loop 300 # continuous, appends to data/
"""
import csv, json, os, subprocess, sys, time, urllib.parse
from datetime import datetime, timezone

USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
USDC_DECIMALS = 6
JUP = "https://lite-api.jup.ag"
PYTH = "https://hermes.pyth.network/v2/price_feeds"

# symbol -> (mint, decimals, underlying equity symbol)
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
OUT = os.path.join(ROOT, "data", "roundtrip_log.csv")
PAUSE = 0.4  # be polite to the public endpoint


def get(url, params=None, timeout=30):
    """Fetch JSON via curl -- avoids macOS system-Python SSL cert issues."""
    if params:
        url = f"{url}?{urllib.parse.urlencode(params, doseq=True)}"
    out = subprocess.run(
        ["curl", "-sS", "-m", str(timeout), "-H", "User-Agent: stocklana/1.0", url],
        capture_output=True, text=True, check=True,
    ).stdout
    return json.loads(out)


def quote(input_mint, output_mint, amount):
    return get(f"{JUP}/swap/v1/quote", {
        "inputMint": input_mint, "outputMint": output_mint,
        "amount": amount, "slippageBps": 50,
    })


def routes_of(q):
    return " + ".join(dict.fromkeys(h["swapInfo"]["label"] for h in q["routePlan"]))


def market_open(symbol):
    """Is the underlying US equity market open? Pyth metadata, no API key."""
    try:
        for f in get(PYTH, {"query": symbol, "asset_type": "equity"}):
            if f.get("attributes", {}).get("nasdaq_symbol") == symbol:
                return f.get("market_hours", {}).get("is_open")
    except Exception:
        pass
    return None


def snapshot():
    rows, ts = [], datetime.now(timezone.utc).isoformat(timespec="seconds")
    for sym, (mint, dec, equity) in BASKET.items():
        try:
            meta = get(f"{JUP}/tokens/v2/search", {"query": sym})
            index_px = float(meta[0].get("usdPrice") or 0) if meta else 0.0
            liq = float(meta[0].get("liquidity") or 0) if meta else 0.0
        except Exception as e:
            print(f"  {sym}: metadata failed ({e})", file=sys.stderr)
            continue
        is_open = market_open(equity)

        for usd in SIZES_USDC:
            try:
                buy = quote(USDC, mint, usd * 10**USDC_DECIMALS)
                time.sleep(PAUSE)
                raw_out = int(buy["outAmount"])
                if raw_out <= 0:
                    continue
                sell = quote(mint, USDC, raw_out)
                time.sleep(PAUSE)
                usd_back = int(sell["outAmount"]) / 10**USDC_DECIMALS

                rows.append({
                    "ts": ts, "symbol": sym, "equity": equity,
                    "market_open": is_open, "size_usdc": usd,
                    "tokens_out": round(raw_out / 10**dec, 8),
                    "usd_back": round(usd_back, 4),
                    # the headline: what a full entry+exit actually costs
                    "roundtrip_bps": round((usd - usd_back) / usd * 10_000, 2),
                    "buy_impact_pct": round(float(buy.get("priceImpactPct", 0)) * 100, 4),
                    "sell_impact_pct": round(float(sell.get("priceImpactPct", 0)) * 100, 4),
                    "buy_route": routes_of(buy), "sell_route": routes_of(sell),
                    # informational only -- an index price, NOT an executable mid
                    "index_price": round(index_px, 4),
                    "liquidity_usd": round(liq, 0),
                })
            except Exception as e:
                print(f"  {sym} @ ${usd}: quote failed ({e})", file=sys.stderr)
    return rows


def write(rows):
    if not rows:
        return
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
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
        print(f"\n{datetime.now(timezone.utc):%Y-%m-%d %H:%M:%S} UTC   "
              f"US market open: {state}   ({len(rows)} round trips -> {os.path.relpath(OUT, ROOT)})")
        print(f"{'sym':8}{'size':>9}{'usd back':>11}{'round-trip':>12}   route")
        for r in rows:
            print(f"{r['symbol']:8}{r['size_usdc']:>9,}{r['usd_back']:>11,.2f}"
                  f"{r['roundtrip_bps']:>10,.1f}bps   {r['buy_route']}")
        if interval is None:
            return
        time.sleep(interval)


if __name__ == "__main__":
    main()
