export type AutoTraderExchange = "hyperliquid" | "injective" | "grvt";

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
  /** Directions to act on ("long", "short") */
  directions: string[];
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
  /** GRVT API key */
  grvtApiKey: string;
  /** GRVT trading account ID */
  grvtTradingAccountId: string;
};

const EXCHANGE_PREFIX: Record<AutoTraderExchange, string> = {
  hyperliquid: "HL",
  injective: "INJ",
  grvt: "GRVT",
};

function isValidExchange(s: string): s is AutoTraderExchange {
  return s === "hyperliquid" || s === "injective" || s === "grvt";
}

/**
 * Reads AUTO_TRADER_<PREFIX>_<KEY> (per-exchange override) with fallback
 * to AUTO_TRADER_<KEY> (shared default).
 * e.g. hyperliquid POSITION_SIZE_USD → AUTO_TRADER_HL_POSITION_SIZE_USD ?? AUTO_TRADER_POSITION_SIZE_USD
 */
function env(exchange: AutoTraderExchange, key: string): string | undefined {
  return (
    process.env[`AUTO_TRADER_${EXCHANGE_PREFIX[exchange]}_${key}`] ??
    process.env[`AUTO_TRADER_${key}`]
  );
}

function buildConfig(exchange: AutoTraderExchange): AutoTraderConfig {
  const network = env(exchange, "NETWORK") ?? "mainnet";
  if (network !== "testnet" && network !== "mainnet") {
    throw new Error(`AUTO_TRADER_NETWORK must be "testnet" or "mainnet", got "${network}"`);
  }

  return {
    enabled: process.env.AUTO_TRADER_ENABLED === "true",
    exchange,
    network,
    privateKey: env(exchange, "PRIVATE_KEY") ?? "",
    coins: (env(exchange, "COINS") ?? "BTC,ETH").split(",").map((s) => s.trim().toUpperCase()),
    signalTypes: (env(exchange, "SIGNAL_TYPES") ?? "flow_shift,confluence").split(",").map((s) => s.trim()),
    directions: (env(exchange, "DIRECTIONS") ?? "long,short").split(",").map((s) => s.trim().toLowerCase()),
    positionSizeUsd: Number(env(exchange, "POSITION_SIZE_USD") ?? "10"),
    leverage: Number(env(exchange, "LEVERAGE") ?? "5"),
    slippage: Number(env(exchange, "SLIPPAGE") ?? "0.02"),
    minConfidence: Number(env(exchange, "MIN_CONFIDENCE") ?? "0.8"),
    maxPositions: Number(env(exchange, "MAX_POSITIONS") ?? "3"),
    tpPct: Number(env(exchange, "TP_PCT") ?? "5"),
    slPct: Number(env(exchange, "SL_PCT") ?? "3"),
    maxHoldH: Number(env(exchange, "MAX_HOLD_H") ?? "24"),
    feeRecipient: process.env.AUTO_TRADER_FEE_RECIPIENT ?? "",
    builderAddress: process.env.AUTO_TRADER_BUILDER_ADDRESS ?? "",
    builderFee: Number(process.env.AUTO_TRADER_BUILDER_FEE ?? "0"),
    grvtApiKey: process.env.AUTO_TRADER_GRVT_API_KEY ?? "",
    grvtTradingAccountId: process.env.AUTO_TRADER_GRVT_TRADING_ACCOUNT_ID ?? "",
  };
}

/**
 * Loads one config per exchange listed in AUTO_TRADER_EXCHANGES
 * (comma-separated; falls back to AUTO_TRADER_EXCHANGE for backward compat).
 */
export function loadAutoTraderConfigs(): AutoTraderConfig[] {
  const raw =
    process.env.AUTO_TRADER_EXCHANGES ??
    process.env.AUTO_TRADER_EXCHANGE ??
    "hyperliquid";

  const names = [...new Set(raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean))];
  for (const name of names) {
    if (!isValidExchange(name)) {
      throw new Error(`AUTO_TRADER_EXCHANGES entries must be "hyperliquid", "injective", or "grvt", got "${name}"`);
    }
  }

  return (names as AutoTraderExchange[]).map(buildConfig);
}
