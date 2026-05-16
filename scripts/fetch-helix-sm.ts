#!/usr/bin/env tsx
/**
 * Helix Smart Money Discovery Script
 *
 * 2つのアプローチで Helix 上のスマートマネー候補を特定する:
 *
 * 1. Chronos Leaderboard API  -- PnL ランキング上位アドレスを取得
 * 2. Indexer Positions API     -- 大口デリバティブポジション保有アドレスを取得
 *
 * 使い方:
 *   npx tsx scripts/fetch-helix-sm.ts
 *
 * 出力:
 *   - コンソールに候補アドレス一覧
 *   - config/helix-sm-candidates.json に wallets.json 追記用 JSON
 */

import {
  IndexerGrpcDerivativesApi,
  IndexerRestLeaderboardChronosApi,
} from "@injectivelabs/sdk-ts";
import { getNetworkEndpoints, Network } from "@injectivelabs/networks";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

// ---------- config ----------
const NETWORK = Network.Mainnet;
const MIN_POSITION_MARGIN_USD = 10_000; // $10k+ margin = whale candidate
const TOP_N = 20; // leaderboard top N to fetch

// ---------- init ----------
const endpoints = getNetworkEndpoints(NETWORK);

console.log("=== Injective Network Endpoints ===");
console.log("Indexer:", endpoints.indexer);
console.log("");

// ---------- Approach 1: Leaderboard API ----------
async function fetchLeaderboard() {
  console.log("--- Approach 1: Chronos Leaderboard API ---");

  // The chronos endpoint follows the pattern:
  // ${endpoints.chronos}/api/chronos/v1/leaderboard
  // If endpoints.chronos is not available, try constructing from indexer
  const chronosBase =
    (endpoints as Record<string, string>).chronos ||
    endpoints.indexer.replace("exchange", "chronos");

  const leaderboardUrl = `${chronosBase}/api/chronos/v1/leaderboard`;
  console.log("Leaderboard URL:", leaderboardUrl);

  try {
    const api = new IndexerRestLeaderboardChronosApi(leaderboardUrl);

    // Fetch weekly leaderboard (7d has more signal than 1d)
    const weeklyLb = await api.fetchLeaderboard("7d");
    console.log("\n7d Leaderboard response type:", typeof weeklyLb);
    console.log(
      "7d Leaderboard data (first 5):",
      JSON.stringify(weeklyLb, null, 2).slice(0, 2000)
    );

    return weeklyLb;
  } catch (err) {
    console.error("Leaderboard API failed:", (err as Error).message);
    console.log(
      "Note: The Chronos leaderboard endpoint may require a specific URL."
    );
    console.log("Try checking the Helix frontend network tab for the correct endpoint.\n");
    return null;
  }
}

// ---------- Approach 2: Large Derivative Positions ----------
async function fetchLargePositions() {
  console.log("--- Approach 2: Indexer Derivative Positions ---");

  const derivativesApi = new IndexerGrpcDerivativesApi(endpoints.indexer);

  // Known Helix derivative market IDs (perpetuals)
  // These can be fetched dynamically, but we start with common ones
  const markets = await derivativesApi.fetchMarkets({});
  console.log(`Found ${markets.length} derivative markets`);

  // Show active perpetual markets
  const activePerps = markets.filter(
    (m) => m.isPerpetual && m.marketStatus === "active"
  );
  console.log(
    `Active perpetual markets: ${activePerps.length}`
  );
  activePerps.slice(0, 10).forEach((m) => {
    console.log(`  - ${m.ticker} (${m.marketId.slice(0, 16)}...)`);
  });

  // Fetch ALL open positions (no subaccountId filter = global)
  const allPositions: Array<{
    subaccountId: string;
    marketId: string;
    direction: string;
    quantity: string;
    margin: string;
    entryPrice: string;
    markPrice: string;
    ticker?: string;
  }> = [];

  for (const market of activePerps.slice(0, 5)) {
    // Top 5 markets
    try {
      const positions = await derivativesApi.fetchPositions({
        marketIds: [market.marketId],
      });

      for (const pos of positions.positions) {
        allPositions.push({
          subaccountId: pos.subaccountId,
          marketId: pos.marketId,
          direction: pos.direction,
          quantity: pos.quantity,
          margin: pos.margin,
          entryPrice: pos.entryPrice,
          markPrice: pos.markPrice,
          ticker: market.ticker,
        });
      }

      console.log(
        `  ${market.ticker}: ${positions.positions.length} open positions`
      );
    } catch (err) {
      console.error(
        `  ${market.ticker}: Error fetching positions:`,
        (err as Error).message
      );
    }
  }

  // Sort by margin (proxy for position size)
  allPositions.sort(
    (a, b) => parseFloat(b.margin) - parseFloat(a.margin)
  );

  // Extract unique subaccount addresses with large positions
  const addressMap = new Map<
    string,
    { totalMargin: number; positions: number; markets: string[] }
  >();

  for (const pos of allPositions) {
    // subaccountId format: <inj_address_hex><subaccount_index>
    // First 42 chars = address in hex, need to convert to inj1... format
    const addrHex = pos.subaccountId.slice(0, 42);
    const marginUsd = parseFloat(pos.margin);

    const existing = addressMap.get(addrHex) || {
      totalMargin: 0,
      positions: 0,
      markets: [],
    };
    existing.totalMargin += marginUsd;
    existing.positions += 1;
    if (pos.ticker && !existing.markets.includes(pos.ticker)) {
      existing.markets.push(pos.ticker);
    }
    addressMap.set(addrHex, existing);
  }

  // Filter for large accounts
  const whales = [...addressMap.entries()]
    .filter(([_, data]) => data.totalMargin >= MIN_POSITION_MARGIN_USD)
    .sort((a, b) => b[1].totalMargin - a[1].totalMargin)
    .slice(0, TOP_N);

  console.log(
    `\nLarge position holders (>=$${MIN_POSITION_MARGIN_USD.toLocaleString()} margin):`
  );
  whales.forEach(([addr, data], i) => {
    console.log(
      `  ${i + 1}. ${addr} | Margin: $${data.totalMargin.toFixed(2)} | ${data.positions} pos | Markets: ${data.markets.join(", ")}`
    );
  });

  return whales;
}

// ---------- Approach 3: Recent Large Trades ----------
async function fetchRecentLargeTrades() {
  console.log("\n--- Approach 3: Recent Large Derivative Trades ---");

  const derivativesApi = new IndexerGrpcDerivativesApi(endpoints.indexer);

  try {
    // Fetch recent trades across all markets (no subaccount filter)
    const trades = await derivativesApi.fetchTrades({});

    console.log(`Fetched ${trades.trades.length} recent derivative trades`);

    // Sort by trade size and show top traders
    const traderVolume = new Map<string, number>();
    for (const trade of trades.trades) {
      const addr = trade.subaccountId?.slice(0, 42) || "unknown";
      const size = parseFloat(trade.executionPrice) * parseFloat(trade.executionQuantity);
      traderVolume.set(addr, (traderVolume.get(addr) || 0) + size);
    }

    const topTraders = [...traderVolume.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);

    console.log("Top traders by recent trade volume:");
    topTraders.forEach(([addr, vol], i) => {
      console.log(`  ${i + 1}. ${addr} | Volume: $${vol.toFixed(2)}`);
    });

    return topTraders;
  } catch (err) {
    console.error("Error fetching trades:", (err as Error).message);
    return [];
  }
}

// ---------- main ----------
async function main() {
  console.log("Helix Smart Money Discovery");
  console.log("===========================\n");

  const leaderboard = await fetchLeaderboard();
  const whales = await fetchLargePositions();
  const topTraders = await fetchRecentLargeTrades();

  // Generate wallets.json candidates
  const candidates = whales.map(([addrHex, data], i) => ({
    address: addrHex, // Note: This is hex format, needs bech32 conversion for wallets.json
    exchange: "helix",
    label: `Helix SM Candidate #${i + 1}`,
    category:
      data.totalMargin >= 100_000
        ? "whale"
        : data.positions >= 5
          ? "smart-money"
          : "smart-money",
    source: "indexer-positions-scan",
    active: false, // Set to true after manual verification
    minNotionalUsd: 25000,
    addedAt: new Date().toISOString().split("T")[0],
    notes: `Total margin: $${data.totalMargin.toFixed(0)}, ${data.positions} positions across ${data.markets.join("/")}. Needs bech32 address conversion and manual verification.`,
  }));

  const outPath = resolve(
    import.meta.dirname ?? ".",
    "../config/helix-sm-candidates.json"
  );
  writeFileSync(outPath, JSON.stringify(candidates, null, 2));
  console.log(`\nWrote ${candidates.length} candidates to ${outPath}`);

  console.log("\n=== NEXT STEPS ===");
  console.log("1. Convert hex addresses to inj1... bech32 format");
  console.log("2. Verify each address on https://injscan.com/");
  console.log("3. Check Helix leaderboard at https://helixapp.com/leaderboard/");
  console.log("4. Update config/wallets.json with verified addresses");
  console.log("5. Set active=true for confirmed smart money wallets");
}

main().catch(console.error);
