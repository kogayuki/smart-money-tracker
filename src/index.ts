import { createServer } from "node:http";
import { notifyDiscord } from "./notify.js";
import { loadWallets } from "./wallets/load.js";
import { startHyperliquidMonitor } from "./exchanges/hyperliquid.js";
import { startHelixMonitor } from "./exchanges/helix/monitor.js";
import { EventBus } from "./events/bus.js";
import { getDb } from "./db/client.js";
import { runMigrations } from "./db/migrate.js";
import { startFillRecorder } from "./recorder/fill-recorder.js";
import { startFillNotifier } from "./listeners/fill-notifier.js";
import { startSignalDetector } from "./signal/detector.js";
import { startSignalRecorder } from "./signal/signal-recorder.js";
import { startSignalWatchdog } from "./signal/signal-watchdog.js";
import { startGrvtGeoProbe } from "./listeners/grvt-geo-probe.js";
import { startSignalNotifier } from "./signal/signal-notifier.js";
import { startPriceCache } from "./signal/price-cache.js";
import { startOutcomeChecker } from "./signal/outcome-checker.js";
import { PolymarketPoller } from "./polymarket/poller.js";
import { startInsightGenerator } from "./insight/generator.js";
import { startInsightRecorder } from "./insight/insight-recorder.js";
import { startInsightNotifier } from "./insight/insight-notifier.js";
import { startPaperEngine } from "./paper/engine.js";
import { startPaperRecorder } from "./paper/recorder.js";
import { startPaperNotifier } from "./paper/notifier.js";
import { startPaperChecker } from "./paper/checker.js";
import { startDailyReport } from "./paper/daily-report.js";
import { startAutoTrader } from "./auto-trader/engine.js";
import { startAutoTradeChecker } from "./auto-trader/checker.js";
import { startAutoTradeNotifier } from "./auto-trader/notifier.js";
import { startAutoTradeRecorder } from "./auto-trader/recorder.js";
import { startContextCollector } from "./signal/context-collector.js";

const NODE_ENV = process.env.NODE_ENV ?? "development";
const PORT = Number(process.env.PORT ?? 3000);

const startedAt = new Date();

function startHealthServer(): void {
  const server = createServer((req, res) => {
    if (req.url === "/health" || req.url === "/") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          ok: true,
          uptime_s: Math.round((Date.now() - startedAt.getTime()) / 1000),
          started_at: startedAt.toISOString(),
        }),
      );
      return;
    }
    res.writeHead(404).end();
  });
  server.listen(PORT, () => {
    console.log(`[http] health server listening on :${PORT}`);
  });
}

async function main(): Promise<void> {
  console.log(`[boot] smart-money-tracker started env=${NODE_ENV} at=${startedAt.toISOString()}`);
  startHealthServer();
  await notifyDiscord(`smart-money-tracker booted at ${startedAt.toISOString()}`);
  console.log("[boot] notify ok");

  // ── DB setup (optional — graceful if DATABASE_URL not set or quota exceeded) ──
  const sql = getDb();
  if (sql) {
    try {
      await runMigrations(sql);
      console.log("[boot] migrations complete");
    } catch (err) {
      console.error("[boot] DB migration failed — continuing without DB:", err instanceof Error ? err.message : err);
    }
  }

  // ── EventBus ──
  const bus = new EventBus();

  // ── Listeners: fill events ──
  startFillNotifier(bus);   // sm:fill → Discord (preserves existing behavior)
  startFillRecorder(bus);   // sm:fill → DB

  // ── Signal detection ──
  const cleanupDetector = startSignalDetector(bus);
  startSignalRecorder(bus);   // signal:detected → DB
  startSignalNotifier(bus);   // signal:detected → Discord
  startContextCollector(bus); // signal:detected → FR/OI/volume snapshot
  const cleanupSignalWatchdog = startSignalWatchdog(bus); // 24h silence → Discord alert
  const cleanupGrvtGeoProbe = startGrvtGeoProbe(); // hourly GRVT access check → Discord on recovery

  // ── Price cache (for outcome checking + future use) ──
  const cleanupPriceCache = await startPriceCache();

  // ── Polymarket poller ──
  const poller = new PolymarketPoller();
  await poller.start();

  // ── Insight generation ──
  startInsightGenerator(bus, poller);
  startInsightRecorder(bus);   // insight:generated → DB
  startInsightNotifier(bus);   // insight:generated → Discord

  // ── Outcome tracking ──
  const cleanupOutcomeChecker = startOutcomeChecker();

  // ── Paper trading ──
  await startPaperEngine(bus);
  startPaperRecorder(bus);
  startPaperNotifier(bus);
  const cleanupPaperChecker = startPaperChecker(bus);
  const cleanupDailyReport = startDailyReport();

  // ── Auto trading (Hyperliquid live trades) ──
  await startAutoTrader(bus);
  const cleanupAutoChecker = startAutoTradeChecker(bus);
  startAutoTradeNotifier(bus);
  startAutoTradeRecorder(bus);

  // ── Load active wallets and start exchange monitors ──
  const { wallets, defaultMinNotionalUsd } = await loadWallets({ onlyActive: true });
  console.log(`[boot] loaded ${wallets.length} active wallet(s)`);

  const hlWallets = wallets.filter((w) => w.exchange === "hyperliquid");
  const helixWallets = wallets.filter((w) => w.exchange === "helix");

  console.log(`[boot] Hyperliquid: ${hlWallets.length}, Helix: ${helixWallets.length}`);

  const monitorConfig = { defaultMinNotionalUsd };
  const cleanupHl = await startHyperliquidMonitor(hlWallets, monitorConfig, bus);
  const cleanupHelix = await startHelixMonitor(helixWallets, monitorConfig, bus);

  console.log("[boot] all systems online");

  const heartbeat = setInterval(() => {
    console.log(`[hb] alive ${new Date().toISOString()}`);
  }, 60_000);

  const shutdown = async (signal: string) => {
    console.log(`[shutdown] received ${signal}`);
    clearInterval(heartbeat);
    cleanupDetector();
    cleanupSignalWatchdog();
    cleanupGrvtGeoProbe();
    cleanupOutcomeChecker?.();
    cleanupPaperChecker();
    cleanupAutoChecker();
    cleanupDailyReport();
    await poller.stop();
    await cleanupPriceCache();
    await cleanupHl();
    await cleanupHelix();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  console.error("[fatal]", err);
  process.exit(1);
});
