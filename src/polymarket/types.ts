// ── Gamma API response types ──

export type GammaMarket = {
  id: string;
  question: string;
  slug: string;
  outcomePrices: string; // JSON-encoded: '["0.78","0.22"]'
  outcomes: string; // JSON-encoded: '["Yes","No"]'
  volume24hr: number;
  liquidity: string;
  active: boolean;
  closed: boolean;
  endDate: string;
  bestBid: number;
  bestAsk: number;
};

export type GammaEvent = {
  id: string;
  title: string;
  slug: string;
  markets: GammaMarket[];
};

export type GammaEventsResponse = GammaEvent[];

// ── Internal types ──

export type PolymarketMarket = {
  id: string;
  question: string;
  slug: string;
  coin: string | null;
  outcomes: string[];
  outcomePrices: number[];
  volume24h: number;
  liquidity: number;
  active: boolean;
  endDate: string | null;
};
