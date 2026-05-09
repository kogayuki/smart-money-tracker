import { randomUUID } from "node:crypto";
import type { EventBus, SmFillEvent } from "../events/bus.js";
import type { PatternMatcher } from "./patterns/types.js";
import { ConfluencePattern } from "./patterns/confluence.js";
import { NewEntryPattern } from "./patterns/new-entry.js";
import { FlowShiftPattern } from "./patterns/flow-shift.js";

/**
 * Signal Detector: listens to sm:fill events, runs all pattern matchers,
 * and emits signal:detected when a pattern fires.
 */
export function startSignalDetector(bus: EventBus): () => void {
  const matchers: PatternMatcher[] = [
    new ConfluencePattern(),
    new NewEntryPattern(),
    new FlowShiftPattern(),
  ];

  const handler = (fill: SmFillEvent) => {
    for (const matcher of matchers) {
      try {
        const match = matcher.evaluate(fill);
        if (match) {
          const signal = {
            ...match,
            id: `sig_${randomUUID().replace(/-/g, "").slice(0, 16)}`,
            detectedAt: new Date(),
          };

          console.log(
            `[detector] signal: ${signal.type} ${signal.coin} ${signal.direction} confidence=${signal.confidence}`,
          );

          bus.emit("signal:detected", signal);
        }
      } catch (err) {
        console.error(`[detector] ${matcher.name} error:`, err);
      }
    }
  };

  bus.on("sm:fill", handler);

  // Periodic tick to prune sliding windows (every 60s)
  const tickInterval = setInterval(() => {
    for (const matcher of matchers) {
      matcher.tick();
    }
  }, 60_000);

  console.log(`[detector] started with ${matchers.length} pattern matcher(s)`);

  return () => {
    bus.off("sm:fill", handler);
    clearInterval(tickInterval);
    console.log("[detector] stopped");
  };
}
