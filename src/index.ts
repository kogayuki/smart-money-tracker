import { createServer } from "node:http";
import { request } from "undici";

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const NODE_ENV = process.env.NODE_ENV ?? "development";
const PORT = Number(process.env.PORT ?? 3000);

const startedAt = new Date();

async function notifyDiscord(content: string): Promise<void> {
  if (!DISCORD_WEBHOOK_URL) {
    console.warn("[notify] DISCORD_WEBHOOK_URL not set, skipping");
    return;
  }
  const res = await request(DISCORD_WEBHOOK_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content }),
  });
  if (res.statusCode >= 300) {
    const body = await res.body.text();
    throw new Error(`Discord webhook ${res.statusCode}: ${body}`);
  }
}

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
  await notifyDiscord(`Hello from Fly.io — smart-money-tracker booted at ${startedAt.toISOString()}`);
  console.log("[boot] notify ok, entering heartbeat loop");

  const heartbeat = setInterval(() => {
    console.log(`[hb] alive ${new Date().toISOString()}`);
  }, 60_000);

  const shutdown = (signal: string) => {
    console.log(`[shutdown] received ${signal}`);
    clearInterval(heartbeat);
    process.exit(0);
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  console.error("[fatal]", err);
  process.exit(1);
});
