import { fetchCryptoEvents } from "./client.js";
import type { PolymarketMarket } from "./types.js";
import { getDb } from "../db/client.js";

const POLL_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
const CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000; // every 6 hours
const SNAPSHOT_RETENTION_DAYS = 7;

export class PolymarketPoller {
  private cache = new Map<string, PolymarketMarket[]>(); // coin → markets
  private allMarkets = new Map<string, PolymarketMarket>(); // market id → market
  private interval: ReturnType<typeof setInterval> | null = null;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  async start(): Promise<void> {
    // Fetch immediately on start
    await this.poll();

    this.interval = setInterval(() => {
      this.poll().catch((err) => {
        console.error("[pm-poller] poll error:", err);
      });
    }, POLL_INTERVAL_MS);

    // Periodic snapshot cleanup
    this.cleanupInterval = setInterval(() => {
      this.cleanupOldSnapshots().catch((err) => {
        console.error("[pm-poller] cleanup error:", err);
      });
    }, CLEANUP_INTERVAL_MS);

    console.log(`[pm-poller] started (interval: ${POLL_INTERVAL_MS / 60_000}min, retention: ${SNAPSHOT_RETENTION_DAYS}d)`);
  }

  private async cleanupOldSnapshots(): Promise<void> {
    const sql = getDb();
    if (!sql) return;

    const result = await sql`
      DELETE FROM pm_snapshots
      WHERE fetched_at < now() - make_interval(days => ${SNAPSHOT_RETENTION_DAYS})
    `;
    console.log(`[pm-poller] cleaned up old snapshots (retention: ${SNAPSHOT_RETENTION_DAYS}d)`);
  }

  private async poll(): Promise<void> {
    try {
      const markets = await fetchCryptoEvents();
      console.log(`[pm-poller] fetched ${markets.length} markets`);

      // Update caches
      this.cache.clear();
      this.allMarkets.clear();

      for (const market of markets) {
        this.allMarkets.set(market.id, market);

        if (market.coin) {
          const existing = this.cache.get(market.coin) ?? [];
          existing.push(market);
          this.cache.set(market.coin, existing);
        }
      }

      // Persist to DB
      try {
        await this.persistMarkets(markets);
      } catch (dbErr) {
        console.error("[pm-poller] persist error:", dbErr instanceof Error ? dbErr.message : dbErr);
      }
    } catch (err) {
      console.error("[pm-poller] fetch error:", err);
    }
  }

  private async persistMarkets(markets: PolymarketMarket[]): Promise<void> {
    const sql = getDb();
    if (!sql) return;

    for (const m of markets) {
      try {
        await sql`
          INSERT INTO pm_markets (
            id, question, slug, coin, outcomes, outcome_prices,
            volume, liquidity, active, end_date, last_fetched_at
          ) VALUES (
            ${m.id}, ${m.question}, ${m.slug}, ${m.coin},
            ${m.outcomes}, ${m.outcomePrices},
            ${m.volume24h}, ${m.liquidity}, ${m.active},
            ${m.endDate}, now()
          )
          ON CONFLICT (id) DO UPDATE SET
            outcome_prices = EXCLUDED.outcome_prices,
            volume = EXCLUDED.volume,
            liquidity = EXCLUDED.liquidity,
            active = EXCLUDED.active,
            last_fetched_at = now()
        `;

        // Save snapshot
        await sql`
          INSERT INTO pm_snapshots (market_id, outcome_prices, volume_24h)
          VALUES (${m.id}, ${m.outcomePrices}, ${m.volume24h})
        `;
      } catch (err) {
        console.error(`[pm-poller] persist error for ${m.id}:`, err);
      }
    }
  }

  getMarketsForCoin(coin: string): PolymarketMarket[] {
    return this.cache.get(coin) ?? [];
  }

  getMarketById(id: string): PolymarketMarket | undefined {
    return this.allMarkets.get(id);
  }

  /**
   * Get a directional sentiment score for a coin from Polymarket.
   * For "long": returns the highest "Yes" probability from bullish markets.
   * Returns null if no relevant market found.
   */
  getSentiment(coin: string, direction: "long" | "short"): { score: number; market: PolymarketMarket } | null {
    const markets = this.getMarketsForCoin(coin);
    if (markets.length === 0) return null;

    // Find best matching market (highest volume = most reliable)
    const sorted = [...markets]
      .filter((m) => m.active && m.outcomePrices.length >= 2)
      .sort((a, b) => b.volume24h - a.volume24h);

    if (sorted.length === 0) return null;

    const best = sorted[0]!;
    // outcomePrices[0] is typically "Yes" probability
    const yesPrice = best.outcomePrices[0] ?? 0.5;

    // For "long" direction, high "Yes" on bullish market = aligned
    // For "short" direction, low "Yes" on bullish market = aligned
    const score = direction === "long" ? yesPrice : 1 - yesPrice;

    return { score, market: best };
  }

  async stop(): Promise<void> {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    console.log("[pm-poller] stopped");
  }
}
