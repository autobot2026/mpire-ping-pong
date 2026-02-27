#!/bin/zsh
set -euo pipefail
APP_DIR="$HOME/Desktop/Mpire-ping-pong"
URL="http://127.0.0.1:3444"
LOG_DIR="$HOME/.openclaw/logs"
LOG_FILE="$LOG_DIR/mpire-ping-pong.log"
mkdir -p "$LOG_DIR"
cd "$APP_DIR"
[ -d node_modules ] || npm install
if ! /usr/sbin/lsof -iTCP:3444 -sTCP:LISTEN >/dev/null 2>&1; then
  nohup npm run dev -- -p 3444 > "$LOG_FILE" 2>&1 &
  disown
  sleep 2
fi
open "$URL"
