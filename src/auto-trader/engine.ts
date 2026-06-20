/**
 * Auto-Trader Engine: listens to signal:detected events and executes
 * real trades on Hyperliquid (or Injective).
 *
 * Safety controls: enabled flag, confidence threshold, max positions, coin filter.
 */
import { HttpTransport } from "@nktkas/hyperliquid";
import { order } from "@nktkas/hyperliquid/api/exchange";
import { allMids, meta } from "@nktkas/hyperliquid/api/info";
import { privateKeyToAccount } from "viem/accounts";
import type { EventBus, SignalDetectedEvent, AutoTradeOpenEvent } from "../events/bus.js";
import { getPrice } from "../signal/price-cache.js";
import { loadAutoTraderConfig, type AutoTraderConfig } from "./config.js";

// ── State ──

const openPositions = new Set<string>();
let assetMap: Map<string, number> | null = null;

// ── Hyperliquid helpers ──

async function loadAssetMap(transport: HttpTransport): Promise<Map<string, number>> {
  if (assetMap) return assetMap;
  const info = await meta({ transport });
  assetMap = new Map<string, number>();
  for (let i = 0; i < info.universe.length; i++) {
    const asset = info.universe[i];
    if (asset) assetMap.set(asset.name.toUpperCase(), i);
  }
  return assetMap;
}

function roundToSigFigs(num: number, sigFigs: number): string {
  if (num === 0) return "0";
  const d = Math.ceil(Math.log10(Math.abs(num)));
  const power = sigFigs - d;
  const magnitude = Math.pow(10, power);
  const shifted = Math.round(num * magnitude);
  const result = shifted / magnitude;
  return result.toString();
}

async function executeHyperliquidTrade(
  config: AutoTraderConfig,
  signal: SignalDetectedEvent,
): Promise<{ txHash: string; executionPrice: string; quantity: string }> {
  const transport = new HttpTransport({
    isTestnet: config.network === "testnet",
  });

  // 1. Resolve asset ID
  const assets = await loadAssetMap(transport);
  const assetId = assets.get(signal.coin.toUpperCase());
  if (assetId === undefined) {
    throw new Error(`Unknown asset: ${signal.coin}`);
  }

  // 2. Get current price
  const mids = await allMids({ transport });
  const midPrice = Number(mids[signal.coin.toUpperCase()]);
  if (!midPrice || midPrice <= 0) {
    throw new Error(`No mid price for ${signal.coin}`);
  }

  // 3. Calculate order params
  const isBuy = signal.direction === "long";
  const slippageMultiplier = isBuy ? 1 + config.slippage : 1 - config.slippage;
  const limitPrice = midPrice * slippageMultiplier;
  const quantity = config.positionSizeUsd / midPrice;

  // Round price to 5 sig figs (Hyperliquid requirement)
  const priceStr = roundToSigFigs(limitPrice, 5);
  const qtyStr = roundToSigFigs(quantity, 5);

  // 4. Create wallet signer
  const wallet = privateKeyToAccount(config.privateKey as `0x${string}`);

  // 5. Build order — use IOC (Immediate or Cancel) for market-like execution
  const builderOpt = config.builderAddress
    ? { b: config.builderAddress as `0x${string}`, f: config.builderFee }
    : undefined;

  const result = await order(
    { transport, wallet },
    {
      orders: [{
        a: assetId,
        b: isBuy,
        p: priceStr,
        s: qtyStr,
        r: false,
        t: { limit: { tif: "Ioc" } },
      }],
      grouping: "na",
      ...(builderOpt ? { builder: builderOpt } : {}),
    },
  );

  // 6. Parse result
  const status = result.response.data.statuses[0];
  if (!status) {
    throw new Error("No order status returned");
  }
  if (typeof status === "string") {
    // "waitingForFill" | "waitingForTrigger"
    return { txHash: `hl_${status}`, executionPrice: priceStr, quantity: qtyStr };
  }
  if ("error" in status) {
    throw new Error(`Order rejected: ${status.error}`);
  }
  if ("filled" in status) {
    return {
      txHash: `hl_oid_${status.filled.oid}`,
      executionPrice: status.filled.avgPx,
      quantity: status.filled.totalSz,
    };
  }
  if ("resting" in status) {
    return {
      txHash: `hl_oid_${status.resting.oid}`,
      executionPrice: priceStr,
      quantity: qtyStr,
    };
  }
  return { txHash: "hl_unknown", executionPrice: priceStr, quantity: qtyStr };
}

// ── Public API ──

export async function startAutoTrader(bus: EventBus): Promise<void> {
  const config = loadAutoTraderConfig();

  if (!config.enabled) {
    console.log("[auto-trader] disabled (AUTO_TRADER_ENABLED != true)");
    return;
  }

  if (!config.privateKey) {
    console.error("[auto-trader] ERROR: AUTO_TRADER_PRIVATE_KEY is required. Disabling.");
    return;
  }

  if (config.exchange !== "hyperliquid") {
    console.log(`[auto-trader] exchange=${config.exchange} not yet supported in this version. Use hyperliquid.`);
    return;
  }

  // Set leverage on startup
  try {
    const transport = new HttpTransport({
      isTestnet: config.network === "testnet",
    });
    const wallet = privateKeyToAccount(config.privateKey as `0x${string}`);
    const assets = await loadAssetMap(transport);

    const { updateLeverage } = await import("@nktkas/hyperliquid/api/exchange");
    for (const coin of config.coins) {
      const assetId = assets.get(coin);
      if (assetId === undefined) continue;
      try {
        await updateLeverage(
          { transport, wallet },
          { asset: assetId, isCross: true, leverage: config.leverage },
        );
        console.log(`[auto-trader] leverage set: ${coin} ${config.leverage}x cross`);
      } catch (e) {
        console.warn(`[auto-trader] leverage set failed for ${coin}:`, e instanceof Error ? e.message : e);
      }
    }
  } catch (e) {
    console.warn("[auto-trader] leverage setup error:", e instanceof Error ? e.message : e);
  }

  bus.on("signal:detected", (signal) => {
    // 1. Coin filter
    if (!config.coins.includes(signal.coin.toUpperCase())) return;

    // 2. Signal type filter
    if (!config.signalTypes.includes(signal.type)) {
      console.log(`[auto-trader] skip ${signal.coin} — type ${signal.type} not in [${config.signalTypes}]`);
      return;
    }

    // 3. Confidence check
    if (signal.confidence < config.minConfidence) {
      console.log(`[auto-trader] skip ${signal.coin} — confidence ${signal.confidence} < ${config.minConfidence}`);
      return;
    }

    // 4. Max positions check
    if (openPositions.size >= config.maxPositions) {
      console.log(`[auto-trader] skip ${signal.coin} — max positions (${openPositions.size}/${config.maxPositions})`);
      return;
    }

    // 5. Duplicate check
    if (openPositions.has(signal.coin)) {
      console.log(`[auto-trader] skip ${signal.coin} — already open`);
      return;
    }

    // 6. Execute
    console.log(`[auto-trader] executing ${signal.coin} ${signal.direction} (conf=${signal.confidence})`);

    executeHyperliquidTrade(config, signal)
      .then((result) => {
        openPositions.add(signal.coin);

        const event: AutoTradeOpenEvent = {
          id: `at_${signal.id}`,
          signalId: signal.id,
          coin: signal.coin,
          direction: signal.direction,
          txHash: result.txHash,
          executionPrice: result.executionPrice,
          quantity: result.quantity,
          margin: (config.positionSizeUsd / config.leverage).toFixed(2),
          leverage: config.leverage,
          feeRecipient: config.builderAddress || "self",
          signalType: signal.type,
          signalConfidence: signal.confidence,
          openedAt: new Date(),
        };

        bus.emit("auto-trade:open", event);
        console.log(
          `[auto-trader] FILLED ${signal.coin} ${signal.direction} @ $${result.executionPrice} qty=${result.quantity} ${result.txHash}`,
        );
      })
      .catch((err) => {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error(`[auto-trader] FAILED ${signal.coin} ${signal.direction}:`, errorMsg);
        bus.emit("auto-trade:error", {
          signalId: signal.id,
          coin: signal.coin,
          direction: signal.direction,
          error: errorMsg,
          occurredAt: new Date(),
        });
      });
  });

  console.log(
    `[auto-trader] started — exchange=${config.exchange} network=${config.network} coins=${config.coins.join(",")} size=$${config.positionSizeUsd} lev=${config.leverage}x minConf=${config.minConfidence} maxPos=${config.maxPositions}`,
  );
}
