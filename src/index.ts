import { request } from "undici";

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const NODE_ENV = process.env.NODE_ENV ?? "development";

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

async function main(): Promise<void> {
  const startedAt = new Date().toISOString();
  console.log(`[boot] smart-money-tracker started env=${NODE_ENV} at=${startedAt}`);
  await notifyDiscord(`Hello from Fly.io — smart-money-tracker booted at ${startedAt}`);
  console.log("[boot] notify ok, entering idle loop");

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
