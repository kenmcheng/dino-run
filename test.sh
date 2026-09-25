#!/usr/bin/env bash
# Single entrypoint for the test suite. The simulation tests are pure logic:
# no database, no network, no running server.
set -euo pipefail
cd "$(dirname "$0")"
node --check server/index.js
node --test "$@" test/*.test.js
