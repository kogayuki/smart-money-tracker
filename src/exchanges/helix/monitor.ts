import {
  IndexerGrpcDerivativesStream,
  IndexerGrpcDerivativesApi,
  getDefaultSubaccountId,
  type StreamStatusResponse,
} from "@injectivelabs/sdk-ts";
import { getNetworkEndpoints, Network } from "@injectivelabs/networks";
import type { Subscription } from "rxjs";
import type { Wallet } from "../../wallets/types.js";
import type { EventBus } from "../../events/bus.js";
import type { MonitorConfig } from "../types.js";
import { startMarketMapRefresh } from "./markets.js";

const RECONNECT_DELAY_MS = 5_000;
const HEALTH_CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const STALE_STREAM_THRESHOLD_MS = 10 * 60 * 1000; // 10 min without data → suspect dead

type WalletStream = {
  wallet: Wallet;
  subaccountId: string;
  minNotional: number;
  subscription: Subscription | null;
  lastDataAt: number;
  tradeCount: number;
  reconnects: number;
};

export async function startHelixMonitor(
  wallets: Wallet[],
  config: MonitorConfig,
  bus: EventBus,
): Promise<() => Promise<void>> {
  if (wallets.length === 0) {
    console.warn("[helix-monitor] no active Helix wallets to monitor");
    return async () => {};
  }

  const endpoints = getNetworkEndpoints(Network.Mainnet);
  const indexerEndpoint = process.env.INJECTIVE_INDEXER_URL ?? endpoints.indexer;

  // Market map refresh
  const { getMarketMap, refresh, stop: stopRefresh } = startMarketMapRefresh(indexerEndpoint);
  await refresh();

  // REST API for health checks
  const restApi = new IndexerGrpcDerivativesApi(indexerEndpoint);

  const streams: WalletStream[] = wallets.map((wallet) => ({
    wallet,
    subaccountId: getDefaultSubaccountId(wallet.address),
    minNotional: wallet.minNotionalUsd || config.defaultMinNotionalUsd,
    subscription: null,
    lastDataAt: 0,
    tradeCount: 0,
    reconnects: 0,
  }));

  let stopped = false;

  // Subscribe a single wallet to the trade stream
  function subscribeWallet(ws: WalletStream): void {
    if (stopped) return;

    try {
      const stream = new IndexerGrpcDerivativesStream(indexerEndpoint);

      ws.subscription = stream.streamTrades({
        subaccountId: ws.subaccountId,
        callback: (data) => {
          ws.lastDataAt = Date.now();

          const trade = data.trade;
          if (!trade) return;

          ws.tradeCount++;
          const marketMap = getMarketMap();
          const market = marketMap.get(trade.marketId);
          const coin = market?.coin ?? trade.marketId;

          // Indexer returns raw chain prices scaled by 10^quoteDecimals
          const priceScale = Math.pow(10, market?.quoteDecimals ?? 6);
          const price = parseFloat(trade.executionPrice ?? "0") / priceScale;
          const quantity = parseFloat(trade.executionQuantity ?? "0");
          const notional = price * quantity;

          if (notional < ws.minNotional) {
            console.log(
              `[helix-monitor] skip ${ws.wallet.label} ${coin} $${notional.toFixed(0)} < $${ws.minNotional} threshold`,
            );
            return;
          }

          const side = trade.tradeDirection === "buy" ? "B" : "A";

          console.log(
            `[helix-monitor] alert ${ws.wallet.label} ${side === "B" ? "LONG" : "SHORT"} ${coin} $${notional.toFixed(0)}`,
          );

          bus.emit("sm:fill", {
            exchange: "helix",
            coin,
            px: price.toString(),
            sz: quantity.toString(),
            side,
            time: trade.executedAt
              ? typeof trade.executedAt === "number"
                ? trade.executedAt
                : parseInt(String(trade.executedAt), 10)
              : Date.now(),
            walletAddress: ws.wallet.address,
            walletLabel: ws.wallet.label,
            walletCategory: ws.wallet.category,
            notionalUsd: notional,
            txHash: trade.orderHash,
            tradeId: trade.tradeId,
          });
        },
        onEndCallback: (status?: StreamStatusResponse) => {
          console.warn(
            `[helix-monitor] stream ENDED for ${ws.wallet.label}: ${status?.details ?? "unknown"}`,
          );
          scheduleReconnect(ws);
        },
        onStatusCallback: (status: StreamStatusResponse) => {
          console.warn(
            `[helix-monitor] stream STATUS for ${ws.wallet.label}: code=${status.code} details=${status.details ?? "none"}`,
          );
        },
      });

      console.log(
        `[helix-monitor] subscribed: ${ws.wallet.label} (${ws.wallet.address}) subaccount=${ws.subaccountId} minNotional=$${ws.minNotional}` +
          (ws.reconnects > 0 ? ` (reconnect #${ws.reconnects})` : ""),
      );
    } catch (err) {
      console.error(
        `[helix-monitor] subscribe failed for ${ws.wallet.label}:`,
        err instanceof Error ? err.message : err,
      );
      scheduleReconnect(ws);
    }
  }

  function scheduleReconnect(ws: WalletStream): void {
    if (stopped) return;

    ws.reconnects++;
    // Exponential backoff: 5s, 10s, 20s, 40s, max 60s
    const delay = Math.min(RECONNECT_DELAY_MS * Math.pow(2, ws.reconnects - 1), 60_000);

    console.log(
      `[helix-monitor] scheduling reconnect for ${ws.wallet.label} in ${delay / 1000}s (attempt #${ws.reconnects})`,
    );

    setTimeout(() => {
      if (stopped) return;
      // Clean up old subscription
      if (ws.subscription) {
        try { ws.subscription.unsubscribe(); } catch { /* ignore */ }
        ws.subscription = null;
      }
      subscribeWallet(ws);
    }, delay);
  }

  // Health check: verify streams are alive via REST API comparison
  async function healthCheck(): Promise<void> {
    if (stopped) return;

    const now = Date.now();
    console.log("[helix-monitor] health check starting...");

    for (const ws of streams) {
      const streamAge = ws.lastDataAt > 0 ? now - ws.lastDataAt : Infinity;
      const isStale = streamAge > STALE_STREAM_THRESHOLD_MS;

      // Check if wallet has recent trades via REST
      let restTradeCount = 0;
      let lastRestTradeAt = 0;
      try {
        const result = await restApi.fetchTrades({
          subaccountId: ws.subaccountId,
        });
        restTradeCount = result.trades.length;
        if (result.trades[0]?.executedAt) {
          const execAt = result.trades[0].executedAt;
          lastRestTradeAt = typeof execAt === "number" ? execAt : parseInt(String(execAt), 10);
        }
      } catch (err) {
        console.error(
          `[helix-monitor] health REST check failed for ${ws.wallet.label}:`,
          err instanceof Error ? err.message : err,
        );
      }

      const restAgeHours = lastRestTradeAt > 0 ? Math.round((now - lastRestTradeAt) / 3600000) : -1;

      console.log(
        `[helix-monitor] health: ${ws.wallet.label}` +
          ` | stream_trades=${ws.tradeCount}` +
          ` | last_stream_data=${ws.lastDataAt > 0 ? `${Math.round(streamAge / 1000)}s ago` : "never"}` +
          ` | rest_last_trade=${restAgeHours >= 0 ? `${restAgeHours}h ago` : "unknown"}` +
          ` | reconnects=${ws.reconnects}` +
          (isStale ? " | STATUS=STALE" : " | STATUS=OK"),
      );

      // If stream is stale but REST shows recent activity, reconnect
      if (isStale && lastRestTradeAt > 0 && now - lastRestTradeAt < STALE_STREAM_THRESHOLD_MS) {
        console.warn(
          `[helix-monitor] stream appears dead for ${ws.wallet.label} — REST shows recent trades. Reconnecting...`,
        );
        if (ws.subscription) {
          try { ws.subscription.unsubscribe(); } catch { /* ignore */ }
          ws.subscription = null;
        }
        subscribeWallet(ws);
      }
    }
  }

  // Initial subscriptions
  console.log(`[helix-monitor] subscribing to ${wallets.length} wallet(s)`);
  for (const ws of streams) {
    subscribeWallet(ws);
  }
  console.log(`[helix-monitor] all ${streams.length} subscription(s) initiated`);

  // Periodic health check
  const healthInterval = setInterval(() => void healthCheck(), HEALTH_CHECK_INTERVAL_MS);

  // Return cleanup function
  return async () => {
    stopped = true;
    console.log("[helix-monitor] shutting down...");
    clearInterval(healthInterval);
    stopRefresh();
    for (const ws of streams) {
      if (ws.subscription) {
        try { ws.subscription.unsubscribe(); } catch { /* ignore */ }
      }
    }
    console.log("[helix-monitor] shutdown complete");
  };
}
