import {
  IndexerGrpcDerivativesApi,
  getDefaultSubaccountId,
} from "@injectivelabs/sdk-ts";
import { getNetworkEndpoints, Network } from "@injectivelabs/networks";

/**
 * Check recent trade activity for monitored Helix wallets.
 * Helps diagnose whether wallets are inactive or the gRPC stream is broken.
 */

const MONITORED_WALLETS = [
  { address: "inj1pwk8j5c85hu2tgr608fntdq6u5eqk0cqvwajuu", label: "Helix Whale #1" },
  { address: "inj1tlatz9jq7s34y6zurg67zfgqajvrjg9wsprqyu", label: "Helix SM #1" },
  { address: "inj1w587jqdxpygatpl8jt6j74g8hh36tw5vmecuek", label: "Helix SM #2" },
  { address: "inj12vpajtjf5cvmk2w737m0t8qwwkyjz0xgvxwyus", label: "Helix SM #3 (Multi-Sub)" },
];

async function main() {
  const endpoints = getNetworkEndpoints(Network.Mainnet);
  const indexerEndpoint = process.env.INJECTIVE_INDEXER_URL ?? endpoints.indexer;
  console.log(`[check-activity] indexer: ${indexerEndpoint}\n`);

  const api = new IndexerGrpcDerivativesApi(indexerEndpoint);

  for (const wallet of MONITORED_WALLETS) {
    const subaccountId = getDefaultSubaccountId(wallet.address);
    console.log(`${"=".repeat(60)}`);
    console.log(`${wallet.label} (${wallet.address})`);
    console.log(`subaccount: ${subaccountId.slice(0, 20)}...`);

    // Check open positions
    try {
      const posResult = await api.fetchPositions({ subaccountId });
      const positions = posResult.positions;
      console.log(`\n  Open positions: ${positions.length}`);
      for (const pos of positions) {
        const margin = parseFloat(pos.margin);
        const qty = parseFloat(pos.quantity);
        console.log(
          `    ${pos.direction} | margin=$${margin.toLocaleString("en-US", { maximumFractionDigits: 2 })} | qty=${qty} | market=${pos.marketId.slice(0, 12)}...`,
        );
      }
    } catch (err) {
      console.error(`  Positions error: ${err instanceof Error ? err.message : err}`);
    }

    // Check recent trades
    try {
      const result = await api.fetchTrades({ subaccountId });
      const trades = result.trades;
      console.log(`\n  Recent trades: ${trades.length}`);
      const recentTrades = trades.slice(0, 5);
      for (const t of recentTrades) {
        const execAt = t.executedAt
          ? new Date(typeof t.executedAt === "number" ? t.executedAt : parseInt(String(t.executedAt), 10)).toISOString()
          : "unknown";
        console.log(
          `    ${t.tradeDirection} | price=${t.executionPrice} | qty=${t.executionQuantity} | at=${execAt} | market=${t.marketId.slice(0, 12)}...`,
        );
      }

      if (trades.length > 0) {
        const latest = trades[0];
        const latestTime = latest?.executedAt
          ? typeof latest.executedAt === "number" ? latest.executedAt : parseInt(String(latest.executedAt), 10)
          : 0;
        const ageMs = Date.now() - latestTime;
        const ageHours = Math.round(ageMs / 3600000);
        console.log(`\n  Last trade: ${ageHours}h ago`);
      }
    } catch (err) {
      console.error(`  Trades error: ${err instanceof Error ? err.message : err}`);
    }

    console.log();
  }
}

main().catch((err) => {
  console.error("[fatal]", err);
  process.exit(1);
});
