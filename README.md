# Stocklana submission — working title TBD

**Live:** https://stocklana-omega.vercel.app

**What it actually costs to trade a tokenized stock on Solana, before you trade it.**

## The problem

Tokenized US equities (xStocks) trade on Solana 24/7. The market that prices them does not.
Liquidity is split across a shifting set of venues — Raydium CLMM, Whirlpool, Meteora DLMM,
Riptide, Byreal, HumidiFi, GoonFi, Quantum, Quay — and the number on screen is an index price,
not what you pay.

Measured: buy $N of each token and immediately sell it back. Whatever doesn't come back is what
entering and exiting cost. Live Jupiter quotes, US market closed:

| token | liquidity | $100 | $1,000 | $10,000 |
|-------|----------:|-----:|-------:|--------:|
| SPYx   | $4.6M | 0.5 bps  | 2.6 bps  | **5.4 bps**  |
| TSLAx  | $1.3M | 4.9 bps  | 10.0 bps | 10.1 bps |
| NVDAx  | $1.9M | 3.6 bps  | 9.1 bps  | 11.5 bps |
| MSTRx  | $748k | 4.7 bps  | 7.1 bps  | 13.8 bps |
| AAPLx  | $873k | 22.6 bps | 28.0 bps | 43.5 bps |
| GOOGLx | $331k | 33.2 bps | 37.9 bps | 61.8 bps |
| AMZNx  | $202k | 40.9 bps | 49.4 bps | 88.2 bps |
| METAx  | $266k | 33.1 bps | 43.3 bps | **95.4 bps** |

**An 18x spread at $10,000. An 82x spread at $100.** Same asset class, same wallet, same minute.
Round-tripping $10,000 of Meta costs $95; the same trade in the S&P 500 ETF costs $5.

Nothing in any interface tells you this before you trade.

## Two things that make it hard to measure correctly

**1. The index price is not the executable price.** Jupiter's `usdPrice` is an index, not the mid
of the pool your trade routes through. Comparing effective price against it produces impossible
results — we measured METAx at *−4.4 bps*, i.e. buying below mid. Round-trip cost avoids the
question: it needs no reference price at all.

**2. xStocks are not `raw / 10^decimals`.** They use the Token-2022 `scaledUiAmount` extension for
dividends and stock splits, so the share-equivalent amount is `raw × multiplier`. Measured
multipliers: SPYx 1.0039, AAPLx ~1.0019–1.0027 *and moving between reads*, METAx 1.0016,
TSLAx exactly 1.0000. Any integration doing naive decimal conversion is wrong by up to 39 bps.
In a round trip both legs are raw, so the multiplier cancels exactly.

Sanity check that the metric is sound: round-trip cost is monotonic in pool depth, and monotonic
in trade size, for every token. The earlier index-based numbers were neither.

## Second finding: the on-chain equity oracles have stopped updating

Pyth price feed accounts are PDAs of `pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT`,
seeds `[u16le shard, 32-byte feed_id]`. Reading all eight underlying equity feeds on-chain:

| feed | oracle price | market price | divergence | last published |
|------|-------------:|-------------:|-----------:|---------------:|
| MSTR  |  $93.04 | $129.91 | **+39.6%** | 717h ago |
| META  | $589.79 | $641.64 |   +8.8% | 717h ago |
| AAPL  | $305.92 | $330.90 |   +8.2% | 717h ago |
| AMZN  | $261.22 | $253.31 |   −3.0% | 573h ago |
| GOOGL | $346.01 | $336.88 |   −2.6% | 717h ago |
| NVDA  | $211.02 | $215.79 |   +2.3% | 433h ago |
| SPY   | $765.48 | $761.41 |   −0.5% | 433h ago |
| TSLA  | $365.28 | $363.86 |   −0.4% |  41h ago |

**Seven of eight are weeks stale.** Only TSLA is current — and its 41 hours is simply Friday's
close, which is correct behaviour for an equity feed over a weekend. The rest stopped between
14 and 26 August.

Divergence tracks staleness exactly as you would expect: the freshest feed is off by 0.4%, and
the one that last published a month ago is off by nearly 40%. Anything pricing collateral or
liquidations off the MSTR feed is working from $93 for an asset trading at $130.

Verification: the decoder is validated against SOL/USD on the same program
(`7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE`), which returns current-to-the-second. `npm run
oracle` refuses to report equity staleness if that control is not fresh.

Pyth's 24/7 synthetic equity feeds have no on-chain account at any shard, and Hermes price
endpoints now require auth — so there is no free live on-chain reference price for tokenized
equities. This is why cost is measured by round trip and not against an oracle.

## Data collection

`scripts/xstock_logger.py` round-trips 8 xStocks at $100 / $1k / $10k every 5 minutes and records
US market-hours state alongside.

```bash
python3 scripts/xstock_logger.py            # one snapshot
python3 scripts/xstock_logger.py --loop 300 # continuous -> data/roundtrip_log.csv
```

No API keys. Jupiter quotes and Pyth market-hours metadata are both public.

`data/xstock_log.csv` is the earlier index-based series, retained for comparison; its
`exec_cost_bps` column is superseded and should not be used.

## Running it locally

```bash
npm install
npm run dev      # dashboard
npm run probe    # cost table in the terminal, exits non-zero if unsound
npm run oracle   # oracle staleness, validated against a SOL/USD control
```

Copy `.env.example` to `.env` and set `RPC_HTTP` for the scripts. The deployed site
needs no key: it makes one batched account read, which the public endpoint serves.

## Hackathon

Stocklana — $100,000, funded by the Solana Foundation.
Submissions close **Friday 18 September, 4:00pm ET**. Judging through 2 October.
