/**
 * Context Collector: captures market context at the moment a signal fires.
 *
 * Records funding rate, open interest, volume, premium, and prices
 * for later analysis of "why did this signal win/lose?"
 */
import { HttpTransport } from "@nktkas/hyperliquid";
import { metaAndAssetCtxs } from "@nktkas/hyperliquid/api/info";
import type { EventBus, SignalDetectedEvent } from "../events/bus.js";
import { getDb } from "../db/client.js";

export type SignalContext = {
  signalId: string;
  coin: string;
  direction: "long" | "short";
  /** Hyperliquid funding rate at signal time */
  fundingRate: number | null;
  /** Open interest in base currency */
  openInterest: number | null;
  /** 24h notional volume */
  dayNtlVlm: number | null;
  /** Premium (mark vs oracle) */
  premium: number | null;
  /** Oracle price */
  oraclePx: number | null;
  /** Mark price */
  markPx: number | null;
  /** 24h price change percentage */
  dayChangePct: number | null;
  collectedAt: Date;
};

// Cache asset name → index mapping
let assetIndexMap: Map<string, number> | null = null;

async function collectContext(
  signal: SignalDetectedEvent,
): Promise<SignalContext> {
  const transport = new HttpTransport();
  const result = await metaAndAssetCtxs({ transport });
  const [metaInfo, assetCtxs] = result;

  // Build index map on first call
  if (!assetIndexMap) {
    assetIndexMap = new Map();
    for (let i = 0; i < metaInfo.universe.length; i++) {
      const asset = metaInfo.universe[i];
      if (asset) assetIndexMap.set(asset.name.toUpperCase(), i);
    }
  }

  const idx = assetIndexMap.get(signal.coin.toUpperCase());
  if (idx === undefined || !assetCtxs[idx]) {
    return {
      signalId: signal.id,
      coin: signal.coin,
      direction: signal.direction,
      fundingRate: null,
      openInterest: null,
      dayNtlVlm: null,
      premium: null,
      oraclePx: null,
      markPx: null,
      dayChangePct: null,
      collectedAt: new Date(),
    };
  }

  const ctx = assetCtxs[idx];
  const prevDayPx = Number(ctx.prevDayPx);
  const markPx = Number(ctx.markPx);
  const dayChangePct = prevDayPx > 0 ? ((markPx - prevDayPx) / prevDayPx) * 100 : null;

  return {
    signalId: signal.id,
    coin: signal.coin,
    direction: signal.direction,
    fundingRate: Number(ctx.funding),
    openInterest: Number(ctx.openInterest),
    dayNtlVlm: Number(ctx.dayNtlVlm),
    premium: Number(ctx.premium),
    oraclePx: Number(ctx.oraclePx),
    markPx,
    dayChangePct,
    collectedAt: new Date(),
  };
}

async function persistContext(context: SignalContext): Promise<void> {
  const sql = getDb();
  if (!sql) return;

  try {
    await sql`
      INSERT INTO signal_contexts (
        signal_id, coin, direction,
        funding_rate, open_interest, day_ntl_vlm,
        premium, oracle_px, mark_px, day_change_pct,
        collected_at
      ) VALUES (
        ${context.signalId}, ${context.coin}, ${context.direction},
        ${context.fundingRate}, ${context.openInterest}, ${context.dayNtlVlm},
        ${context.premium}, ${context.oraclePx}, ${context.markPx}, ${context.dayChangePct},
        ${context.collectedAt.toISOString()}
      )
    `;
  } catch (err) {
    console.error("[context] DB persist failed:", err instanceof Error ? err.message : err);
  }
}

export function startContextCollector(bus: EventBus): void {
  bus.on("signal:detected", (signal) => {
    collectContext(signal)
      .then((ctx) => {
        const fr = ctx.fundingRate !== null ? (ctx.fundingRate * 100).toFixed(4) + "%" : "N/A";
        const oi = ctx.openInterest !== null ? "$" + (ctx.openInterest * (ctx.markPx ?? 0) / 1e6).toFixed(1) + "M" : "N/A";
        const chg = ctx.dayChangePct !== null ? (ctx.dayChangePct >= 0 ? "+" : "") + ctx.dayChangePct.toFixed(2) + "%" : "N/A";

        console.log(
          `[context] ${ctx.coin} ${ctx.direction} | FR=${fr} OI=${oi} 24hChg=${chg} premium=${ctx.premium?.toFixed(6) ?? "N/A"}`,
        );

        void persistContext(ctx);
      })
      .catch((err) => {
        console.error("[context] collect failed:", err instanceof Error ? err.message : err);
      });
  });

  console.log("[context] collector started — recording FR/OI/volume on every signal");
}
