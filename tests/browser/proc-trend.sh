#!/usr/bin/env bash
# Per-role process trend for ONE isolated fixture (never the user's real instance): one JSON line per
# sample with cumulative CPU seconds, RSS MB, open FDs, threads and process count per role.
# Read-only /proc sampling; process selection and roles as in proc-cpu.sh.
# Usage: tests/browser/proc-trend.sh <fixture-dir> <interval-seconds> <duration-seconds> <out.jsonl>
set -euo pipefail
FIX=$1; STEP=$2; DUR=$3; OUT=$4; TCK=$(getconf CLK_TCK); PAGE_KB=$(( $(getconf PAGESIZE) / 1024 ))
role() {
  local a; a=$(tr '\0' ' ' < /proc/$1/cmdline 2>/dev/null | cut -c1-300)
  case "$a" in
    *build/service/main.js*) echo service;; *agent-progress-probe-cli/opencode*) echo opencode;;
    *--type=renderer*) echo renderer;; *--type=gpu-process*) echo gpu;; *--type=utility*) echo utility;; *--type=zygote*) echo zygote;;
    *squashfs-root/openchamber*) echo main;; *) echo other;;
  esac
}
roots() { for p in $(pgrep -u "$(id -u)" -f . 2>/dev/null); do tr '\0' '\n' < /proc/$p/environ 2>/dev/null | grep -q "^HOME=$FIX/" && echo $p; done 2>/dev/null; }
tree() { local q=("$@") out=(); while ((${#q[@]})); do local p=${q[0]}; q=("${q[@]:1}"); out+=("$p"); q+=($(pgrep -P "$p" 2>/dev/null || true)); done; printf '%s\n' "${out[@]}" | sort -u; }
END=$(( $(date +%s) + DUR ))
while (( $(date +%s) <= END )); do
  r=$(roots || true)
  {
    for p in $( [ -n "$r" ] && tree $r ); do
      read -r -a s < <(sed 's/^.*) //' /proc/$p/stat 2>/dev/null) || continue
      fd=$(ls /proc/$p/fd 2>/dev/null | wc -l)
      echo "$(role $p) $(( ${s[11]} + ${s[12]} )) $(( ${s[21]} * PAGE_KB )) $fd ${s[17]}"
    done
  } | awk -v t="$(date +%s.%N)" -v tck="$TCK" '
    { n[$1]++; c[$1]+=$2; r[$1]+=$3; f[$1]+=$4; h[$1]+=$5 }
    END { printf "{\"t\":%.1f,\"roles\":{", t; sep="";
      for (k in n) { printf "%s\"%s\":{\"n\":%d,\"cpu\":%.2f,\"rssMB\":%.1f,\"fd\":%d,\"thr\":%d}", sep, k, n[k], c[k]/tck, r[k]/1024, f[k], h[k]; sep="," }
      print "}}" }' >> "$OUT"
  sleep "$STEP"
done
