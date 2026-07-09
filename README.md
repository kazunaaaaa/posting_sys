# ポスティング配布エリア選択システム

ラクスルの「地図から簡単注文」のように、**地図上でポスティング配布エリアを選び、配布部数を自動算出**するWebアプリのMVPです。さらに以下を備えています。

- 📮 **配布部数の自動算出** … 各エリアの最新世帯数（国勢調査／住民基本台帳）に対して **70%** を配布部数とする
- 🔍 **競合分析** … 業態を選ぶと、その業態の競合が地図上にプロットされる
- 🤖 **AIによる最適エリア分析** … 世帯規模・競合密度・配布効率・コストをスコア化し、最適エリアをAIが提案・解説

![screenshot](docs/screenshot.png)

## クイックスタート

```bash
# 依存関係のインストール（ルート / server / client）
npm run install:all

# 開発モード（server: 4000, client: 5173）
npm run dev
# → http://localhost:5173 を開く

# 本番ビルド＋単一サーバー起動（http://localhost:4000）
npm run build
npm start
```

APIキーが未設定でも**そのまま動作**します（松戸市周辺のサンプル世帯数、競合はサンプル生成、AI解説はルールベース）。地図はGoogle Mapsキーが無い場合、内蔵のSVGデモ地図にフォールバックします。

## 環境変数（`.env.example` を `.env` にコピー）

| 変数 | 用途 | 未設定時の挙動 |
|------|------|----------------|
| `GOOGLE_MAPS_API_KEY` | 地図表示（Maps JavaScript API） | SVGデモ地図で描画 |
| `GOOGLE_PLACES_API_KEY` | 競合POI検索（Places API New） | OpenStreetMap Overpass → サンプルの順でフォールバック |
| `ESTAT_APP_ID` | 世帯数の実データ取得（e-Stat API） | 同梱サンプル世帯数を使用 |
| `ANTHROPIC_API_KEY` | 最適エリアのAI解説（Claude API） | ルールベース解説を使用 |
| `CLAUDE_MODEL` | 使用モデル | `claude-opus-4-8` |

### Google Maps / Places キーの取得
1. [Google Cloud Console](https://console.cloud.google.com/) でプロジェクト作成
2. **Maps JavaScript API** と **Places API (New)** を有効化
3. 認証情報 > APIキーを作成。地図用キーはHTTPリファラ制限、Places用キーはIP制限を推奨

### e-Stat（世帯数の実データ）
1. [e-Stat API](https://www.e-stat.go.jp/api/) でアプリケーションID(appId)を取得
2. `.env` に `ESTAT_APP_ID` と、世帯数の統計表ID `ESTAT_STATS_DATA_ID`（国勢調査 小地域 世帯数）を設定
3. 地図描画には小地域の**境界ポリゴン**が必要です。e-Stat の[統計GIS 境界データ](https://www.e-stat.go.jp/gis)（shapefile/GeoJSON）を小地域コードで結合してください（`server/services/estat.js` にフックあり）

## アーキテクチャ

```
posting_sys/
├── server/                 Node.js + Express API
│   ├── index.js            エントリ / /api/config でフロントへ設定公開
│   ├── routes/
│   │   ├── areas.js        GET /api/areas 世帯数・配布部数、POST /summary
│   │   ├── competitors.js  業態マスタ、POST /search 競合検索
│   │   └── analyze.js      POST /api/analyze 最適エリア分析
│   ├── services/
│   │   ├── estat.js        世帯数（e-Stat連携 or サンプル）＋ 配布率70%
│   │   ├── places.js       競合検索（Google Places → Overpass → サンプル）
│   │   ├── scoring.js      最適エリア スコアリングエンジン
│   │   ├── claude.js       Claude API 解説（or ルールベース）
│   │   └── geo.js          ポリゴン内包判定・面積・重心・距離
│   └── data/
│       ├── households.sample.json   松戸市周辺の町丁目サンプル
│       └── business-types.json      業態マスタ（Google/Overpassマッピング付き）
└── client/                 React + Vite
    └── src/
        ├── App.jsx                  画面全体・状態管理
        ├── components/
        │   ├── GoogleMapView.jsx    Google Maps 描画
        │   └── SvgMapView.jsx       キー未設定時のSVGフォールバック地図
        └── lib/{api,googleMaps}.js  APIクライアント / Mapsローダ
```

## APIエンドポイント

| メソッド | パス | 説明 |
|----------|------|------|
| GET | `/api/config` | フロント公開設定（Mapsキー等） |
| GET | `/api/areas` | 全エリア（世帯数・配布部数=世帯数×70%・重心・面積） |
| POST | `/api/areas/summary` | 選択エリアの配布サマリ `{ codes: [] }` |
| GET | `/api/competitors/business-types` | 業態マスタ |
| POST | `/api/competitors/search` | 競合検索 `{ businessTypeId, codes: [] }` |
| POST | `/api/analyze` | 最適エリア分析 `{ codes: [], businessTypeId, unitCost? }` |

## スコアリングの考え方

各エリアを4軸で0–100に正規化し、重み付けして総合スコアを算出します（`server/services/scoring.js`）。

| 軸 | 指標 | 重み |
|----|------|------|
| 到達 (reach) | 世帯数（配布到達数） | 35% |
| 競合機会 (opportunity) | 世帯数 ÷ (競合数+1) が大きいほど良い | 30% |
| 配布効率 (efficiency) | 世帯密度 | 20% |
| コスト効率 (cost) | 到達世帯 ÷ 配布コスト | 15% |

競合は各エリアのポリゴン内包判定（＋近傍800m）で割り当てます。`ANTHROPIC_API_KEY` を設定すると、このスコアリング結果をもとにClaudeが最適エリアの理由・優先度・予算配分を日本語で解説します。

## 実データへの差し替えポイント

- **世帯数** → `server/services/estat.js` の `fetchFromEstat()`（e-Stat数値取得 ＋ 境界データ結合）
- **競合** → `server/services/places.js` の `fromGooglePlaces()` / `fromOverpass()`
- **エリア（境界）** → `server/data/households.sample.json` を e-Stat 境界データ由来のGeoJSONに置換

## 今後の拡張候補

- 対象自治体の全国展開（境界データの動的ロード）
- 配布日・在庫を考慮した部数最適化、カート/注文フロー
- 競合の口コミ評価を加味したスコアリング、商圏（到達圏）解析
