import { request } from "undici";
import type { Wallet } from "./wallets/types.js";
import type { SignalDetectedEvent, InsightGeneratedEvent } from "./events/bus.js";

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
const COLOR_SIGNAL_LONG = 0x2196f3; // blue
const COLOR_SIGNAL_SHORT = 0xff9800; // orange
const COLOR_INSIGHT = 0x9c27b0; // purple

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

// ── Signal Embed ──

const SIGNAL_TYPE_LABELS: Record<string, string> = {
  confluence: "Confluence",
  new_entry: "New Entry",
  flow_shift: "Flow Shift",
};

function confidenceBar(value: number): string {
  const filled = Math.round(value * 10);
  return "\u2588".repeat(filled) + "\u2591".repeat(10 - filled) + ` ${Math.round(value * 100)}%`;
}

export function buildSignalEmbed(signal: SignalDetectedEvent): DiscordPayload {
  const isLong = signal.direction === "long";
  const dirEmoji = isLong ? "\uD83D\uDD35" : "\uD83D\uDFE0";
  const direction = isLong ? "LONG" : "SHORT";
  const color = isLong ? COLOR_SIGNAL_LONG : COLOR_SIGNAL_SHORT;

  const priceStr = signal.priceAtSignal.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  const fields: { name: string; value: string; inline?: boolean }[] = [
    { name: "Type", value: SIGNAL_TYPE_LABELS[signal.type] ?? signal.type, inline: true },
    { name: "Direction", value: `${dirEmoji} ${direction}`, inline: true },
    { name: "Confidence", value: confidenceBar(signal.confidence), inline: true },
    { name: "Price", value: `$${priceStr}`, inline: true },
    { name: "Wallets", value: signal.walletLabels.join(", "), inline: true },
  ];

  // Add metadata fields
  const meta = signal.metadata;
  if (meta.totalNotionalUsd) {
    const notStr = (meta.totalNotionalUsd as number).toLocaleString("en-US");
    fields.push({ name: "Total Notional", value: `$${notStr}`, inline: true });
  }
  if (meta.netFlowUsd) {
    const flowStr = (meta.netFlowUsd as number).toLocaleString("en-US");
    fields.push({ name: "Net Flow", value: `$${flowStr}`, inline: true });
  }

  return {
    embeds: [
      {
        title: `${dirEmoji} Signal: ${signal.coin} ${direction}`,
        color,
        fields,
        timestamp: signal.detectedAt.toISOString(),
        footer: { text: "Smart Money Signal" },
      },
    ],
  };
}

// ── Insight Embed ──

export function buildInsightEmbed(insight: InsightGeneratedEvent): DiscordPayload {
  const isLong = insight.direction === "long";
  const dirEmoji = isLong ? "\uD83D\uDFE2" : "\uD83D\uDD34";
  const direction = isLong ? "LONG" : "SHORT";

  const priceStr = insight.priceAtInsight.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  const fields: { name: string; value: string; inline?: boolean }[] = [
    { name: "Score", value: confidenceBar(insight.combinedScore), inline: false },
    { name: "SM Confidence", value: confidenceBar(insight.smConfidence), inline: true },
  ];

  if (insight.pmSentiment !== null) {
    fields.push({ name: "PM Sentiment", value: confidenceBar(insight.pmSentiment), inline: true });
  }

  fields.push(
    { name: "Direction", value: `${dirEmoji} ${direction}`, inline: true },
    { name: "Price", value: `$${priceStr}`, inline: true },
  );

  // Add PM market info from metadata
  const meta = insight.metadata;
  if (meta.pmQuestion) {
    fields.push({
      name: "Polymarket",
      value: `"${meta.pmQuestion}" \u2192 ${Math.round((meta.pmPrice as number) * 100)}%`,
      inline: false,
    });
  }

  if (meta.insightType) {
    fields.push({ name: "Type", value: meta.insightType as string, inline: true });
  }

  return {
    embeds: [
      {
        title: `\uD83D\uDD2E Insight: ${insight.coin} ${direction}`,
        description: insight.summary,
        color: COLOR_INSIGHT,
        fields,
        timestamp: insight.generatedAt.toISOString(),
        footer: { text: "\u26A0\uFE0F \u514D\u8CAC: \u60C5\u5831\u63D0\u4F9B\u76EE\u7684\u306E\u307F\u3002\u6295\u8CC7\u52A9\u8A00\u3067\u306F\u3042\u308A\u307E\u305B\u3093\u3002 | Smart Money Insight" },
      },
    ],
  };
}
