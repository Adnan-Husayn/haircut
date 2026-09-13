# Stocklana submission — working title TBD

**What it costs to actually buy a tokenized stock on Solana, before you buy it.**

## The problem

Tokenized US equities (xStocks) trade on Solana 24/7. The market that prices them does not.
Liquidity is split across a shifting set of venues — Raydium CLMM, Whirlpool, Meteora DLMM,
Riptide, Byreal, HumidiFi, GoonFi, Quantum, Flux — and the price on screen is a mid, not
what you pay.

Measured from live Jupiter quotes, $100 buy, US market closed:

| ticker | mid | you actually pay | cost |
|--------|------:|------:|------:|
| METAx  | 649.37 | 649.08 | **−4.4 bps** |
| MSTRx  | 129.50 | 129.50 | 0.5 bps |
| TSLAx  | 366.04 | 366.12 | 2.1 bps |
| GOOGLx | 339.59 | 340.13 | 15.9 bps |
| NVDAx  | 216.35 | 216.77 | 19.1 bps |
| AMZNx  | 255.89 | 256.51 | 24.0 bps |
| SPYx   | 764.80 | 769.33 | 59.2 bps |
| AAPLx  | 328.74 | 333.98 | **159.3 bps** |

AAPLx cost 80 bps the previous day and 159 bps here — it doubled overnight, with NASDAQ
shut the whole time. METAx trades *below* mid. Nothing in any interface surfaces this.

So: the same asset class, in the same wallet, in the same minute, varies by more than an
order of magnitude in what it costs to enter — and the reference price that would tell you
whether any of it is fair does not exist while the underlying market is closed.

## What this builds

1. **Ingestion** — real executable quotes per venue, per trade size, on a timer.
2. **Reference** — Pyth equity feeds read on-chain, plus market-hours state, so a premium
   or discount can be stated even when NASDAQ is closed.
3. **Surface** — what your specific trade costs, which venue is best for your size, and how
   that has moved.
4. **Execute** — route and swap through the best path.

## Data collection

`scripts/xstock_logger.py` records executable quotes for 8 xStocks at $100 / $1k / $10k
every 5 minutes, alongside US market-hours state.

```bash
python3 scripts/xstock_logger.py            # one snapshot
python3 scripts/xstock_logger.py --loop 300 # continuous, appends to data/xstock_log.csv
```

No API keys. Jupiter quotes and Pyth market-hours metadata are both public.

The Monday 09:30 ET open is the important capture — the market-closed to market-open
transition cannot be reconstructed after the fact.

## Verified infrastructure

| | |
|---|---|
| Jupiter quote API | works, free, no key |
| Jupiter token search | mint, mid price, liquidity, holders |
| Pyth `/v2/price_feeds` metadata | free — `market_hours.is_open`, `next_open`, holiday schedule |
| Pyth Hermes price endpoints | **401, needs auth** — read price accounts on-chain instead |
| Pyth 24/7 synthetic equity feed | exists alongside the official feed |
| xStocks | SPL **Token-2022**, 8 decimals |

## Hackathon

Stocklana — $100,000, funded by the Solana Foundation.
Submissions close **Friday 18 September, 4:00pm ET**. Judging through 2 October.
