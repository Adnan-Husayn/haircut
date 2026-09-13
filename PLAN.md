# Stocklana — build plan
**Deadline: Friday 18 September, 4:00pm ET** (= Sat 19 Sep, ~1:30am IST). Judging to Oct 2.
$100,000 pool, funded by the Solana Foundation. 261 registered, 21 submissions at time of writing.

---

## The insight (measured, not assumed)

Live Jupiter quotes, Sunday 12 Sep 21:20 UTC, US market **closed**:

| Ticker | cost @ $100 | cost @ $10k | venues routed |
|--------|------------:|------------:|---------------|
| AMZNx  |   8.3 bps   |  35.0 bps   | Byreal, Raydium CLMM |
| MSTRx  |  10.8 bps   |  15.3 bps   | Riptide |
| TSLAx  |  20.5 bps   |  20.5 bps   | Riptide |
| NVDAx  |  22.6 bps   |  29.7 bps   | Whirlpool, Riptide, BinaryFi |
| SPYx   |  59.7 bps   |  60.4 bps   | Raydium CLMM, Byreal, Riptide |
| METAx  |  68.4 bps   |  78.0 bps   | Whirlpool, HumidiFi, Raydium CLMM |
| GOOGLx |  75.5 bps   |  90.9 bps   | Byreal, HumidiFi, Meteora DLMM, Raydium |
| AAPLx  |  79.9 bps   |  88.8 bps   | Raydium CLMM, Whirlpool |

Two facts a user cannot currently see:

1. **Identical-looking assets cost 10x more to trade than each other.** The screen shows
   "AAPLx $331.80". You pay $334.45. Nothing says so.
2. **xStocks trade 24/7; NASDAQ does not.** Right now there is no open market to price
   against. The discount/premium is widest exactly when it is least visible.

**Product: the execution-cost layer for tokenized stocks.** Show what a trade actually
costs before it happens — across every venue, at your size, including when the underlying
market is shut. Then route it.

Fits two of the five tracks at once: *Trading* (24/7 venues, stock-to-stablecoin swaps)
and *Infrastructure* (price feeds, analytics).

---

## Verified infrastructure — no research needed on day one

| Thing | Status |
|---|---|
| Jupiter quote API (`lite-api.jup.ag/swap/v1/quote`) | works, free, **no API key** |
| Jupiter token search (`/tokens/v2/search`) | works, gives mint, mid price, liquidity, holders |
| Pyth `/v2/price_feeds` metadata | works, free — `market_hours.is_open`, `next_open`, full holiday schedule |
| Pyth Hermes **price** endpoints | **401 — now needs auth.** Read price accounts on-chain via RPC instead |
| Pyth 24/7 synthetic equity feed | exists (`aaba35e6…`) alongside official (`49f6b65c…`) — reference price while NASDAQ is closed |
| xStocks | live SPL **Token-2022**, 8 decimals, real liquidity (SPYx $4.6M, NVDAx $1.9M) |

The Hermes 401 is good news: reading Pyth price accounts over RPC is what your arbitrage
bot already does. That makes the Rust ingestion layer load-bearing instead of decorative.

### Mints
```
AAPLx  XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp
TSLAx  XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB
NVDAx  Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh
SPYx   XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W
MSTRx  XsP7xzNPvEHS1m6qfanPUGjNmdnmsLKEoNAnHjdxxyZ
METAx  Xsa62P5mvPszXL1krVUnU5ar38bBSVcWAB6fmPCo5Zu
GOOGLx XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN
AMZNx  Xs3eBt7uRfJX8QUs4suhyU8p2M6DoUDrJyWBa8LLZsg
USDC   EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
```

---

## Do this in the next hour

1. **Register** at hackathons.solana.com/hackathons/stocklana (registering is not submitting).
2. **Start the logger looping** — `python3 xstock_logger.py --loop 300`.
   Monday 9:30am ET NASDAQ reopens. The closed→open transition is the single most valuable
   chart in your demo and **you cannot regenerate it afterwards.** Start it today.

---

## MVP — what ships by Friday

1. **Ingestion (Rust).** Poll Jupiter quotes for 8 xStocks at 3 sizes. Read Pyth price
   accounts on-chain for the reference price + market-hours state. Persist a time series.
2. **Analytics.** Execution cost in bps vs mid, at the user's actual size. Premium/discount
   vs Pyth reference. Market open/closed badge with "last close was N hours ago".
3. **Dashboard (React/TS).** One table: ticker, mid, your real cost, bps, best venue.
   One cost curve: what $100 / $1k / $10k actually costs. Closed→open time series.
4. **Execute.** Wallet connect, swap the best route via Jupiter, confirmation + error states.

### Say no to (these kill the deadline)
Your own AMM or order book. Perps. Mobile app. More than 8 tickers. Auth/accounts.
Historical charting beyond one sparkline. A landing page with animations.

---

## Five days

| Day | Target |
|---|---|
| **Sun 13** | Register. Logger looping. Lock scope. Quote poller returning bps for 8 names. |
| **Mon 14** | Pyth on-chain reads + market-hours logic. Capture the 9:30am ET open. Persist series. |
| **Tue 15** | React dashboard: the table + the cost curve. Ugly but real data end to end. |
| **Wed 16** | Wallet connect + Jupiter swap execution. Error/confirmation handling. |
| **Thu 17** | Deploy public URL. README. Record the 2–3 min demo. Submit. |
| **Fri 18** | Buffer. Polish. Edits are allowed right up to close — submit Thursday regardless. |

Judging is one question: *could this be a real app people actually use?* They want a real
user and problem, a working end-to-end demo, a reason it belongs on Solana, and execution
quality. You have the problem, measured. Spend the days on the working demo.

---

## Money

Jupiter quotes are free. You only need USDC for **one** demo swap — roughly $5–20, plus
a few cents of SOL for fees. That is the entire capital requirement. (Contrast the OOBE
bounty, which wanted 5+ real mainnet trades.)

## Submission checklist
- [ ] Registered
- [ ] At least one link: GitHub, live demo, or video (include all three)
- [ ] Repo open source, README explains the problem with your own measured numbers
- [ ] Demo video shows the cost difference and a real swap executing
- [ ] Submitted Thursday, not Friday
