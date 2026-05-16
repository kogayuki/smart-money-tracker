import type { EventBus } from "../events/bus.js";
import { getDb } from "../db/client.js";

export function startPaperRecorder(bus: EventBus): void {
  const sql = getDb();
  if (!sql) {
    console.warn("[paper-recorder] DATABASE_URL not set, skipping");
    return;
  }

  bus.on("paper:open", async (event) => {
    try {
      await sql`
        INSERT INTO paper_trades (
          id, signal_id, coin, direction, entry_price,
          position_size_usd, quantity, status,
          tp_price, sl_price, signal_type, signal_confidence,
          max_close_at, opened_at, metadata
        ) VALUES (
          ${event.id}, ${event.signalId}, ${event.coin}, ${event.direction}, ${event.entryPrice},
          ${event.positionSizeUsd}, ${event.quantity}, ${"open"},
          ${event.tpPrice}, ${event.slPrice}, ${event.signalType}, ${event.signalConfidence},
          ${event.maxCloseAt.toISOString()}, ${event.openedAt.toISOString()}, ${JSON.stringify({})}
        )
      `;
      console.log(`[paper-recorder] inserted open trade ${event.id} ${event.coin}`);
    } catch (err) {
      console.error("[paper-recorder] insert failed:", err instanceof Error ? err.message : err);
    }
  });

  bus.on("paper:close", async (event) => {
    try {
      await sql`
        UPDATE paper_trades SET
          status = ${event.status},
          exit_price = ${event.exitPrice},
          pnl_usd = ${event.pnlUsd},
          pnl_pct = ${event.pnlPct},
          closed_at = ${event.closedAt.toISOString()}
        WHERE id = ${event.id}
      `;
      console.log(`[paper-recorder] closed trade ${event.id} status=${event.status} pnl=$${event.pnlUsd.toFixed(2)}`);
    } catch (err) {
      console.error("[paper-recorder] update failed:", err instanceof Error ? err.message : err);
    }
  });

  console.log("[paper-recorder] listening");
}
