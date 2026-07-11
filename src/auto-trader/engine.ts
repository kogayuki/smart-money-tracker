/**
 * Auto-Trader Engine: listens to signal:detected events and executes
 * real trades on the configured exchange(s).
 *
 * Supports multiple exchanges in parallel (AUTO_TRADER_EXCHANGES=grvt,hyperliquid),
 * each with its own position tracking, cooldowns, and per-exchange config overrides.
 *
 * Safety controls: enabled flag, confidence threshold, max positions, coin filter.
 */
import { HttpTransport } from "@nktkas/hyperliquid";
import { order } from "@nktkas/hyperliquid/api/exchange";
import { allMids, meta } from "@nktkas/hyperliquid/api/info";
import { privateKeyToAccount } from "viem/accounts";
import type { EventBus, SignalDetectedEvent, AutoTradeOpenEvent } from "../events/bus.js";
import { loadAutoTraderConfigs, type AutoTraderConfig } from "./config.js";
import { trackPosition } from "./checker.js";

const COOLDOWN_MS = 4 * 60 * 60 * 1000; // 4 hours

type AssetInfo = { index: number; szDecimals: number };
let assetMap: Map<string, AssetInfo> | null = null;

// ── Hyperliquid helpers ──

async function loadAssetMap(transport: HttpTransport): Promise<Map<string, AssetInfo>> {
  if (assetMap) return assetMap;
  const info = await meta({ transport });
  assetMap = new Map<string, AssetInfo>();
  for (let i = 0; i < info.universe.length; i++) {
    const asset = info.universe[i];
    if (asset) assetMap.set(asset.name.toUpperCase(), { index: i, szDecimals: asset.szDecimals });
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

  // 1. Resolve asset ID and size decimals
  const assets = await loadAssetMap(transport);
  const assetInfo = assets.get(signal.coin.toUpperCase());
  if (!assetInfo) {
    throw new Error(`Unknown asset: ${signal.coin}`);
  }
  const { index: assetId, szDecimals } = assetInfo;

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

  // Round price to 5 sig figs, quantity to szDecimals
  const priceStr = roundToSigFigs(limitPrice, 5);
  const qtyStr = quantity.toFixed(szDecimals);

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

// ── Hyperliquid startup: leverage + position restore ──

async function setupHyperliquid(config: AutoTraderConfig, openPositions: Set<string>): Promise<void> {
  const transport = new HttpTransport({
    isTestnet: config.network === "testnet",
  });
  const wallet = privateKeyToAccount(config.privateKey as `0x${string}`);
  const assets = await loadAssetMap(transport);

  const { updateLeverage } = await import("@nktkas/hyperliquid/api/exchange");
  for (const coin of config.coins) {
    const info = assets.get(coin);
    if (!info) continue;
    try {
      await updateLeverage(
        { transport, wallet },
        { asset: info.index, isCross: true, leverage: config.leverage },
      );
      console.log(`[auto-trader] leverage set: ${coin} ${config.leverage}x cross`);
    } catch (e) {
      console.warn(`[auto-trader] leverage set failed for ${coin}:`, e instanceof Error ? e.message : e);
    }
  }
  // Restore openPositions from existing Hyperliquid positions
  const state = await (await import("@nktkas/hyperliquid/api/info")).clearinghouseState(
    { transport }, { user: wallet.address },
  );
  for (const ap of state.assetPositions) {
    if (Number(ap.position.szi) !== 0 && config.coins.includes(ap.position.coin.toUpperCase())) {
      openPositions.add(ap.position.coin);
    }
  }
  if (openPositions.size > 0) {
    console.log(`[auto-trader] restored openPositions (hyperliquid): ${[...openPositions].join(", ")}`);
  }
}

// ── Per-exchange instance ──

async function startAutoTraderInstance(bus: EventBus, config: AutoTraderConfig): Promise<void> {
  if (!config.privateKey) {
    console.error(`[auto-trader] ERROR: private key required for ${config.exchange}. Disabling.`);
    return;
  }

  if (config.exchange !== "hyperliquid" && config.exchange !== "grvt") {
    console.log(`[auto-trader] exchange=${config.exchange} not supported. Use hyperliquid or grvt.`);
    return;
  }

  // Per-instance state
  const openPositions = new Set<string>();
  /** Cooldown: coin:direction → cooldown expiry timestamp */
  const cooldowns = new Map<string, number>();

  // Set leverage on startup + restore existing positions
  try {
    if (config.exchange === "grvt") {
      const { setupGrvtLeverage } = await import("./grvt-executor.js");
      await setupGrvtLeverage(config);
      const { fetchGrvtPositions } = await import("./grvt-executor.js");
      for (const pos of await fetchGrvtPositions(config)) {
        if (config.coins.includes(pos.coin.toUpperCase())) openPositions.add(pos.coin);
      }
      if (openPositions.size > 0) {
        console.log(`[auto-trader] restored openPositions (grvt): ${[...openPositions].join(", ")}`);
      }
    } else {
      await setupHyperliquid(config, openPositions);
    }
  } catch (e) {
    console.warn(`[auto-trader] ${config.exchange} startup error:`, e instanceof Error ? e.message : e);
  }

  // Clear openPositions when auto-trade:close fires + set cooldown on SL
  bus.on("auto-trade:close", (event) => {
    if (event.exchange !== config.exchange) return;
    openPositions.delete(event.coin);
    if (event.status === "closed_sl") {
      const key = `${event.coin}:${event.direction}`;
      const expiry = Date.now() + COOLDOWN_MS;
      cooldowns.set(key, expiry);
      console.log(`[auto-trader] ${config.exchange} cooldown set: ${key} for 4h (until ${new Date(expiry).toISOString()})`);
    }
  });

  bus.on("signal:detected", (signal) => {
    const tag = `${config.exchange}:${signal.coin}`;

    // 1. Coin filter
    if (!config.coins.includes(signal.coin.toUpperCase())) return;

    // 2. Signal type filter
    if (!config.signalTypes.includes(signal.type)) {
      console.log(`[auto-trader] skip ${tag} — type ${signal.type} not in [${config.signalTypes}]`);
      return;
    }

    // 2b. Direction filter
    if (!config.directions.includes(signal.direction)) {
      console.log(`[auto-trader] skip ${tag} — direction ${signal.direction} not in [${config.directions}]`);
      return;
    }

    // 3. Confidence check
    if (signal.confidence < config.minConfidence) {
      console.log(`[auto-trader] skip ${tag} — confidence ${signal.confidence} < ${config.minConfidence}`);
      return;
    }

    // 4. Cooldown check (after SL, same coin+direction blocked for 4h)
    const cooldownKey = `${signal.coin}:${signal.direction}`;
    const cooldownExpiry = cooldowns.get(cooldownKey);
    if (cooldownExpiry && Date.now() < cooldownExpiry) {
      const remainMin = Math.round((cooldownExpiry - Date.now()) / 60000);
      console.log(`[auto-trader] skip ${tag} ${signal.direction} — cooldown (${remainMin}min remaining)`);
      return;
    }
    if (cooldownExpiry) cooldowns.delete(cooldownKey); // expired, clean up

    // 5. Max positions check
    if (openPositions.size >= config.maxPositions) {
      console.log(`[auto-trader] skip ${tag} — max positions (${openPositions.size}/${config.maxPositions})`);
      return;
    }

    // 6. Duplicate check
    if (openPositions.has(signal.coin)) {
      console.log(`[auto-trader] skip ${tag} — already open`);
      return;
    }

    // 7. Execute
    console.log(`[auto-trader] executing ${signal.coin} ${signal.direction} on ${config.exchange} (conf=${signal.confidence})`);

    const executeTrade = config.exchange === "grvt"
      ? import("./grvt-executor.js").then(m => m.executeGrvtTrade(config, signal))
      : executeHyperliquidTrade(config, signal);

    executeTrade
      .then((result) => {
        openPositions.add(signal.coin);

        // Track for TP/SL/timeout checker
        trackPosition(
          config.exchange,
          signal.coin,
          signal.direction,
          Number(result.executionPrice),
          Number(result.quantity),
          config.tpPct,
          config.slPct,
          config.maxHoldH,
        );

        const event: AutoTradeOpenEvent = {
          id: `at_${config.exchange}_${signal.id}`,
          exchange: config.exchange,
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
          `[auto-trader] FILLED ${config.exchange} ${signal.coin} ${signal.direction} @ $${result.executionPrice} qty=${result.quantity} ${result.txHash}`,
        );
      })
      .catch((err) => {
        const errorMsg = err instanceof Error ? err.message : String(err);
        console.error(`[auto-trader] FAILED ${config.exchange} ${signal.coin} ${signal.direction}:`, errorMsg);
        bus.emit("auto-trade:error", {
          exchange: config.exchange,
          signalId: signal.id,
          coin: signal.coin,
          direction: signal.direction,
          error: errorMsg,
          occurredAt: new Date(),
        });
      });
  });

  console.log(
    `[auto-trader] started — exchange=${config.exchange} network=${config.network} coins=${config.coins.join(",")} size=$${config.positionSizeUsd} lev=${config.leverage}x minConf=${config.minConfidence} maxPos=${config.maxPositions} dirs=${config.directions.join(",")}`,
  );
}

// ── Public API ──

export async function startAutoTrader(bus: EventBus): Promise<void> {
  const configs = loadAutoTraderConfigs();

  if (!configs[0]?.enabled) {
    console.log("[auto-trader] disabled (AUTO_TRADER_ENABLED != true)");
    return;
  }

  for (const config of configs) {
    await startAutoTraderInstance(bus, config);
  }
}
