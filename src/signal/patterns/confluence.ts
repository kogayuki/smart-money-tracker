import type { SmFillEvent } from "../../events/bus.js";
import type { PatternMatcher, PatternMatch } from "./types.js";

/**
 * Confluence pattern: 2+ distinct wallets trading the same coin in the same
 * direction within a sliding time window → high-confidence directional signal.
 */

const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const MIN_WALLETS = 2;

type FillEntry = {
  fill: SmFillEvent;
  receivedAt: number;
};

export class ConfluencePattern implements PatternMatcher {
  readonly name = "confluence";

  // coin:direction → fill entries
  private windows = new Map<string, FillEntry[]>();
  // Track emitted signals to avoid duplicates within the same window
  private emittedKeys = new Map<string, number>(); // key → timestamp

  evaluate(fill: SmFillEvent): PatternMatch | null {
    const direction = fill.side === "B" ? "long" : "short";
    const key = `${fill.coin}:${direction}`;
    const now = Date.now();

    // Add to window
    const entries = this.windows.get(key) ?? [];
    entries.push({ fill, receivedAt: now });
    this.windows.set(key, entries);

    // Filter to active window
    const cutoff = now - WINDOW_MS;
    const active = entries.filter((e) => e.receivedAt >= cutoff);
    this.windows.set(key, active);

    // Count distinct wallets
    const wallets = new Set(active.map((e) => e.fill.walletAddress));
    if (wallets.size < MIN_WALLETS) return null;

    // Check if we already emitted for this key recently (within 5 min cooldown)
    const lastEmit = this.emittedKeys.get(key);
    if (lastEmit && now - lastEmit < 5 * 60 * 1000) return null;
    this.emittedKeys.set(key, now);

    // Calculate confidence based on wallet count and total notional
    const totalNotional = active.reduce((sum, e) => sum + e.fill.notionalUsd, 0);
    const walletCount = wallets.size;
    const confidence = Math.min(0.5 + walletCount * 0.15 + Math.min(totalNotional / 2_000_000, 0.2), 1);

    return {
      type: "confluence",
      coin: fill.coin,
      direction,
      confidence: Math.round(confidence * 1000) / 1000,
      triggerFillIds: active.map((e) => e.fill.tid).filter((id): id is number => id !== undefined),
      walletLabels: [...new Set(active.map((e) => e.fill.walletLabel))],
      priceAtSignal: parseFloat(fill.px),
      metadata: {
        walletCount,
        totalNotionalUsd: Math.round(totalNotional),
        windowMinutes: WINDOW_MS / 60_000,
      },
    };
  }

  tick(): void {
    const cutoff = Date.now() - WINDOW_MS;

    for (const [key, entries] of this.windows) {
      const active = entries.filter((e) => e.receivedAt >= cutoff);
      if (active.length === 0) {
        this.windows.delete(key);
      } else {
        this.windows.set(key, active);
      }
    }

    // Clean old emitted keys (keep 30min)
    const emitCutoff = Date.now() - 30 * 60 * 1000;
    for (const [key, ts] of this.emittedKeys) {
      if (ts < emitCutoff) this.emittedKeys.delete(key);
    }
  }
}
