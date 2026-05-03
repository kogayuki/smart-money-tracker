# smart-money-tracker

Hyperliquid + Injective Helix の Smart Money 動向を Discord に通知する常駐ボット。

## Stack

- TypeScript / Node.js 24
- Fly.io (Tokyo region, multi-region ready)
- Neon Postgres (Phase 2)
- Upstash Redis (Phase 2)
- Discord Webhook / discord.js (Phase 2)

## Local dev

```bash
cp .env.example .env
# .env を編集
npm install
npm run dev
```

## Deploy

`main` ブランチへ push すると GitHub Actions 経由で Fly.io に自動デプロイされる。

## Roadmap

- [x] Phase 0: Deploy pipeline (push → Fly.io → Discord)
- [ ] Phase 1: Hyperliquid WebSocket + Smart Money リスト
- [ ] Phase 2: Injective Helix 統合 + DB 永続化
- [ ] Phase 3: エンリッチメント (PnL / 勝率 / 履歴)
- [ ] Phase 4: Web Dashboard (Next.js on Vercel)
