import type { EventBus, SmFillEvent } from "../events/bus.js";
import { notifyDiscord, buildFillEmbed } from "../notify.js";

// Per-fill Discord notifications only above this notional. Monitors now emit
// small TWAP clips (down to ~$1-2k) for signal aggregation — notifying each
// one would flood the channel with thousands of messages per day.
const FILL_NOTIFY_MIN_USD = Number(process.env.FILL_NOTIFY_MIN_USD ?? "10000");

export function startFillNotifier(bus: EventBus): void {
  bus.on("sm:fill", (fill: SmFillEvent) => {
    if (fill.notionalUsd < FILL_NOTIFY_MIN_USD) return;
    const wallet = {
      address: fill.walletAddress,
      exchange: fill.exchange,
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

  console.log(`[fill-notifier] listening for sm:fill events (notify >= $${FILL_NOTIFY_MIN_USD})`);
}
