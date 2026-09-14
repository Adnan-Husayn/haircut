# Haircut

**Every tokenized stock takes a haircut. Nobody tells you how big.**

**Live:** https://haircut-fi.vercel.app

<sub>`stocklana-omega.vercel.app` is the same deployment under the project's original auto-generated alias, kept for development checks.</sub>

Haircut measures what trading a tokenized stock on Solana actually costs — at your size, across
the venues your trade really routes through — before you trade.

## The problem

Tokenized US equities (xStocks) trade on Solana 24/7. The market that prices them does not.
Liquidity is split across a shifting set of venues — Raydium CLMM, Whirlpool, Meteora DLMM,
Riptide, Byreal, HumidiFi, BisonFi, Quantum, ZeroFi — and the number on screen is an index price,
not what you pay.

Measured: buy $N of each token and immediately sell it back. Whatever doesn't come back is what
entering and exiting cost. Live Jupiter quotes, 2026-09-14 16:14 UTC, **US market open**:

| token | liquidity | $100 | $1,000 | $10,000 |
|-------|----------:|-----:|-------:|--------:|
| SPYx   |  $4.3M |  0.5 bps |  0.8 bps |  **3.0 bps** |
| NVDAx  |  $1.7M |  4.9 bps |  9.4 bps |   9.9 bps |
| TSLAx  |  $1.3M |  4.3 bps | 10.0 bps |  10.1 bps |
| MSTRx  |  $861k | 10.0 bps |  9.2 bps |  12.6 bps |
| AAPLx  |  $881k | 21.5 bps | 44.6 bps |  57.6 bps |
| GOOGLx |  $435k | 36.0 bps | 39.5 bps |  69.5 bps |
| AMZNx  |  $216k | 34.1 bps | 48.8 bps |  83.1 bps |
| METAx  |  $234k | 22.7 bps | 55.0 bps | **126.4 bps** |

**A 42x spread at $10,000. A 78x spread at $100.** Same asset class, same wallet, same minute.
Round-tripping $10,000 of Meta costs **$126.42**; the same trade in the S&P 500 ETF costs **$3.03**.

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
seeds `[u16le shard, 32-byte feed_id]`. Reading all eight underlying equity feeds on-chain,
live from the deployed page:

| feed | oracle price | market price | divergence | feed age |
|------|-------------:|-------------:|-----------:|---------:|
| MSTR  |  $93.04 | $131.91 | **+41.8%** | 31d |
| META  | $589.79 | $662.69 |   +12.4% | 31d |
| AAPL  | $305.92 | $334.07 |    +9.2% | 31d |
| AMZN  | $261.22 | $255.21 |    −2.3% | 25d |
| TSLA  | $365.27 | $359.05 |    −1.7% | 61h |
| NVDA  | $211.02 | $212.98 |    +0.9% | 19d |
| GOOGL | $346.01 | $343.83 |    −0.6% | 31d |
| SPY   | $765.48 | $763.18 |    −0.3% | 19d |

**Seven of eight are weeks stale.** TSLA is the freshest at 61 hours, last publishing at Friday's
close. The rest stopped between 14 and 26 August.

Divergence tracks staleness exactly as you would expect: the freshest feed is off by 1.7%, and the
one that last published a month ago is off by nearly 42%. Anything pricing collateral or
liquidations off the MSTR feed is working from $93 for an asset trading at $132.

Verification: the decoder is validated against SOL/USD on the same program
(`7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE`), which returns current-to-the-second. `npm run
oracle` refuses to report equity staleness if that control is not fresh.

Pyth's 24/7 synthetic equity feeds have no on-chain account at any shard, and Hermes price
endpoints now require auth — so there is no free live on-chain reference price for tokenized
equities. This is why cost is measured by round trip and not against an oracle.

## The RPC proxy

The staleness panel needs a keyed RPC endpoint; the public mainnet-beta endpoint rate-limits the
read and the panel renders empty. But **anything named `VITE_*` is inlined into the production
bundle at build time**, so shipping the key that way publishes it.

So the key never reaches the browser. `api/rpc.ts` holds it in a server-only environment variable
and the page posts to that same-origin path instead:

```
browser, deployed   ->  /api/rpc  ->  keyed provider
browser, local dev  ->  VITE_RPC_HTTP directly (convenience only)
node scripts        ->  RPC_HTTP from .env
```

A proxy that forwards anything is an open relay for whoever finds it, so it is deliberately
narrow: only the RPC methods this application actually calls are forwarded, batches are capped,
request bodies are size-limited, and the provider's status code is passed through unchanged so
`web3.js` still backs off correctly on a 429.

```bash
curl -s -X POST $SITE/api/rpc -d '{"jsonrpc":"2.0","id":1,"method":"getVersion"}'
# {"jsonrpc":"2.0","result":{"solana-core":"4.2.2"},"id":1}

curl -s -X POST $SITE/api/rpc -d '{"jsonrpc":"2.0","id":1,"method":"getProgramAccounts"}'
# 403 {"error":"Method getProgramAccounts is not available through this endpoint."}
```

One subtlety: the proxy speaks HTTP only. Left alone, `web3.js` derives a websocket URL on the
same origin — where nothing is listening — and confirming a swap hangs forever. Subscriptions are
pointed at the public websocket explicitly, which needs no credential.

## Design

The page is built as a **data poster**, not a dashboard: a hard grid, zero radius, zero shadow,
Archivo Black set enormous against hairline rules. The hero leads with the single figure that is
the whole argument — the dearest and cheapest way to buy the same equity exposure, in the same
minute.

Cost is one quantity, so it gets one visual channel rather than a green/amber/red rainbow: figures
stay black until a trade is genuinely expensive, then turn red. The `$10,000` column carries a data
bar beneath each exact figure, so magnitude registers before you read a digit — relative magnitude
layered on absolute values, with nothing hidden.

**Below 760px the table stops being a table.** Each token becomes a record: ticker, the headline
figure at 26px, a bar running the full width of the screen, and the two smaller sizes on one line
beneath. This is the point of the layout — squeezed into a column on a phone the bar is about 40px
wide and communicates nothing; given the full width it is 343px, which is where the spread between
tokens actually becomes visible. Secondary tables become labelled records instead, so each column
head travels with its value.

Type is Archivo and Archivo Black throughout, with tabular figures everywhere digits line up.
Motion is limited to a staggered row entrance and bars growing from zero, and collapses entirely
under `prefers-reduced-motion`.

## Data collection

`scripts/xstock_logger.py` round-trips 8 xStocks at $100 / $1k / $10k every 15 minutes and records
US market-hours state alongside.

```bash
python3 scripts/xstock_logger.py            # one snapshot
python3 scripts/xstock_logger.py --loop 900 # continuous -> data/roundtrip_log.csv
```

No API keys. Jupiter quotes and Pyth market-hours metadata are both public.

The series starts 2026-09-13 12:27 UTC and spans the closed→open transition, which is the point:
cost is not a constant, and a single quote is not an answer.

`data/xstock_log.csv` is the earlier index-based series, retained for comparison; its
`exec_cost_bps` column is superseded and should not be used.

## Running it locally

```bash
npm install
npm run dev      # dashboard
npm run probe    # cost table in the terminal, exits non-zero if unsound
npm run oracle   # oracle staleness, validated against a SOL/USD control
```

Copy `.env.example` to `.env` and set `RPC_HTTP` for the scripts. For the dev server only, set
`VITE_RPC_HTTP` in `.env.development.local` — Vite never loads `*.development.*` in a production
build, so that key cannot reach `dist/`. Deployed, the key lives only in the Vercel environment
and is read by `api/rpc.ts`.

## Hackathon

Built for Stocklana — $100,000, funded by the Solana Foundation.
Submissions close **Friday 18 September, 4:00pm ET**. Judging through 2 October.
