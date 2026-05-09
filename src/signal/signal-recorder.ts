import type { EventBus, SignalDetectedEvent } from "../events/bus.js";
import { getDb } from "../db/client.js";

export function startSignalRecorder(bus: EventBus): void {
  const sql = getDb();
  if (!sql) {
    console.warn("[signal-recorder] DB not available — skipping signal recording");
    return;
  }

  bus.on("signal:detected", (signal: SignalDetectedEvent) => {
    sql`
      INSERT INTO signals (
        id, type, coin, direction, confidence,
        trigger_fill_ids, wallet_labels,
        price_at_signal, metadata, detected_at
      ) VALUES (
        ${signal.id}, ${signal.type}, ${signal.coin}, ${signal.direction},
        ${signal.confidence}, ${signal.triggerFillIds}, ${signal.walletLabels},
        ${signal.priceAtSignal}, ${JSON.stringify(signal.metadata)},
        ${signal.detectedAt.toISOString()}
      )
      ON CONFLICT (id) DO NOTHING
    `
      .then(() => {
        console.log(`[signal-recorder] saved signal ${signal.id}`);
      })
      .catch((err) => {
        console.error("[signal-recorder] insert error:", err);
      });
  });

  console.log("[signal-recorder] listening for signal:detected events");
}
