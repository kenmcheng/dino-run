#!/usr/bin/env bash
# Guard for the open-source cutover: no tracked file may name the self-hosted
# board host, a LAN address, or a board auth artifact. Every pattern below is
# written with a bracket class around one character so the script's own
# source text does not match its own regex.
#
# 127.0.0.1 and RFC 5737 TEST-NET addresses (192.0.2.0/24, 198.51.100.0/24,
# 203.0.113.0/24) are allowed by design -- they are not LAN addresses and are
# used by the test suite's fixtures.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

RE='nas[.]home'
RE="$RE|/home/km[c]"
RE="$RE|192[.]168[.][0-9]{1,3}[.][0-9]{1,3}"
RE="$RE|(^|[^0-9.])10[.][0-9]{1,3}[.][0-9]{1,3}[.][0-9]{1,3}"
RE="$RE|(^|[^0-9.])172[.](1[6-9]|2[0-9]|3[01])[.][0-9]{1,3}[.][0-9]{1,3}"
RE="$RE|[.]config/tasksmit[h]"
RE="$RE|[A-Za-z0-9-]+_[A-Za-z0-9-]+[.]ke[y]\b"
RE="$RE|forgejo-toke[n]"

HITS=$(git ls-files -z | xargs -0 grep -nIE -- "$RE" || true)

if [ -n "$HITS" ]; then
  echo "FAIL: local host, LAN address or board key reference found in tracked files:"
  echo "$HITS"
  exit 1
fi

echo "pass: no local host, LAN address or board key reference in tracked files"
