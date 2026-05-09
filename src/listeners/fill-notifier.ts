import type { EventBus, SmFillEvent } from "../events/bus.js";
import { notifyDiscord, buildFillEmbed } from "../notify.js";

export function startFillNotifier(bus: EventBus): void {
  bus.on("sm:fill", (fill: SmFillEvent) => {
    const wallet = {
      address: fill.walletAddress,
      label: fill.walletLabel,
      category: fill.walletCategory as "smart-money" | "whale" | "market-maker" | "vault" | "watchlist",
      source: "manual" as const,
      active: true,
      minNotionalUsd: 0,
      addedAt: "",
      notes: "",
    };

    notifyDiscord(buildFillEmbed(fill, wallet)).catch((err) => {
      console.error("[fill-notifier] Discord notify error:", err);
    });
  });

  console.log("[fill-notifier] listening for sm:fill events");
}
