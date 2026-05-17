import { getDb } from "../db/client.js";
import { notifyDiscord } from "../notify.js";

const REPORT_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h

type DiscordField = { name: string; value: string; inline?: boolean };

export function startDailyReport(): () => void {
  const sql = getDb();
  if (!sql) {
    console.warn("[daily-report] DATABASE_URL not set, skipping");
    return () => {};
  }

  // First report 1 minute after boot, then every 24h
  const initialTimeout = setTimeout(() => {
    void sendReport(sql);
  }, 60_000);

  const interval = setInterval(() => void sendReport(sql), REPORT_INTERVAL_MS);
  console.log("[daily-report] started (24h interval)");

  return () => {
    clearTimeout(initialTimeout);
    clearInterval(interval);
    console.log("[daily-report] stopped");
  };
}

async function sendReport(sql: NonNullable<ReturnType<typeof getDb>>): Promise<void> {
  try {
    const overall = await sql`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status != 'open') as closed,
        COUNT(*) FILTER (WHERE status = 'open') as open,
        COUNT(*) FILTER (WHERE status = 'closed_tp') as wins,
        COUNT(*) FILTER (WHERE status = 'closed_sl') as losses,
        COUNT(*) FILTER (WHERE status = 'closed_timeout') as timeouts,
        COALESCE(SUM(pnl_usd) FILTER (WHERE status != 'open'), 0) as total_pnl_usd,
        COALESCE(ROUND(AVG(pnl_pct) FILTER (WHERE status != 'open'), 2), 0) as avg_pnl_pct
      FROM paper_trades
    `;

    const last24h = await sql`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'closed_tp') as wins,
        COUNT(*) FILTER (WHERE status = 'closed_sl') as losses,
        COUNT(*) FILTER (WHERE status = 'closed_timeout') as timeouts,
        COALESCE(SUM(pnl_usd) FILTER (WHERE status != 'open'), 0) as pnl_usd
      FROM paper_trades
      WHERE closed_at >= now() - interval '24 hours'
    `;

    const byCoin = await sql`
      SELECT
        coin,
        COUNT(*) FILTER (WHERE status = 'closed_tp') as wins,
        COUNT(*) FILTER (WHERE status = 'closed_sl') as losses,
        COUNT(*) FILTER (WHERE status = 'closed_timeout') as timeouts,
        COUNT(*) FILTER (WHERE status = 'open') as open,
        COALESCE(SUM(pnl_usd) FILTER (WHERE status != 'open'), 0) as total_pnl_usd
      FROM paper_trades
      GROUP BY coin
      ORDER BY coin
    `;

    const o = overall[0]!;
    const d = last24h[0]!;
    const closedCount = Number(o.closed);
    const winRate = closedCount > 0
      ? `${((Number(o.wins) / closedCount) * 100).toFixed(1)}%`
      : "-";

    const totalPnl = Number(o.total_pnl_usd);
    const pnlSign = totalPnl >= 0 ? "+" : "";
    const dayPnl = Number(d.pnl_usd);
    const daySign = dayPnl >= 0 ? "+" : "";
    const dayTotal = Number(d.total);

    const fields: DiscordField[] = [
      { name: "累計トレード", value: `${o.total}件 (決済: ${o.closed})`, inline: true },
      { name: "勝率", value: winRate, inline: true },
      { name: "累計損益", value: `${pnlSign}$${totalPnl.toFixed(2)}`, inline: true },
      { name: "直近24h", value: dayTotal > 0 ? `${d.wins}勝/${d.losses}敗/${d.timeouts}TO (${daySign}$${dayPnl.toFixed(2)})` : "決済なし", inline: true },
      { name: "オープン", value: `${o.open}件`, inline: true },
      { name: "平均損益", value: `${o.avg_pnl_pct}%`, inline: true },
    ];

    // Coin breakdown
    if (byCoin.length > 0) {
      const coinLines = byCoin.map((row) => {
        const pnl = Number(row.total_pnl_usd);
        const sign = pnl >= 0 ? "+" : "";
        const open = Number(row.open) > 0 ? ` (${row.open}件オープン)` : "";
        return `**${row.coin}**: ${row.wins}勝/${row.losses}敗/${row.timeouts}TO → ${sign}$${pnl.toFixed(2)}${open}`;
      });
      fields.push({ name: "コイン別", value: coinLines.join("\n"), inline: false });
    }

    const color = totalPnl >= 0 ? 0x4caf50 : 0xf44336;

    await notifyDiscord({
      embeds: [
        {
          title: "\uD83D\uDCCB \u30DA\u30FC\u30D1\u30FC\u30C8\u30EC\u30FC\u30C9 \u65E5\u6B21\u30EC\u30DD\u30FC\u30C8",
          color,
          fields,
          timestamp: new Date().toISOString(),
          footer: { text: "\u26A0\uFE0F \u30DA\u30FC\u30D1\u30FC\u30C8\u30EC\u30FC\u30C9\uFF08\u4EEE\u60F3\u53D6\u5F15\uFF09 | Smart Money Tracker" },
        },
      ],
    });

    console.log("[daily-report] sent to Discord");
  } catch (err) {
    console.error("[daily-report] failed:", err instanceof Error ? err.message : err);
  }
}
