/**
 * Auto-Trade Recorder: persists trade executions and errors to the database.
 */
import type { EventBus } from "../events/bus.js";
import { getDb } from "../db/client.js";

export function startAutoTradeRecorder(bus: EventBus): void {
  const sql = getDb();
  if (!sql) {
    console.log("[auto-trade-recorder] skipped (no DATABASE_URL)");
    return;
  }

  bus.on("auto-trade:open", async (event) => {
    try {
      await sql`
        INSERT INTO auto_trades (
          id, exchange, signal_id, coin, direction, tx_hash,
          execution_price, quantity, margin, leverage,
          fee_recipient, signal_type, signal_confidence, opened_at
        ) VALUES (
          ${event.id}, ${event.exchange}, ${event.signalId}, ${event.coin}, ${event.direction}, ${event.txHash},
          ${event.executionPrice}, ${event.quantity}, ${event.margin}, ${event.leverage},
          ${event.feeRecipient}, ${event.signalType}, ${event.signalConfidence}, ${event.openedAt.toISOString()}
        )
      `;
    } catch (err) {
      console.error("[auto-trade-recorder] insert error:", err instanceof Error ? err.message : err);
    }
  });

  bus.on("auto-trade:error", async (event) => {
    try {
      await sql`
        INSERT INTO auto_trade_errors (
          signal_id, coin, direction, error, occurred_at
        ) VALUES (
          ${event.signalId}, ${event.coin}, ${event.direction}, ${event.error}, ${event.occurredAt.toISOString()}
        )
      `;
    } catch (err) {
      console.error("[auto-trade-recorder] error insert failed:", err instanceof Error ? err.message : err);
    }
  });

  console.log("[auto-trade-recorder] started");
}
