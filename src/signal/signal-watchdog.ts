import type { EventBus } from "../events/bus.js";
import { getDb } from "../db/client.js";
import { notifyDiscord } from "../notify.js";

/**
 * Signal Watchdog: alerts Discord when no signal has been generated for
 * SILENCE_THRESHOLD_MS. Catches silent pipeline failures (e.g. the July 2026
 * incident where a price-descale fix left thresholds unreachable and signals
 * stopped for 6 days unnoticed).
 */

const CHECK_INTERVAL_MS = 60 * 60 * 1000; // hourly
const SILENCE_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours

export function startSignalWatchdog(bus: EventBus): () => void {
  // Baseline: process start. Replaced by DB max(detected_at) if available,
  // and by live signals thereafter.
  let lastSignalAt = Date.now();
  let lastAlertAt = 0;

  const sql = getDb();
  if (sql) {
    sql`SELECT max(detected_at) AS last FROM signals`
      .then((rows) => {
        const last = rows[0]?.last as string | Date | null;
        if (last) {
          const ts = new Date(last).getTime();
          if (ts < lastSignalAt) lastSignalAt = ts;
        }
      })
      .catch((err) => {
        console.error("[signal-watchdog] seed query failed:", err instanceof Error ? err.message : err);
      });
  }

  const onSignal = () => {
    lastSignalAt = Date.now();
  };
  bus.on("signal:detected", onSignal);

  const check = () => {
    const silenceMs = Date.now() - lastSignalAt;
    if (silenceMs < SILENCE_THRESHOLD_MS) return;
    // At most one alert per silence threshold period
    if (Date.now() - lastAlertAt < SILENCE_THRESHOLD_MS) return;
    lastAlertAt = Date.now();

    const hours = Math.round(silenceMs / 3_600_000);
    console.warn(`[signal-watchdog] no signals for ${hours}h — alerting`);
    notifyDiscord(
      `⚠️ **シグナル未検知アラート**: 直近${hours}時間、シグナルが1件も生成されていません。\n` +
        `閾値設定（FLOW_SHIFT_THRESHOLD_USD / minNotional）、監視ウォレットの活動、ストリーム接続を確認してください。`,
    ).catch((err) => {
      console.error("[signal-watchdog] alert failed:", err instanceof Error ? err.message : err);
    });
  };

  const interval = setInterval(check, CHECK_INTERVAL_MS);
  console.log(
    `[signal-watchdog] started (alert after ${SILENCE_THRESHOLD_MS / 3_600_000}h of silence, check every ${CHECK_INTERVAL_MS / 60_000}min)`,
  );

  return () => {
    clearInterval(interval);
    bus.off("signal:detected", onSignal);
    console.log("[signal-watchdog] stopped");
  };
}
