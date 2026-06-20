# Smart Money Tracker

**24時間自律稼働する暗号資産スマートマネー追跡エージェント**

Hyperliquid と Injective Helix のデリバティブ市場をリアルタイムで監視し、スマートマネー（大口トレーダー）の取引パターンを検知・分析・仮想売買検証まで全自動で行う常駐型 AI エージェント。

---

## Why ── 誰の、どんな課題を解決するのか

### 背景: 情報の非対称性

暗号資産市場には「スマートマネー」と呼ばれる一握りのトレーダーが存在する。彼らは常に勝ち続けるわけではないが、**過去の取引データから高い勝率が確認されている上位プレイヤー**だ。

彼らの取引はオンチェーンで公開されている。つまりデータはそこにある。**問題は、誰もそれをリアルタイムで追えないこと**。

### 課題

```
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│  個人トレーダーの現実                                         │
│                                                              │
│  1. 24時間市場を見続けることは不可能                           │
│     └ SMは深夜でも動く。寝ている間にチャンスを逃す            │
│                                                              │
│  2. 複数取引所を同時に監視できない                             │
│     └ Hyperliquid, Helix, dYdX... 取引所は分散している       │
│                                                              │
│  3. 「SM が動いた」という情報だけでは判断できない              │
│     └ 1人の大口が動いただけ？ 複数人が同方向？ 流れは？       │
│                                                              │
│  4. 「SMに従えば儲かる」は本当か？ 検証手段がない             │
│     └ 感覚的に "勝てそう" で実弾を入れるのは危険              │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

### 解決策: 人間ができないことをエージェントが代行する

| 課題 | Smart Money Tracker の解決方法 |
|------|------------------------------|
| 24時間監視できない | **常駐エージェントが365日休まず監視**。検知したらDiscordに即通知 |
| 複数取引所を追えない | **Hyperliquid + Helix を同時監視**。取引所の追加も容易な設計 |
| 単発の動きか全体の流れか判断できない | **3つのパターンマッチャー**が「合流」「資金フロー転換」等を自動検知。確信度スコアで重要度を定量化 |
| SM追従が有効か検証できない | **ペーパートレード（仮想売買）で自動検証**。シグナル通りに仮想$100を投入し、勝率・損益を記録 |

### 2つの対象ユーザー

| 取引所 | 対象 | 提供価値 |
|--------|------|---------|
| **Hyperliquid** (BTC等) | **投資家向け** | BTCを中心としたSMの動向を追跡。「プロが今何をしているか」を可視化し、投資判断の参考材料を提供 |
| **Injective Helix** (INJ等) | **コミュニティ向け** | INJエコシステムの大口動向を追跡。コミュニティメンバーが市場の流れを把握し、エコシステムへの理解を深める |

### つまり

> **「データはある。でも人間がリアルタイムに処理するには量が多すぎる。」**
>
> この問題を、24時間稼働する自律エージェントが解決する。
> 人間は Discord の通知を見て、最終的な投資判断だけに集中すればいい。

---

## Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                     Smart Money Tracker                         │
│                                                                  │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────────┐   │
│  │ Hyperliquid │  │ Injective    │  │  Polymarket          │   │
│  │  WebSocket  │  │ Helix gRPC   │  │  REST API            │   │
│  │  (BTC etc.) │  │  (INJ etc.)  │  │  (予測市場データ)     │   │
│  └──────┬──────┘  └──────┬───────┘  └──────────┬───────────┘   │
│         │                │                      │               │
│         ▼                ▼                      │               │
│  ┌─────────────────────────────────┐           │               │
│  │       EventBus (型安全)          │           │               │
│  │  sm:fill → signal:detected →    │           │               │
│  │  insight:generated →            │           │               │
│  │  paper:open / paper:close       │◄──────────┘               │
│  │  auto-trade:open / error        │                            │
│  └──────────────┬──────────────────┘                            │
│                 │                                                │
│    ┌────────────┼────────────┬──────────┬────────┐              │
│    ▼            ▼            ▼          ▼        ▼              │
│ ┌──────┐  ┌─────────┐  ┌─────────┐ ┌──────┐ ┌───────┐        │
│ │Signal│  │ Insight  │  │ Paper   │ │ Auto │ │Discord│        │
│ │Detect│  │Generator │  │ Engine  │ │Trader│ │Notify │        │
│ └──────┘  └─────────┘  └─────────┘ └──┬───┘ └───────┘        │
│                                        │                        │
│                                        ▼                        │
│                                   ┌──────────┐                  │
│                                   │Hyperliquid│                 │
│                                   │ Mainnet   │                 │
│                                   └──────────┘                  │
│                                                                  │
│  ┌──────────────────────────────────────────────────────┐       │
│  │              Neon Postgres (永続化)                    │       │
│  │  sm_fills │ signals │ insights │ paper_trades          │       │
│  └──────────────────────────────────────────────────────┘       │
└──────────────────────────────────────────────────────────────────┘
```

---

## Features

### 1. マルチ取引所リアルタイム監視

| 取引所 | 接続方式 | 監視対象 |
|--------|---------|---------|
| **Hyperliquid** | WebSocket (allMids + userFills) | BTC, ETH 等のデリバティブ |
| **Injective Helix** | gRPC Stream + REST Polling | INJ 等の無期限先物 |

事前に登録したスマートマネーウォレット（勝率上位トレーダー）の取引をリアルタイムに捕捉。

### 2. シグナル検知エンジン

3つのパターンマッチャーがスライディングウィンドウ方式で動作:

| パターン | ロジック | 精度 |
|---------|---------|------|
| **Confluence** | 15分以内に2人以上のSMが同一方向に取引 | ~75% |
| **Flow Shift** | 30分間のネットフロー $500K超 → 方向性検知 | 71-81% |
| **New Entry** | 新規ポジション開始を検知 | 30-44% |

各パターンは信頼度スコア（0.0〜1.0）を算出し、閾値を超えた場合のみシグナル発火。

### 3. Polymarket 統合インサイト

- Polymarket の予測市場データ（1,500+マーケット）を5分間隔でポーリング
- SM シグナルと予測市場センチメントを統合 → 複合スコアを算出
- 「SMが買っていて、予測市場も強気」= 高スコアインサイト

### 4. ペーパートレード（仮想売買検証）

シグナルに基づく仮想売買を自動実行し、戦略の収益性をデータで検証:

```
signal:detected (confidence >= 0.7)
    │
    ▼
Paper Engine ── エントリー判断
    │               • コイン/シグナル種別フィルタ
    │               • 確信度チェック
    │               • 重複ポジションチェック
    ▼
paper:open ── $100仮想ポジション
    │
    [60秒ごとにTP/SL/タイムアウトチェック]
    │
    ▼
paper:close ── 決済 & P&L計算
```

| パラメータ | デフォルト値 |
|-----------|------------|
| 対象コイン | BTC, INJ |
| ポジションサイズ | $100 |
| 利確 (TP) | +5% |
| 損切 (SL) | -3% |
| 最大保有時間 | 24時間 |
| 最低確信度 | 0.7 |
| 対象シグナル | flow_shift, confluence |

### 5. Auto-Trader（自動売買）

シグナル発火と同時に Hyperliquid メインネットで実注文を自動執行:

```
signal:detected (confidence >= 0.8)
    │
    ▼
Auto-Trader Engine ── エントリー判断
    │                   • コイン/シグナル種別フィルタ
    │                   • 確信度チェック
    │                   • 重複・最大ポジションチェック
    ▼
Hyperliquid IOC 注文 ── 即時約定
    │
    ▼
Discord 通知 + DB 記録
```

| パラメータ | デフォルト値 | 環境変数 |
|-----------|------------|---------|
| 対象取引所 | Hyperliquid | `AUTO_TRADER_EXCHANGE` |
| 対象コイン | BTC, ETH | `AUTO_TRADER_COINS` |
| ポジションサイズ | $10 | `AUTO_TRADER_POSITION_SIZE_USD` |
| レバレッジ | 5x (cross) | `AUTO_TRADER_LEVERAGE` |
| スリッページ | 2% | `AUTO_TRADER_SLIPPAGE` |
| 最低確信度 | 0.8 | `AUTO_TRADER_MIN_CONFIDENCE` |
| 最大同時ポジション | 3 | `AUTO_TRADER_MAX_POSITIONS` |

**有効化手順:**
1. Hyperliquid に USDC を入金（[app.hyperliquid.xyz](https://app.hyperliquid.xyz) → Deposit）
2. `.env` に `AUTO_TRADER_PRIVATE_KEY` と `AUTO_TRADER_ENABLED=true` を設定
3. 起動 → シグナル待ち → 自動約定

### 6. Discord リアルタイム通知

すべてのイベントを Discord Webhook 経由で即時通知:

- SM の取引検知 (Embed + エクスプローラーリンク)
- シグナル発火 (方向/確信度/参加ウォレット)
- インサイト生成 (複合スコア/PM センチメント)
- ペーパートレード開始・決済 (P&L表示)
- 日次パフォーマンスレポート (24h自動送信)

### 6. シグナル精度自動検証

発火したシグナルの 1h / 4h / 24h 後の価格変動を自動計測し、精度データを蓄積。

---

## Tech Stack

| レイヤー | 技術 |
|---------|------|
| Runtime | Node.js 24, TypeScript 5.7 |
| Exchange API | `@nktkas/hyperliquid` (WebSocket), `@injectivelabs/sdk-ts` (gRPC) |
| Database | Neon Postgres (`@neondatabase/serverless` HTTP driver) |
| HTTP | `undici` (fetch) |
| Hosting | Fly.io (Tokyo `nrt` region, 24/7常駐) |
| CI/CD | GitHub Actions → Fly.io 自動デプロイ |
| Notification | Discord Webhook |
| Schema | Valibot (ウォレット設定バリデーション) |

---

## Architecture

### イベント駆動アーキテクチャ

全モジュール間の通信は型安全な `EventBus` 経由。疎結合でモジュールの追加・削除が容易。

```typescript
type EventMap = {
  "sm:fill":            SmFillEvent;          // 取引検知
  "signal:detected":    SignalDetectedEvent;   // シグナル発火
  "insight:generated":  InsightGeneratedEvent; // インサイト生成
  "paper:open":         PaperTradeOpenEvent;   // 仮想エントリー
  "paper:close":        PaperTradeCloseEvent;  // 仮想決済
  "auto-trade:open":    AutoTradeOpenEvent;    // 実注文約定
  "auto-trade:error":   AutoTradeErrorEvent;   // 実注文エラー
};
```

### モジュール構成

```
src/
├── index.ts                    # エントリーポイント & ブート配線
├── events/bus.ts               # 型安全EventBus
├── notify.ts                   # Discord Webhook + Embed構築
│
├── exchanges/                  # 取引所アダプター
│   ├── hyperliquid.ts          #   Hyperliquid WebSocket監視
│   └── helix/                  #   Injective Helix
│       ├── monitor.ts          #     gRPCストリーム + RESTポーリング
│       ├── markets.ts          #     デリバティブ市場マッピング
│       └── address.ts          #     Injective アドレス変換
│
├── wallets/                    # ウォレット管理
│   ├── types.ts                #   Valibotスキーマ定義
│   └── load.ts                 #   YAML設定ファイル読み込み
│
├── signal/                     # シグナル検知
│   ├── detector.ts             #   パターンマッチャー統合
│   ├── signal-recorder.ts      #   シグナル → DB保存
│   ├── signal-notifier.ts      #   シグナル → Discord通知
│   ├── price-cache.ts          #   リアルタイム価格キャッシュ
│   ├── outcome-checker.ts      #   シグナル精度追跡
│   └── patterns/               #   検知パターン実装
│       ├── types.ts            #     PatternMatcher インターフェース
│       ├── confluence.ts       #     複数ウォレット合流パターン
│       ├── flow-shift.ts       #     資金フローシフトパターン
│       └── new-entry.ts        #     新規参入パターン
│
├── polymarket/                 # 予測市場データ
│   ├── poller.ts               #   Polymarketポーリング
│   ├── client.ts               #   API クライアント
│   └── types.ts                #   型定義
│
├── insight/                    # 統合インサイト
│   ├── generator.ts            #   SM + PM データ統合
│   ├── templates.ts            #   インサイト分類 & サマリー生成
│   ├── insight-recorder.ts     #   インサイト → DB保存
│   └── insight-notifier.ts     #   インサイト → Discord通知
│
├── paper/                      # ペーパートレード
│   ├── config.ts               #   環境変数から設定読み込み
│   ├── engine.ts               #   シグナル → エントリー判断
│   ├── checker.ts              #   TP/SL/タイムアウト監視 (60秒間隔)
│   ├── recorder.ts             #   paper:open/close → DB記録
│   ├── notifier.ts             #   paper:open/close → Discord通知
│   └── daily-report.ts         #   日次パフォーマンスレポート
│
├── auto-trader/                # 自動売買
│   ├── config.ts               #   環境変数から設定読み込み
│   ├── engine.ts               #   signal:detected → Hyperliquid IOC注文
│   ├── notifier.ts             #   約定/エラー → Discord通知
│   └── recorder.ts             #   約定/エラー → DB記録
│
├── recorder/
│   └── fill-recorder.ts        # 取引データ → DB永続化
├── listeners/
│   └── fill-notifier.ts        # 取引検知 → Discord即時通知
│
├── db/
│   ├── client.ts               # Neon serverless クライアント
│   ├── migrate.ts              # マイグレーションランナー
│   └── migrations/             # SQLマイグレーション (001-008)
│
└── scripts/                    # CLIユーティリティ
    ├── paper-report.ts         #   ペーパートレードレポート (日本語)
    ├── report.ts               #   シグナル精度レポート
    └── db-status.ts            #   DB接続確認
```

### DB スキーマ

```
┌──────────────┐    ┌──────────────┐    ┌───────────────────┐
│   sm_fills   │───>│   signals    │───>│  signal_outcomes   │
│              │    │              │    │  (1h/4h/24h精度)   │
│ coin, side   │    │ type, coin   │    └───────────────────┘
│ px, sz       │    │ direction    │
│ wallet_*     │    │ confidence   │    ┌───────────────────┐
│ exchange     │    │ price        │    │     insights       │
└──────────────┘    └──────┬───────┘    │ SM + PM 統合       │
                           │            └───────────────────┘
                           ▼
                    ┌──────────────┐    ┌──────────────────┐
                    │ paper_trades │    │   auto_trades    │
                    │              │    │                  │
                    │ entry/exit   │    │ tx_hash, coin    │
                    │ tp/sl price  │    │ direction, qty   │
                    │ pnl_usd/pct  │    │ execution_price  │
                    │ status       │    │ leverage         │
                    └──────────────┘    └──────────────────┘
```

---

## Setup

### 前提条件

- Node.js >= 24
- Neon Postgres データベース
- Discord Webhook URL

### インストール

```bash
git clone https://github.com/<owner>/smart-money-tracker.git
cd smart-money-tracker
npm install
```

### 環境変数

```bash
cp .env.example .env
```

| 変数名 | 必須 | 説明 |
|--------|------|------|
| `DISCORD_WEBHOOK_URL` | Yes | Discord Webhook URL |
| `DATABASE_URL` | No | Neon Postgres 接続文字列（なくても動作する） |
| **Auto-Trader** | | |
| `AUTO_TRADER_ENABLED` | No | 自動売買 ON/OFF (default: `false`) |
| `AUTO_TRADER_EXCHANGE` | No | 取引所 (default: `hyperliquid`) |
| `AUTO_TRADER_NETWORK` | No | ネットワーク (default: `mainnet`) |
| `AUTO_TRADER_PRIVATE_KEY` | *※ | ウォレット秘密鍵 (※ AUTO_TRADER_ENABLED=true 時必須) |
| `AUTO_TRADER_COINS` | No | 対象コイン (default: `BTC,ETH`) |
| `AUTO_TRADER_POSITION_SIZE_USD` | No | 1注文サイズ (default: `10`) |
| `AUTO_TRADER_LEVERAGE` | No | レバレッジ (default: `5`) |
| `AUTO_TRADER_SLIPPAGE` | No | スリッページ (default: `0.02`) |
| `AUTO_TRADER_MIN_CONFIDENCE` | No | 最低確信度 (default: `0.8`) |
| `AUTO_TRADER_MAX_POSITIONS` | No | 最大同時ポジション (default: `3`) |
| **Paper Trading** | | |
| `PAPER_ENABLED` | No | ペーパートレード ON/OFF (default: `true`) |
| `PAPER_COINS` | No | 対象コイン (default: `BTC,INJ`) |
| `PAPER_TP_PCT` | No | 利確% (default: `5`) |
| `PAPER_SL_PCT` | No | 損切% (default: `3`) |
| `PAPER_MIN_CONFIDENCE` | No | 最低確信度 (default: `0.7`) |
| `PAPER_SIGNAL_TYPES` | No | 対象シグナル (default: `flow_shift,confluence`) |

### 起動

```bash
# 開発モード（ホットリロード）
npm run dev

# プロダクションビルド
npm run build
npm start
```

### デプロイ (Fly.io)

```bash
fly deploy
```

`main` ブランチへの push で GitHub Actions 経由の自動デプロイも可能。

---

## CLI ツール

### ペーパートレードレポート

```bash
DATABASE_URL=<your-url> npx tsx src/scripts/paper-report.ts
```

```
╔══════════════════════════════════════════╗
║   ペーパートレード パフォーマンスレポート   ║
╚══════════════════════════════════════════╝

── 全体サマリー ──
  トレード数:     5 (オープン: 1 / 決済済: 4)
  勝敗:           2勝 / 1敗 / 1タイムアウト
  勝率:           50.0%
  累計損益:       +$3.42

── コイン別成績 ──
コイン | 合計 | 勝/敗/TO   | 累計損益
-------|------|------------|--------
BTC   | 3    | 1勝/1敗/1TO | +$1.85
INJ   | 2    | 1勝/0敗/0TO | +$1.57
```

### シグナル精度レポート

```bash
DATABASE_URL=<your-url> npx tsx src/scripts/report.ts
```

---

## How It Works (24h Autonomous Loop)

```
                    ┌─────────────────────────┐
                    │      Boot Sequence       │
                    │                          │
                    │  1. DB Migration         │
                    │  2. EventBus Init        │
                    │  3. Listener Wiring      │
                    │  4. Price Cache Start    │
                    │  5. Polymarket Poller    │
                    │  6. Paper Engine Init    │
                    │  7. Wallet Load          │
                    │  8. Exchange Monitors    │
                    └────────────┬────────────┘
                                 │
                    ┌────────────▼────────────┐
                    │   Continuous Operation    │
                    │                          │
                    │  WebSocket/gRPC Stream   │
 Every trade ──────>│  Fill Detection          │
                    │       │                  │
                    │       ▼                  │
                    │  Pattern Matching        │
                    │  (15-30min windows)      │
                    │       │                  │
                    │       ▼                  │
                    │  Signal + Insight        │
                    │       │                  │
                    │       ▼                  │
  Every 60s ───────>│  Paper Trade Check      │
                    │  (TP/SL/Timeout)         │
                    │       │                  │
  Every 5min ──────>│  PM Data Refresh        │
                    │       │                  │
  Every 30s ───────>│  Price Cache Update     │
                    │       │                  │
  Every 24h ───────>│  Daily Report           │
                    │       │                  │
                    │       ▼                  │
                    │  Discord Notification    │
                    │  DB Persistence          │
                    └─────────────────────────┘
```

完全自律型。起動後は人間の介入なしに 24 時間 365 日稼働し続ける。

---

## Disclaimer

本ソフトウェアは教育・研究目的で提供されています。自動売買機能の使用は自己責任で行ってください。暗号資産取引にはリスクが伴います。投資助言ではありません。

## License

MIT
