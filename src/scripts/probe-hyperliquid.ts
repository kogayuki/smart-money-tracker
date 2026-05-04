import { WebSocketTransport } from "@nktkas/hyperliquid";
import { allMids, trades, userFills } from "@nktkas/hyperliquid/api/subscription";

const PROBE_DURATION_MS = 15_000;
const PROBE_USER: `0x${string}` = "0x31ca8395cf837de08b24da3f660e77761dfb974b";

type Counters = {
  allMids: number;
  btcTrades: number;
  userFills: number;
  errors: number;
};

const counters: Counters = { allMids: 0, btcTrades: 0, userFills: 0, errors: 0 };

function log(tag: string, msg: string, extra: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), tag, msg, ...extra }));
}

async function main() {
  log("probe", "starting", { duration_ms: PROBE_DURATION_MS, user: PROBE_USER });
  const transport = new WebSocketTransport();
  const config = { transport };

  let firstAllMids: unknown = null;
  let firstBtcTrade: unknown = null;
  let firstUserFills: unknown = null;

  const subs = await Promise.all([
    allMids(config, (data) => {
      counters.allMids++;
      if (!firstAllMids) {
        firstAllMids = data;
        const sampleCoins = Object.keys(data.mids).slice(0, 5);
        log("allMids", "first event", {
          total_coins: Object.keys(data.mids).length,
          sample: sampleCoins.map((c) => `${c}=${data.mids[c]}`),
        });
      }
    }),
    trades(config, { coin: "BTC" }, (data) => {
      counters.btcTrades++;
      if (!firstBtcTrade && data.length > 0) {
        firstBtcTrade = data[0];
        log("trades", "first event", { batch_size: data.length, sample: data[0] });
      }
    }),
    userFills(config, { user: PROBE_USER }, (data) => {
      counters.userFills++;
      if (!firstUserFills) {
        firstUserFills = data;
        log("userFills", "first event", {
          user: data.user,
          isSnapshot: data.isSnapshot ?? false,
          fills_count: data.fills.length,
          first_fill: data.fills[0],
        });
      }
    }),
  ]).catch((err) => {
    counters.errors++;
    log("probe", "subscribe error", { error: err instanceof Error ? err.message : String(err) });
    throw err;
  });

  log("probe", "subscribed, waiting", {});
  await new Promise((resolve) => setTimeout(resolve, PROBE_DURATION_MS));

  log("probe", "summary", { ...counters });

  await Promise.all(subs.map((s) => s.unsubscribe()));
  await transport.close();
  log("probe", "shutdown clean", {});
}

main().catch((err) => {
  log("probe", "fatal", { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
