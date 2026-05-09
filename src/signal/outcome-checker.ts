import { getDb } from "../db/client.js";
import { getPrice } from "./price-cache.js";

/**
 * Outcome Checker: periodically checks unchecked signals and insights
 * against current prices at 1h, 4h, 24h intervals.
 */

const CHECK_DELAYS_H = [1, 4, 24];
const CHECK_INTERVAL_MS = 5 * 60 * 1000; // every 5 minutes

export function startOutcomeChecker(): (() => void) | null {
  const sql = getDb();
  if (!sql) {
    console.warn("[outcome-checker] DB not available — skipping");
    return null;
  }

  const interval = setInterval(() => {
    checkSignalOutcomes(sql).catch((err) => {
      console.error("[outcome-checker] signal check error:", err);
    });
    checkInsightOutcomes(sql).catch((err) => {
      console.error("[outcome-checker] insight check error:", err);
    });
  }, CHECK_INTERVAL_MS);

  console.log("[outcome-checker] started (interval: 5min)");

  return () => {
    clearInterval(interval);
    console.log("[outcome-checker] stopped");
  };
}

async function checkSignalOutcomes(sql: ReturnType<typeof getDb> & {}): Promise<void> {
  for (const delayH of CHECK_DELAYS_H) {
    // Find signals that are old enough and don't yet have an outcome for this delay
    const signals = await sql`
      SELECT s.id, s.coin, s.direction, s.price_at_signal, s.detected_at
      FROM signals s
      WHERE s.detected_at <= now() - make_interval(hours => ${delayH})
        AND NOT EXISTS (
          SELECT 1 FROM signal_outcomes so
          WHERE so.signal_id = s.id AND so.check_delay_h = ${delayH}
        )
      ORDER BY s.detected_at DESC
      LIMIT 50
    `;

    for (const sig of signals) {
      const currentPrice = getPrice(sig.coin as string);
      if (currentPrice === null) continue;

      const priceAtSignal = Number(sig.price_at_signal);
      const changePercent = ((currentPrice - priceAtSignal) / priceAtSignal) * 100;
      const directionCorrect =
        (sig.direction === "long" && currentPrice > priceAtSignal) ||
        (sig.direction === "short" && currentPrice < priceAtSignal);

      await sql`
        INSERT INTO signal_outcomes (signal_id, check_delay_h, price_at_check, price_change_pct, direction_correct)
        VALUES (${sig.id as string}, ${delayH}, ${currentPrice}, ${Math.round(changePercent * 10000) / 10000}, ${directionCorrect})
        ON CONFLICT (signal_id, check_delay_h) DO NOTHING
      `;

      console.log(
        `[outcome-checker] signal ${sig.id} @${delayH}h: ${changePercent > 0 ? "+" : ""}${changePercent.toFixed(2)}% correct=${directionCorrect}`,
      );
    }
  }
}

async function checkInsightOutcomes(sql: ReturnType<typeof getDb> & {}): Promise<void> {
  for (const delayH of CHECK_DELAYS_H) {
    const insights = await sql`
      SELECT i.id, i.coin, i.direction, i.price_at_insight, i.generated_at
      FROM insights i
      WHERE i.generated_at <= now() - make_interval(hours => ${delayH})
        AND NOT EXISTS (
          SELECT 1 FROM insight_outcomes io
          WHERE io.insight_id = i.id AND io.check_delay_h = ${delayH}
        )
      ORDER BY i.generated_at DESC
      LIMIT 50
    `;

    for (const ins of insights) {
      const currentPrice = getPrice(ins.coin as string);
      if (currentPrice === null) continue;

      const priceAtInsight = Number(ins.price_at_insight);
      const changePercent = ((currentPrice - priceAtInsight) / priceAtInsight) * 100;
      const directionCorrect =
        (ins.direction === "long" && currentPrice > priceAtInsight) ||
        (ins.direction === "short" && currentPrice < priceAtInsight);

      await sql`
        INSERT INTO insight_outcomes (insight_id, check_delay_h, price_at_check, price_change_pct, direction_correct)
        VALUES (${ins.id as string}, ${delayH}, ${currentPrice}, ${Math.round(changePercent * 10000) / 10000}, ${directionCorrect})
        ON CONFLICT (insight_id, check_delay_h) DO NOTHING
      `;

      console.log(
        `[outcome-checker] insight ${ins.id} @${delayH}h: ${changePercent > 0 ? "+" : ""}${changePercent.toFixed(2)}% correct=${directionCorrect}`,
      );
    }
  }
}
