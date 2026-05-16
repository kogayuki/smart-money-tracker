import type { SmFillEvent } from "../../events/bus.js";
import type { PatternMatcher, PatternMatch } from "./types.js";

/**
 * New Entry pattern: A wallet opens a position in a coin it hasn't traded
 * recently. Indicates fresh conviction.
 *
 * Warmup: After startup, the first WARMUP_FILLS fills per wallet are used
 * to seed history without firing signals. This prevents false positives
 * from the empty in-memory state after a restart.
 */

const HISTORY_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours lookback
const COOLDOWN_MS = 60 * 60 * 1000; // 1 hour between signals for same wallet+coin
const WARMUP_FILLS = 3; // ignore first N fills per wallet after startup

export class NewEntryPattern implements PatternMatcher {
  readonly name = "new_entry";

  // wallet → coin → last seen timestamp
  private walletHistory = new Map<string, Map<string, number>>();
  // Cooldown: wallet:coin → last signal timestamp
  private cooldowns = new Map<string, number>();
  // Warmup: wallet → fill count seen since startup
  private warmupCounts = new Map<string, number>();

  evaluate(fill: SmFillEvent): PatternMatch | null {
    const now = Date.now();
    const direction = fill.side === "B" ? "long" : "short";
    const walletCoins = this.walletHistory.get(fill.walletAddress) ?? new Map<string, number>();

    const lastSeen = walletCoins.get(fill.coin);
    const isNewEntry = !lastSeen || now - lastSeen > HISTORY_WINDOW_MS;

    // Update history
    walletCoins.set(fill.coin, now);
    this.walletHistory.set(fill.walletAddress, walletCoins);

    if (!isNewEntry) return null;

    // Warmup check: suppress signals during initial fill collection
    const count = (this.warmupCounts.get(fill.walletAddress) ?? 0) + 1;
    this.warmupCounts.set(fill.walletAddress, count);
    if (count <= WARMUP_FILLS) {
      console.log(`[new-entry] warmup ${fill.walletLabel} fill ${count}/${WARMUP_FILLS}, suppressing signal`);
      return null;
    }

    // Check cooldown
    const cooldownKey = `${fill.walletAddress}:${fill.coin}`;
    const lastSignal = this.cooldowns.get(cooldownKey);
    if (lastSignal && now - lastSignal < COOLDOWN_MS) return null;
    this.cooldowns.set(cooldownKey, now);

    // Confidence based on wallet category and notional
    let confidence = 0.5;
    if (fill.walletCategory === "smart-money") confidence += 0.2;
    if (fill.notionalUsd > 100_000) confidence += 0.1;
    if (fill.notionalUsd > 500_000) confidence += 0.1;
    confidence = Math.min(confidence, 1);

    return {
      type: "new_entry",
      coin: fill.coin,
      direction,
      confidence: Math.round(confidence * 1000) / 1000,
      triggerFillIds: fill.tid !== undefined ? [fill.tid] : [],
      walletLabels: [fill.walletLabel],
      priceAtSignal: parseFloat(fill.px),
      metadata: {
        walletAddress: fill.walletAddress,
        notionalUsd: Math.round(fill.notionalUsd),
        lastSeenMs: lastSeen ?? null,
      },
    };
  }

  tick(): void {
    const cutoff = Date.now() - HISTORY_WINDOW_MS;

    for (const [wallet, coins] of this.walletHistory) {
      for (const [coin, lastSeen] of coins) {
        if (lastSeen < cutoff) coins.delete(coin);
      }
      if (coins.size === 0) this.walletHistory.delete(wallet);
    }

    // Clean expired cooldowns
    const cooldownCutoff = Date.now() - COOLDOWN_MS;
    for (const [key, ts] of this.cooldowns) {
      if (ts < cooldownCutoff) this.cooldowns.delete(key);
    }
  }
}
