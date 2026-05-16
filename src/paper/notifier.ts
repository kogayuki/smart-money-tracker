import type { EventBus } from "../events/bus.js";
import { notifyDiscord, buildPaperOpenEmbed, buildPaperCloseEmbed } from "../notify.js";

export function startPaperNotifier(bus: EventBus): void {
  bus.on("paper:open", async (event) => {
    try {
      const payload = buildPaperOpenEmbed(event);
      await notifyDiscord(payload);
    } catch (err) {
      console.error("[paper-notifier] open notification failed:", err instanceof Error ? err.message : err);
    }
  });

  bus.on("paper:close", async (event) => {
    try {
      const payload = buildPaperCloseEmbed(event);
      await notifyDiscord(payload);
    } catch (err) {
      console.error("[paper-notifier] close notification failed:", err instanceof Error ? err.message : err);
    }
  });

  console.log("[paper-notifier] listening");
}
