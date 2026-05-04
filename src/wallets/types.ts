import * as v from "valibot";

export const WalletCategory = v.picklist([
  "smart-money",
  "whale",
  "market-maker",
  "vault",
  "watchlist",
]);

export const WalletSource = v.picklist([
  "manual",
  "hyperdash-leaderboard",
  "onchain-screen",
  "community-tip",
  "test",
]);

export const Wallet = v.object({
  address: v.pipe(
    v.string(),
    v.regex(/^0x[a-fA-F0-9]{40}$/, "must be a valid 0x address"),
    v.transform((s) => s.toLowerCase() as `0x${string}`),
  ),
  label: v.pipe(v.string(), v.minLength(1)),
  category: WalletCategory,
  source: WalletSource,
  active: v.boolean(),
  minNotionalUsd: v.pipe(v.number(), v.minValue(0)),
  addedAt: v.pipe(v.string(), v.isoDate()),
  notes: v.optional(v.string(), ""),
});

export type Wallet = v.InferOutput<typeof Wallet>;

export const WalletConfig = v.object({
  version: v.literal(1),
  defaultMinNotionalUsd: v.pipe(v.number(), v.minValue(0)),
  wallets: v.array(Wallet),
});

export type WalletConfig = v.InferOutput<typeof WalletConfig>;
