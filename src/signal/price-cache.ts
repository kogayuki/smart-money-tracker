import { WebSocketTransport } from "@nktkas/hyperliquid";
import { allMids } from "@nktkas/hyperliquid/api/subscription";
import { IndexerGrpcDerivativesApi } from "@injectivelabs/sdk-ts";
import { getNetworkEndpoints, Network } from "@injectivelabs/networks";

/**
 * Maintains an in-memory map of latest mid prices for all coins,
 * combining Hyperliquid allMids (WebSocket) and Helix derivative
 * orderbook mid prices (REST polling every 30s).
 */

// coin → mid price (shared across both exchanges)
const prices = new Map<string, number>();

// ── Hyperliquid allMids (WebSocket) ──

async function startHyperliquidPrices(): Promise<() => Promise<void>> {
  const transport = new WebSocketTransport();

  const sub = await allMids({ transport }, (data) => {
    for (const [coin, price] of Object.entries(data.mids)) {
      prices.set(coin, parseFloat(price));
    }
  });

  sub.failureSignal.addEventListener("abort", () => {
    console.error(`[price-cache] HL subscription failed: ${sub.failureSignal.reason}`);
  });

  console.log("[price-cache] subscribed to Hyperliquid allMids");

  return async () => {
    await sub.unsubscribe();
    await transport.close();
  };
}

// ── Helix derivative mid prices (REST polling) ──

const HELIX_POLL_INTERVAL_MS = 30_000; // 30 seconds

async function startHelixPrices(): Promise<() => void> {
  const endpoints = getNetworkEndpoints(Network.Mainnet);
  const indexerEndpoint = process.env.INJECTIVE_INDEXER_URL ?? endpoints.indexer;
  const api = new IndexerGrpcDerivativesApi(indexerEndpoint);

  // marketId → { coin, quoteDecimals } cache
  let marketCoinMap = new Map<string, { coin: string; quoteDecimals: number }>();

  const refreshMarkets = async () => {
    try {
      const markets = await api.fetchMarkets();
      const map = new Map<string, { coin: string; quoteDecimals: number }>();
      for (const m of markets) {
        const coin = m.ticker.split("/")[0]?.trim();
        if (coin) map.set(m.marketId, { coin, quoteDecimals: m.quoteToken?.decimals ?? 6 });
      }
      marketCoinMap = map;
    } catch (err) {
      console.error(
        "[price-cache] Helix market refresh failed:",
        err instanceof Error ? err.message : err,
      );
    }
  };

  const fetchPrices = async () => {
    try {
      if (marketCoinMap.size === 0) await refreshMarkets();

      const marketIds = [...marketCoinMap.keys()];
      if (marketIds.length === 0) return;

      const orderbooks = await api.fetchOrderbooksV2(marketIds);

      for (const { marketId, orderbook } of orderbooks) {
        const market = marketCoinMap.get(marketId);
        if (!market) continue;
        const { coin, quoteDecimals } = market;

        const bestBid = orderbook.buys[0];
        const bestAsk = orderbook.sells[0];
        if (!bestBid || !bestAsk) continue;

        // Indexer returns raw chain prices scaled by 10^quoteDecimals
        const priceScale = Math.pow(10, quoteDecimals);
        const mid = (parseFloat(bestBid.price) + parseFloat(bestAsk.price)) / 2 / priceScale;
        if (mid > 0) {
          // Only set if Hyperliquid doesn't already have this coin
          // (HL data is more real-time via WebSocket)
          if (!prices.has(coin)) {
            prices.set(coin, mid);
          }
        }
      }

      console.log(`[price-cache] Helix prices updated (${orderbooks.length} markets)`);
    } catch (err) {
      console.error(
        "[price-cache] Helix price fetch failed:",
        err instanceof Error ? err.message : err,
      );
    }
  };

  // Initial load
  await refreshMarkets();
  await fetchPrices();

  // Periodic refresh: prices every 30s, markets every 10min
  const priceInterval = setInterval(() => void fetchPrices(), HELIX_POLL_INTERVAL_MS);
  const marketInterval = setInterval(() => void refreshMarkets(), 10 * 60 * 1000);

  console.log("[price-cache] Helix price polling started (30s interval)");

  return () => {
    clearInterval(priceInterval);
    clearInterval(marketInterval);
  };
}

// ── Combined price cache ──

export async function startPriceCache(): Promise<() => Promise<void>> {
  const cleanupHl = await startHyperliquidPrices();
  const cleanupHelix = await startHelixPrices();

  console.log("[price-cache] all price sources active");

  return async () => {
    cleanupHelix();
    await cleanupHl();
    console.log("[price-cache] stopped");
  };
}

export function getPrice(coin: string): number | null {
  return prices.get(coin) ?? null;
}

export function getAllPrices(): ReadonlyMap<string, number> {
  return prices;
}
