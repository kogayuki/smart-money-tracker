import { IndexerGrpcDerivativesApi } from "@injectivelabs/sdk-ts";

/**
 * Builds and maintains a map of marketId (0x hash) → coin symbol.
 *
 * Ticker format: "BTC/USDT PERP" → "BTC"
 *                "ETH/USDT PERP" → "ETH"
 *                "INJ/USDT PERP" → "INJ"
 */

const REFRESH_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

export async function buildMarketMap(
  indexerEndpoint: string,
): Promise<Map<string, string>> {
  const api = new IndexerGrpcDerivativesApi(indexerEndpoint);
  const markets = await api.fetchMarkets();

  const map = new Map<string, string>();
  for (const m of markets) {
    // "BTC/USDT PERP" → "BTC"
    const coin = m.ticker.split("/")[0]?.trim();
    if (coin) {
      map.set(m.marketId, coin);
    }
  }

  console.log(`[helix-markets] loaded ${map.size} derivative market(s)`);
  return map;
}

/**
 * Starts a periodic refresh of the market map.
 * Returns a getter function and a cleanup function.
 */
export function startMarketMapRefresh(
  indexerEndpoint: string,
): {
  getMarketMap: () => Map<string, string>;
  refresh: () => Promise<void>;
  stop: () => void;
} {
  let marketMap = new Map<string, string>();

  const refresh = async () => {
    try {
      marketMap = await buildMarketMap(indexerEndpoint);
    } catch (err) {
      console.error(
        "[helix-markets] refresh failed:",
        err instanceof Error ? err.message : err,
      );
    }
  };

  const interval = setInterval(() => void refresh(), REFRESH_INTERVAL_MS);

  return {
    getMarketMap: () => marketMap,
    refresh,
    stop: () => clearInterval(interval),
  };
}
