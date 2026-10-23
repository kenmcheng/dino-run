# AGENTS.md

## What this repo is
Dino Run is a multiplayer 3D browser racing game (inflatable-dinosaur runners, Mario Kart-style items, bots). One Node process (`server/index.js`, port 8090, `/healthz`) serves the static client and a `ws` WebSocket game server; browsers are the only callers. State is in memory (rooms), with no database. A Dockerfile exists, but the workspace AGENTS.md lists no dino-run service, so treat it as not deployed as a service.

## Layout
- `server/index.js` - HTTP + WebSocket entrypoint, env limits, message dispatch
- `server/rooms.js` - lobby and room lifecycle, tick loop; `server/race.js` - pure race simulation; `server/limits.js` - rate/connection caps
- `shared/` - code used by both server and browser (`data.js` game data, `lobby.js`, `playout.js`)
- `public/` - browser client (`index.html`, `js/`, `js/three/`, `assets/`); no build step
- `art/` - Blender asset pipeline that produces `public/assets/costumes`
- `test/*.test.js` - node:test suites; `test.sh` - test entrypoint
- `.forgejo/workflows/ci.yml` and `.forgejo/scripts/` (`ship.sh`, `no-comment-control-signals.sh`) - board CI
- `.github/workflows/ci.yml` and `.github/scripts/no-local-refs.sh` - GitHub CI, not run by the board
- `Dockerfile`, `README.md` (env limit table), `DESIGN.md`, `CONTRIBUTING.md`

## Build and test
- Test entrypoint: `./test.sh [node --test flags]`. It runs `node --check` on `server/index.js` and `server/rooms.js`, then `node --test test/*.test.js`.
- Database: none. `test/server.test.js` spawns the real server on an ephemeral localhost port and drives it over a real WebSocket; no external network.
- The board's Forgejo runs `.forgejo/workflows/ci.yml` (it takes precedence over `.github/workflows`); the GitHub file is the CI of record only after the GitHub cutover.
- CI job `test`: `npm ci`, `./test.sh` with spec and junit reporters, then `no-comment-control-signals.sh`; on PRs it comments the result.
- CI job `ship` (push to main only, needs `test`): runs `ship.sh` to sync the wiki and close shipped tickets.
- CI job `report-verdict` (PRs only): sets the `ci:pass` / `ci:fail` label on the `task-N` ticket.
- GitHub-only job `secret-scan`: `no-local-refs.sh` plus gitleaks.
- CI is the test authority; a local run is a convenience.

## Rules and pitfalls
- Never write a local hostname, LAN address, home path or board key reference into any tracked file, including docs; `no-local-refs.sh` fails the GitHub `secret-scan` job.
- Commits need a `Signed-off-by:` trailer (DCO, see `CONTRIBUTING.md`).
- Never read a control signal out of ticket comment text; `ship.sh` only POSTs comments and signals via the `ship:done` label (tasks 1173, 1012).
- Keep `server/race.js` free of sockets and timers, and inject `rng` (default `Math.random`), so tests can step it deterministically.
- Code in `shared/` runs in the browser as well as Node: no Node-only imports, and the Dockerfile copies only `server`, `shared` and `public`.
- Changing a server limit means updating the env table in `README.md`; the defaults (150 msg/s) are sized above a 144 Hz input stream.
- Forgejo cancels in-flight runs on a newer push; the workflow sets `cancel-in-progress: false` so `ship` is not lost on main (task 1200).
- A skipped `ship` on a PR is not a failure; `report-verdict` treats only failure or cancelled as fail (task 1186).

## Fleet-wide contract
Credentials, services, hosts and agent roles are in the workspace AGENTS.md one directory above this repo (in a ticket worktree, the one above the worktree root); nothing from it is repeated here.
