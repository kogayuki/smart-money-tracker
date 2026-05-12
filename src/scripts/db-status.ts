import { neon } from "@neondatabase/serverless";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) { console.error("DATABASE_URL required"); process.exit(1); }

  const sql = neon(url);

  const fills = await sql`SELECT COUNT(*) as count FROM sm_fills`;
  const signals = await sql`SELECT COUNT(*) as count FROM signals`;
  const insights = await sql`SELECT COUNT(*) as count FROM insights`;
  const sigOutcomes = await sql`SELECT COUNT(*) as count FROM signal_outcomes`;
  const insOutcomes = await sql`SELECT COUNT(*) as count FROM insight_outcomes`;
  const pmMarkets = await sql`SELECT COUNT(*) as count FROM pm_markets`;
  const pmSnaps = await sql`SELECT COUNT(*) as count FROM pm_snapshots`;

  console.log("=== DB Status ===");
  console.log(`sm_fills:         ${fills[0]?.count}`);
  console.log(`signals:          ${signals[0]?.count}`);
  console.log(`insights:         ${insights[0]?.count}`);
  console.log(`signal_outcomes:  ${sigOutcomes[0]?.count}`);
  console.log(`insight_outcomes: ${insOutcomes[0]?.count}`);
  console.log(`pm_markets:       ${pmMarkets[0]?.count}`);
  console.log(`pm_snapshots:     ${pmSnaps[0]?.count}`);

  // Recent fills
  const recentFills = await sql`
    SELECT wallet_label, coin, side, notional_usd, time_ms
    FROM sm_fills ORDER BY time_ms DESC LIMIT 10
  `;
  if (recentFills.length > 0) {
    console.log("\n--- Recent Fills (last 10) ---");
    for (const f of recentFills) {
      const ts = new Date(Number(f.time_ms)).toISOString().slice(0, 19);
      const dir = f.side === "B" ? "LONG" : "SHORT";
      console.log(`  ${ts} | ${f.wallet_label} | ${dir} ${f.coin} | $${Number(f.notional_usd).toLocaleString()}`);
    }
  }

  // Recent signals
  const recentSignals = await sql`
    SELECT id, type, coin, direction, confidence, detected_at
    FROM signals ORDER BY detected_at DESC LIMIT 10
  `;
  if (recentSignals.length > 0) {
    console.log("\n--- Recent Signals (last 10) ---");
    for (const s of recentSignals) {
      const ts = new Date(s.detected_at as string).toISOString().slice(0, 19);
      console.log(`  ${ts} | ${s.type} | ${s.coin} ${s.direction} | conf=${s.confidence}`);
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
