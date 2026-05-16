import type { EventBus, PaperTradeCloseEvent } from "../events/bus.js";
import { getPrice } from "../signal/price-cache.js";
import { getDb } from "../db/client.js";
import { loadPaperConfig } from "./config.js";

const CHECK_INTERVAL_MS = 60_000;

type OpenTrade = {
  id: string;
  signal_id: string;
  coin: string;
  direction: "long" | "short";
  entry_price: number;
  position_size_usd: number;
  quantity: number;
  tp_price: number;
  sl_price: number;
  signal_type: string;
  signal_confidence: number;
  max_close_at: string;
  opened_at: string;
};

export function startPaperChecker(bus: EventBus): () => void {
  const config = loadPaperConfig();

  if (!config.enabled) {
    console.log("[paper-checker] disabled (PAPER_ENABLED=false)");
    return () => {};
  }

  const sql = getDb();
  if (!sql) {
    console.warn("[paper-checker] DATABASE_URL not set, skipping");
    return () => {};
  }

  const interval = setInterval(() => void checkPositions(bus, sql), CHECK_INTERVAL_MS);
  console.log("[paper-checker] started (60s interval)");

  return () => {
    clearInterval(interval);
    console.log("[paper-checker] stopped");
  };
}

async function checkPositions(
  bus: EventBus,
  sql: ReturnType<typeof getDb> & object,
): Promise<void> {
  try {
    const rows = await (sql as NonNullable<ReturnType<typeof getDb>>)`
      SELECT id, signal_id, coin, direction, entry_price, position_size_usd,
             quantity, tp_price, sl_price, signal_type, signal_confidence,
             max_close_at, opened_at
      FROM paper_trades
      WHERE status = 'open'
    `;

    if (rows.length === 0) return;

    const now = new Date();

    for (const row of rows) {
      const trade = row as unknown as OpenTrade;
      const currentPrice = getPrice(trade.coin);
      if (currentPrice === null) continue;

      const entryPrice = Number(trade.entry_price);
      const tpPrice = Number(trade.tp_price);
      const slPrice = Number(trade.sl_price);
      const maxCloseAt = new Date(trade.max_close_at);

      let status: PaperTradeCloseEvent["status"] | null = null;
      let exitPrice = currentPrice;

      if (trade.direction === "long") {
        if (currentPrice >= tpPrice) {
          status = "closed_tp";
          exitPrice = tpPrice;
        } else if (currentPrice <= slPrice) {
          status = "closed_sl";
          exitPrice = slPrice;
        }
      } else {
        // short
        if (currentPrice <= tpPrice) {
          status = "closed_tp";
          exitPrice = tpPrice;
        } else if (currentPrice >= slPrice) {
          status = "closed_sl";
          exitPrice = slPrice;
        }
      }

      // Timeout check
      if (!status && now >= maxCloseAt) {
        status = "closed_timeout";
        exitPrice = currentPrice;
      }

      if (!status) continue;

      // Calculate P&L
      let pnlPct: number;
      if (trade.direction === "long") {
        pnlPct = ((exitPrice - entryPrice) / entryPrice) * 100;
      } else {
        pnlPct = ((entryPrice - exitPrice) / entryPrice) * 100;
      }
      const positionSizeUsd = Number(trade.position_size_usd);
      const pnlUsd = (pnlPct / 100) * positionSizeUsd;

      const event: PaperTradeCloseEvent = {
        id: trade.id,
        signalId: trade.signal_id,
        coin: trade.coin,
        direction: trade.direction,
        entryPrice,
        exitPrice,
        positionSizeUsd,
        quantity: Number(trade.quantity),
        pnlUsd,
        pnlPct,
        status,
        signalType: trade.signal_type,
        signalConfidence: Number(trade.signal_confidence),
        openedAt: new Date(trade.opened_at),
        closedAt: now,
      };

      bus.emit("paper:close", event);
      console.log(
        `[paper-checker] ${trade.id} ${trade.coin} → ${status} pnl=${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(2)}% ($${pnlUsd.toFixed(2)})`,
      );
    }
  } catch (err) {
    console.error("[paper-checker] check failed:", err instanceof Error ? err.message : err);
  }
}
