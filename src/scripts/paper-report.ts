import { neon } from "@neondatabase/serverless";

/**
 * CLI report: paper trade performance stats
 * Usage: npx tsx src/scripts/paper-report.ts
 */

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }

  const sql = neon(url);

  console.log("=== Paper Trade Performance Report ===\n");

  // ── Overall stats ──
  const overall = await sql`
    SELECT
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE status != 'open') as closed,
      COUNT(*) FILTER (WHERE status = 'open') as open,
      COUNT(*) FILTER (WHERE status = 'closed_tp') as wins,
      COUNT(*) FILTER (WHERE status = 'closed_sl') as losses,
      COUNT(*) FILTER (WHERE status = 'closed_timeout') as timeouts,
      COALESCE(SUM(pnl_usd) FILTER (WHERE status != 'open'), 0) as total_pnl_usd,
      COALESCE(ROUND(AVG(pnl_pct) FILTER (WHERE status != 'open'), 2), 0) as avg_pnl_pct,
      COALESCE(ROUND(MAX(pnl_pct) FILTER (WHERE status != 'open'), 2), 0) as best_pct,
      COALESCE(ROUND(MIN(pnl_pct) FILTER (WHERE status != 'open'), 2), 0) as worst_pct
    FROM paper_trades
  `;

  const o = overall[0]!;
  const closedCount = Number(o.closed);
  const winCount = Number(o.wins);
  const winRate = closedCount > 0 ? ((winCount / closedCount) * 100).toFixed(1) : "N/A";

  console.log("--- Overall ---");
  console.log(`  Total trades:   ${o.total} (open: ${o.open}, closed: ${o.closed})`);
  console.log(`  Win/Loss/TO:    ${o.wins}W / ${o.losses}L / ${o.timeouts}TO`);
  console.log(`  Win rate:       ${winRate}%`);
  console.log(`  Total P&L:      $${Number(o.total_pnl_usd).toFixed(2)}`);
  console.log(`  Avg P&L:        ${o.avg_pnl_pct}%`);
  console.log(`  Best trade:     ${o.best_pct}%`);
  console.log(`  Worst trade:    ${o.worst_pct}%`);

  console.log("");

  // ── Per-coin breakdown ──
  const byCoin = await sql`
    SELECT
      coin,
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE status = 'open') as open,
      COUNT(*) FILTER (WHERE status = 'closed_tp') as wins,
      COUNT(*) FILTER (WHERE status = 'closed_sl') as losses,
      COUNT(*) FILTER (WHERE status = 'closed_timeout') as timeouts,
      COALESCE(SUM(pnl_usd) FILTER (WHERE status != 'open'), 0) as total_pnl_usd,
      COALESCE(ROUND(AVG(pnl_pct) FILTER (WHERE status != 'open'), 2), 0) as avg_pnl_pct
    FROM paper_trades
    GROUP BY coin
    ORDER BY coin
  `;

  if (byCoin.length > 0) {
    console.log("--- By Coin ---");
    console.log("Coin | Total | Open | W/L/TO      | Win Rate | Total P&L  | Avg P&L");
    console.log("-----|-------|------|-------------|----------|------------|--------");
    for (const row of byCoin) {
      const closed = Number(row.total) - Number(row.open);
      const wr = closed > 0 ? `${((Number(row.wins) / closed) * 100).toFixed(0)}%` : "N/A";
      const coin = String(row.coin).padEnd(4);
      const total = String(row.total).padEnd(5);
      const open = String(row.open).padEnd(4);
      const wlt = `${row.wins}W/${row.losses}L/${row.timeouts}TO`.padEnd(11);
      const pnl = `$${Number(row.total_pnl_usd).toFixed(2)}`.padEnd(10);
      const avg = `${row.avg_pnl_pct}%`;
      console.log(`${coin} | ${total} | ${open} | ${wlt} | ${wr.padEnd(8)} | ${pnl} | ${avg}`);
    }
  }

  console.log("");

  // ── By signal type ──
  const bySignal = await sql`
    SELECT
      signal_type,
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE status = 'closed_tp') as wins,
      COUNT(*) FILTER (WHERE status = 'closed_sl') as losses,
      COUNT(*) FILTER (WHERE status = 'closed_timeout') as timeouts,
      COALESCE(SUM(pnl_usd) FILTER (WHERE status != 'open'), 0) as total_pnl_usd,
      COALESCE(ROUND(AVG(pnl_pct) FILTER (WHERE status != 'open'), 2), 0) as avg_pnl_pct,
      COALESCE(ROUND(AVG(signal_confidence), 3), 0) as avg_confidence
    FROM paper_trades
    GROUP BY signal_type
    ORDER BY signal_type
  `;

  if (bySignal.length > 0) {
    console.log("--- By Signal Type ---");
    console.log("Signal Type  | Total | W/L/TO      | Total P&L  | Avg P&L | Avg Conf");
    console.log("-------------|-------|-------------|------------|---------|----------");
    for (const row of bySignal) {
      const type = String(row.signal_type).padEnd(12);
      const total = String(row.total).padEnd(5);
      const wlt = `${row.wins}W/${row.losses}L/${row.timeouts}TO`.padEnd(11);
      const pnl = `$${Number(row.total_pnl_usd).toFixed(2)}`.padEnd(10);
      const avg = `${row.avg_pnl_pct}%`.padEnd(7);
      const conf = `${(Number(row.avg_confidence) * 100).toFixed(0)}%`;
      console.log(`${type} | ${total} | ${wlt} | ${pnl} | ${avg} | ${conf}`);
    }
  }

  console.log("");

  // ── Recent trades ──
  const recent = await sql`
    SELECT id, coin, direction, signal_type, entry_price, exit_price,
           status, pnl_usd, pnl_pct, signal_confidence, opened_at, closed_at
    FROM paper_trades
    ORDER BY opened_at DESC
    LIMIT 10
  `;

  if (recent.length > 0) {
    console.log("--- Recent Trades (last 10) ---");
    for (const t of recent) {
      const ts = new Date(t.opened_at as string).toISOString().slice(0, 16);
      const dir = t.direction === "long" ? "LONG " : "SHORT";
      const status = String(t.status).replace("closed_", "");

      let pnlStr = "";
      if (t.status !== "open") {
        const sign = Number(t.pnl_usd) >= 0 ? "+" : "";
        pnlStr = `${sign}$${Number(t.pnl_usd).toFixed(2)} (${sign}${Number(t.pnl_pct).toFixed(2)}%)`;
      } else {
        pnlStr = "(open)";
      }

      console.log(
        `  ${ts} | ${t.coin} ${dir} | ${t.signal_type} | ` +
        `entry=$${Number(t.entry_price).toFixed(2)} | ${status} | ${pnlStr}`,
      );
    }
  } else {
    console.log("No paper trades recorded yet.");
  }

  console.log("\n=== End of Report ===");
}

main().catch((err) => {
  console.error("Report error:", err);
  process.exit(1);
});
