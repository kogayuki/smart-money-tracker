import { neon } from "@neondatabase/serverless";

/**
 * CLI report: paper trade performance stats
 * Usage: npx tsx src/scripts/paper-report.ts
 */

const DIR_JA: Record<string, string> = { long: "ロング", short: "ショート" };
const STATUS_JA: Record<string, string> = {
  open: "オープン",
  closed_tp: "利確",
  closed_sl: "損切",
  closed_timeout: "タイムアウト",
};

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }

  const sql = neon(url);

  console.log("╔══════════════════════════════════════════╗");
  console.log("║   ペーパートレード パフォーマンスレポート   ║");
  console.log("╚══════════════════════════════════════════╝\n");

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
  const winRate = closedCount > 0 ? ((winCount / closedCount) * 100).toFixed(1) : "-";

  console.log("── 全体サマリー ──");
  console.log(`  トレード数:     ${o.total} (オープン: ${o.open} / 決済済: ${o.closed})`);
  console.log(`  勝敗:           ${o.wins}勝 / ${o.losses}敗 / ${o.timeouts}タイムアウト`);
  console.log(`  勝率:           ${winRate}%`);
  console.log(`  累計損益:       $${Number(o.total_pnl_usd).toFixed(2)}`);
  console.log(`  平均損益:       ${o.avg_pnl_pct}%`);
  console.log(`  最高収益:       ${o.best_pct}%`);
  console.log(`  最大損失:       ${o.worst_pct}%`);

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
    console.log("── コイン別成績 ──");
    console.log("コイン | 合計 | 未決済 | 勝/敗/TO    | 勝率     | 累計損益   | 平均損益");
    console.log("-------|------|--------|-------------|----------|-----------|--------");
    for (const row of byCoin) {
      const closed = Number(row.total) - Number(row.open);
      const wr = closed > 0 ? `${((Number(row.wins) / closed) * 100).toFixed(0)}%` : "-";
      const coin = String(row.coin).padEnd(5);
      const total = String(row.total).padEnd(4);
      const open = String(row.open).padEnd(6);
      const wlt = `${row.wins}勝/${row.losses}敗/${row.timeouts}TO`.padEnd(11);
      const pnl = `$${Number(row.total_pnl_usd).toFixed(2)}`.padEnd(9);
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
    console.log("── シグナル種別 ──");
    console.log("シグナル     | 合計 | 勝/敗/TO    | 累計損益   | 平均損益 | 平均確信度");
    console.log("-------------|------|-------------|-----------|---------|----------");
    for (const row of bySignal) {
      const type = String(row.signal_type).padEnd(12);
      const total = String(row.total).padEnd(4);
      const wlt = `${row.wins}勝/${row.losses}敗/${row.timeouts}TO`.padEnd(11);
      const pnl = `$${Number(row.total_pnl_usd).toFixed(2)}`.padEnd(9);
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
    console.log("── 直近トレード (最大10件) ──");
    for (const t of recent) {
      const ts = new Date(t.opened_at as string).toLocaleString("ja-JP", {
        timeZone: "Asia/Tokyo",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
      const dir = DIR_JA[t.direction as string] ?? t.direction;
      const status = STATUS_JA[t.status as string] ?? t.status;

      let pnlStr = "";
      if (t.status !== "open") {
        const sign = Number(t.pnl_usd) >= 0 ? "+" : "";
        pnlStr = `${sign}$${Number(t.pnl_usd).toFixed(2)} (${sign}${Number(t.pnl_pct).toFixed(2)}%)`;
      } else {
        pnlStr = "-";
      }

      console.log(
        `  ${ts} | ${t.coin} ${dir} | ${t.signal_type} | ` +
        `$${Number(t.entry_price).toFixed(2)} | ${status} | ${pnlStr}`,
      );
    }
  } else {
    console.log("まだトレード記録がありません。");
  }

  console.log("\n══ レポート終了 ══");
}

main().catch((err) => {
  console.error("レポートエラー:", err);
  process.exit(1);
});
