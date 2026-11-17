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
- `.github/workflows/ci.yml` and `.github/scripts/no-local-refs.sh` - CI of record (jobs `test`, `secret-scan`)
- `Dockerfile`, `README.md` (env limit table), `DESIGN.md`, `CONTRIBUTING.md`

## Build and test
- Test entrypoint: `./test.sh [node --test flags]`. It runs `node --check` on `server/index.js` and `server/rooms.js`, then `node --test test/*.test.js`.
- Database: none. `test/server.test.js` spawns the real server on an ephemeral localhost port and drives it over a real WebSocket; no external network.
- CI of record is `.github/workflows/ci.yml`; it runs on push to `main` and on `pull_request`. PR runs cancel in-progress runs; `main` runs do not.
- CI job `test`: `npm ci`, `./test.sh` with spec and junit reporters, a step summary, and the `test-report` artifact upload.
- CI job `secret-scan`: `no-local-refs.sh` plus gitleaks (PR diff on PRs, full history on push).
- The board's `ci:pass` / `ci:fail` label and ship/close (wiki sync, `ship:done`) are set by the fleet's host-side GitHub poller and ship script (`tasksmith-github-poll.sh`, `tasksmith-github-ship.sh`, outside this repo); there is no in-repo `ship` or `report-verdict` job.
- CI is the test authority; a local run is a convenience.

## Rules and pitfalls
- Never write a local hostname, LAN address, home path or board key reference into any tracked file, including docs; `no-local-refs.sh` fails the GitHub `secret-scan` job.
- Commits need a `Signed-off-by:` trailer (DCO, see `CONTRIBUTING.md`).
- Never read a control signal out of ticket comment text; ship state is signalled only by the `ship:*` / `ci:*` labels (tasks 1173, 1012).
- Keep `server/race.js` free of sockets and timers, and inject `rng` (default `Math.random`), so tests can step it deterministically.
- Code in `shared/` runs in the browser as well as Node: no Node-only imports, and the Dockerfile copies only `server`, `shared` and `public`.
- Changing a server limit means updating the env table in `README.md`; the defaults (150 msg/s) are sized above a 144 Hz input stream.

## Fleet-wide contract
Credentials, services, hosts and agent roles are in the workspace AGENTS.md one directory above this repo (in a ticket worktree, the one above the worktree root); nothing from it is repeated here.
