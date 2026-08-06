/**
 * GRVT geo-block probe: GRVT blocks Fly's datacenter egress IP since 2026-07-24
 * ("Access from this location is not allowed"), so GRVT trading is disabled.
 * Probe hourly from this machine's IP and alert Discord once when access
 * recovers, so we know when GRVT can be re-enabled.
 */
import { notifyDiscord } from "../notify.js";

const PROBE_INTERVAL_MS = 60 * 60_000;
const LOGIN_URL = "https://edge.grvt.io/auth/api_key/login";

let lastBlocked: boolean | null = null;

async function probe(): Promise<void> {
  try {
    // Must probe with a VALID key: GRVT validates the key BEFORE the geo
    // check, so an invalid key returns "api_key not found" even from a
    // blocked IP (this caused a false "unblocked" alert on 2026-07-27).
    // With a valid key, a blocked IP returns "Access from this location is
    // not allowed." while an allowed IP returns 200 + gravity cookie.
    const apiKey = process.env.AUTO_TRADER_GRVT_API_KEY;
    if (!apiKey) return;
    const res = await fetch(LOGIN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_key: apiKey }),
    });
    const body = await res.text();
    const blocked = body.includes("not allowed");

    if (lastBlocked !== null && lastBlocked !== blocked) {
      const msg = blocked
        ? "🚫 GRVT geo-block再発: このIPからのアクセスが再びブロックされました"
        : "✅ **GRVT geo-block解除を検知**: FlyのIPからアクセス可能になりました。GRVT取引の再開を検討してください";
      notifyDiscord(msg).catch((err) => {
        console.error("[grvt-geo-probe] Discord notify error:", err);
      });
    }

    if (lastBlocked !== blocked) {
      console.log(`[grvt-geo-probe] GRVT access: ${blocked ? "BLOCKED" : "OK"}`);
    }
    lastBlocked = blocked;
  } catch (err) {
    console.error("[grvt-geo-probe] probe failed:", err instanceof Error ? err.message : err);
  }
}

export function startGrvtGeoProbe(): () => void {
  void probe();
  const interval = setInterval(() => void probe(), PROBE_INTERVAL_MS);
  console.log(`[grvt-geo-probe] probing GRVT access every ${PROBE_INTERVAL_MS / 60_000}min`);
  return () => clearInterval(interval);
}
