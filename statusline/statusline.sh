#!/bin/bash
# Claude Code status line: model · folder · context · plan usage bars
#
#   Opus · my-project · context 41% · ↻ 1h47 █▌░░░░ 27% · ↻ Thu ▌░░░░░ 10%
#
# Session (5 h window): label = time left until reset; color by usage
#   green < 40%, yellow 40–75%, red > 75%   (CC_BARS_SESSION_YELLOW / _RED)
# Week (7 d window): label = reset weekday (or HH:MM on reset day); color by PACE:
#   projected usage at the end of the window if you keep the current rate
#   (used% / fraction of the week already elapsed):
#   green < 90%, yellow 90–100%, red > 100%  (CC_BARS_PACE_YELLOW / _RED)
#   During the first ~3 h of the week the projection is noise: uses the session bands.
#
# Data comes from the JSON Claude Code pipes into the status line
# (rate_limits.five_hour / seven_day: used_percentage + resets_at), so no API calls.
# Needs: jq, awk, GNU date. Weekday names follow your LC_TIME/LANG.

input=$(cat)
model=$(echo "$input" | jq -r '.model.display_name // "?"')
dir=$(echo "$input" | jq -r '.workspace.current_dir // .cwd // ""')
pct=$(echo "$input" | jq -r '.context_window.used_percentage // 0')
h5=$(echo "$input" | jq -r '.rate_limits.five_hour.used_percentage // empty')
d7=$(echo "$input" | jq -r '.rate_limits.seven_day.used_percentage // empty')
r5=$(echo "$input" | jq -r '.rate_limits.five_hour.resets_at // empty')
r7=$(echo "$input" | jq -r '.rate_limits.seven_day.resets_at // empty')

N=${CC_BARS_WIDTH:-6}
SY=${CC_BARS_SESSION_YELLOW:-40}
SR=${CC_BARS_SESSION_RED:-75}
PY=${CC_BARS_PACE_YELLOW:-90}
PR=${CC_BARS_PACE_RED:-100}

cor() { if [ "$1" -ge 80 ]; then printf '\033[31m'; elif [ "$1" -ge 60 ]; then printf '\033[33m'; else printf '\033[32m'; fi; }
int() { LC_NUMERIC=C printf '%.0f' "$1"; }

p=$(int "$pct")
out=$(printf '\033[36m%s\033[0m · \033[97m%s\033[0m · context %b%s%%\033[0m' "$model" "${dir##*/}" "$(cor "$p")" "$p")

# bar <pct> <session|week> <resets_at epoch> -> "label bar pct%" with ANSI colors
bar() {
  LC_NUMERIC=C awk -v p="$1" -v mode="$2" -v r="$3" -v now="$(date +%s)" -v today="$(date +%F)" \
      -v N="$N" -v sy="$SY" -v sr="$SR" -v py="$PY" -v pr="$PR" \
      -v day="$( [ -n "$3" ] && date -d "@${3%.*}" '+%F %a %H:%M')" '
    function band(x) { return x > sr ? 31 : (x >= sy ? 33 : 32) }
    BEGIN {
      if (p < 0) p = 0; if (p > 100) p = 100
      if (mode == "session") {
        c = band(p)
        if (r != "") { m = int((r - now + 59) / 60); if (m < 0) m = 0; lbl = sprintf("↻ %dh%02d", int(m / 60), m % 60) }
        else lbl = "5h"
      } else {
        f = (r != "") ? 1 - (r - now) / 604800 : 0
        if (f < 0.02) c = band(p)
        else { if (f > 1) f = 1; proj = p / f; c = proj > pr ? 31 : (proj >= py ? 33 : 32) }
        split(day, d, " "); sub(/\.$/, "", d[2])
        lbl = (r == "") ? "7d" : (d[1] == today ? "↻ " d[3] : "↻ " d[2])
      }
      half = int(p / 100 * N * 2 + 0.5); full = int(half / 2); h = half % 2
      b = ""; for (i = 0; i < full; i++) b = b "█"; if (h) b = b "▌"
      t = ""; for (i = full + h; i < N; i++) t = t "░"
      printf "%s \033[%dm%s\033[90m%s\033[0m %d%%", lbl, c, b, t, int(p + 0.5)
    }'
}

if [ -n "$h5" ]; then
  out+=" · $(bar "$h5" session "$r5")"
  [ -n "$d7" ] && out+=" · $(bar "$d7" week "$r7")"
elif [ -n "$d7" ]; then
  out+=" · $(bar "$d7" week "$r7")"
fi
printf '%b' "$out"
