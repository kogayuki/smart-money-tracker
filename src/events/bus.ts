import { EventEmitter } from "node:events";

// ── Event payload types ──

export type Exchange = "hyperliquid" | "helix";

export type SmFillEvent = {
  // Common fields (all exchanges)
  exchange: Exchange;
  coin: string;
  px: string;
  sz: string;
  side: "B" | "A";
  time: number;
  walletAddress: string;
  walletLabel: string;
  walletCategory: string;
  notionalUsd: number;

  // Hyperliquid-specific (optional)
  hash?: `0x${string}`;
  startPosition?: string;
  closedPnl?: string;
  fee?: string;
  crossed?: boolean;
  oid?: number;
  tid?: number;
  dir?: string;
  feeToken?: string;

  // Helix-specific (optional)
  txHash?: string;
  tradeId?: string;
};

export type SignalDetectedEvent = {
  id: string;
  type: "confluence" | "new_entry" | "flow_shift";
  coin: string;
  direction: "long" | "short";
  confidence: number;
  triggerFillIds: number[];
  walletLabels: string[];
  priceAtSignal: number;
  metadata: Record<string, unknown>;
  detectedAt: Date;
};

export type InsightGeneratedEvent = {
  id: string;
  coin: string;
  direction: "long" | "short";
  summary: string;
  signalIds: string[];
  pmMarketIds: string[];
  smConfidence: number;
  pmSentiment: number | null;
  combinedScore: number;
  priceAtInsight: number;
  metadata: Record<string, unknown>;
  generatedAt: Date;
};

export type PaperTradeOpenEvent = {
  id: string;
  signalId: string;
  coin: string;
  direction: "long" | "short";
  entryPrice: number;
  positionSizeUsd: number;
  quantity: number;
  tpPrice: number;
  slPrice: number;
  maxCloseAt: Date;
  signalType: string;
  signalConfidence: number;
  openedAt: Date;
};

export type PaperTradeCloseEvent = {
  id: string;
  signalId: string;
  coin: string;
  direction: "long" | "short";
  entryPrice: number;
  exitPrice: number;
  positionSizeUsd: number;
  quantity: number;
  pnlUsd: number;
  pnlPct: number;
  status: "closed_tp" | "closed_sl" | "closed_timeout";
  signalType: string;
  signalConfidence: number;
  openedAt: Date;
  closedAt: Date;
};

export type AutoTradeOpenEvent = {
  id: string;
  signalId: string;
  coin: string;
  direction: "long" | "short";
  txHash: string;
  executionPrice: string;
  quantity: string;
  margin: string;
  leverage: number;
  feeRecipient: string;
  signalType: string;
  signalConfidence: number;
  openedAt: Date;
};

export type AutoTradeCloseEvent = {
  id: string;
  coin: string;
  direction: "long" | "short";
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  pnlUsd: number;
  pnlPct: number;
  status: "closed_tp" | "closed_sl" | "closed_timeout";
  txHash: string;
  openedAt: Date;
  closedAt: Date;
};

export type AutoTradeErrorEvent = {
  signalId: string;
  coin: string;
  direction: "long" | "short";
  error: string;
  occurredAt: Date;
};

// ── Event map ──

export type EventMap = {
  "sm:fill": SmFillEvent;
  "signal:detected": SignalDetectedEvent;
  "insight:generated": InsightGeneratedEvent;
  "paper:open": PaperTradeOpenEvent;
  "paper:close": PaperTradeCloseEvent;
  "auto-trade:open": AutoTradeOpenEvent;
  "auto-trade:close": AutoTradeCloseEvent;
  "auto-trade:error": AutoTradeErrorEvent;
};

// ── Typed EventBus ──

export class EventBus {
  private emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(20);
  }

  on<K extends keyof EventMap>(event: K, listener: (data: EventMap[K]) => void): void {
    this.emitter.on(event, listener as (...args: unknown[]) => void);
  }

  off<K extends keyof EventMap>(event: K, listener: (data: EventMap[K]) => void): void {
    this.emitter.off(event, listener as (...args: unknown[]) => void);
  }

  emit<K extends keyof EventMap>(event: K, data: EventMap[K]): void {
    this.emitter.emit(event, data);
  }
}
