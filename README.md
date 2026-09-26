# Haircut

**Every tokenized stock takes a haircut. Nobody tells you how big.**

**Live:** https://haircut-fi.vercel.app  
**Source:** https://github.com/Adnan-Husayn/haircut

<sub>`stocklana-omega.vercel.app` is the same deployment under the project's original auto-generated alias, kept for development checks.</sub>

Haircut measures what trading a tokenized stock on Solana actually costs before you trade: at your
size, across the venues your trade really routes through.

## The problem

Tokenized US equities (xStocks) trade on Solana 24/7. The market that prices them does not.
Liquidity is split across a shifting set of venues (Raydium CLMM, Whirlpool, Meteora DLMM,
Riptide, Byreal, HumidiFi, BisonFi, Quantum, ZeroFi), and the number on screen is an index price,
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
results. We measured METAx at *−4.4 bps*, i.e. buying below mid. Round-trip cost avoids the
question: it needs no reference price at all.

**2. xStocks are not `raw / 10^decimals`.** They use the Token-2022 `scaledUiAmount` extension for
dividends and stock splits, so the share-equivalent amount is `raw × multiplier`. Read from the
mints on-chain:

| token | multiplier in force | error if ignored | superseded on |
|-------|--------------------:|-----------------:|--------------:|
| SPYx   | 1.0057146 | 57.1 bps | 2026-06-18 |
| AAPLx  | 1.0032690 | 32.7 bps | 2026-08-08 |
| GOOGLx | 1.0023773 | 23.8 bps | 2026-09-04 |
| METAx  | 1.0022983 | 23.0 bps | 2026-06-14 |
| NVDAx  | 1.0017012 | 17.0 bps | 2026-09-10 |
| TSLAx  | 1.0000000 |   0.0 bps | — |
| MSTRx  | 1.0000000 |   0.0 bps | — |
| AMZNx  | 1.0000000 |   0.0 bps | — |

Ignoring the multiplier misstates a holding by up to **57 bps**, larger than the entire execution
cost of most of these tokens at $10,000.

There is a second trap inside the first. The extension carries *two* values, `multiplier` and
`newMultiplier`, with an effective timestamp. **On every xStock that has one, the pending value has
already taken over**. AAPLx reads 1.0026642 in `multiplier` and 1.0032690 in `newMultiplier`,
effective since 8 August. Reading the obvious field gives a number that is stale by 6 bps and
looks perfectly plausible.

In a round trip both legs are quoted in raw base units, so the multiplier cancels exactly and the
cost measurement never touches it. It matters only where a token amount is shown to a person,
which is why the swap panel applies it, and why that panel now agrees with Phantom to ~1 bps.

Sanity check that the metric is sound: round-trip cost is monotonic in pool depth, and monotonic
in trade size, for every token. The earlier index-based numbers were neither.

### Against the oracle

The table's last column is a live quote against the live company feed: what one share costs when
bought as a token, against what Pyth says that share is worth. Measured live, the tokens track the
oracle to within a few basis points, while execution costs up to 105 bps at $10,000. The premium is
not where the money goes. The spread is.

Two things make that number easy to get wrong, and both were got wrong first:

**The multiplier applies here, and only here.** Round-trip cost quotes both legs raw precisely so
the scaled-UI multiplier cancels. A price is a single leg, so it does not cancel: a price per raw
unit has to be divided by the multiplier to become a price per share. Skipping that step makes
every row report its own multiplier as a market premium (SPYx +0.62% against a 1.0057 multiplier,
AAPLx +0.31% against 1.0033), with TSLAx at exactly 1.0 sitting at zero and looking like proof.

**Both sides must be read at the same moment.** Comparing a feed that updates every ten seconds
against a trade recorded an hour earlier measures the stock moving. MSTRx read +1.00% that way and
+0.16% when both sides were taken seconds apart, so the page quotes the price live rather than
reusing the recorded table beside it.

## Second finding: the oracle prices the company, not the token

Pyth price feed accounts are PDAs of `pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT`,
seeds `[u16le shard, 32-byte feed_id]`. There are two feed families for each name, and they
are in completely different condition.

`Equity.US.{SYMBOL}/USD` prices the company. It is live, publishing every few seconds, and it
keeps moving after the US close. Sampled every two minutes across the bell on 16 September,
20:00 UTC:

| window | samples | distinct prices per feed |
|--------|--------:|-------------------------:|
| 19:46 to 20:00 UTC (open)   |   7 | 6 to 7 |
| 20:00 to 21:34 UTC (closed) |  48 | 44 to 48 |

Across all 495 readings in that window, spanning an hour and a half past the bell, no company
feed was ever more than **19 seconds** old (min 3s, mean 10s, zero readings above two minutes).
Price discovery continues after hours at the same rate. MSTR moved more after the close than
before it.

`Crypto.{SYMBOL}X/USD` prices the token you would actually buy, and it publishes only when
somebody pays for it. Read on 23 September, the same eight feeds at the same shard:

| feed | last published | age |
|------|----------------|----:|
| `Crypto.TSLAX/USD`  | 2026-09-23 12:32 | 0.3d |
| `Crypto.SPYX/USD`   | 2026-09-21 19:59 | 2.0d |
| `Crypto.MSTRX/USD`  | 2026-09-21 13:53 | 2.3d |
| `Crypto.NVDAX/USD`  | 2026-09-20 19:58 | 3.0d |
| `Crypto.AAPLX/USD`  | 2026-09-12 12:18 | 11.4d |
| `Crypto.METAX/USD`  | 2026-09-12 12:18 | 11.4d |
| `Crypto.GOOGLX/USD` | 2026-09-12 12:18 | 11.4d |
| `Crypto.AMZNX/USD`  | 2026-09-12 12:18 | 11.4d |

On 16 September all eight read 12 September at the same timestamp, which looked like a publisher
that had stopped. A week later half of them had moved and half had not. The pattern is not a stop,
it is intermittency: hours to weeks apart, on no schedule, with nothing on the account to say which
you are holding. That is worse than a feed that is plainly dead, because a dead feed is obvious.

The `Crypto.{SYMBOL}X/{SYMBOL}.RR` redemption-rate feeds, which exist precisely to price the gap
between a token and the share behind it, have not published since late July.

Pyth is a pull oracle: an on-chain price account only moves while somebody pays to update it.
Somebody pays for the company feeds continuously. For the token feeds somebody pays occasionally,
which is the harder case to build on. That is the reason this project measures the round trip
rather than pricing against a reference: for the thing being traded there is a reference price,
and no way to know from the account whether it is a minute or a fortnight old without reading the
timestamp every single time.

### Two corrections, and what actually causes the trap

Until 16 September this section claimed the equity oracles themselves had stopped. That was
wrong. The code read **shard 0** and nothing else, and AAPL there reads $305.92 from 14 August
while the same feed at shard 1 tracked the live market.

The second correction came from Pyth. "Abandoned" was also wrong. The receiver program is
permissionless: anyone with Pyth Pro access can push a price on-chain, so an account moves only
while somebody pays to push into it, and a shard nobody happens to be pushing still answers with
an old price and no error of any kind. A designated set of push feeds is maintained continuously,
and the rest show whatever their last pusher left behind. Nobody retired anything.

The difference is visible in who signs the writes. Last 20 transactions per account, read
2026-09-26 20:54 UTC:

| account | window | distinct fee payers |
|---------|--------|--------------------:|
| `SOL/USD` shard 0 | 20 writes in 10s | **9** |
| `Equity.US.AAPL/USD` shard 0 | last write 2026-08-17 | several one-off payers |
| `Equity.US.AAPL/USD` shard 1 | 20 writes in 3m | **1** |

`src/lib/pyth.ts` now sweeps shards 0 to 2 in a single `getMultipleAccounts` call and takes the
freshest reading, and `PriceUpdate` carries the shard it came from. That is an assumption, not a
fix. The single fee payer behind shard 1 stopped on Friday 25 September at 23:59 UTC, and all
eight equity feeds went stale together; by Saturday evening they read 20.9 hours old while
SOL/USD stayed current to the second. Taking the freshest shard means depending on whichever
publisher is most recent, without knowing who they are or whether they will continue, which is
why the panel shows the age beside every price.

Verification: the decoder is validated against SOL/USD on the same program, which returns
current-to-the-second because many parties push it. That is a property of that feed, not
evidence that any other feed is maintained, and SOL/USD itself shows an untouched shard 2 last
written 2024-04-11. `npm run oracle` reports the shard for every reading and
refuses to report anything if the control is not fresh.

## It executes

One real mainnet swap, $5 of USDC into AAPLx, signed in Phantom from the deployed page:

**[`2X73jXAmYTeBZVm9SQ3iSpuRP2e96iceJ8qnMbnR4E8FuP8uyYQtSV9Pj5ZfSSpKEhfvpa9PA8o9MhJhtRqLWvFk`](https://solscan.io/tx/2X73jXAmYTeBZVm9SQ3iSpuRP2e96iceJ8qnMbnR4E8FuP8uyYQtSV9Pj5ZfSSpKEhfvpa9PA8o9MhJhtRqLWvFk)**

Slot 447058311, 2026-09-14 19:38:54 UTC, finalized, no error. Fee 0.000105 SOL, 262,538 compute
units. Routed SolFi V2 + Flux + PancakeSwap: three venues for a $5 order, which is the routing
fragmentation this whole project is about.

| | |
|---|---|
| spent | 5.000000 USDC |
| received | 1,488,225 base units = **0.01488225 raw** |
| quoted | 0.014907 raw |
| slippage against the quote | **−16.6 bps**, inside the 50 bps tolerance |
| realised price | $335.97 |

The receipt shows the multiplier trap a third time: the RPC's own `uiAmountString` for this
balance reads `0.01488225`, the *unscaled* figure. Applying the multiplier gives 0.014931, which
is what a wallet displays. Even the node's "ui amount" is not the amount to show a user.

Every stage is staged and checked: quote, build, simulate against live state, and only then sign.
Execute stays disabled until a simulation has actually succeeded.

## The RPC proxy

The oracle panel needs a keyed RPC endpoint; the public mainnet-beta endpoint rate-limits the
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
same origin, where nothing is listening, and confirming a swap hangs forever. Subscriptions are
pointed at the public websocket explicitly, which needs no credential.

## Design

The page is built as a **data poster**, not a dashboard: a hard grid, zero radius, zero shadow,
Archivo Black set enormous against hairline rules. The hero leads with the single figure that is
the whole argument: the dearest and cheapest way to buy the same equity exposure, in the same
minute.

Cost is one quantity, so it gets one visual channel rather than a green/amber/red rainbow: figures
stay black until a trade is genuinely expensive, then turn red. The `$10,000` column carries a data
bar beneath each exact figure, so magnitude registers before you read a digit: relative magnitude
layered on absolute values, with nothing hidden.

**Below 760px the table stops being a table.** Each token becomes a record: ticker, the headline
figure at 26px, a bar running the full width of the screen, and the two smaller sizes on one line
beneath. This is the point of the layout. Squeezed into a column on a phone the bar is about 40px
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
npm run oracle   # per-shard feed readings, validated against a SOL/USD control
```

Copy `.env.example` to `.env` and set `RPC_HTTP` for the scripts. For the dev server only, set
`VITE_RPC_HTTP` in `.env.development.local`. Vite never loads `*.development.*` in a production
build, so that key cannot reach `dist/`. Deployed, the key lives only in the Vercel environment
and is read by `api/rpc.ts`.

## Licence

The **source is MIT** (see `LICENSE`): use it, fork it, build on the methodology.

The **measurement data is CC BY 4.0** (see `data/LICENSE`), not MIT. Those are timestamped
observations spanning the closed→open transition of a market; they cannot be reconstructed after
the fact from any public source, and MIT is a software licence that fits a dataset poorly. CC BY
asks only that you credit them.

`NOTICE` lists third-party dependencies. One is worth knowing about: `rpc-websockets` is
LGPL-3.0-only, arriving transitively through `@solana/web3.js`. This application does not use its
websocket subscriptions, since transactions are confirmed by polling over HTTP, but the package is
still in the dependency graph, as it is for every Solana app built on web3.js.

Nothing here is investment advice. It is a measurement of what public APIs returned at a moment in
time, and it executes trades only when you click a button that says so.

## Hackathon

Built for Stocklana, a $100,000 hackathon funded by the Solana Foundation.
Submissions close **Friday 18 September, 4:00pm ET**. Judging through 2 October.
