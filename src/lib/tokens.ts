/**
 * xStock registry.
 *
 * Every mint here was resolved from Jupiter's token search against the live
 * mainnet listing, not copied from a docs page. All xStocks are SPL Token-2022
 * with 8 decimals.
 *
 * A note on `decimals`: do NOT use it alone to convert a raw amount into a
 * share-equivalent figure. xStocks carry a Token-2022 scaledUiAmount multiplier
 * for dividends and splits, so the displayable amount is `raw * multiplier`
 * (see lib/scaled.ts). Round-trip costing avoids the issue entirely because both
 * legs are denominated in raw base units and the multiplier cancels.
 */

export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const USDC_DECIMALS = 6;

export interface XStock {
  /** On-chain ticker, e.g. "AAPLx". */
  symbol: string;
  /** Token-2022 mint address. */
  mint: string;
  /** Raw decimals. Not sufficient on its own for display; see note above. */
  decimals: number;
  /** Underlying NASDAQ/NYSE symbol, used for Pyth market-hours lookup. */
  equity: string;
  /** Pyth price feed id for the underlying equity, where known. */
  pythFeedId?: string;
  /**
   * Pyth feed id for the *token* rather than the company: Crypto.{T}X/USD.
   * These exist only at shard 0 and stopped publishing on 12 September 2026.
   */
  tokenFeedId?: string;
}

export const XSTOCKS: XStock[] = [
  {
    symbol: "AAPLx",
    mint: "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp",
    decimals: 8,
    equity: "AAPL",
    pythFeedId: "49f6b65cb1de6b10eaf75e7c03ca029c306d0357e91b5311b175084a5ad55688", tokenFeedId: "978e6cc68a119ce066aa830017318563a9ed04ec3a0a6439010fc11296a58675",
  },
  {
    symbol: "TSLAx",
    mint: "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB",
    decimals: 8,
    equity: "TSLA",
    pythFeedId: "16dad506d7db8da01c87581c87ca897a012a153557d4d578c3b9c9e1bc0632f1", tokenFeedId: "47a156470288850a440df3a6ce85a55917b813a19bb5b31128a33a986566a362",
  },
  { symbol: "NVDAx",  mint: "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh", decimals: 8, equity: "NVDA", pythFeedId: "b1073854ed24cbc755dc527418f52b7d271f6cc967bbf8d8129112b18860a593", tokenFeedId: "4244d07890e4610f46bbde67de8f43a4bf8b569eebe904f136b469f148503b7f" },
  { symbol: "SPYx",   mint: "XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W", decimals: 8, equity: "SPY", pythFeedId: "19e09bb805456ada3979a7d1cbb4b6d63babc3a0f8e8a9509f68afa5c4c11cd5", tokenFeedId: "2817b78438c769357182c04346fddaad1178c82f4048828fe0997c3c64624e14" },
  { symbol: "MSTRx",  mint: "XsP7xzNPvEHS1m6qfanPUGjNmdnmsLKEoNAnHjdxxyZ", decimals: 8, equity: "MSTR", pythFeedId: "e1e80251e5f5184f2195008382538e847fafc36f751896889dd3d1b1f6111f09", tokenFeedId: "53f95ba4e23ed15ea56083e2ee9a5eec48055d6f59033d4bb95f1ca2a2349c28" },
  { symbol: "METAx",  mint: "Xsa62P5mvPszXL1krVUnU5ar38bBSVcWAB6fmPCo5Zu", decimals: 8, equity: "META", pythFeedId: "78a3e3b8e676a8f73c439f5d749737034b139bbbe899ba5775216fba596607fe", tokenFeedId: "bf3e5871be3f80ab7a4d1f1fd039145179fb58569e159aee1ccd472868ea5900" },
  { symbol: "GOOGLx", mint: "XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN", decimals: 8, equity: "GOOGL", pythFeedId: "5a48c03e9b9cb337801073ed9d166817473697efff0d138874e0f6a33d6d5aa6", tokenFeedId: "b911b0329028cd0283e4259c33809d62942bd2716a58084e5f31d64c00b5424e" },
  { symbol: "AMZNx",  mint: "Xs3eBt7uRfJX8QUs4suhyU8p2M6DoUDrJyWBa8LLZsg", decimals: 8, equity: "AMZN", pythFeedId: "b5d0e0fa58a1f8b81498ae670ce93c872d14434b72c364885d4fa1b257cbb07a", tokenFeedId: "7148fbe6e493ff2580305c92a8d7f8628c9943b11b9b253aebc24863fec290e8" },
];

/** Trade sizes we quote, in whole USDC. */
export const SIZES_USDC = [100, 1_000, 10_000] as const;

/**
 * Sizes offered for a real swap.
 *
 * Deliberately not SIZES_USDC: those are measurement sizes chosen to show the
 * shape of the cost curve, and the smallest of them is $100 of someone's actual
 * money. A demo swap should be able to be small.
 */
export const SWAP_SIZES_USDC = [5, 10, 25, 50, 100] as const;

/** Below this a quote is not meaningfully executable. */
export const MIN_SWAP_USDC = 1;

export function bySymbol(symbol: string): XStock | undefined {
  return XSTOCKS.find((t) => t.symbol === symbol);
}
