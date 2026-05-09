import type { EventBus, InsightGeneratedEvent } from "../events/bus.js";
import { notifyDiscord, buildInsightEmbed } from "../notify.js";

const DISCORD_SIGNAL_WEBHOOK_URL = process.env.DISCORD_SIGNAL_WEBHOOK_URL;

export function startInsightNotifier(bus: EventBus): void {
  bus.on("insight:generated", (insight: InsightGeneratedEvent) => {
    const embed = buildInsightEmbed(insight);

    // Send to signal webhook if configured, otherwise default
    if (DISCORD_SIGNAL_WEBHOOK_URL) {
      import("undici").then(({ request }) =>
        request(DISCORD_SIGNAL_WEBHOOK_URL, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(embed),
        }),
      ).catch((err) => {
        console.error("[insight-notifier] signal webhook error:", err);
      });
    } else {
      notifyDiscord(embed).catch((err) => {
        console.error("[insight-notifier] Discord notify error:", err);
      });
    }
  });

  console.log("[insight-notifier] listening for insight:generated events");
}
