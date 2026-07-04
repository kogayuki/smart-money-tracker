/**
 * GRVT Executor: executes trades on GRVT exchange.
 *
 * Uses the @wezzcoetzee/grvt SDK (CCXT-style client).
 */
import {
  GrvtClient,
  GrvtEnv,
} from "@wezzcoetzee/grvt";
import type { SignalDetectedEvent } from "../events/bus.js";
import type { AutoTraderConfig } from "./config.js";

// Singleton client
let client: GrvtClient | null = null;

function getClient(config: AutoTraderConfig): GrvtClient {
  if (client) return client;

  const env = config.network === "testnet" ? GrvtEnv.TESTNET : GrvtEnv.PROD;

  client = new GrvtClient({
    env,
    apiKey: config.grvtApiKey || undefined,
    tradingAccountId: config.grvtTradingAccountId || undefined,
    privateKey: config.privateKey || undefined,
  });

  return client;
}

function toGrvtSymbol(coin: string): string {
  return `${coin.toUpperCase()}_USDT_Perp`;
}

export async function executeGrvtTrade(
  config: AutoTraderConfig,
  signal: SignalDetectedEvent,
): Promise<{ txHash: string; executionPrice: string; quantity: string }> {
  const grvt = getClient(config);

  // 1. Get current price
  const symbol = toGrvtSymbol(signal.coin);
  const ticker = await grvt.fetchTicker(symbol);
  const midPrice = Number(ticker.mid_price);

  if (!midPrice || midPrice <= 0) {
    throw new Error(`No mid price for ${signal.coin} on GRVT`);
  }

  // 2. Calculate order params
  const isBuy = signal.direction === "long";
  const side = isBuy ? "buy" : "sell";
  const quantity = config.positionSizeUsd / midPrice;
  const qtyStr = quantity.toFixed(6);

  // 3. Place market order
  const result = await grvt.createMarketOrder(symbol, side, Number(qtyStr));

  // 4. Parse result
  return {
    txHash: `grvt_${result.order_id}`,
    executionPrice: midPrice.toString(),
    quantity: qtyStr,
  };
}

export async function setupGrvtLeverage(
  config: AutoTraderConfig,
): Promise<void> {
  console.log(`[auto-trader] GRVT: leverage configured via GRVT dashboard (not per-API)`);
}
