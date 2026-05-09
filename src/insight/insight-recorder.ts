import type { EventBus, InsightGeneratedEvent } from "../events/bus.js";
import { getDb } from "../db/client.js";

export function startInsightRecorder(bus: EventBus): void {
  const sql = getDb();
  if (!sql) {
    console.warn("[insight-recorder] DB not available — skipping insight recording");
    return;
  }

  bus.on("insight:generated", (insight: InsightGeneratedEvent) => {
    sql`
      INSERT INTO insights (
        id, coin, direction, summary, signal_ids, pm_market_ids,
        sm_confidence, pm_sentiment, combined_score,
        price_at_insight, metadata, generated_at
      ) VALUES (
        ${insight.id}, ${insight.coin}, ${insight.direction},
        ${insight.summary}, ${insight.signalIds}, ${insight.pmMarketIds},
        ${insight.smConfidence}, ${insight.pmSentiment},
        ${insight.combinedScore}, ${insight.priceAtInsight},
        ${JSON.stringify(insight.metadata)}, ${insight.generatedAt.toISOString()}
      )
      ON CONFLICT (id) DO NOTHING
    `
      .then(() => {
        console.log(`[insight-recorder] saved insight ${insight.id}`);
      })
      .catch((err) => {
        console.error("[insight-recorder] insert error:", err);
      });
  });

  console.log("[insight-recorder] listening for insight:generated events");
}
