import { WebSocketTransport, type ISubscription } from "@nktkas/hyperliquid";
import { userFills } from "@nktkas/hyperliquid/api/subscription";
import type { Wallet } from "./wallets/types.js";
import type { EventBus } from "./events/bus.js";

export type MonitorConfig = {
  defaultMinNotionalUsd: number;
};

export async function startMonitor(
  wallets: Wallet[],
  config: MonitorConfig,
  bus: EventBus,
): Promise<() => Promise<void>> {
  if (wallets.length === 0) {
    console.warn("[monitor] no active wallets to monitor");
    return async () => {};
  }

  const transport = new WebSocketTransport();
  const subscriptions: ISubscription[] = [];
  const snapshotSeen = new Set<string>();

  console.log(`[monitor] subscribing to ${wallets.length} wallet(s)`);

  for (const wallet of wallets) {
    const minNotional = wallet.minNotionalUsd || config.defaultMinNotionalUsd;

    const sub = await userFills(
      { transport },
      { user: wallet.address },
      (data) => {
        // Skip initial snapshot (replays existing fills)
        if (data.isSnapshot) {
          if (!snapshotSeen.has(wallet.address)) {
            snapshotSeen.add(wallet.address);
            console.log(
              `[monitor] snapshot skipped for ${wallet.label} (${data.fills.length} historical fills)`,
            );
          }
          return;
        }

        for (const fill of data.fills) {
          const notional = parseFloat(fill.px) * parseFloat(fill.sz);

          if (notional < minNotional) {
            console.log(
              `[monitor] skip ${wallet.label} ${fill.coin} $${notional.toFixed(0)} < $${minNotional} threshold`,
            );
            continue;
          }

          console.log(
            `[monitor] alert ${wallet.label} ${fill.side === "B" ? "LONG" : "SHORT"} ${fill.coin} $${notional.toFixed(0)}`,
          );

          bus.emit("sm:fill", {
            coin: fill.coin,
            px: fill.px,
            sz: fill.sz,
            side: fill.side,
            hash: fill.hash as `0x${string}`,
            time: fill.time,
            startPosition: fill.startPosition,
            closedPnl: fill.closedPnl,
            fee: fill.fee,
            crossed: fill.crossed,
            oid: fill.oid,
            tid: fill.tid,
            dir: fill.dir,
            feeToken: fill.feeToken,
            walletAddress: wallet.address,
            walletLabel: wallet.label,
            walletCategory: wallet.category,
            notionalUsd: notional,
          });
        }
      },
    );

    // Watch for subscription failure (e.g. reconnect failed)
    sub.failureSignal.addEventListener("abort", () => {
      console.error(
        `[monitor] subscription failed for ${wallet.label} (${wallet.address}): ${sub.failureSignal.reason}`,
      );
    });

    subscriptions.push(sub);
    console.log(`[monitor] subscribed: ${wallet.label} (${wallet.address}) minNotional=$${minNotional}`);
  }

  console.log(`[monitor] all ${subscriptions.length} subscription(s) active`);

  // Return cleanup function
  return async () => {
    console.log("[monitor] shutting down subscriptions...");
    await Promise.allSettled(subscriptions.map((s) => s.unsubscribe()));
    await transport.close();
    console.log("[monitor] shutdown complete");
  };
}
