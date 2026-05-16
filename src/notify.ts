import { request } from "undici";
import type { Wallet } from "./wallets/types.js";
import type {
  SignalDetectedEvent,
  InsightGeneratedEvent,
  PaperTradeOpenEvent,
  PaperTradeCloseEvent,
  Exchange,
} from "./events/bus.js";

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
  exchange: Exchange;
  coin: string;
  px: string;
  sz: string;
  side: "B" | "A";
  time: number;
  hash?: `0x${string}`;
  txHash?: string;
};

// Fill embed colors — different palettes per exchange for instant recognition
const FILL_COLORS: Record<Exchange, { long: number; short: number }> = {
  hyperliquid: { long: 0x00c853, short: 0xff1744 },   // green / red
  helix:       { long: 0x00bcd4, short: 0xe040fb },   // cyan  / magenta
};
const COLOR_SIGNAL_LONG = 0x2196f3; // blue
const COLOR_SIGNAL_SHORT = 0xff9800; // orange
const COLOR_INSIGHT = 0x9c27b0; // purple
const COLOR_PAPER_OPEN = 0x607d8b; // blue-grey
const COLOR_PAPER_WIN = 0x4caf50; // green
const COLOR_PAPER_LOSS = 0xf44336; // red

function getExplorerUrl(fill: Fill): string | undefined {
  switch (fill.exchange) {
    case "hyperliquid":
      return fill.hash
        ? `https://app.hyperliquid.xyz/explorer/tx/${fill.hash}`
        : undefined;
    case "helix":
      return fill.txHash
        ? `https://explorer.injective.network/transaction/${fill.txHash}`
        : undefined;
    default:
      return undefined;
  }
}

const EXCHANGE_BADGES: Record<Exchange, string> = {
  hyperliquid: "\u26A1HL",
  helix: "\uD83C\uDF00Helix",
};

const CATEGORY_JA: Record<string, string> = {
  "smart-money": "\u30B9\u30DE\u30FC\u30C8\u30DE\u30CD\u30FC",
  "whale": "\u5927\u53E3\u6295\u8CC7\u5BB6",
  "market-maker": "\u30DE\u30FC\u30B1\u30C3\u30C8\u30E1\u30FC\u30AB\u30FC",
};

function buildActionLinks(coin: string, fill: Fill): string {
  const links: string[] = [];
  links.push(`[\uD83D\uDCC8 \u30C1\u30E3\u30FC\u30C8](https://www.tradingview.com/chart/?symbol=${encodeURIComponent(coin)}USDT)`);
  links.push(`[\uD83D\uDD0D Grok\u3067\u5206\u6790](https://x.com/i/grok?text=${encodeURIComponent(coin + " \u6700\u65B0\u306E\u4FA1\u683C\u52D5\u5411\u3068\u30CB\u30E5\u30FC\u30B9\u3092\u5206\u6790\u3057\u3066")})`);
  const explorerUrl = getExplorerUrl(fill);
  if (explorerUrl) {
    links.push(`[\uD83D\uDD17 Explorer](${explorerUrl})`);
  }
  return links.join(" \u00B7 ");
}

export function buildFillEmbed(fill: Fill, wallet: Wallet): DiscordPayload {
  const isLong = fill.side === "B";
  const dirJa = isLong ? "\u30ED\u30F3\u30B0" : "\u30B7\u30E7\u30FC\u30C8";
  const dirAction = isLong ? "\u30ED\u30F3\u30B0\uFF08\u8CB7\u3044\uFF09" : "\u30B7\u30E7\u30FC\u30C8\uFF08\u58F2\u308A\uFF09";
  const signalJa = isLong ? "\u4E0A\u6607" : "\u4E0B\u843D";
  const dirEmoji = isLong ? "\uD83D\uDFE2" : "\uD83D\uDD34";
  const badge = EXCHANGE_BADGES[fill.exchange] ?? fill.exchange;
  const palette = FILL_COLORS[fill.exchange] ?? FILL_COLORS.hyperliquid;
  const categoryJa = CATEGORY_JA[wallet.category] ?? wallet.category;
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

  // Narrative description
  const narrative =
    `${categoryJa}\u300C${wallet.label}\u300D\u304C${fill.coin}\u3092**$${notionalStr}**\u5206${dirAction}\u3057\u307E\u3057\u305F\u3002\n` +
    `\u2192 \u77ED\u671F\u7684\u306A${signalJa}\u5727\u529B\u306E\u30B7\u30B0\u30CA\u30EB\u3067\u3059\u3002`;

  const links = buildActionLinks(fill.coin, fill);
  const description = `${narrative}\n\n${links}`;

  return {
    embeds: [
      {
        title: `${badge} ${dirEmoji} ${fill.coin} ${dirJa}`,
        description,
        color: isLong ? palette.long : palette.short,
        fields: [
          { name: "\u53D6\u5F15\u984D", value: `$${notionalStr}`, inline: true },
          { name: "\u4FA1\u683C", value: `$${priceStr}`, inline: true },
        ],
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

// ── Paper Trade Embeds ──

const SIGNAL_TYPE_LABELS_JA: Record<string, string> = {
  confluence: "Confluence",
  new_entry: "New Entry",
  flow_shift: "Flow Shift",
};

function fmtUsd(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function buildPaperOpenEmbed(event: PaperTradeOpenEvent): DiscordPayload {
  const isLong = event.direction === "long";
  const dirEmoji = isLong ? "\uD83D\uDCC8" : "\uD83D\uDCC9";
  const dirJa = isLong ? "\u30ED\u30F3\u30B0" : "\u30B7\u30E7\u30FC\u30C8";
  const signalLabel = SIGNAL_TYPE_LABELS_JA[event.signalType] ?? event.signalType;
  const confPct = Math.round(event.signalConfidence * 100);

  const description =
    `${event.coin}\u306E${dirJa}\u30DD\u30B8\u30B7\u30E7\u30F3\u3092\u30A8\u30F3\u30C8\u30EA\u30FC\u3057\u307E\u3057\u305F\u3002\n` +
    `\u30B7\u30B0\u30CA\u30EB: ${signalLabel} (\u78BA\u4FE1\u5EA6: ${confPct}%)`;

  return {
    embeds: [
      {
        title: `\uD83D\uDCDD \u30DA\u30FC\u30D1\u30FC\u30C8\u30EC\u30FC\u30C9 ${dirEmoji} ${event.coin} ${dirJa}`,
        description,
        color: COLOR_PAPER_OPEN,
        fields: [
          { name: "\u30A8\u30F3\u30C8\u30EA\u30FC\u4FA1\u683C", value: `$${fmtUsd(event.entryPrice)}`, inline: true },
          { name: "\u30DD\u30B8\u30B7\u30E7\u30F3\u30B5\u30A4\u30BA", value: `$${fmtUsd(event.positionSizeUsd)}`, inline: true },
          { name: "\u5229\u78BA (TP)", value: `$${fmtUsd(event.tpPrice)}`, inline: true },
          { name: "\u640D\u5207 (SL)", value: `$${fmtUsd(event.slPrice)}`, inline: true },
        ],
        timestamp: event.openedAt.toISOString(),
        footer: { text: "\u26A0\uFE0F \u30DA\u30FC\u30D1\u30FC\u30C8\u30EC\u30FC\u30C9\uFF08\u4EEE\u60F3\u53D6\u5F15\uFF09 | Smart Money Tracker" },
      },
    ],
  };
}

export function buildPaperCloseEmbed(event: PaperTradeCloseEvent): DiscordPayload {
  const isLong = event.direction === "long";
  const dirJa = isLong ? "\u30ED\u30F3\u30B0" : "\u30B7\u30E7\u30FC\u30C8";
  const isProfit = event.pnlUsd >= 0;
  const statusIcon = isProfit ? "\u2705" : "\u274C";
  const color = isProfit ? COLOR_PAPER_WIN : COLOR_PAPER_LOSS;
  const signalLabel = SIGNAL_TYPE_LABELS_JA[event.signalType] ?? event.signalType;
  const confPct = Math.round(event.signalConfidence * 100);

  const statusLabels: Record<string, string> = {
    closed_tp: "\u5229\u78BA (TP\u5230\u9054)",
    closed_sl: "\u640D\u5207 (SL\u5230\u9054)",
    closed_timeout: "\u30BF\u30A4\u30E0\u30A2\u30A6\u30C8",
  };
  const statusLabel = statusLabels[event.status] ?? event.status;

  const holdMs = event.closedAt.getTime() - event.openedAt.getTime();
  const holdH = Math.floor(holdMs / 3_600_000);
  const holdM = Math.floor((holdMs % 3_600_000) / 60_000);
  const holdStr = `${holdH}\u6642\u9593${holdM}\u5206`;

  const pnlSign = isProfit ? "+" : "";
  const pnlStr = `${pnlSign}${event.pnlPct.toFixed(2)}% (${pnlSign}$${fmtUsd(Math.abs(event.pnlUsd))})`;

  const description =
    `${statusLabel} \u306B\u3088\u308A\u6C7A\u6E08\u3057\u307E\u3057\u305F\u3002\n` +
    `P&L: **${pnlStr}**`;

  return {
    embeds: [
      {
        title: `\uD83D\uDCCA \u30DA\u30FC\u30D1\u30FC\u30C8\u30EC\u30FC\u30C9\u6C7A\u6E08 ${statusIcon} ${event.coin} ${dirJa}`,
        description,
        color,
        fields: [
          { name: "\u30A8\u30F3\u30C8\u30EA\u30FC", value: `$${fmtUsd(event.entryPrice)}`, inline: true },
          { name: "\u6C7A\u6E08\u4FA1\u683C", value: `$${fmtUsd(event.exitPrice)}`, inline: true },
          { name: "\u4FDD\u6709\u6642\u9593", value: holdStr, inline: true },
          { name: "\u30B7\u30B0\u30CA\u30EB\u30BF\u30A4\u30D7", value: signalLabel, inline: true },
          { name: "\u78BA\u4FE1\u5EA6", value: `${confPct}%`, inline: true },
        ],
        timestamp: event.closedAt.toISOString(),
        footer: { text: "\u26A0\uFE0F \u30DA\u30FC\u30D1\u30FC\u30C8\u30EC\u30FC\u30C9\uFF08\u4EEE\u60F3\u53D6\u5F15\uFF09 | Smart Money Tracker" },
      },
    ],
  };
}
