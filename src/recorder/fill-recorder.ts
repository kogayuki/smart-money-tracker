import type { EventBus, SmFillEvent } from "../events/bus.js";
import { getDb } from "../db/client.js";

function toNumericOrNull(value: string | undefined | null): string | null {
  if (value === undefined || value === null || value === "") return null;
  return value;
}

export function startFillRecorder(bus: EventBus): void {
  const sql = getDb();
  if (!sql) {
    console.warn("[fill-recorder] DB not available — skipping fill recording");
    return;
  }

  bus.on("sm:fill", (fill: SmFillEvent) => {
    // Use hash (HL) or txHash+tradeId (Helix) as unique key
    const uniqueHash = fill.hash ?? `${fill.txHash}:${fill.tradeId}`;

    sql`
      INSERT INTO sm_fills (
        coin, side, px, sz, notional_usd, time_ms, hash,
        oid, tid, crossed, fee, fee_token,
        start_position, closed_pnl, dir,
        wallet_address, wallet_label, wallet_category,
        exchange, tx_hash
      ) VALUES (
        ${fill.coin}, ${fill.side}, ${fill.px}, ${fill.sz},
        ${fill.notionalUsd}, ${fill.time}, ${uniqueHash},
        ${fill.oid ?? null}, ${fill.tid ?? null}, ${fill.crossed ?? false},
        ${toNumericOrNull(fill.fee) ?? "0"}, ${fill.feeToken ?? "USDC"},
        ${toNumericOrNull(fill.startPosition)}, ${toNumericOrNull(fill.closedPnl)}, ${fill.dir || null},
        ${fill.walletAddress}, ${fill.walletLabel}, ${fill.walletCategory},
        ${fill.exchange}, ${fill.txHash ?? null}
      )
      ON CONFLICT (hash) DO NOTHING
      RETURNING id
    `
      .then((res) => {
        if (res.length === 0) {
          console.log(`[fill-recorder] duplicate hash=${uniqueHash}`);
        } else {
          console.log(`[fill-recorder] saved id=${res[0]?.id} [${fill.exchange}] ${fill.walletLabel} ${fill.side === "B" ? "LONG" : "SHORT"} ${fill.coin} $${Math.round(fill.notionalUsd).toLocaleString()}`);
        }
      })
      .catch((err) => {
        console.error(
          `[fill-recorder] insert error for ${fill.walletLabel} ${fill.coin}:`,
          err instanceof Error ? err.message : err,
          { hash: uniqueHash, px: fill.px, sz: fill.sz, fee: fill.fee, startPosition: fill.startPosition, closedPnl: fill.closedPnl },
        );
      });
  });

  console.log("[fill-recorder] listening for sm:fill events");
}
