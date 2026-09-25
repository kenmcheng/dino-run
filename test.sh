#!/usr/bin/env bash
# Single entrypoint for the test suite. Most tests are pure logic, but
# test/server.test.js starts the real server on an ephemeral localhost port
# and drives it over a real WebSocket (still no DB, no external network).
set -euo pipefail
cd "$(dirname "$0")"
node --check server/index.js
node --check server/rooms.js
node --test "$@" test/*.test.js
