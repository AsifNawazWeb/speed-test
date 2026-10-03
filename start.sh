#!/usr/bin/env bash
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT=8080
URL="http://localhost:${PORT}/"
LOG="${TMPDIR:-/tmp}/speed-test-server.log"

is_ours() {
  curl -sf --max-time 2 "http://127.0.0.1:${PORT}/manifest.webmanifest" >/dev/null 2>&1
}

port_busy() {
  ss -ltn "sport = :${PORT}" 2>/dev/null | grep -q LISTEN
}

notify() {
  if command -v notify-send >/dev/null 2>&1; then
    notify-send "Speed Test" "$1" 2>/dev/null || true
  fi
}

find_pwa() {
  local file
  for file in "$HOME"/.local/share/applications/chrome-*.desktop; do
    [ -f "$file" ] || continue
    if grep -q "^Name=Speed Test$" "$file" 2>/dev/null && grep -q -- "--app-id=" "$file" 2>/dev/null; then
      printf '%s\n' "$file"
      return 0
    fi
  done
  return 1
}

if ! is_ours && port_busy; then
  notify "Port ${PORT} is already in use by another application."
  exit 1
fi

if ! is_ours; then
  cd "$DIR"
  setsid python3 -m http.server "$PORT" --bind 127.0.0.1 >"$LOG" 2>&1 </dev/null &
  for _ in $(seq 1 40); do
    is_ours && break
    sleep 0.25
  done
fi

if ! is_ours; then
  notify "Server failed to start. See ${LOG}."
  exit 1
fi

PWA_ENTRY="$(find_pwa || true)"
if [ -n "$PWA_ENTRY" ]; then
  gio launch "$PWA_ENTRY" >/dev/null 2>&1 && exit 0
fi

for browser in google-chrome google-chrome-stable chromium chromium-browser; do
  if command -v "$browser" >/dev/null 2>&1; then
    "$browser" --app="$URL" >/dev/null 2>&1 &
    exit 0
  fi
done

xdg-open "$URL" >/dev/null 2>&1 &
exit 0
