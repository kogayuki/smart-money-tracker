import type { EventBus, Exchange } from "../events/bus.js";
import type { Wallet } from "../wallets/types.js";

export type MonitorConfig = {
  defaultMinNotionalUsd: number;
};

export type ExchangeMonitor = {
  exchange: Exchange;
  start(
    wallets: Wallet[],
    config: MonitorConfig,
    bus: EventBus,
  ): Promise<() => Promise<void>>;
};
