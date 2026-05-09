import type { EventBus, SmFillEvent } from "../events/bus.js";
import { getDb } from "../db/client.js";

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
        ${fill.fee}, ${fill.feeToken},
        ${fill.startPosition || null}, ${fill.closedPnl || null}, ${fill.dir || null},
        ${fill.walletAddress}, ${fill.walletLabel}, ${fill.walletCategory}
      )
      ON CONFLICT (hash) DO NOTHING
    `
      .then((res) => {
        if (res.length === 0) {
          console.log(`[fill-recorder] duplicate skipped hash=${fill.hash}`);
        } else {
          console.log(`[fill-recorder] saved ${fill.walletLabel} ${fill.coin} ${fill.side}`);
        }
      })
      .catch((err) => {
        console.error("[fill-recorder] insert error:", err);
      });
  });

  console.log("[fill-recorder] listening for sm:fill events");
}
