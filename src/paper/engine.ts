import { randomUUID } from "node:crypto";
import type { EventBus, PaperTradeOpenEvent } from "../events/bus.js";
import { getPrice } from "../signal/price-cache.js";
import { getDb } from "../db/client.js";
import { loadPaperConfig, type PaperConfig } from "./config.js";

type OpenPosition = {
  id: string;
  direction: "long" | "short";
};

// In-memory tracking of open positions per coin
const openPositions = new Map<string, OpenPosition>();

async function syncOpenPositions(): Promise<void> {
  const sql = getDb();
  if (!sql) return;

  try {
    const rows = await sql`SELECT id, coin, direction FROM paper_trades WHERE status = 'open'`;
    for (const row of rows) {
      openPositions.set(row.coin as string, {
        id: row.id as string,
        direction: row.direction as "long" | "short",
      });
    }
    if (rows.length > 0) {
      console.log(`[paper-engine] synced ${rows.length} open position(s) from DB`);
    }
  } catch (err) {
    console.error("[paper-engine] sync failed:", err instanceof Error ? err.message : err);
  }
}

export function getOpenPositions(): ReadonlyMap<string, OpenPosition> {
  return openPositions;
}

export async function startPaperEngine(bus: EventBus): Promise<void> {
  const config = loadPaperConfig();

  if (!config.enabled) {
    console.log("[paper-engine] disabled (PAPER_ENABLED=false)");
    return;
  }

  // Sync open positions from DB on startup
  await syncOpenPositions();

  bus.on("signal:detected", (signal) => {
    try {
      handleSignal(signal, config, bus);
    } catch (err) {
      console.error("[paper-engine] error:", err instanceof Error ? err.message : err);
    }
  });

  // Listen for close events to clear in-memory map
  bus.on("paper:close", (event) => {
    const pos = openPositions.get(event.coin);
    if (pos && pos.id === event.id) {
      openPositions.delete(event.coin);
    }
  });

  console.log(
    `[paper-engine] started — coins=${config.coins.join(",")} signals=${config.signalTypes.join(",")} budget=$${config.budgetUsd} tp=${config.tpPct}% sl=${config.slPct}% minConf=${config.minConfidence}`,
  );
}

function handleSignal(
  signal: { id: string; coin: string; direction: "long" | "short"; confidence: number; type: string; priceAtSignal: number },
  config: PaperConfig,
  bus: EventBus,
): void {
  // 1. Coin filter
  if (!config.coins.includes(signal.coin.toUpperCase())) {
    return;
  }

  // 2. Signal type filter
  if (!config.signalTypes.includes(signal.type)) {
    console.log(`[paper-engine] skip ${signal.coin} — signal type ${signal.type} not in [${config.signalTypes}]`);
    return;
  }

  // 3. Confidence check
  if (signal.confidence < config.minConfidence) {
    console.log(`[paper-engine] skip ${signal.coin} — confidence ${signal.confidence} < ${config.minConfidence}`);
    return;
  }

  // 4. Duplicate check — already have an open position for this coin
  if (openPositions.has(signal.coin)) {
    console.log(`[paper-engine] skip ${signal.coin} — already have open position`);
    return;
  }

  // 5. Get current price
  const currentPrice = getPrice(signal.coin);
  const entryPrice = currentPrice ?? signal.priceAtSignal;
  if (entryPrice <= 0) {
    console.warn(`[paper-engine] skip ${signal.coin} — no valid price`);
    return;
  }

  // 6. Calculate TP/SL
  const { tpPct, slPct, positionSizeUsd, maxHoldH } = config;
  let tpPrice: number;
  let slPrice: number;

  if (signal.direction === "long") {
    tpPrice = entryPrice * (1 + tpPct / 100);
    slPrice = entryPrice * (1 - slPct / 100);
  } else {
    tpPrice = entryPrice * (1 - tpPct / 100);
    slPrice = entryPrice * (1 + slPct / 100);
  }

  const quantity = positionSizeUsd / entryPrice;
  const now = new Date();
  const maxCloseAt = new Date(now.getTime() + maxHoldH * 3_600_000);
  const id = `pt_${randomUUID().replace(/-/g, "").slice(0, 16)}`;

  // Track in-memory
  openPositions.set(signal.coin, { id, direction: signal.direction });

  // 7. Emit paper:open
  const event: PaperTradeOpenEvent = {
    id,
    signalId: signal.id,
    coin: signal.coin,
    direction: signal.direction,
    entryPrice,
    positionSizeUsd,
    quantity,
    tpPrice,
    slPrice,
    maxCloseAt,
    signalType: signal.type,
    signalConfidence: signal.confidence,
    openedAt: now,
  };

  bus.emit("paper:open", event);
  console.log(
    `[paper-engine] opened ${id} ${signal.coin} ${signal.direction} @ $${entryPrice.toFixed(2)} TP=$${tpPrice.toFixed(2)} SL=$${slPrice.toFixed(2)}`,
  );
}
