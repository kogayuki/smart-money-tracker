import { createServer } from "node:http";
import { notifyDiscord } from "./notify.js";
import { loadWallets } from "./wallets/load.js";
import { startMonitor } from "./monitor.js";

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

  // Load active wallets and start WebSocket monitor
  const { wallets, defaultMinNotionalUsd } = await loadWallets({ onlyActive: true });
  console.log(`[boot] loaded ${wallets.length} active wallet(s)`);

  const cleanupMonitor = await startMonitor(wallets, { defaultMinNotionalUsd });

  const heartbeat = setInterval(() => {
    console.log(`[hb] alive ${new Date().toISOString()}`);
  }, 60_000);

  const shutdown = async (signal: string) => {
    console.log(`[shutdown] received ${signal}`);
    clearInterval(heartbeat);
    await cleanupMonitor();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  console.error("[fatal]", err);
  process.exit(1);
});
