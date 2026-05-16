import {
  IndexerGrpcDerivativesApi,
  getInjectiveAddress,
} from "@injectivelabs/sdk-ts";
import { getNetworkEndpoints, Network } from "@injectivelabs/networks";

/**
 * Probe Helix (Injective) derivative markets to find large position holders.
 * Uses the Indexer Positions API without subaccountId to get ALL positions,
 * then ranks by margin size to identify smart money wallets.
 */

async function main() {
  const endpoints = getNetworkEndpoints(Network.Mainnet);
  const indexerEndpoint = process.env.INJECTIVE_INDEXER_URL ?? endpoints.indexer;
  console.log(`[probe-helix] indexer: ${indexerEndpoint}`);

  const api = new IndexerGrpcDerivativesApi(indexerEndpoint);

  // Step 1: Get derivative markets
  console.log("\n[probe-helix] Fetching derivative markets...");
  const markets = await api.fetchMarkets();
  console.log(`[probe-helix] Found ${markets.length} derivative markets:`);
  for (const m of markets) {
    console.log(`  ${m.ticker} (${m.marketId.slice(0, 16)}...)`);
  }

  // Step 2: For top markets, fetch positions and find large holders
  // Focus on high-liquidity markets
  const targetTickers = ["BTC/USDT", "ETH/USDT", "INJ/USDT"];
  const topMarkets = markets.filter((m) =>
    targetTickers.some((t) => m.ticker.startsWith(t)),
  );

  console.log(`\n[probe-helix] Scanning ${topMarkets.length} top market(s) for large positions...`);

  // subaccountId → aggregated info
  const walletMap = new Map<
    string,
    { markets: string[]; totalMargin: number; positionCount: number }
  >();

  for (const market of topMarkets) {
    console.log(`\n--- ${market.ticker} ---`);
    try {
      const result = await api.fetchPositions({ marketId: market.marketId });
      const positions = result.positions;
      console.log(`  ${positions.length} open position(s)`);

      for (const pos of positions) {
        const margin = parseFloat(pos.margin);
        const subaccountId = pos.subaccountId;
        if (!subaccountId) continue;

        const existing = walletMap.get(subaccountId);
        if (existing) {
          existing.markets.push(market.ticker);
          existing.totalMargin += margin;
          existing.positionCount++;
        } else {
          walletMap.set(subaccountId, {
            markets: [market.ticker],
            totalMargin: margin,
            positionCount: 1,
          });
        }
      }
    } catch (err) {
      console.error(
        `  Error fetching positions for ${market.ticker}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  // Step 3: Rank by total margin and output top wallets
  const sorted = [...walletMap.entries()]
    .sort((a, b) => b[1].totalMargin - a[1].totalMargin)
    .slice(0, 20);

  console.log(`\n${"=".repeat(60)}`);
  console.log(`TOP 20 WALLETS BY TOTAL MARGIN (across ${topMarkets.length} markets)`);
  console.log("=".repeat(60));

  for (const [subaccountId, info] of sorted) {
    // Convert subaccountId (0x...) to inj1... address
    // subaccountId = ethAddress (40 hex) + nonce (24 hex)
    const ethHex = subaccountId.slice(0, 42); // 0x + 40 hex chars
    let injAddress: string;
    try {
      injAddress = getInjectiveAddress(ethHex);
    } catch {
      injAddress = `(cannot convert: ${ethHex.slice(0, 16)}...)`;
    }

    console.log(
      `\n  Address:     ${injAddress}` +
        `\n  SubaccountId: ${subaccountId.slice(0, 20)}...` +
        `\n  Margin:      $${info.totalMargin.toLocaleString("en-US", { maximumFractionDigits: 0 })}` +
        `\n  Positions:   ${info.positionCount} (${info.markets.join(", ")})`,
    );
  }

  // Step 4: Output wallets.json candidates
  console.log(`\n${"=".repeat(60)}`);
  console.log("WALLETS.JSON CANDIDATES (top 5, margin > $10k)");
  console.log("=".repeat(60));

  const candidates = sorted
    .filter(([, info]) => info.totalMargin > 10_000)
    .slice(0, 5);

  const jsonEntries = candidates.map(([subaccountId, info], i) => {
    const ethHex = subaccountId.slice(0, 42);
    let injAddress: string;
    try {
      injAddress = getInjectiveAddress(ethHex);
    } catch {
      injAddress = "UNKNOWN";
    }

    return {
      address: injAddress,
      exchange: "helix" as const,
      label: `Helix SM #${i + 1}`,
      category: info.totalMargin > 100_000 ? "whale" : "smart-money",
      source: "onchain-screen" as const,
      active: true,
      minNotionalUsd: 25000,
      addedAt: new Date().toISOString().slice(0, 10),
      notes: `Margin $${Math.round(info.totalMargin).toLocaleString()}. ${info.positionCount} position(s) in ${info.markets.join(", ")}. Auto-detected via Indexer Positions API.`,
    };
  });

  console.log(JSON.stringify(jsonEntries, null, 2));
}

main().catch((err) => {
  console.error("[fatal]", err);
  process.exit(1);
});
