export type PaperConfig = {
  enabled: boolean;
  coins: string[];
  signalTypes: string[];
  budgetUsd: number;
  positionSizeUsd: number;
  tpPct: number;
  slPct: number;
  maxHoldH: number;
  minConfidence: number;
};

export function loadPaperConfig(): PaperConfig {
  return {
    enabled: process.env.PAPER_ENABLED !== "false",
    coins: (process.env.PAPER_COINS ?? "BTC,INJ").split(",").map((s) => s.trim().toUpperCase()),
    signalTypes: (process.env.PAPER_SIGNAL_TYPES ?? "flow_shift,confluence").split(",").map((s) => s.trim()),
    budgetUsd: Number(process.env.PAPER_BUDGET_USD ?? "100"),
    positionSizeUsd: Number(process.env.PAPER_POSITION_SIZE_USD ?? "100"),
    tpPct: Number(process.env.PAPER_TP_PCT ?? "5"),
    slPct: Number(process.env.PAPER_SL_PCT ?? "3"),
    maxHoldH: Number(process.env.PAPER_MAX_HOLD_H ?? "24"),
    minConfidence: Number(process.env.PAPER_MIN_CONFIDENCE ?? "0.7"),
  };
}
