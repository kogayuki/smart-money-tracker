export type InsightType = "sm_pm_aligned" | "sm_contrarian" | "sm_only" | "pm_shift";

export function getInsightSummary(
  type: InsightType,
  coin: string,
  direction: "long" | "short",
  walletLabels: string[],
  pmQuestion: string | null,
  pmPrice: number | null,
): string {
  const dir = direction === "long" ? "LONG" : "SHORT";
  const walletsStr = walletLabels.join(", ");

  switch (type) {
    case "sm_pm_aligned": {
      const pct = pmPrice !== null ? `${Math.round(pmPrice * 100)}%` : "N/A";
      return `SM群が${coin} ${dir} + Polymarket "${pmQuestion}" ${pct} → 方向一致で強いシグナル`;
    }
    case "sm_contrarian": {
      const pct = pmPrice !== null ? `${Math.round(pmPrice * 100)}%` : "N/A";
      const pmDir = direction === "long" ? "弱気" : "強気";
      return `SM群が${coin} ${dir} だがPolymarket ${pct}は${pmDir}予測 → SM逆張りに注意`;
    }
    case "sm_only":
      return `${walletsStr}が${coin} ${dir} (Polymarket対応市場なし)`;
    case "pm_shift":
      return `Polymarket "${pmQuestion}" の確率が急変`;
  }
}

export function classifyInsight(
  smDirection: "long" | "short",
  pmSentiment: number | null,
): InsightType {
  if (pmSentiment === null) return "sm_only";

  // pmSentiment is aligned score (high = same direction as SM)
  if (pmSentiment >= 0.55) return "sm_pm_aligned";
  if (pmSentiment <= 0.45) return "sm_contrarian";
  return "sm_only"; // neutral range → treat as SM only
}

export function calculateCombinedScore(
  smConfidence: number,
  pmSentiment: number | null,
  historicalAccuracy: number,
): number {
  if (pmSentiment === null) {
    return smConfidence * 0.7 + historicalAccuracy * 0.3;
  }
  return smConfidence * 0.4 + pmSentiment * 0.3 + historicalAccuracy * 0.3;
}
