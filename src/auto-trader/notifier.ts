/**
 * Auto-Trade Notifier: sends Discord notifications for trade executions and errors.
 */
import type { EventBus } from "../events/bus.js";
import { notifyDiscord } from "../notify.js";

export function startAutoTradeNotifier(bus: EventBus): void {
  bus.on("auto-trade:open", (event) => {
    const lines = [
      `🤖 **AUTO-TRADE EXECUTED**`,
      `**${event.coin}** ${event.direction.toUpperCase()} @ $${event.executionPrice}`,
      `Qty: ${event.quantity} | Margin: $${event.margin} | Lev: ${event.leverage}x`,
      `Signal: ${event.signalType} (conf: ${(event.signalConfidence * 100).toFixed(0)}%)`,
      `Fee Recipient: \`${event.feeRecipient.slice(0, 12)}...\``,
      `TX: \`${event.txHash}\``,
    ];
    void notifyDiscord(lines.join("\n"));
  });

  bus.on("auto-trade:error", (event) => {
    const lines = [
      `⚠️ **AUTO-TRADE FAILED**`,
      `**${event.coin}** ${event.direction.toUpperCase()}`,
      `Signal: ${event.signalId}`,
      `Error: ${event.error}`,
    ];
    void notifyDiscord(lines.join("\n"));
  });

  console.log("[auto-trade-notifier] started");
}
