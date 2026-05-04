import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import * as v from "valibot";
import { WalletConfig, type Wallet } from "./types.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_CONFIG_PATH = join(HERE, "..", "..", "config", "wallets.json");

export type LoadOptions = {
  path?: string;
  onlyActive?: boolean;
};

export async function loadWallets(opts: LoadOptions = {}): Promise<{
  wallets: Wallet[];
  defaultMinNotionalUsd: number;
  source: string;
}> {
  const path = opts.path ?? DEFAULT_CONFIG_PATH;
  const raw = await readFile(path, "utf-8");
  const json: unknown = JSON.parse(raw);
  const parsed = v.parse(WalletConfig, json);
  const wallets = opts.onlyActive ? parsed.wallets.filter((w) => w.active) : parsed.wallets;
  const seen = new Set<string>();
  for (const w of wallets) {
    if (seen.has(w.address)) {
      throw new Error(`duplicate wallet address: ${w.address}`);
    }
    seen.add(w.address);
  }
  return {
    wallets,
    defaultMinNotionalUsd: parsed.defaultMinNotionalUsd,
    source: path,
  };
}

export function summarizeWallets(wallets: Wallet[]): Record<string, number> {
  const byCategory: Record<string, number> = {};
  for (const w of wallets) {
    byCategory[w.category] = (byCategory[w.category] ?? 0) + 1;
  }
  return byCategory;
}
