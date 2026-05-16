import type { SmFillEvent } from "../../events/bus.js";
import type { PatternMatcher, PatternMatch } from "./types.js";

/**
 * Flow Shift pattern: Net notional flow for a coin shifts significantly
 * in one direction over a sliding window.
 * e.g. $500K+ net long flow within 30 minutes = bullish flow shift.
 */

const WINDOW_MS = 30 * 60 * 1000; // 30 minutes
const THRESHOLD_USD = 500_000; // $500K net flow
const COOLDOWN_MS = 30 * 60 * 1000; // 30 min between signals for same coin

type FlowEntry = {
  coin: string;
  signedNotional: number; // positive = long, negative = short
  receivedAt: number;
  fill: SmFillEvent;
};

export class FlowShiftPattern implements PatternMatcher {
  readonly name = "flow_shift";

  // coin → flow entries
  private windows = new Map<string, FlowEntry[]>();
  // coin → last signal timestamp
  private cooldowns = new Map<string, number>();

  evaluate(fill: SmFillEvent): PatternMatch | null {
    const now = Date.now();
    const signedNotional = fill.side === "B" ? fill.notionalUsd : -fill.notionalUsd;

    // Add to window
    const entries = this.windows.get(fill.coin) ?? [];
    entries.push({ coin: fill.coin, signedNotional, receivedAt: now, fill });
    this.windows.set(fill.coin, entries);

    // Filter to active window
    const cutoff = now - WINDOW_MS;
    const active = entries.filter((e) => e.receivedAt >= cutoff);
    this.windows.set(fill.coin, active);

    // Calculate net flow
    const netFlow = active.reduce((sum, e) => sum + e.signedNotional, 0);
    const absFlow = Math.abs(netFlow);

    if (absFlow < THRESHOLD_USD) return null;

    // Check cooldown
    const lastSignal = this.cooldowns.get(fill.coin);
    if (lastSignal && now - lastSignal < COOLDOWN_MS) return null;
    this.cooldowns.set(fill.coin, now);

    const direction = netFlow > 0 ? "long" : "short";

    // Confidence scales with how far above threshold
    const flowMultiple = absFlow / THRESHOLD_USD;
    const wallets = new Set(active.map((e) => e.fill.walletAddress));
    const confidence = Math.min(0.5 + Math.min(flowMultiple * 0.15, 0.3) + wallets.size * 0.05, 1);

    return {
      type: "flow_shift",
      coin: fill.coin,
      direction,
      confidence: Math.round(confidence * 1000) / 1000,
      triggerFillIds: active.map((e) => e.fill.tid).filter((id): id is number => id !== undefined),
      walletLabels: [...new Set(active.map((e) => e.fill.walletLabel))],
      priceAtSignal: parseFloat(fill.px),
      metadata: {
        netFlowUsd: Math.round(netFlow),
        absFlowUsd: Math.round(absFlow),
        fillCount: active.length,
        walletCount: wallets.size,
        windowMinutes: WINDOW_MS / 60_000,
      },
    };
  }

  tick(): void {
    const cutoff = Date.now() - WINDOW_MS;

    for (const [coin, entries] of this.windows) {
      const active = entries.filter((e) => e.receivedAt >= cutoff);
      if (active.length === 0) {
        this.windows.delete(coin);
      } else {
        this.windows.set(coin, active);
      }
    }

    const cooldownCutoff = Date.now() - COOLDOWN_MS;
    for (const [key, ts] of this.cooldowns) {
      if (ts < cooldownCutoff) this.cooldowns.delete(key);
    }
  }
}
