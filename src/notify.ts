import { request } from "undici";
import type { Wallet } from "./wallets/types.js";

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

type DiscordEmbed = {
  title?: string;
  description?: string;
  color?: number;
  fields?: { name: string; value: string; inline?: boolean }[];
  url?: string;
  timestamp?: string;
  footer?: { text: string };
};

type DiscordPayload = {
  content?: string;
  embeds?: DiscordEmbed[];
};

export async function notifyDiscord(payload: string | DiscordPayload): Promise<void> {
  if (!DISCORD_WEBHOOK_URL) {
    console.warn("[notify] DISCORD_WEBHOOK_URL not set, skipping");
    return;
  }
  const body = typeof payload === "string" ? { content: payload } : payload;
  const res = await request(DISCORD_WEBHOOK_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.statusCode >= 300) {
    const text = await res.body.text();
    throw new Error(`Discord webhook ${res.statusCode}: ${text}`);
  }
}

export type Fill = {
  coin: string;
  px: string;
  sz: string;
  side: "B" | "A";
  hash: `0x${string}`;
  time: number;
};

const COLOR_LONG = 0x00c853; // green
const COLOR_SHORT = 0xff1744; // red

export function buildFillEmbed(fill: Fill, wallet: Wallet): DiscordPayload {
  const isLong = fill.side === "B";
  const direction = isLong ? "LONG" : "SHORT";
  const dirEmoji = isLong ? "\uD83D\uDFE2" : "\uD83D\uDD34";
  const price = parseFloat(fill.px);
  const size = parseFloat(fill.sz);
  const notional = price * size;

  const priceStr = price.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const notionalStr = notional.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });

  const explorerUrl = `https://app.hyperliquid.xyz/explorer/tx/${fill.hash}`;

  return {
    embeds: [
      {
        title: `${dirEmoji} ${direction}  ${fill.coin}`,
        color: isLong ? COLOR_LONG : COLOR_SHORT,
        fields: [
          { name: "Wallet", value: wallet.label, inline: true },
          { name: "Category", value: wallet.category, inline: true },
          { name: "\u200b", value: "\u200b", inline: true },
          { name: "Size", value: `${fill.sz} ${fill.coin}`, inline: true },
          { name: "Notional", value: `$${notionalStr}`, inline: true },
          { name: "Price", value: `$${priceStr}`, inline: true },
        ],
        url: explorerUrl,
        timestamp: new Date(fill.time).toISOString(),
        footer: { text: "Smart Money Tracker" },
      },
    ],
  };
}
