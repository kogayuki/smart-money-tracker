import type { EventBus, SignalDetectedEvent } from "../events/bus.js";
import { notifyDiscord, buildSignalEmbed } from "../notify.js";

const DISCORD_SIGNAL_WEBHOOK_URL = process.env.DISCORD_SIGNAL_WEBHOOK_URL;

export function startSignalNotifier(bus: EventBus): void {
  bus.on("signal:detected", (signal: SignalDetectedEvent) => {
    const embed = buildSignalEmbed(signal);

    // Send to signal-specific webhook if configured, otherwise default webhook
    const webhookUrl = DISCORD_SIGNAL_WEBHOOK_URL;
    if (webhookUrl) {
      import("undici").then(({ request }) =>
        request(webhookUrl, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(embed),
        }),
      ).catch((err) => {
        console.error("[signal-notifier] signal webhook error:", err);
      });
    } else {
      notifyDiscord(embed).catch((err) => {
        console.error("[signal-notifier] Discord notify error:", err);
      });
    }
  });

  console.log("[signal-notifier] listening for signal:detected events");
}
