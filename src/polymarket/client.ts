import { request } from "undici";
import type { GammaEventsResponse, GammaMarket, PolymarketMarket } from "./types.js";

const GAMMA_API_BASE = "https://gamma-api.polymarket.com";

// ── Coin mapping from question text ──

const COIN_PATTERNS: [RegExp, string][] = [
  [/\bBitcoin\b|\bBTC\b/i, "BTC"],
  [/\bEthereum\b|\bETH\b/i, "ETH"],
  [/\bSolana\b|\bSOL\b/i, "SOL"],
  [/\bXRP\b/i, "XRP"],
  [/\bDogecoin\b|\bDOGE\b/i, "DOGE"],
  [/\bCardano\b|\bADA\b/i, "ADA"],
  [/\bAvalanche\b|\bAVAX\b/i, "AVAX"],
  [/\bPolygon\b|\bMATIC\b|\bPOL\b/i, "POL"],
  [/\bChainlink\b|\bLINK\b/i, "LINK"],
  [/\bLitecoin\b|\bLTC\b/i, "LTC"],
  [/\bPolkadot\b|\bDOT\b/i, "DOT"],
  [/\bUniswap\b|\bUNI\b/i, "UNI"],
  [/\bArbitrum\b|\bARB\b/i, "ARB"],
  [/\bOptimism\b|\bOP\b/i, "OP"],
  [/\bInjective\b|\bINJ\b/i, "INJ"],
  [/\bSUI\b/i, "SUI"],
  [/\bAPT\b|\bAptos\b/i, "APT"],
  [/\bPEPE\b/i, "PEPE"],
  [/\bWIF\b/i, "WIF"],
];

function extractCoin(question: string): string | null {
  for (const [pattern, coin] of COIN_PATTERNS) {
    if (pattern.test(question)) return coin;
  }
  return null;
}

function parseMarket(raw: GammaMarket): PolymarketMarket {
  let outcomes: string[];
  let outcomePrices: number[];

  try {
    outcomes = JSON.parse(raw.outcomes) as string[];
  } catch {
    outcomes = [];
  }

  try {
    outcomePrices = (JSON.parse(raw.outcomePrices) as string[]).map(Number);
  } catch {
    outcomePrices = [];
  }

  return {
    id: raw.id,
    question: raw.question,
    slug: raw.slug,
    coin: extractCoin(raw.question),
    outcomes,
    outcomePrices,
    volume24h: raw.volume24hr ?? 0,
    liquidity: parseFloat(raw.liquidity) || 0,
    active: raw.active && !raw.closed,
    endDate: raw.endDate || null,
  };
}

export async function fetchCryptoEvents(): Promise<PolymarketMarket[]> {
  const url = `${GAMMA_API_BASE}/events?tag=crypto&active=true&closed=false&limit=100`;

  const res = await request(url, {
    method: "GET",
    headers: { accept: "application/json" },
  });

  if (res.statusCode >= 300) {
    const text = await res.body.text();
    throw new Error(`Gamma API ${res.statusCode}: ${text}`);
  }

  const events = (await res.body.json()) as GammaEventsResponse;
  const markets: PolymarketMarket[] = [];

  for (const event of events) {
    for (const market of event.markets) {
      markets.push(parseMarket(market));
    }
  }

  return markets;
}
