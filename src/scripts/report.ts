import { neon } from "@neondatabase/serverless";

/**
 * CLI report: signal + insight accuracy stats
 * Usage: npx tsx src/scripts/report.ts
 */

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }

  const sql = neon(url);

  console.log("=== Smart Money Signal Accuracy Report ===\n");

  // Signal accuracy by type
  const signalStats = await sql`
    SELECT
      s.type,
      so.check_delay_h,
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE so.direction_correct) as correct,
      ROUND(100.0 * COUNT(*) FILTER (WHERE so.direction_correct) / NULLIF(COUNT(*), 0), 1) as accuracy_pct,
      ROUND(AVG(ABS(so.price_change_pct)), 2) as avg_move_pct
    FROM signal_outcomes so
    JOIN signals s ON s.id = so.signal_id
    GROUP BY s.type, so.check_delay_h
    ORDER BY s.type, so.check_delay_h
  `;

  if (signalStats.length > 0) {
    console.log("--- Signal Accuracy by Type ---");
    console.log("Type           | Delay | Total | Correct | Accuracy | Avg Move");
    console.log("---------------|-------|-------|---------|----------|---------");
    for (const row of signalStats) {
      const type = String(row.type).padEnd(14);
      const delay = `${row.check_delay_h}h`.padEnd(5);
      const total = String(row.total).padEnd(5);
      const correct = String(row.correct).padEnd(7);
      const acc = `${row.accuracy_pct}%`.padEnd(8);
      const avg = `${row.avg_move_pct}%`;
      console.log(`${type} | ${delay} | ${total} | ${correct} | ${acc} | ${avg}`);
    }
  } else {
    console.log("No signal outcomes recorded yet.\n");
  }

  console.log("");

  // Insight accuracy
  const insightStats = await sql`
    SELECT
      io.check_delay_h,
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE io.direction_correct) as correct,
      ROUND(100.0 * COUNT(*) FILTER (WHERE io.direction_correct) / NULLIF(COUNT(*), 0), 1) as accuracy_pct,
      ROUND(AVG(ABS(io.price_change_pct)), 2) as avg_move_pct
    FROM insight_outcomes io
    GROUP BY io.check_delay_h
    ORDER BY io.check_delay_h
  `;

  if (insightStats.length > 0) {
    console.log("--- Insight Accuracy ---");
    console.log("Delay | Total | Correct | Accuracy | Avg Move");
    console.log("------|-------|---------|----------|---------");
    for (const row of insightStats) {
      const delay = `${row.check_delay_h}h`.padEnd(5);
      const total = String(row.total).padEnd(5);
      const correct = String(row.correct).padEnd(7);
      const acc = `${row.accuracy_pct}%`.padEnd(8);
      const avg = `${row.avg_move_pct}%`;
      console.log(`${delay} | ${total} | ${correct} | ${acc} | ${avg}`);
    }
  } else {
    console.log("No insight outcomes recorded yet.\n");
  }

  console.log("");

  // Recent signals
  const recentSignals = await sql`
    SELECT id, type, coin, direction, confidence, detected_at
    FROM signals
    ORDER BY detected_at DESC
    LIMIT 10
  `;

  if (recentSignals.length > 0) {
    console.log("--- Recent Signals (last 10) ---");
    for (const s of recentSignals) {
      const ts = new Date(s.detected_at as string).toISOString().slice(0, 19);
      console.log(
        `  ${ts} | ${s.type} | ${s.coin} ${s.direction} | confidence=${s.confidence}`,
      );
    }
  }

  console.log("\n=== End of Report ===");
}

main().catch((err) => {
  console.error("Report error:", err);
  process.exit(1);
});
