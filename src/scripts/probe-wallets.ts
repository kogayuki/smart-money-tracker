import { loadWallets, summarizeWallets } from "../wallets/load.js";

async function main() {
  const all = await loadWallets();
  const active = await loadWallets({ onlyActive: true });

  console.log(JSON.stringify({
    tag: "probe-wallets",
    source: all.source,
    defaultMinNotionalUsd: all.defaultMinNotionalUsd,
    total: all.wallets.length,
    active: active.wallets.length,
    by_category_all: summarizeWallets(all.wallets),
    by_category_active: summarizeWallets(active.wallets),
  }, null, 2));

  for (const w of all.wallets) {
    console.log(JSON.stringify({
      addr: w.address,
      label: w.label,
      category: w.category,
      active: w.active,
      minNotionalUsd: w.minNotionalUsd,
    }));
  }
}

main().catch((err) => {
  console.error("[fatal]", err);
  process.exit(1);
});
