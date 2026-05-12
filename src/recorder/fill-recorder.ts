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
    sql`
      INSERT INTO sm_fills (
        coin, side, px, sz, notional_usd, time_ms, hash,
        oid, tid, crossed, fee, fee_token,
        start_position, closed_pnl, dir,
        wallet_address, wallet_label, wallet_category
      ) VALUES (
        ${fill.coin}, ${fill.side}, ${fill.px}, ${fill.sz},
        ${fill.notionalUsd}, ${fill.time}, ${fill.hash},
        ${fill.oid}, ${fill.tid}, ${fill.crossed},
        ${toNumericOrNull(fill.fee)}, ${fill.feeToken},
        ${toNumericOrNull(fill.startPosition)}, ${toNumericOrNull(fill.closedPnl)}, ${fill.dir || null},
        ${fill.walletAddress}, ${fill.walletLabel}, ${fill.walletCategory}
      )
      ON CONFLICT (hash) DO NOTHING
      RETURNING id
    `
      .then((res) => {
        if (res.length === 0) {
          console.log(`[fill-recorder] duplicate hash=${fill.hash}`);
        } else {
          console.log(`[fill-recorder] saved id=${res[0]?.id} ${fill.walletLabel} ${fill.side === "B" ? "LONG" : "SHORT"} ${fill.coin} $${Math.round(fill.notionalUsd).toLocaleString()}`);
        }
      })
      .catch((err) => {
        console.error(
          `[fill-recorder] insert error for ${fill.walletLabel} ${fill.coin}:`,
          err instanceof Error ? err.message : err,
          { hash: fill.hash, px: fill.px, sz: fill.sz, fee: fill.fee, startPosition: fill.startPosition, closedPnl: fill.closedPnl },
        );
      });
  });

  console.log("[fill-recorder] listening for sm:fill events");
}
