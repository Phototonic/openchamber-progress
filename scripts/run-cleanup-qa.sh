#!/usr/bin/env bash
# Linux: use only processes and a browser profile created for this run.
set -euo pipefail

chromium=${1:?Pass an installed Chromium executable}
artifacts=${2:?Pass an artifact directory outside the checkout}
scratch=$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/cleanup-qa.XXXXXX")
fixture_url=http://127.0.0.1:47851/
fixture_pid=
browser_pid=

stop() {
  # Let the fixture stop its own services and remove its disposable stores.
  [[ -z "$fixture_pid" ]] || kill -TERM "$fixture_pid" 2>/dev/null || true
  [[ -z "$browser_pid" ]] || kill -TERM -- "-$browser_pid" 2>/dev/null || true
  local deadline=$((SECONDS + 5)) pid
  for pid in "$fixture_pid" "$browser_pid"; do
    [[ -n "$pid" ]] || continue
    while kill -0 "$pid" 2>/dev/null && ((SECONDS < deadline)); do sleep 0.1; done
    # Sweep any remaining children, including after a failed startup.
    kill -KILL -- "-$pid" 2>/dev/null || kill -KILL "$pid" 2>/dev/null || true
    wait "$pid" 2>/dev/null || true
  done
  rm -rf -- "$scratch"
}
trap stop EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

wait_for() {
  local pid=$1 deadline=$((SECONDS + 20))
  shift
  until "$@"; do
    if ((SECONDS >= deadline)) || ! kill -0 "$pid" 2>/dev/null; then return 1; fi
    sleep 0.1
  done
}

setsid node --experimental-strip-types tests/browser/cleanup-fixture.ts --source >"$scratch/fixture.log" 2>&1 &
fixture_pid=$!
wait_for "$fixture_pid" grep -Fq '"ready":true' "$scratch/fixture.log" ||
  { echo 'Cleanup fixture did not start; check that port 47851 is free.' >&2; exit 1; }

setsid "$chromium" --headless=new --user-data-dir="$scratch/profile" \
  --remote-debugging-address=127.0.0.1 --remote-debugging-port=0 \
  --no-first-run --no-default-browser-check --disable-extensions --disable-background-networking \
  --disable-sync --window-size=1280,1000 "$fixture_url" >"$scratch/chromium.log" 2>&1 &
browser_pid=$!
read_port() {
  [[ -s "$scratch/profile/DevToolsActivePort" ]] &&
    read -r CDP_PORT <"$scratch/profile/DevToolsActivePort" &&
    [[ "$CDP_PORT" =~ ^[1-9][0-9]{0,4}$ ]] && ((CDP_PORT < 65536))
}
wait_for "$browser_pid" read_port ||
  { echo 'Isolated Chromium did not expose a DevTools port.' >&2; exit 1; }

page_ready() {
  timeout -k 1 2 node --experimental-strip-types tests/browser/cdp.ts "$CDP_PORT" eval \
    'Boolean(window.qa && document.readyState === "complete")' 2>/dev/null | grep -Fxq true
}
wait_for "$browser_pid" page_ready ||
  { echo 'Cleanup fixture page did not load in Chromium.' >&2; exit 1; }

timeout -k 5 150 node --experimental-strip-types tests/browser/cleanup-qa.ts "$CDP_PORT" --artifacts "$artifacts"
