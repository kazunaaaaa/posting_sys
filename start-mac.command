#!/bin/bash
# ============================================================
#  ポスティング配布エリア選択システム  起動・更新ランチャー（Mac）
#
#  ダブルクリック（引数なし）:
#    最新コードを取得 → 部品をインストール → 町丁目データを事前取得 → 起動してブラウザで開く
#    ※ 自動起動を登録済みなら、更新後にバックグラウンドのアプリを再起動してブラウザを開く
#
#  ターミナルから:
#    bash ポスティング起動.command --install-autostart   Macログイン時の自動起動を登録（--no-browser で起動時にブラウザを開かない）
#    bash ポスティング起動.command --uninstall-autostart 自動起動を解除
#    bash ポスティング起動.command --status              自動起動・アプリの状態を表示
#
#  設定（環境変数で上書き可）:
#    APP_DIR        アプリの置き場所（既定: ~/posting-sys）
#    PREFETCH_AREA  事前取得する範囲（既定: 一都三県。全国 / なし など）
#    PORT           アプリのポート（既定: 4000）
# ============================================================

# 実行中にこのファイル自体が更新されても安全なよう、全体を関数にしてから実行する
main() {
  APP_DIR="${APP_DIR:-$HOME/posting-sys}"
  REPO="kazunaaaaa/posting_sys"
  BRANCH="${BRANCH:-claude/posting-area-distribution-s7c07d}"
  PREFETCH_AREA="${PREFETCH_AREA:-一都三県}"
  PORT="${PORT:-4000}"
  LABEL="com.posting-sys.app"
  PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
  LOG_DIR="$HOME/Library/Logs"
  SELF="$0"
  MODE="${1:-run}"

  case "$MODE" in
    --service)             service_mode ;;
    --install-autostart)   shift; install_autostart "$@" ;;
    --uninstall-autostart) uninstall_autostart ;;
    --status)              show_status ;;
    *)                     interactive_mode ;;
  esac
}

# ---------- 表示 ----------
say()  { printf '\n\033[1;35m▶ %s\033[0m\n' "$1"; }
ok()   { printf '  \033[32m✓ %s\033[0m\n' "$1"; }
warn() { printf '  \033[33m! %s\033[0m\n' "$1"; }
die()  { printf '\n\033[31m✗ %s\033[0m\n' "$1"; pause; exit 1; }
pause() { if [ -t 0 ]; then read -r -p "  Enter キーで閉じます…" _; fi; }
open_url() { if command -v open >/dev/null 2>&1; then open "$1"; elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$1" >/dev/null 2>&1; fi; }
healthy() { curl -fs "http://localhost:$PORT/api/health" >/dev/null 2>&1; }
banner() { printf '\033[1m\n=== 📮 ポスティング配布エリア選択システム ===\033[0m\n  置き場所: %s\n' "$APP_DIR"; }
autostart_installed() { [ -f "$PLIST" ]; }

# ---------- 共通ステップ ----------
check_node() {
  say "Node.js を確認"
  if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
    warn "Node.js が見つかりません。開いたページから「LTS」版をインストールして、もう一度実行してください。"
    open_url "https://nodejs.org/ja"
    die "Node.js が未インストールです"
  fi
  ok "Node.js $(node -v)"
}

# 最新コードを取得して入れ替える（.env・部品・旧データは引き継ぐ）
update_code() {
  say "最新のコードを取得"
  local tmp src bak keep
  tmp="$(mktemp -d)"
  if curl -fsSL --retry 2 "https://codeload.github.com/$REPO/zip/refs/heads/$BRANCH" -o "$tmp/src.zip" \
     && unzip -q "$tmp/src.zip" -d "$tmp/x"; then
    src="$(find "$tmp/x" -mindepth 1 -maxdepth 1 -type d | head -1)"
    if [ -d "$APP_DIR" ]; then
      bak="$APP_DIR.updating-$$"
      mv "$APP_DIR" "$bak" || { rm -rf "$tmp"; die "フォルダを入れ替えられません（$APP_DIR を開いているアプリを閉じてください）"; }
      mv "$src" "$APP_DIR"
      for keep in .env node_modules server/node_modules client/node_modules server/data/towns server/data/boundaries; do
        if [ -e "$bak/$keep" ]; then rm -rf "${APP_DIR:?}/$keep"; mkdir -p "$(dirname "$APP_DIR/$keep")"; mv "$bak/$keep" "$APP_DIR/$keep"; fi
      done
      rm -rf "$bak"
    else
      mkdir -p "$(dirname "$APP_DIR")"
      mv "$src" "$APP_DIR"
    fi
    date +%s > "$APP_DIR/.last-update"
    ok "最新版に更新しました"
  else
    if [ -d "$APP_DIR" ]; then warn "ダウンロードできませんでした（オフライン？）。今のコードのまま起動します"
    else rm -rf "$tmp"; die "コードをダウンロードできませんでした。インターネット接続を確認してください"; fi
  fi
  rm -rf "$tmp"
  cd "$APP_DIR" || die "$APP_DIR に移動できません"
}

# このランチャー自身も最新版に（プロジェクト外に置いている場合。開発用のGit作業フォルダ内では行わない）
self_update() {
  [ -d "$(dirname "$SELF")/.git" ] && return 0
  case "$SELF" in
    "$APP_DIR"/*) ;;
    *) if [ -f "$APP_DIR/start-mac.command" ] && [ -f "$SELF" ] && ! cmp -s "$APP_DIR/start-mac.command" "$SELF"; then
         cp "$APP_DIR/start-mac.command" "$SELF" 2>/dev/null && chmod +x "$SELF" && ok "ランチャーも更新しました（次回から反映）"
       fi ;;
  esac
}

# デスクトップの「ポスティング起動」が無くなっていたら作り直す
ensure_shortcut() {
  local dest="$HOME/Desktop/ポスティング起動.command"
  [ -d "$HOME/Desktop" ] || return 0
  [ -e "$dest" ] && return 0
  [ -f "$APP_DIR/start-mac.command" ] || return 0
  cp "$APP_DIR/start-mac.command" "$dest" 2>/dev/null && chmod +x "$dest" && ok "デスクトップに「ポスティング起動」を作り直しました"
}

ensure_env() {
  say "APIキーの設定を確認"
  local f
  if [ ! -f .env ]; then
    # 以前の置き場所（デスクトップ）から引き継ぐ
    for f in "$HOME/Desktop/posting_sys/.env" "$HOME/Desktop/posting_sys_old/.env"; do
      if [ -f "$f" ]; then cp "$f" .env && ok "$(dirname "$f" | sed "s|$HOME|~|") から .env を引き継ぎました"; break; fi
    done
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
}

install_deps() {
  say "部品をインストール（初回は数分）"
  if npm run install:all --silent >"$APP_DIR/.install.log" 2>&1; then ok "インストール完了"
  else tail -20 "$APP_DIR/.install.log"; die "インストールに失敗しました（上のメッセージを確認）"; fi
}

prefetch_fg() {
  { [ "$PREFETCH_AREA" = "なし" ] || [ -z "$PREFETCH_AREA" ]; } && return 0
  say "町丁目データを事前取得（$PREFETCH_AREA・取得済みはスキップ）"
  local awake=""; command -v caffeinate >/dev/null 2>&1 && awake="caffeinate -i"
  if $awake npm --prefix server run --silent towns:prefetch -- "$PREFETCH_AREA"; then ok "事前取得 完了"
  else warn "一部の市区町村を取得できませんでした（次回の起動時に自動で再取得します）"; fi
}

build_client() {
  npm --prefix client run --silent build >"$APP_DIR/.build.log" 2>&1 || { tail -20 "$APP_DIR/.build.log"; die "画面のビルドに失敗しました"; }
  ok "画面を準備しました"
}

wait_and_open() {
  local i
  for i in $(seq 1 120); do sleep 1; healthy && { open_url "http://localhost:$PORT"; return 0; }; done
  return 1
}

# ---------- 通常起動（ダブルクリック）----------
interactive_mode() {
  banner
  check_node
  update_code
  self_update
  ensure_shortcut
  ensure_env
  install_deps
  prefetch_fg

  say "アプリを起動"
  build_client
  if autostart_installed && command -v launchctl >/dev/null 2>&1; then
    # 自動起動（バックグラウンド）を使っている場合は、それを再起動して新しいコードを反映
    launchctl kickstart -k "gui/$(id -u)/$LABEL" >/dev/null 2>&1 || launchctl start "$LABEL" 2>/dev/null
    if wait_and_open; then ok "バックグラウンドのアプリを再起動して開きました（このウィンドウは閉じてOK）"
    else warn "アプリの応答がありません。ログ: $LOG_DIR/posting-sys.log"; fi
    pause
    return 0
  fi
  # すでにこのアプリが動いていれば止めてから起動し直す
  if healthy; then
    lsof -ti "tcp:$PORT" 2>/dev/null | xargs kill 2>/dev/null; sleep 1
    ok "起動中だった古いアプリを停止しました"
  elif lsof -ti "tcp:$PORT" >/dev/null 2>&1; then
    die "ポート $PORT は別のアプリが使用中です（PORT=4100 などで変更できます）"
  fi
  ( wait_and_open ) &
  printf '\n  \033[1m🌐 http://localhost:%s をブラウザで開きます。止めるときは Ctrl + C\033[0m\n\n' "$PORT"
  PORT="$PORT" npm --prefix server start
}

# ---------- 自動起動から呼ばれる（launchd）----------
service_mode() {
  echo "=== $(date '+%Y-%m-%d %H:%M:%S') 自動起動 ==="
  # ログイン直後はネットワークの準備に少し時間がかかることがある
  local i last now
  # （応答の内容は問わず、つながれば次へ。-f を付けるとエラー応答で失敗扱いになるため付けない）
  for i in $(seq 1 20); do curl -s -o /dev/null --max-time 5 https://codeload.github.com && break; sleep 3; done
  # 直前（10分以内）に更新済みなら取得とビルドを省略（ダブルクリックからの再起動時など）
  last="$(cat "$APP_DIR/.last-update" 2>/dev/null || echo 0)"; now="$(date +%s)"
  if [ -d "$APP_DIR" ] && [ $((now - last)) -lt 600 ]; then
    cd "$APP_DIR" || exit 1
    echo "  （直前に更新済みのため取得を省略）"
    [ -f client/dist/index.html ] || build_client
  else
    update_code
    install_deps
    build_client
  fi
  [ -f .env ] || warn ".env がありません"
  # 町丁目の事前取得は裏で（アプリはすぐ使える）
  if [ "$PREFETCH_AREA" != "なし" ] && [ -n "$PREFETCH_AREA" ]; then
    nohup npm --prefix server run --silent towns:prefetch -- "$PREFETCH_AREA" >>"$LOG_DIR/posting-sys-prefetch.log" 2>&1 &
  fi
  if [ "${OPEN_BROWSER:-1}" = "1" ]; then ( wait_and_open ) & fi
  echo "  アプリを起動: http://localhost:$PORT"
  cd "$APP_DIR/server" || exit 1
  PORT="$PORT" exec node index.js
}

# ---------- 自動起動の登録・解除・状態 ----------
install_autostart() {
  local open_browser=1 node_dir
  [ "${1:-}" = "--no-browser" ] && open_browser=0
  banner
  command -v launchctl >/dev/null 2>&1 || die "この機能は Mac 専用です（launchctl が見つかりません）"
  check_node
  update_code
  self_update
  ensure_env
  install_deps
  prefetch_fg
  build_client

  say "Macログイン時の自動起動を登録"
  node_dir="$(dirname "$(command -v node)")"
  mkdir -p "$(dirname "$PLIST")" "$LOG_DIR"
  # 登録済みなら一度解除し、ダブルクリックで起動中のアプリがあれば止める（自動起動側に切り替える）
  autostart_installed && launchctl bootout "gui/$(id -u)" "$PLIST" >/dev/null 2>&1
  if healthy; then lsof -ti "tcp:$PORT" 2>/dev/null | xargs kill 2>/dev/null; sleep 1; fi
  cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$APP_DIR/start-mac.command</string>
    <string>--service</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>$node_dir:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>APP_DIR</key><string>$APP_DIR</string>
    <key>PORT</key><string>$PORT</string>
    <key>PREFETCH_AREA</key><string>$PREFETCH_AREA</string>
    <key>OPEN_BROWSER</key><string>$open_browser</string>
    <key>LANG</key><string>ja_JP.UTF-8</string>
  </dict>
  <key>WorkingDirectory</key><string>$HOME</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>StandardOutPath</key><string>$LOG_DIR/posting-sys.log</string>
  <key>StandardErrorPath</key><string>$LOG_DIR/posting-sys.log</string>
</dict>
</plist>
PLIST
  plutil -lint "$PLIST" >/dev/null 2>&1 || die "設定ファイルの作成に失敗しました: $PLIST"
  launchctl bootout "gui/$(id -u)" "$PLIST" >/dev/null 2>&1
  launchctl bootstrap "gui/$(id -u)" "$PLIST" 2>/dev/null || launchctl load -w "$PLIST" 2>/dev/null
  ok "登録しました（次回から Mac にログインすると自動で起動します）"
  say "今すぐ起動します"
  if wait_and_open; then ok "起動しました: http://localhost:$PORT"
  else warn "応答がありません。ログを確認してください: $LOG_DIR/posting-sys.log"; fi
  printf '\n  解除するとき: bash %s --uninstall-autostart\n' "$SELF"
  pause
}

uninstall_autostart() {
  banner
  say "自動起動を解除"
  if autostart_installed; then
    launchctl bootout "gui/$(id -u)" "$PLIST" >/dev/null 2>&1 || launchctl unload -w "$PLIST" 2>/dev/null
    rm -f "$PLIST"
    ok "解除しました（アプリも停止しました）"
  else
    ok "自動起動は登録されていません"
  fi
  pause
}

show_status() {
  banner
  say "状態"
  if autostart_installed; then ok "自動起動: 登録済み（$PLIST）"; else warn "自動起動: 未登録"; fi
  if healthy; then ok "アプリ: 起動中 → http://localhost:$PORT"; else warn "アプリ: 停止中"; fi
  [ -f "$LOG_DIR/posting-sys.log" ] && echo "  ログ: $LOG_DIR/posting-sys.log"
  pause
}

main "$@"
exit $?
