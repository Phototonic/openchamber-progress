#!/usr/bin/env bash
# CPU seconds per process role over a window, for processes whose environment HOME is inside one
# isolated fixture (never the user's real instance). Read-only /proc sampling.
# Usage: tests/browser/proc-cpu.sh <fixture-dir> <seconds>
set -euo pipefail
FIX=$1; SECS=$2; TCK=$(getconf CLK_TCK)
role() {
  local a; a=$(tr '\0' ' ' < /proc/$1/cmdline 2>/dev/null | cut -c1-300)
  case "$a" in
    *build/service/main.js*) echo service;; *agent-progress-probe-cli/opencode*) echo opencode;;
    *--type=renderer*) echo renderer;; *--type=gpu-process*) echo gpu;; *--type=utility*) echo utility;; *--type=zygote*) echo zygote;;
    *squashfs-root/openchamber*) echo main;; *) echo other;;
  esac
}
# Roots: processes whose environment HOME is inside the fixture; sandboxed children (renderer, gpu,
# zygote) hide their environment, so every descendant of a root is included by process tree.
roots() { for p in $(pgrep -u "$(id -u)" -f . 2>/dev/null); do tr '\0' '\n' < /proc/$p/environ 2>/dev/null | grep -q "^HOME=$FIX/" && echo $p; done; }
tree() { local q=("$@") out=(); while ((${#q[@]})); do local p=${q[0]}; q=("${q[@]:1}"); out+=("$p"); q+=($(pgrep -P "$p" 2>/dev/null || true)); done; printf '%s\n' "${out[@]}" | sort -u; }
snap() {
  for p in $(tree $(roots)); do
    read -r -a s < <(sed 's/^.*) //' /proc/$p/stat 2>/dev/null) || continue
    echo "$p $(role $p) $(( ${s[11]} + ${s[12]} ))"
  done
}
A=$(snap); sleep "$SECS"; B=$(snap)
join <(echo "$A" | sort) <(echo "$B" | sort) | awk -v t="$TCK" -v s="$SECS" '{d[$2]+=($5-$3)/t; n[$2]++} END {for (r in d) printf "%s n=%d cpu_s=%.2f pct_core=%.1f\n", r, n[r], d[r], 100*d[r]/s}' | sort
echo "new_or_gone_pids=$(comm -3 <(echo "$A" | awk '{print $1}' | sort) <(echo "$B" | awk '{print $1}' | sort) | wc -l)"
