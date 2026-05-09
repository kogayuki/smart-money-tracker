import { EventEmitter } from "node:events";

// ── Event payload types ──

export type SmFillEvent = {
  coin: string;
  px: string;
  sz: string;
  side: "B" | "A";
  hash: `0x${string}`;
  time: number;
  startPosition: string;
  closedPnl: string;
  fee: string;
  crossed: boolean;
  oid: number;
  tid: number;
  dir: string;
  feeToken: string;
  walletAddress: `0x${string}`;
  walletLabel: string;
  walletCategory: string;
  notionalUsd: number;
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

// ── Event map ──

export type EventMap = {
  "sm:fill": SmFillEvent;
  "signal:detected": SignalDetectedEvent;
  "insight:generated": InsightGeneratedEvent;
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
