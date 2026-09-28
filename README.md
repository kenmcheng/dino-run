# Dino Run 🦖💨

A multiplayer 3D browser racing game. Everyone runs in an inflatable dinosaur
costume, and the race plays like Mario Kart: a chase camera, looping
circuits, mystery eggs, egg bombs, fern peels, and meteors called down on
whoever is leading.

It was inspired by the *最速恐龍爭霸賽* (Speediest Dinosaur Battle) at the 2027
Kaohsiung Marathon, a 150 m sprint where every runner wears a dinosaur costume.

## Run it

```bash
npm install
npm start            # http://<host>:8090  (PORT / HOST env vars override)
```

Open the page, pick a costume, then **Create room** and share the invite link
or the 4-letter code. Bots fill the field up to six runners, so you can race
alone too.

```bash
./test.sh            # simulation tests plus a server integration test (no external network or DB)
```

Docker:

```bash
docker build -t dino-run .
docker run -p 8090:8090 dino-run
# e.g. docker run -p 8090:8090 -e MAX_ROOMS=50 dino-run
```

## Limits

The server is unauthenticated, so it caps a few things to keep one client (or
a small script) from growing memory use or flooding the event loop without
bound. All are env vars with defaults sized for a LAN party of up to
`MAX_PLAYERS` (8) runners:

| Env var | Default | Meaning | On limit |
| --- | --- | --- | --- |
| `MAX_ROOMS` | 200 | Ceiling on concurrent rooms | `create` gets `{t:'error', msg:'Server is full…'}` (shown via `toast()`); no room is made |
| `MAX_CONNECTIONS` | 500 | Ceiling on total open WebSocket connections | New socket gets an error frame, then closes with code 1013 |
| `MAX_CONNECTIONS_PER_IP` | 16 | Ceiling on open connections from one IP | Same as above — a LAN party of 8 players sharing one IP, plus reconnect slack |
| `MSG_RATE` | 150 | Sustained messages/second a connection can send | Extra messages are dropped silently once the burst is spent |
| `MSG_BURST` | 300 | Token-bucket burst size | — |
| `MSG_FLOOD_DROPS` | 300 | Dropped messages within `MSG_FLOOD_WINDOW_MS` before the socket is cut off | Socket closes with code 1008 |
| `MSG_FLOOD_WINDOW_MS` | 10000 | Window (ms) the flood count resets over | — |
| `TRUST_PROXY` | unset | Set to `1` behind a reverse proxy | Uses the last `X-Forwarded-For` hop as the client IP instead of the socket address |

`MSG_RATE`/`MSG_BURST` default to 150/300 because the client sends an `input`
message on every animation frame where steer, sprint or brake changes, which
on a 144 Hz display with an analog stick is close to 144 messages/second —
the defaults stay comfortably above that.

Without `TRUST_PROXY=1` behind a reverse proxy, every client appears to share
the proxy's IP, and the per-IP cap effectively becomes a site-wide cap. With
it set, the server trusts the last `X-Forwarded-For` entry (the one the proxy
itself appended) rather than the client-controlled leftmost entry.

## How to play

| Key | Gamepad | Action |
|---|---|---|
| ← → (A D) | left stick / d-pad | **steer** (you run automatically) |
| ↑ / W / Shift | RT or RB | **sprint**, which heats up your costume |
| ↓ / S | LT or LB | ease off (cools you down) |
| Space | A | jump fossil hurdles and fern peels |
| E | B | use your item |
| Q | X | your dinosaur's signature move |
| T | Y | taunt |

On phones, drag anywhere on the left half of the screen to steer, and use the
round buttons on the right.

**Costume heat** is the core decision. Sprinting is about 28 % faster, but
foam suits get hot. When the meter fills you *overheat* and waddle at walking
pace for 2.5 s. Water stations cool you quickly, and the Volcano course heats
you faster.

**Skill moves:**
- **Rocket start:** press sprint in the last ~0.45 s before GO for a boost.
  Hold it for more than 1.2 s and you wobble off the line.
- **Perfect hop:** time your jump so you're near the top of the arc as you
  cross a hurdle for a short burst.
- **Slipstream:** tuck in 1–7 m behind a runner for 7 % more speed and half
  the heat build-up.

### Costumes

| Dinosaur | Signature move (Q) | Profile |
|---|---|---|
| T-Rex | **Mighty Roar**: stuns runners just ahead | fastest top speed |
| Velociraptor | **Pounce**: burst leap forward | best acceleration, runs hot |
| Triceratops | **Horn Charge**: unstoppable, bowls people over, smashes hurdles | heavy |
| Stegosaurus | **Spike Guard**: 3 s immunity, reflects egg bombs | defensive |
| Pteranodon | **Glide**: fly over every ground hazard | light |
| Ankylosaurus | **Tail Club**: trips everyone behind or beside you | heaviest, best cooling |
| Parasaurolophus | **Crest Honk**: steals the nearest rival's item | item thief |
| Pachycephalosaurus | **Dome Slam**: dash and flatten the first runner hit | bruiser |

### Items (from mystery eggs)

The odds depend on your position, so leaders get defensive items and
stragglers get the equalisers.

🌿 Fern Peel · 🥚 Egg Bomb · ☄️ Meteor (homes in on the leader) · 🔶 Amber Shield ·
🧋 Boba Boost · 🕳️ Tar Pit · 📌 Deflator Pin (deflates every costume ahead) ·
🌋 Ash Cloud (smokes rivals' screens) · 💧 Ice Water

Four items let you attack rivals up close:

- 🔫 **Water Blaster**: a 2.5 s jet of water. Steer to aim it. It soaks the
  first runner in the stream and shoves them sideways.
- 🔨 **Squeaky Mallet**: a giant inflatable hammer. It bonks anyone beside you
  or just ahead when the swing lands, so a quick sidestep dodges it.
- 🎈 **Water Balloon**: lobbed over the pack at the runner ahead. A blue
  marker shows where it will land; it commits halfway through its flight, so
  you can still dive out of the way. The splash soaks and stumbles everyone
  nearby.
- 🐣 **Raptor Hatchlings**: three babies scurry after the runners ahead and
  nip their ankles. Jump them!

**Soaked** runners are about 22 % slower for a while, because wet foam is
heavy. The water also cools their costume, which is the one upside of being
hosed down.

## Architecture

```
server/index.js          HTTP static files + WebSocket (/ws) on one port; serves three.js from node_modules
server/rooms.js          rooms, lobby, bots, 30 Hz tick loop, 15 Hz snapshots
server/limits.js         room/connection caps and message rate limiting, see "Limits" above
server/race.js           authoritative race simulation (pure, deterministic with a seeded rng)
shared/data.js           dinosaurs, items, courses, shared by server and browser
shared/playout.js        jitter-tolerant playback clock for snapshots (unit-tested)
public/js/main.js        UI, networking, HUD, minimap
public/js/controls.js    keyboard, gamepad and touch stick → { steer, sprint, brake }
public/js/predict.js     local prediction of your own steering and jumps
public/js/three/
  game3d.js              renderer, lights, chase camera, per-frame sync, adaptive quality
  quality.js             auto-quality state machine (unit-tested)
  track.js               course loops (length = sim distance), surfaces, extrusion helpers
  scenery.js             stadium / jungle / volcano environments (instanced crowds, trees, lava…)
  props.js               start arch + mascot, hurdles, water stations, eggs, hazards, projectiles
  dino3d.js              the costumes: Blender rig or procedural fallback, shared animation
  assets.js              loads the Blender models (manifest, GLB, WebP), with fallback
  fx.js                  GPU particles (dust, steam, boba, sparks, smoke, embers, mist, confetti…)
  studio.js              title-screen turntable and costume thumbnails
  textures.js            every procedural texture, painted on canvases
public/assets/           Blender-built models and baked textures (generated, see art/)
art/                     the Blender build: costumes, props and scenery, baked on the GPU
```

### Models: Blender-built, with procedural fallback

The costumes, items, course props and most scenery are modelled and baked in
Blender by the scripts in [`art/`](art/README.md). They sculpt a detailed
high-poly model, then bake its detail into textures on a light game mesh
using Cycles on the GPU. The game streams these models in and replaces each
procedural model as soon as its file arrives.

The procedural models stay as the fallback. They are used while a file is
downloading, when a file fails to load, and when the player picks
**Models → Classic** on the title screen (or adds `?classic` to the URL).

```powershell
.\art\build.ps1 -Only trex -Preview   # rebuild a costume (Blender 4.2+)
```

### The 3D world

- **The simulation stays 2D, and the view is 3D.** The server tracks distance
  along the course, lateral position and height. Each course is a closed 3D
  loop whose arc length equals the course length, so that distance maps
  straight onto the circuit. The Stadium Sprint is a real 400 m oval. The
  jungle loop winds over hills, and the volcano course circles a live
  volcano.
- **Costume models.** Each costume is modelled like a real inflatable:
  - **Body:** one continuous skinned shell (tail, belly and neck) swept along a
    spine curve. Bones drive the tail follow-through, the neck bob, the lean
    into turns and the deflation sag.
  - **Fabric:** nylon with sheen, plus a procedural normal map for stitched
    panel seams, inflation creases and weave. Species markings are printed on
    top, and a lighter belly is blended in by vertex color.
  - **Details:** sculpted heads, glossy eyes with printed irises and blinking
    fabric eyelids, and a clear PVC face window with the runner inside. The
    face changes expression when dizzy or overheating. There's also a blower
    fan on the lower back, a pinned race bib, and puffy costume trousers with
    elastic cuffs over real running shoes.
  - **Species extras:** teeth and tongue, a frill with horns, back plates and
    a thagomizer, membrane wings, armour and a tail club, a tubular crest, a
    knobbed dome, and feathers.
- **Environments.** The stadium has a bowl of instanced fans (thousands of
  them, some in dino hats) whose cheering bounce is animated on the GPU. It
  also has floodlights, a roof, waving flags, advertising boards, a football
  pitch, a live video screen showing the leader, palm trees and a skyline.
  The jungle has instanced trees, ferns, glowing flowers, mossy boulders,
  fireflies and a distant smoking volcano. The volcano course has lava
  rivers, lava pools, obsidian spires, falling ash, embers and a giant fossil
  ribcage you run through.
- **Look.** The stadium and jungle use a physically based sky with drifting
  clouds; the volcano has its own smoky red sky. Post-processing adds bloom
  (on lava, lamps and sparks), gentle grading and a vignette. Grass, ferns,
  palms and tree canopies sway in the wind on the GPU. Every runner has a soft
  contact shadow. Speed lines appear while boosting, and the camera leans into
  turns.
- **Graphics settings.** You can pick Auto, High, Medium, Low or Lowest on the
  title screen. Auto starts at High and steps down whenever frames stay slower
  than about 40 fps, then climbs back up after a sustained run faster than
  about 55 fps; a tier that keeps failing needs longer and longer fast streaks
  to earn back (and gives up after enough drops), so it can't flap. The order
  is: pixel ratio, then post-processing, then shadow resolution, then shadows.
  A toast announces every effective change, and the Auto option's label shows
  the current effective tier when it isn't High. Add `?hq` to the URL to pin
  High.
  If a drop doesn't raise the frame rate (for example, a browser or battery
  saver capping at 30 fps), Auto undoes it and stops lowering for that cap.
  - A stadium frame at High is about 600 draw calls and 825k triangles,
    shadow pass included.
  - Small parts don't cast shadows.
  - Scenery sets that span the whole course are single instanced draws and
    stay out of the shadow pass.

### Networking and assets

- **Server-authoritative.** Clients send only held keys and one-shot actions.
  The server simulates everything and broadcasts compact snapshots plus an
  event list (hits, pickups, finishes). Clients can't cheat on position or items.
- **Smooth playback.** The server sends 30 snapshots per second. The client
  draws everyone slightly in the past, trailing the newest snapshot by one
  interval plus the jitter it has recently measured. It steers its playback
  clock by gently speeding up or slowing down rather than jumping, so late
  packets and slow frames don't cause stutter. `test/playout.test.js` replays
  jittery networks against the old and new clocks.
- **Instant controls.** Your own sideways movement and jumps are predicted
  locally with the server's own physics (`lateralStep` in `shared/data.js`),
  so steering responds on the next frame instead of after the playback delay.
  Everything else stays server-authoritative.
- **Event timing.** Hits, pickups and explosions play when the rendered world
  reaches them, not when their packet arrives.
- **No mid-race loading.** While the loading screen is up, every effect that
  could appear later is shown once and prepared. That covers shields, spikes,
  stars, speech bubbles, peels, tar, egg bombs and meteors. Shaders are
  compiled for both render paths (with and without post-processing), every
  texture is uploaded, all "place. name" tags are pre-drawn, and one warm-up
  frame is rendered. A stadium race compiles 0 shaders and uploads 0 textures
  after GO (previously 5 and 12), and auto-quality ignores the first seconds
  after loading.
- **Small, optional asset files.** The Blender models in `public/assets/` are
  meshopt-compressed GLB files with WebP textures, about 1.3 MB per costume.
  The race's costumes, props and scenery load before its loading screen
  closes. Anything that takes longer than 10 s falls back to its procedural
  model. Without the files, every model is built from code and every texture
  is painted on a canvas. Sound effects are synthesized with WebAudio.
- **Disconnects.** A player who drops mid-race is taken over by a bot, so the
  race keeps going.

See [DESIGN.md](DESIGN.md) for the game design and roadmap.
