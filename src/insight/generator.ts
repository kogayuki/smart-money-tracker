import { randomUUID } from "node:crypto";
import type { EventBus, SignalDetectedEvent } from "../events/bus.js";
import type { PolymarketPoller } from "../polymarket/poller.js";
import {
  classifyInsight,
  calculateCombinedScore,
  getInsightSummary,
} from "./templates.js";

/**
 * Insight Generator: listens for signal:detected events, combines with
 * Polymarket data, and emits insight:generated events.
 */

// For now, use a fixed historical accuracy until we have enough outcome data
const DEFAULT_HISTORICAL_ACCURACY = 0.5;

export function startInsightGenerator(
  bus: EventBus,
  poller: PolymarketPoller,
): void {
  bus.on("signal:detected", (signal: SignalDetectedEvent) => {
    try {
      const sentimentResult = poller.getSentiment(signal.coin, signal.direction);
      const pmSentiment = sentimentResult?.score ?? null;
      const pmMarket = sentimentResult?.market ?? null;

      const insightType = classifyInsight(signal.direction, pmSentiment);
      const combinedScore = calculateCombinedScore(
        signal.confidence,
        pmSentiment,
        DEFAULT_HISTORICAL_ACCURACY,
      );

      const summary = getInsightSummary(
        insightType,
        signal.coin,
        signal.direction,
        signal.walletLabels,
        pmMarket?.question ?? null,
        pmSentiment,
      );

      const insight = {
        id: `ins_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
        coin: signal.coin,
        direction: signal.direction,
        summary,
        signalIds: [signal.id],
        pmMarketIds: pmMarket ? [pmMarket.id] : [],
        smConfidence: signal.confidence,
        pmSentiment,
        combinedScore: Math.round(combinedScore * 1000) / 1000,
        priceAtInsight: signal.priceAtSignal,
        metadata: {
          insightType,
          signalType: signal.type,
          pmQuestion: pmMarket?.question ?? null,
          pmPrice: pmSentiment,
          walletLabels: signal.walletLabels,
        },
        generatedAt: new Date(),
      };

      console.log(
        `[insight] generated: ${insight.id} ${insight.coin} ${insight.direction} score=${insight.combinedScore} type=${insightType}`,
      );

      bus.emit("insight:generated", insight);
    } catch (err) {
      console.error("[insight] generation error:", err);
    }
  });

  console.log("[insight] generator listening for signals");
}
