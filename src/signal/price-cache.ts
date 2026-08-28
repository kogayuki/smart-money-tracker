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

      // The indexer rejects requests with too many marketIds (>~100, URL
      // length limit), so fetch in batches.
      const BATCH_SIZE = 50;
      const batches: string[][] = [];
      for (let i = 0; i < marketIds.length; i += BATCH_SIZE) {
        batches.push(marketIds.slice(i, i + BATCH_SIZE));
      }
      const orderbooks = (
        await Promise.all(batches.map((ids) => api.fetchOrderbooksV2(ids)))
      ).flat();

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

// ── xStocks l2Book polling (not in allMids) ──

const XSTOCKS_POLL_INTERVAL_MS = 60_000; // 60 seconds
const xStocksCoins = new Set<string>();

/** Register a coin for xStocks price polling (call when signals arrive). */
export function registerXStocksCoin(coin: string): void {
  if (coin.includes(":") && !xStocksCoins.has(coin)) {
    xStocksCoins.add(coin);
    console.log(`[price-cache] registered xStocks coin: ${coin}`);
  }
}

async function fetchXStocksPrices(): Promise<void> {
  if (xStocksCoins.size === 0) return;

  const coins = [...xStocksCoins];
  const results = await Promise.allSettled(
    coins.map(async (coin) => {
      const resp = await fetch("https://api.hyperliquid.xyz/info", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "l2Book", coin, nSigFigs: 5 }),
      });
      const data = (await resp.json()) as {
        levels?: [Array<{ px: string }>, Array<{ px: string }>];
      };
      const bid = data.levels?.[0]?.[0]?.px;
      const ask = data.levels?.[1]?.[0]?.px;
      if (bid && ask) {
        const mid = (parseFloat(bid) + parseFloat(ask)) / 2;
        if (mid > 0) prices.set(coin, mid);
      }
    }),
  );

  const ok = results.filter((r) => r.status === "fulfilled").length;
  if (ok > 0) {
    console.log(`[price-cache] xStocks prices updated (${ok}/${coins.length})`);
  }
}

function startXStocksPrices(): () => void {
  // Seed from DB: find coins with ":" prefix in recent signals
  void seedXStocksFromDb();
  void fetchXStocksPrices();
  const interval = setInterval(() => void fetchXStocksPrices(), XSTOCKS_POLL_INTERVAL_MS);
  console.log("[price-cache] xStocks price polling started (60s interval)");
  return () => clearInterval(interval);
}

async function seedXStocksFromDb(): Promise<void> {
  try {
    const { getDb } = await import("../db/client.js");
    const sql = getDb();
    if (!sql) return;
    const rows = await sql`
      SELECT DISTINCT coin FROM signals
      WHERE coin LIKE '%:%'
        AND detected_at >= now() - interval '30 days'
    `;
    for (const row of rows) {
      xStocksCoins.add(row.coin as string);
    }
    if (rows.length > 0) {
      console.log(`[price-cache] seeded ${rows.length} xStocks coins from DB`);
    }
  } catch {
    // Non-critical — coins will be registered as signals arrive
  }
}

// ── Combined price cache ──

export async function startPriceCache(): Promise<() => Promise<void>> {
  const cleanupHl = await startHyperliquidPrices();
  const cleanupHelix = await startHelixPrices();
  const cleanupXStocks = startXStocksPrices();

  console.log("[price-cache] all price sources active");

  return async () => {
    cleanupXStocks();
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
