export type AutoTraderExchange = "hyperliquid" | "injective";

export type AutoTraderConfig = {
  enabled: boolean;
  /** Which exchange to execute trades on */
  exchange: AutoTraderExchange;
  /** "testnet" | "mainnet" */
  network: "testnet" | "mainnet";
  /** Private key (0x-prefixed hex) for the trading wallet */
  privateKey: string;
  /** Coins to trade (uppercase) */
  coins: string[];
  /** Signal types to act on */
  signalTypes: string[];
  /** Notional amount per trade in USD */
  positionSizeUsd: number;
  /** Leverage multiplier */
  leverage: number;
  /** Slippage tolerance as fraction (0.01 = 1%) */
  slippage: number;
  /** Minimum signal confidence to act */
  minConfidence: number;
  /** Maximum concurrent positions */
  maxPositions: number;
  /** Take profit percentage (e.g. 5 = +5%) */
  tpPct: number;
  /** Stop loss percentage (e.g. 3 = -3%) */
  slPct: number;
  /** Maximum hold time in hours */
  maxHoldH: number;
  /** Fee recipient (Injective only: inj1... address) */
  feeRecipient: string;
  /** Builder fee address (Hyperliquid only: 0x... address) */
  builderAddress: string;
  /** Builder fee in 0.1bps (Hyperliquid only, e.g. 10 = 0.01%) */
  builderFee: number;
};

export function loadAutoTraderConfig(): AutoTraderConfig {
  const exchange = (process.env.AUTO_TRADER_EXCHANGE ?? "hyperliquid") as AutoTraderExchange;
  if (exchange !== "hyperliquid" && exchange !== "injective") {
    throw new Error(`AUTO_TRADER_EXCHANGE must be "hyperliquid" or "injective", got "${exchange}"`);
  }

  const network = process.env.AUTO_TRADER_NETWORK ?? "mainnet";
  if (network !== "testnet" && network !== "mainnet") {
    throw new Error(`AUTO_TRADER_NETWORK must be "testnet" or "mainnet", got "${network}"`);
  }

  return {
    enabled: process.env.AUTO_TRADER_ENABLED === "true",
    exchange,
    network,
    privateKey: process.env.AUTO_TRADER_PRIVATE_KEY ?? "",
    coins: (process.env.AUTO_TRADER_COINS ?? "BTC,ETH").split(",").map((s) => s.trim().toUpperCase()),
    signalTypes: (process.env.AUTO_TRADER_SIGNAL_TYPES ?? "flow_shift,confluence").split(",").map((s) => s.trim()),
    positionSizeUsd: Number(process.env.AUTO_TRADER_POSITION_SIZE_USD ?? "10"),
    leverage: Number(process.env.AUTO_TRADER_LEVERAGE ?? "5"),
    slippage: Number(process.env.AUTO_TRADER_SLIPPAGE ?? "0.02"),
    minConfidence: Number(process.env.AUTO_TRADER_MIN_CONFIDENCE ?? "0.8"),
    maxPositions: Number(process.env.AUTO_TRADER_MAX_POSITIONS ?? "3"),
    tpPct: Number(process.env.AUTO_TRADER_TP_PCT ?? "5"),
    slPct: Number(process.env.AUTO_TRADER_SL_PCT ?? "3"),
    maxHoldH: Number(process.env.AUTO_TRADER_MAX_HOLD_H ?? "24"),
    feeRecipient: process.env.AUTO_TRADER_FEE_RECIPIENT ?? "",
    builderAddress: process.env.AUTO_TRADER_BUILDER_ADDRESS ?? "",
    builderFee: Number(process.env.AUTO_TRADER_BUILDER_FEE ?? "0"),
  };
}
