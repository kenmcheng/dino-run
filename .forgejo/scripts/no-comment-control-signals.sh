#!/usr/bin/env bash
# Regression guard for board task 1173: a control signal (shipment,
# review verdicts, anything a script branches on) must never be read out of
# ticket comment text. A comment is free prose that any agent (including the
# script's own past runs) can write, so a consumer that greps /comments for a
# magic string will eventually match its own prose about that string and
# loop -- that is exactly what the old `<!-- forgejo-ship:` marker did to
# board task 1012 six times.
#
# Two mechanical, negative assertions -- neither can be satisfied by adding
# more prose, only by the code itself never reading a comment for control
# purposes:
#   (i)  no tracked file mentions the retired "forgejo-ship" string, except
#        this guard's own source (which has to name it to explain the check).
#   (ii) every line in ship.sh that touches the /comments endpoint issues a
#        POST, never a GET -- i.e. ship.sh writes comments for humans but
#        never reads them back.
#
# Usage: no-comment-control-signals.sh (no args; run from anywhere in the repo)
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"

SELF="$(realpath --relative-to="$(pwd)" "$0" 2>/dev/null || echo ".forgejo/scripts/no-comment-control-signals.sh")"
FAIL=0

# --- (i) no tracked file names the retired marker string, except this guard
HITS=$(git ls-files -z | xargs -0 grep -ln 'forgejo-ship' -- 2>/dev/null | grep -vFx "$SELF" || true)
if [ -n "$HITS" ]; then
  echo "FAIL: 'forgejo-ship' still appears in tracked files (control signal must be a label, not comment text):"
  echo "$HITS" | while read -r f; do
    grep -n 'forgejo-ship' "$f" | sed "s|^|  $f:|"
  done
  FAIL=1
else
  echo "pass: no tracked file (other than this guard) mentions 'forgejo-ship'"
fi

# --- (ii) ship.sh never GETs /comments, only ever POSTs to it. Skip comment
# lines (leading '#', ignoring indentation) -- this checks executed code, not
# prose that explains the rule.
SHIP=".forgejo/scripts/ship.sh"
if [ -f "$SHIP" ]; then
  BAD=$(grep -n '/comments' "$SHIP" | grep -vE '^[0-9]+: *#' | grep -v -- '-X POST' || true)
  if [ -n "$BAD" ]; then
    echo "FAIL: $SHIP touches /comments without -X POST (a read of comment text for control purposes):"
    echo "$BAD" | sed "s|^|  $SHIP:|"
    FAIL=1
  else
    echo "pass: every /comments reference in $SHIP is a POST (write-only)"
  fi
else
  echo "FAIL: $SHIP not found"
  FAIL=1
fi

if [ "$FAIL" -eq 0 ]; then
  echo "no-comment-control-signals: all checks passed"
else
  echo "no-comment-control-signals: FAILED"
fi
exit "$FAIL"
