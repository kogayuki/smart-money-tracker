import type { SmFillEvent, SignalDetectedEvent } from "../../events/bus.js";

export type PatternMatch = Omit<SignalDetectedEvent, "id" | "detectedAt">;

export interface PatternMatcher {
  readonly name: string;
  /** Process a new fill and return a signal if pattern matches, null otherwise. */
  evaluate(fill: SmFillEvent): PatternMatch | null;
  /** Prune expired data from sliding windows. Called periodically. */
  tick(): void;
}
