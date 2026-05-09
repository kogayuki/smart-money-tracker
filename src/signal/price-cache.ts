import { WebSocketTransport } from "@nktkas/hyperliquid";
import { allMids } from "@nktkas/hyperliquid/api/subscription";

/**
 * Subscribes to Hyperliquid allMids WebSocket feed and keeps an in-memory
 * map of latest mid prices for all coins.
 */

// coin → mid price
const prices = new Map<string, number>();

let cleanup: (() => Promise<void>) | null = null;

export async function startPriceCache(): Promise<() => Promise<void>> {
  const transport = new WebSocketTransport();

  const sub = await allMids({ transport }, (data) => {
    for (const [coin, price] of Object.entries(data.mids)) {
      prices.set(coin, parseFloat(price));
    }
  });

  sub.failureSignal.addEventListener("abort", () => {
    console.error(`[price-cache] subscription failed: ${sub.failureSignal.reason}`);
  });

  console.log("[price-cache] subscribed to allMids");

  cleanup = async () => {
    await sub.unsubscribe();
    await transport.close();
    console.log("[price-cache] stopped");
  };

  return cleanup;
}

export function getPrice(coin: string): number | null {
  return prices.get(coin) ?? null;
}

export function getAllPrices(): ReadonlyMap<string, number> {
  return prices;
}
