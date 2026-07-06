/**
 * GRVT Executor: executes trades on GRVT exchange via direct REST + EIP-712 signing.
 *
 * Why not the @wezzcoetzee/grvt SDK?
 *  - Its market orders always carry a limit_price field, which GRVT rejects
 *    (error 2020). We use IOC limit orders with a slippage-capped price instead.
 *  - Its EIP-712 signing includes `verifyingContract` in the domain, but GRVT
 *    verifies against a 3-field domain {name, version, chainId} — every order
 *    it signs is rejected with error 2002 "Signature does not match payload".
 *
 * Auth: API-key login via edge (may be geo-blocked from some datacenter IPs),
 * with fallback to the GRVT_TRADE_SESSION_TOKEN env var (refreshed externally).
 */
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import type { SignalDetectedEvent } from "../events/bus.js";
import type { AutoTraderConfig } from "./config.js";

// =============================================================
// Environment / endpoints
// =============================================================

function endpoints(config: AutoTraderConfig) {
  const testnet = config.network === "testnet";
  return {
    edge: testnet ? "https://edge.testnet.grvt.io" : "https://edge.grvt.io",
    trades: testnet ? "https://trades.testnet.grvt.io" : "https://trades.grvt.io",
    marketData: testnet ? "https://market-data.testnet.grvt.io" : "https://market-data.grvt.io",
    chainId: testnet ? 326 : 325,
  };
}

// =============================================================
// Session cookie (gravity=...)
// =============================================================

let session: { cookie: string; expires: number } | null = null;

async function getSessionCookie(config: AutoTraderConfig): Promise<string> {
  if (session && Date.now() < session.expires - 60_000) return session.cookie;

  const staticToken = process.env.GRVT_TRADE_SESSION_TOKEN?.trim();

  if (config.grvtApiKey) {
    try {
      const res = await fetch(`${endpoints(config).edge}/auth/api_key/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_key: config.grvtApiKey }),
      });
      const setCookie = res.headers.get("set-cookie");
      const gravity = setCookie?.match(/gravity=([^;]+)/)?.[1];
      if (res.ok && gravity) {
        const expiresStr = setCookie?.match(/expires=([^;]+)/i)?.[1];
        const expires = expiresStr ? Date.parse(expiresStr) : Date.now() + 5 * 60_000;
        session = { cookie: gravity, expires };
        return gravity;
      }
      console.error(`[auto-trader] GRVT login failed (${res.status}), falling back to static token`);
    } catch (err) {
      console.error("[auto-trader] GRVT login error, falling back to static token:", err instanceof Error ? err.message : err);
    }
  }

  if (staticToken) return staticToken;
  throw new Error("GRVT auth failed: no API key login and no GRVT_TRADE_SESSION_TOKEN");
}

function invalidateSession(): void {
  session = null;
}

// =============================================================
// Instruments
// =============================================================

type GrvtInstrument = {
  instrument: string;
  instrument_hash: string;
  base_decimals: number;
  tick_size: string;
  min_size: string;
};

let instrumentsCache: Map<string, GrvtInstrument> | null = null;

async function getInstrument(config: AutoTraderConfig, symbol: string): Promise<GrvtInstrument> {
  if (!instrumentsCache) {
    const res = await fetch(`${endpoints(config).marketData}/full/v1/all_instruments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: true }),
    });
    if (!res.ok) throw new Error(`GRVT all_instruments failed: ${res.status}`);
    const data = (await res.json()) as { result: GrvtInstrument[] };
    instrumentsCache = new Map(data.result.map((i) => [i.instrument, i]));
  }
  const inst = instrumentsCache.get(symbol);
  if (!inst) throw new Error(`Unknown GRVT instrument: ${symbol}`);
  return inst;
}

function toGrvtSymbol(coin: string): string {
  return `${coin.toUpperCase()}_USDT_Perp`;
}

function fromGrvtSymbol(instrument: string): string {
  return instrument.replace("_USDT_Perp", "");
}

// =============================================================
// Rounding helpers
// =============================================================

function decimalsOf(step: string): number {
  return (step.split(".")[1] ?? "").length;
}

/** Round price to the instrument's tick size. */
function roundToTick(price: number, tickSize: string): number {
  const tick = Number(tickSize);
  const rounded = Math.round(price / tick) * tick;
  return Number(rounded.toFixed(decimalsOf(tickSize)));
}

/** Round quantity down to the instrument's min size step. */
function roundQty(quantity: number, minSize: string): string {
  const step = Number(minSize);
  const floored = Math.floor(quantity / step) * step;
  return floored.toFixed(decimalsOf(minSize));
}

// =============================================================
// Order signing + submission
// =============================================================

const PRICE_MULTIPLIER = 1_000_000_000n;

const EIP712_ORDER_TYPES = {
  Order: [
    { name: "subAccountID", type: "uint64" },
    { name: "isMarket", type: "bool" },
    { name: "timeInForce", type: "uint8" },
    { name: "postOnly", type: "bool" },
    { name: "reduceOnly", type: "bool" },
    { name: "legs", type: "OrderLeg[]" },
    { name: "nonce", type: "uint32" },
    { name: "expiration", type: "int64" },
  ],
  OrderLeg: [
    { name: "assetID", type: "uint256" },
    { name: "contractSize", type: "uint64" },
    { name: "limitPrice", type: "uint64" },
    { name: "isBuyingContract", type: "bool" },
  ],
} as const;

let account: PrivateKeyAccount | null = null;

function getAccount(config: AutoTraderConfig): PrivateKeyAccount {
  if (!account) account = privateKeyToAccount(config.privateKey as `0x${string}`);
  return account;
}

function generateClientOrderId(): string {
  return (2n ** 63n + BigInt(Math.floor(Math.random() * Number(2n ** 53n)))).toString();
}

/**
 * Place a slippage-capped IOC limit order (market-order equivalent).
 */
async function placeIocOrder(
  config: AutoTraderConfig,
  symbol: string,
  side: "buy" | "sell",
  quantity: number,
  referencePrice: number,
  reduceOnly: boolean,
): Promise<{ orderId: string; limitPrice: number; quantity: string }> {
  const inst = await getInstrument(config, symbol);
  const wallet = getAccount(config);
  const { trades, chainId } = endpoints(config);

  const slippageMult = side === "buy" ? 1 + config.slippage : 1 - config.slippage;
  const limitPrice = roundToTick(referencePrice * slippageMult, inst.tick_size);
  const qtyStr = roundQty(quantity, inst.min_size);

  if (Number(qtyStr) <= 0) {
    throw new Error(`Quantity ${quantity} below GRVT min size ${inst.min_size} for ${symbol}`);
  }

  const isBuy = side === "buy";
  const nonce = Math.floor(Math.random() * 1e9);
  const expiration = (BigInt(Date.now() + 24 * 60 * 60 * 1000) * 1_000_000n).toString();

  const signature = await wallet.signTypedData({
    domain: { name: "GRVT Exchange", version: "0", chainId },
    types: EIP712_ORDER_TYPES,
    primaryType: "Order",
    message: {
      subAccountID: BigInt(config.grvtTradingAccountId),
      isMarket: false,
      timeInForce: 3, // IMMEDIATE_OR_CANCEL
      postOnly: false,
      reduceOnly,
      legs: [{
        assetID: BigInt(inst.instrument_hash),
        contractSize: BigInt(Math.round(Number(qtyStr) * 10 ** inst.base_decimals)),
        limitPrice: BigInt(Math.round(limitPrice * Number(PRICE_MULTIPLIER))),
        isBuyingContract: isBuy,
      }],
      nonce,
      expiration: BigInt(expiration),
    },
  });

  const payload = {
    order: {
      sub_account_id: config.grvtTradingAccountId,
      is_market: false,
      time_in_force: "IMMEDIATE_OR_CANCEL",
      post_only: false,
      reduce_only: reduceOnly,
      legs: [{
        instrument: symbol,
        size: qtyStr,
        limit_price: String(limitPrice),
        is_buying_asset: isBuy,
      }],
      signature: {
        signer: wallet.address.toLowerCase(),
        r: `0x${signature.slice(2, 66)}`,
        s: `0x${signature.slice(66, 130)}`,
        v: parseInt(signature.slice(130, 132), 16),
        expiration,
        nonce,
      },
      metadata: {
        client_order_id: generateClientOrderId(),
      },
    },
  };

  const body = await authedPost(config, `${trades}/full/v1/create_order`, payload);
  const result = body.result as { order_id?: string; metadata?: { client_order_id?: string } } | undefined;

  return {
    orderId: String(result?.order_id ?? result?.metadata?.client_order_id ?? "unknown"),
    limitPrice,
    quantity: qtyStr,
  };
}

/** POST with session cookie; retries once on 401 after re-authenticating. */
async function authedPost(
  config: AutoTraderConfig,
  url: string,
  payload: unknown,
): Promise<Record<string, unknown>> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const cookie = await getSessionCookie(config);
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: `gravity=${cookie}` },
      body: JSON.stringify(payload),
    });
    if (res.status === 401 && attempt === 0) {
      invalidateSession();
      continue;
    }
    const text = await res.text();
    if (!res.ok) throw new Error(`GRVT API ${res.status}: ${text.slice(0, 300)}`);
    return JSON.parse(text) as Record<string, unknown>;
  }
  throw new Error("GRVT API: unreachable");
}

// =============================================================
// Public API (used by engine.ts / checker.ts)
// =============================================================

export async function executeGrvtTrade(
  config: AutoTraderConfig,
  signal: SignalDetectedEvent,
): Promise<{ txHash: string; executionPrice: string; quantity: string }> {
  const symbol = toGrvtSymbol(signal.coin);
  const midPrice = await fetchMidPriceBySymbol(config, symbol);

  if (!midPrice || midPrice <= 0) {
    throw new Error(`No mid price for ${signal.coin} on GRVT`);
  }

  const isBuy = signal.direction === "long";
  const quantity = config.positionSizeUsd / midPrice;

  const order = await placeIocOrder(
    config,
    symbol,
    isBuy ? "buy" : "sell",
    quantity,
    midPrice,
    false,
  );

  return {
    txHash: `grvt_${order.orderId}`,
    executionPrice: midPrice.toString(),
    quantity: order.quantity,
  };
}

/**
 * Close a GRVT position with a reduce-only IOC order.
 */
export async function closeGrvtPosition(
  config: AutoTraderConfig,
  coin: string,
  direction: "long" | "short",
  quantity: number,
  currentPrice: number,
): Promise<{ txHash: string; exitPrice: number }> {
  const symbol = toGrvtSymbol(coin);

  // Opposite side to close: sell to close long, buy to close short
  const side = direction === "long" ? "sell" : "buy";

  const order = await placeIocOrder(config, symbol, side, quantity, currentPrice, true);

  return {
    txHash: `grvt_${order.orderId}`,
    exitPrice: currentPrice,
  };
}

/** Fetch open GRVT positions (for restore-on-restart). */
export async function fetchGrvtPositions(
  config: AutoTraderConfig,
): Promise<{ coin: string; direction: "long" | "short"; entryPrice: number; quantity: number }[]> {
  const { trades } = endpoints(config);
  const body = await authedPost(config, `${trades}/full/v1/positions`, {
    sub_account_id: config.grvtTradingAccountId,
  });
  const positions = (body.result ?? []) as { instrument: string; size: string; entry_price: string }[];

  return positions
    .filter((p) => Number(p.size) !== 0)
    .map((p) => {
      const size = Number(p.size);
      return {
        coin: fromGrvtSymbol(p.instrument),
        direction: size > 0 ? ("long" as const) : ("short" as const),
        entryPrice: Number(p.entry_price),
        quantity: Math.abs(size),
      };
    });
}

async function fetchMidPriceBySymbol(config: AutoTraderConfig, symbol: string): Promise<number> {
  const res = await fetch(`${endpoints(config).marketData}/full/v1/mini`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ instrument: symbol }),
  });
  if (!res.ok) throw new Error(`GRVT mini ticker failed for ${symbol}: ${res.status}`);
  const data = (await res.json()) as { result?: { mid_price?: string } };
  return Number(data.result?.mid_price ?? 0);
}

/** Fetch current GRVT mid price for a coin. */
export async function fetchGrvtMidPrice(
  config: AutoTraderConfig,
  coin: string,
): Promise<number> {
  return fetchMidPriceBySymbol(config, toGrvtSymbol(coin));
}

export async function setupGrvtLeverage(
  _config: AutoTraderConfig,
): Promise<void> {
  console.log(`[auto-trader] GRVT: leverage configured via GRVT dashboard (not per-API)`);
}
