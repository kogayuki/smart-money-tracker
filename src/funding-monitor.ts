/**
 * Funding Monitor: records hourly funding rates for configured coins across
 * Hyperliquid, GRVT, and Helix into Neon, and alerts Discord when the
 * cross-venue spread exceeds a threshold.
 *
 * Observation only — no execution. Purpose: measure whether funding-rate
 * arbitrage opportunities actually exist (net of fees) before building an
 * executor.
 *
 * Unit normalization (hourly_pct = percent per hour):
 * - Hyperliquid: assetCtx.funding is a fraction per hour  → *100
 * - GRVT: ticker.funding_rate_8h_curr is percent per 8h   → /8
 * - Helix: fundingRates.rate is a fraction per hour (1h funding interval) → *100
 */
import { HttpTransport } from "@nktkas/hyperliquid";
import { metaAndAssetCtxs } from "@nktkas/hyperliquid/api/info";
import { IndexerGrpcDerivativesApi } from "@injectivelabs/sdk-ts";
import { getNetworkEndpoints, Network } from "@injectivelabs/networks";
import { getDb } from "./db/client.js";
import { notifyDiscord } from "./notify.js";

const CHECK_INTERVAL_MS = 60 * 60 * 1000; // hourly
const INITIAL_DELAY_MS = 2 * 60 * 1000; // let other services boot first
const ALERT_THROTTLE_MS = 6 * 60 * 60 * 1000; // one alert per coin per 6h

const GRVT_MARKET_DATA_URL = "https://market-data.grvt.io";

type Snapshot = {
  coin: string;
  venue: "hyperliquid" | "grvt" | "helix";
  rawRate: number;
  hourlyPct: number;
  markPx: number | null;
};

// ── Per-venue fetchers ──

async function fetchHyperliquid(coins: string[]): Promise<Snapshot[]> {
  const transport = new HttpTransport();
  const [info, ctxs] = await metaAndAssetCtxs({ transport });
  const out: Snapshot[] = [];
  for (const coin of coins) {
    const idx = info.universe.findIndex((a) => a.name.toUpperCase() === coin);
    const ctx = idx >= 0 ? ctxs[idx] : undefined;
    if (!ctx) continue;
    const raw = Number(ctx.funding);
    if (!Number.isFinite(raw)) continue;
    out.push({
      coin,
      venue: "hyperliquid",
      rawRate: raw,
      hourlyPct: raw * 100,
      markPx: Number(ctx.markPx) || null,
    });
  }
  return out;
}

async function fetchGrvt(coins: string[]): Promise<Snapshot[]> {
  const out: Snapshot[] = [];
  for (const coin of coins) {
    try {
      const res = await fetch(`${GRVT_MARKET_DATA_URL}/full/v1/ticker`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instrument: `${coin}_USDT_Perp` }),
      });
      if (!res.ok) continue; // instrument may not exist (e.g. HYPE)
      const data = (await res.json()) as {
        result?: { funding_rate_8h_curr?: string; mark_price?: string };
      };
      const raw = Number(data.result?.funding_rate_8h_curr);
      if (!Number.isFinite(raw)) continue;
      out.push({
        coin,
        venue: "grvt",
        rawRate: raw,
        hourlyPct: raw / 8,
        markPx: Number(data.result?.mark_price) || null,
      });
    } catch (e) {
      console.warn(`[funding-monitor] GRVT fetch failed for ${coin}:`, e instanceof Error ? e.message : e);
    }
  }
  return out;
}

// marketId cache: coin → marketId
let helixMarketIds: Map<string, string> | null = null;

async function fetchHelix(coins: string[]): Promise<Snapshot[]> {
  const api = new IndexerGrpcDerivativesApi(
    process.env.INJECTIVE_INDEXER_URL ?? getNetworkEndpoints(Network.Mainnet).indexer,
  );

  if (!helixMarketIds) {
    const markets = await api.fetchMarkets();
    helixMarketIds = new Map();
    for (const m of markets) {
      const match = /^([A-Z0-9]+)\/(USDT|USDC) PERP$/.exec(m.ticker);
      if (match?.[1]) helixMarketIds.set(match[1], m.marketId);
    }
  }

  const out: Snapshot[] = [];
  for (const coin of coins) {
    const marketId = helixMarketIds.get(coin);
    if (!marketId) continue;
    try {
      const fr = await api.fetchFundingRates({ marketId, pagination: { limit: 1 } });
      const raw = Number(fr.fundingRates[0]?.rate);
      if (!Number.isFinite(raw)) continue;
      out.push({ coin, venue: "helix", rawRate: raw, hourlyPct: raw * 100, markPx: null });
    } catch (e) {
      console.warn(`[funding-monitor] Helix fetch failed for ${coin}:`, e instanceof Error ? e.message : e);
    }
  }
  return out;
}

// ── Persistence + alerting ──

async function persist(snapshots: Snapshot[]): Promise<void> {
  const sql = getDb();
  if (!sql) return;
  for (const s of snapshots) {
    try {
      await sql`
        INSERT INTO funding_snapshots (coin, venue, raw_rate, hourly_pct, mark_px)
        VALUES (${s.coin}, ${s.venue}, ${s.rawRate}, ${s.hourlyPct}, ${s.markPx})
      `;
    } catch (err) {
      console.error("[funding-monitor] DB persist failed:", err instanceof Error ? err.message : err);
    }
  }
}

const lastAlertAt = new Map<string, number>();

function checkSpreads(snapshots: Snapshot[], alertThresholdPct: number): void {
  const byCoin = new Map<string, Snapshot[]>();
  for (const s of snapshots) {
    const list = byCoin.get(s.coin) ?? [];
    list.push(s);
    byCoin.set(s.coin, list);
  }

  for (const [coin, list] of byCoin) {
    if (list.length < 2) continue;
    const sorted = [...list].sort((a, b) => a.hourlyPct - b.hourlyPct);
    const low = sorted[0]!;
    const high = sorted[sorted.length - 1]!;
    const spread = high.hourlyPct - low.hourlyPct;

    const detail = list
      .map((s) => `${s.venue}=${s.hourlyPct.toFixed(5)}%/h`)
      .join(" ");
    console.log(`[funding-monitor] ${coin}: ${detail} spread=${spread.toFixed(5)}%/h`);

    if (spread < alertThresholdPct) continue;
    const last = lastAlertAt.get(coin) ?? 0;
    if (Date.now() - last < ALERT_THROTTLE_MS) continue;
    lastAlertAt.set(coin, Date.now());

    const aprPct = spread * 24 * 365;
    notifyDiscord(
      `💡 **Fundingスプレッド検知: ${coin}**\n` +
        `short ${high.venue} (${high.hourlyPct.toFixed(5)}%/h) / long ${low.venue} (${low.hourlyPct.toFixed(5)}%/h)\n` +
        `スプレッド ${spread.toFixed(5)}%/h ≈ 年率 ${aprPct.toFixed(1)}%（手数料未控除・観測のみ）`,
    ).catch((err) => {
      console.error("[funding-monitor] alert failed:", err instanceof Error ? err.message : err);
    });
  }
}

// ── Public API ──

export function startFundingMonitor(): () => void {
  const coins = (process.env.FUNDING_MONITOR_COINS ?? "BTC,ETH,HYPE")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  const alertThresholdPct = Number(process.env.FUNDING_ALERT_HOURLY_PCT ?? "0.005");

  const cycle = async () => {
    const results = await Promise.allSettled([
      fetchHyperliquid(coins),
      fetchGrvt(coins),
      fetchHelix(coins),
    ]);
    const snapshots: Snapshot[] = [];
    for (const r of results) {
      if (r.status === "fulfilled") snapshots.push(...r.value);
      else console.warn("[funding-monitor] venue fetch failed:", r.reason instanceof Error ? r.reason.message : r.reason);
    }
    if (snapshots.length === 0) return;
    await persist(snapshots);
    checkSpreads(snapshots, alertThresholdPct);
  };

  const initialTimer = setTimeout(() => void cycle(), INITIAL_DELAY_MS);
  const interval = setInterval(() => void cycle(), CHECK_INTERVAL_MS);

  console.log(
    `[funding-monitor] started — coins=${coins.join(",")} alert>=${alertThresholdPct}%/h (hourly snapshots to funding_snapshots)`,
  );

  return () => {
    clearTimeout(initialTimer);
    clearInterval(interval);
  };
}
