#!/bin/bash
# ============================================================
#  ポスティング配布エリア選択システム  起動・更新ランチャー（Mac）
#  ダブルクリックするだけで、次をすべて自動で行います:
#    1. 最新のコードをGitHubから取得（.env・取得済みデータは残す）
#    2. 必要な部品をインストール
#    3. 町丁目データを事前取得（初回のみ数分。2回目以降は差分だけ）
#    4. アプリを起動してブラウザで開く
#  止めるときは、このウィンドウで Ctrl + C を押すか、ウィンドウを閉じます。
#
#  設定（必要なときだけ。環境変数で上書き可）:
#    APP_DIR        アプリの置き場所（既定: デスクトップの posting_sys）
#    PREFETCH_AREA  事前取得する範囲（既定: 一都三県。全国 / なし など）
#    PORT           アプリのポート（既定: 4000）
# ============================================================

# 実行中にこのファイル自体が更新されても安全なよう、全体を関数にしてから実行する
main() {
  APP_DIR="${APP_DIR:-$HOME/Desktop/posting_sys}"
  REPO="kazunaaaaa/posting_sys"
  BRANCH="${BRANCH:-claude/posting-area-distribution-s7c07d}"
  PREFETCH_AREA="${PREFETCH_AREA:-一都三県}"
  PORT="${PORT:-4000}"
  SELF="$0"

  say()  { printf '\n\033[1;35m▶ %s\033[0m\n' "$1"; }
  ok()   { printf '  \033[32m✓ %s\033[0m\n' "$1"; }
  warn() { printf '  \033[33m! %s\033[0m\n' "$1"; }
  die()  { printf '\n\033[31m✗ %s\033[0m\n' "$1"; pause; exit 1; }
  pause() { if [ -t 0 ]; then read -r -p "  Enter キーで閉じます…" _; fi; }
  open_url() { if command -v open >/dev/null 2>&1; then open "$1"; elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$1" >/dev/null 2>&1; fi; }

  printf '\033[1m\n=== 📮 ポスティング配布エリア選択システム ===\033[0m\n'
  echo "  置き場所: $APP_DIR"

  # ---- 1. Node.js の確認 ----
  say "Node.js を確認"
  if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
    warn "Node.js が見つかりません。開いたページから「LTS」版をインストールして、もう一度実行してください。"
    open_url "https://nodejs.org/ja"
    die "Node.js が未インストールです"
  fi
  ok "Node.js $(node -v)"

  # ---- 2. 最新コードの取得 ----
  say "最新のコードを取得"
  TMP="$(mktemp -d)"
  if curl -fsSL --retry 2 "https://codeload.github.com/$REPO/zip/refs/heads/$BRANCH" -o "$TMP/src.zip" \
     && unzip -q "$TMP/src.zip" -d "$TMP/x"; then
    SRC="$(find "$TMP/x" -mindepth 1 -maxdepth 1 -type d | head -1)"
    if [ -d "$APP_DIR" ]; then
      # 入れ替え: 旧フォルダを退避 → 新コードを配置 → 引き継ぐもの(.env・部品・旧データ)を戻す
      BAK="$APP_DIR.updating-$$"
      mv "$APP_DIR" "$BAK" || die "フォルダを入れ替えられません（$APP_DIR を開いているアプリを閉じてください）"
      mv "$SRC" "$APP_DIR"
      for keep in .env node_modules server/node_modules client/node_modules server/data/towns server/data/boundaries; do
        if [ -e "$BAK/$keep" ]; then rm -rf "${APP_DIR:?}/$keep"; mkdir -p "$(dirname "$APP_DIR/$keep")"; mv "$BAK/$keep" "$APP_DIR/$keep"; fi
      done
      rm -rf "$BAK"
    else
      mkdir -p "$(dirname "$APP_DIR")"
      mv "$SRC" "$APP_DIR"
    fi
    ok "最新版に更新しました"
  else
    if [ -d "$APP_DIR" ]; then warn "ダウンロードできませんでした（オフライン？）。今のコードのまま起動します"
    else rm -rf "$TMP"; die "コードをダウンロードできませんでした。インターネット接続を確認してください"; fi
  fi
  rm -rf "$TMP"
  cd "$APP_DIR" || die "$APP_DIR に移動できません"

  # このランチャー自身も最新版に（プロジェクト外に置いている場合）
  case "$SELF" in
    "$APP_DIR"/*) ;;
    *) if [ -f "$APP_DIR/start-mac.command" ] && ! cmp -s "$APP_DIR/start-mac.command" "$SELF"; then
         cp "$APP_DIR/start-mac.command" "$SELF" 2>/dev/null && chmod +x "$SELF" && ok "ランチャーも更新しました（次回から反映）"
       fi ;;
  esac

  # ---- 3. APIキー(.env) ----
  say "APIキーの設定を確認"
  if [ ! -f .env ] && [ -f "$HOME/Desktop/posting_sys_old/.env" ]; then
    cp "$HOME/Desktop/posting_sys_old/.env" .env && ok "posting_sys_old から .env を引き継ぎました"
  fi
  if [ ! -f .env ]; then
    if [ -t 0 ]; then
      echo "  初回設定です。キーを貼り付けて Enter（分からなければ空のまま Enter）"
      read -r -p "  Google Maps APIキー: " GKEY
      read -r -p "  e-Stat アプリケーションID: " EKEY
      { echo "GOOGLE_MAPS_API_KEY=$GKEY"; echo "ESTAT_APP_ID=$EKEY"; } > .env
      ok ".env を作成しました"
    else
      warn ".env がありません（キー未設定のまま起動します）"
    fi
  else
    ok ".env あり"
  fi

  # ---- 4. 部品のインストール ----
  say "部品をインストール（初回は数分）"
  if npm run install:all --silent >"$APP_DIR/.install.log" 2>&1; then ok "インストール完了"
  else tail -20 "$APP_DIR/.install.log"; die "インストールに失敗しました（上のメッセージを確認）"; fi

  # ---- 5. 町丁目データの事前取得 ----
  if [ "$PREFETCH_AREA" != "なし" ] && [ -n "$PREFETCH_AREA" ]; then
    say "町丁目データを事前取得（$PREFETCH_AREA・取得済みはスキップ）"
    KEEP_AWAKE=""; command -v caffeinate >/dev/null 2>&1 && KEEP_AWAKE="caffeinate -i"
    if $KEEP_AWAKE npm --prefix server run --silent towns:prefetch -- "$PREFETCH_AREA"; then ok "事前取得 完了"
    else warn "一部の市区町村を取得できませんでした（次回の起動時に自動で再取得します）"; fi
  fi

  # ---- 6. 起動 ----
  say "アプリを起動"
  # すでにこのアプリが動いていれば止めてから起動し直す
  if curl -fs "http://localhost:$PORT/api/health" >/dev/null 2>&1; then
    lsof -ti "tcp:$PORT" 2>/dev/null | xargs kill 2>/dev/null; sleep 1
    ok "起動中だった古いアプリを停止しました"
  elif lsof -ti "tcp:$PORT" >/dev/null 2>&1; then
    die "ポート $PORT は別のアプリが使用中です（PORT=4100 などで変更できます）"
  fi
  npm --prefix client run --silent build >"$APP_DIR/.build.log" 2>&1 || { tail -20 "$APP_DIR/.build.log"; die "画面のビルドに失敗しました"; }
  ok "画面を準備しました"
  ( for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
      sleep 1; curl -fs "http://localhost:$PORT/api/health" >/dev/null 2>&1 && { open_url "http://localhost:$PORT"; exit 0; }
    done ) &
  printf '\n  \033[1m🌐 http://localhost:%s をブラウザで開きます。止めるときは Ctrl + C\033[0m\n\n' "$PORT"
  PORT="$PORT" npm --prefix server start
}

main "$@"
exit $?
