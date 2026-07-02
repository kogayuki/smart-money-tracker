/**
 * Auto-Trade Checker: monitors open Hyperliquid positions and closes them
 * when TP, SL, or timeout conditions are met.
 *
 * Runs every 30 seconds. No DB dependency — reads positions directly from Hyperliquid.
 */
import { HttpTransport } from "@nktkas/hyperliquid";
import { order } from "@nktkas/hyperliquid/api/exchange";
import { clearinghouseState, allMids, meta } from "@nktkas/hyperliquid/api/info";
import { privateKeyToAccount } from "viem/accounts";
import type { EventBus, AutoTradeCloseEvent } from "../events/bus.js";
import { loadAutoTraderConfig, type AutoTraderConfig } from "./config.js";

const CHECK_INTERVAL_MS = 30_000;

type TrackedPosition = {
  coin: string;
  direction: "long" | "short";
  entryPrice: number;
  quantity: number;
  tpPrice: number;
  slPrice: number;
  maxCloseAt: Date;
  openedAt: Date;
};

// In-memory tracking of positions opened by auto-trader
const tracked = new Map<string, TrackedPosition>();

/** Called by engine.ts when a new position is opened */
export function trackPosition(
  coin: string,
  direction: "long" | "short",
  entryPrice: number,
  quantity: number,
  tpPct: number,
  slPct: number,
  maxHoldH: number,
): void {
  const now = new Date();
  let tpPrice: number;
  let slPrice: number;

  if (direction === "long") {
    tpPrice = entryPrice * (1 + tpPct / 100);
    slPrice = entryPrice * (1 - slPct / 100);
  } else {
    tpPrice = entryPrice * (1 - tpPct / 100);
    slPrice = entryPrice * (1 + slPct / 100);
  }

  tracked.set(coin, {
    coin,
    direction,
    entryPrice,
    quantity,
    tpPrice,
    slPrice,
    maxCloseAt: new Date(now.getTime() + maxHoldH * 3_600_000),
    openedAt: now,
  });

  console.log(
    `[auto-checker] tracking ${coin} ${direction} entry=$${entryPrice.toFixed(2)} TP=$${tpPrice.toFixed(2)} SL=$${slPrice.toFixed(2)} timeout=${maxHoldH}h`,
  );
}

/** Remove tracking when position is closed */
export function untrackPosition(coin: string): void {
  tracked.delete(coin);
}

export function getTrackedPositions(): ReadonlyMap<string, TrackedPosition> {
  return tracked;
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

async function closePosition(
  config: AutoTraderConfig,
  pos: TrackedPosition,
  status: AutoTradeCloseEvent["status"],
  currentPrice: number,
  bus: EventBus,
): Promise<void> {
  const transport = new HttpTransport({
    isTestnet: config.network === "testnet",
  });
  const wallet = privateKeyToAccount(config.privateKey as `0x${string}`);
  const info = await meta({ transport });
  const assetIdx = info.universe.findIndex((m) => m.name === pos.coin);
  if (assetIdx < 0) throw new Error(`Unknown asset: ${pos.coin}`);

  const szDecimals = info.universe[assetIdx]?.szDecimals ?? 4;
  const isShort = pos.direction === "short";
  const slippage = isShort ? 1 + config.slippage : 1 - config.slippage;
  const closePrice = currentPrice * slippage;
  const priceStr = roundToSigFigs(closePrice, 5);
  const qtyStr = pos.quantity.toFixed(szDecimals);

  const result = await order(
    { transport, wallet },
    {
      orders: [{
        a: assetIdx,
        b: isShort,  // buy to close short, sell to close long
        p: priceStr,
        s: qtyStr,
        r: true,     // reduce-only
        t: { limit: { tif: "Ioc" } },
      }],
      grouping: "na",
    },
  );

  const orderStatus = result.response.data.statuses[0];
  let exitPrice = currentPrice;
  let txHash = "hl_close";

  if (orderStatus && typeof orderStatus === "object" && "filled" in orderStatus) {
    exitPrice = Number(orderStatus.filled.avgPx);
    txHash = `hl_oid_${orderStatus.filled.oid}`;
  } else if (orderStatus && typeof orderStatus === "object" && "error" in orderStatus) {
    throw new Error(`Close rejected: ${orderStatus.error}`);
  }

  // Calculate PnL
  let pnlPct: number;
  if (pos.direction === "long") {
    pnlPct = ((exitPrice - pos.entryPrice) / pos.entryPrice) * 100;
  } else {
    pnlPct = ((pos.entryPrice - exitPrice) / pos.entryPrice) * 100;
  }
  const notional = pos.entryPrice * pos.quantity;
  const pnlUsd = (pnlPct / 100) * notional;

  const event: AutoTradeCloseEvent = {
    id: `atc_${pos.coin}_${Date.now()}`,
    coin: pos.coin,
    direction: pos.direction,
    entryPrice: pos.entryPrice,
    exitPrice,
    quantity: pos.quantity,
    pnlUsd,
    pnlPct,
    status,
    txHash,
    openedAt: pos.openedAt,
    closedAt: new Date(),
  };

  untrackPosition(pos.coin);
  bus.emit("auto-trade:close", event);

  const emoji = pnlUsd >= 0 ? "+" : "";
  console.log(
    `[auto-checker] CLOSED ${pos.coin} ${status} @ $${exitPrice.toFixed(2)} PnL: ${emoji}$${pnlUsd.toFixed(2)} (${emoji}${pnlPct.toFixed(1)}%) ${txHash}`,
  );
}

/**
 * Restore tracked positions from Hyperliquid on startup.
 * This ensures TP/SL/timeout continues to work after a restart.
 */
async function restorePositions(config: AutoTraderConfig): Promise<void> {
  try {
    const transport = new HttpTransport({
      isTestnet: config.network === "testnet",
    });
    const wallet = privateKeyToAccount(config.privateKey as `0x${string}`);
    const state = await clearinghouseState({ transport }, { user: wallet.address });

    if (state.assetPositions.length === 0) {
      console.log("[auto-checker] no existing positions to restore");
      return;
    }

    for (const ap of state.assetPositions) {
      const pos = ap.position;
      const coin = pos.coin;
      const size = Number(pos.szi);
      if (size === 0) continue;

      // Only restore coins we're configured to trade
      if (!config.coins.includes(coin.toUpperCase())) continue;

      // Skip if already tracked (shouldn't happen on startup, but safety check)
      if (tracked.has(coin)) continue;

      const direction: "long" | "short" = size > 0 ? "long" : "short";
      const entryPrice = Number(pos.entryPx);
      const quantity = Math.abs(size);

      // Reconstruct TP/SL from config
      trackPosition(
        coin,
        direction,
        entryPrice,
        quantity,
        config.tpPct,
        config.slPct,
        config.maxHoldH,
      );

      console.log(
        `[auto-checker] restored ${coin} ${direction} entry=$${entryPrice.toFixed(2)} qty=${quantity}`,
      );
    }

    console.log(`[auto-checker] restored ${tracked.size} position(s) from Hyperliquid`);
  } catch (err) {
    console.error("[auto-checker] restore failed:", err instanceof Error ? err.message : err);
  }
}

export function startAutoTradeChecker(bus: EventBus): () => void {
  const config = loadAutoTraderConfig();

  if (!config.enabled || !config.privateKey) {
    console.log("[auto-checker] disabled");
    return () => {};
  }

  // Restore existing positions from Hyperliquid (survives restart)
  void restorePositions(config);

  const interval = setInterval(() => void checkAll(config, bus), CHECK_INTERVAL_MS);
  console.log(`[auto-checker] started (${CHECK_INTERVAL_MS / 1000}s interval, TP=${config.tpPct}% SL=${config.slPct}% timeout=${config.maxHoldH}h)`);

  return () => {
    clearInterval(interval);
    console.log("[auto-checker] stopped");
  };
}

async function checkAll(config: AutoTraderConfig, bus: EventBus): Promise<void> {
  if (tracked.size === 0) return;

  try {
    const transport = new HttpTransport({
      isTestnet: config.network === "testnet",
    });
    const mids = await allMids({ transport });
    const now = new Date();

    for (const [coin, pos] of tracked) {
      const currentPrice = Number(mids[coin]);
      if (!currentPrice || currentPrice <= 0) continue;

      let status: AutoTradeCloseEvent["status"] | null = null;

      if (pos.direction === "long") {
        if (currentPrice >= pos.tpPrice) status = "closed_tp";
        else if (currentPrice <= pos.slPrice) status = "closed_sl";
      } else {
        if (currentPrice <= pos.tpPrice) status = "closed_tp";
        else if (currentPrice >= pos.slPrice) status = "closed_sl";
      }

      if (!status && now >= pos.maxCloseAt) {
        status = "closed_timeout";
      }

      if (!status) continue;

      console.log(`[auto-checker] ${coin} triggered ${status} (price=$${currentPrice.toFixed(2)} TP=$${pos.tpPrice.toFixed(2)} SL=$${pos.slPrice.toFixed(2)})`);

      try {
        await closePosition(config, pos, status, currentPrice, bus);
      } catch (err) {
        console.error(`[auto-checker] close failed for ${coin}:`, err instanceof Error ? err.message : err);
      }
    }
  } catch (err) {
    console.error("[auto-checker] check error:", err instanceof Error ? err.message : err);
  }
}
