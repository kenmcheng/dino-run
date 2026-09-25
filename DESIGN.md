# Dino Run: design notes

## Pillars

1. **It's a real footrace, in a silly suit.** The game is about running: pacing,
   line choice and jumping. Items add chaos without replacing the race.
2. **The costume is the character.** Every mechanic should be something a
   person in an inflatable dinosaur suit could plausibly suffer: overheating,
   deflating, tripping over your own tail, a tiny face peeking out of the neck
   window.
3. **Anyone can join in 10 seconds.** Browser only, no account, a 4-letter
   code, bots when you're alone. Playable on a phone.

## Core loop (implemented)

```
run automatically ─► choose line (items / hazards / rivals)
        │
        ├─ sprint?  faster, but costume heat rises ─► overheat = 2.5 s waddle
        │            water stations and Ice Water cool you
        ├─ jump?    clear fossil hurdles and peels (a mistimed jump = stumble)
        ├─ item?    rank-weighted mystery eggs (rubber band)
        └─ skill?   per-dinosaur signature move on a cooldown
```

Heat is the resource that separates good runners from button mashers. The
Volcano course multiplies heat gain, and the Jungle has two water stations
and mud that rewards careful pacing.

Three skill moves reward timing without adding buttons: a **rocket start**
(sprint just before GO), a **perfect hop** (peak your jump over a hurdle) and
**slipstream** (tuck in behind a rival). Slipstream also halves heat
build-up, which ties drafting into the heat economy.

## Ideas backlog

Roughly in the order I'd build them.

### Modes

- **Dinosaur Egg Relay (4×100 m)**: straight from the real event. Teams of
  four, and you pass a giant *egg baton* at the exchange zone with a timed
  button press. If you get hit while holding it, the egg rolls away and has to
  be picked up. The real event requires at least one woman per team, so the
  in-game version could require mixed costumes (e.g. at least one herbivore).
- **Hatchling Dash**: a kids' mode with no weapons, gentle bots, bigger
  hitboxes and a baby-dino costume set. It mirrors the real event's
  7–12-year-old race.
- **Extinction Event**: battle royale. A meteor shower sweeps forward from the
  back of the pack and the last runner caught is eliminated each lap.
- **Time Trial with ghosts**: race your best run, a friend's, or the daily
  top time. Ghost replays are just stored input streams, and the deterministic
  simulation (seeded rng) already supports them.
- **Parade Mode**: no racing. Everyone dances along the course, spectators vote
  on the best costume, and the winner gets a cosmetic.

### Costumes and characters

- **More species**: Brachiosaurus (*Long Neck*: grabs eggs from two lines
  away), Spinosaurus (*Sail Cooling*: fast in water zones), Dilophosaurus
  (*Frill Spit*: blinds one target), Mosasaurus (a "pool noodle" costume that
  only swims), Therizinosaurus (*Claw Swipe*: steals the shield off a rival).
- **Customisation**: accessories that don't affect stats, like sunglasses,
  headbands, race bibs with your own number, a tutu, a boba cup. Costume
  patterns: spots, stripes, glitter, "wet from the water station".
- **Costume condition**: a costume that takes too many hits tears in the
  results screen, and repairing it is a cosmetic mini-game.
- **3D dinosaur medals**: the real event gives 3D dinosaur medals. The game
  could let you collect one medal design per species podium.

### Items

- **Sticky Bib**: glues your race bib onto the leader's face and reverses
  their up/down controls for 3 s.
- **Air Pump**: inflates your costume to double size. You're slower, but you
  shove everyone aside and are immune to peels.
- **Nest**: drop a nest that hatches three tiny raptors, which chase the
  nearest runner.
- **Cheer Horn**: spectators' cheers become a small boost for everyone near you
  (and you get the biggest share).
- **Fossil Fuel**: a very long, weak boost. Great on the marathon course.

### Spectators and social

- **Cheering crowd as players**: spectators join the room from their phones.
  Tapping *cheer* charges a meter that drops random item eggs on the track or
  gives the underdog a boost. It works well on a TV at a party or on stream.
- **Emotes and taunts** (T is implemented): per-species voice lines, photo-finish
  replays, and a shareable end-of-race GIF.
- **Seasonal events**: a Lunar New Year course with firecracker hurdles, a
  Halloween "skeleton costume" set, and a Kaohsiung course that runs past the
  Lotus Pond's Dragon and Tiger Pagodas and along Pier-2 and the Love River.

### Courses

- A **real-world-inspired course pack**: a stadium sprint (done), a riverside
  night run with lantern lighting, a museum run through the dinosaur hall
  where fossil skeletons are the hurdles, and a beach course where sand slows
  you and waves cool you down.
- **Branching routes**: a short hot path and a long shaded path. That makes
  the heat mechanic a routing decision.
- **Dynamic hazards**: rolling eggs, a geyser that launches you, a slow
  sauropod crossing the track.

## Technical roadmap

| Step | What | Why |
|---|---|---|
| 1 | ~~Client-side prediction of your own runner~~ done for steering and jumps; extend to your own speed changes (boost, sprint) | instant feel for everything you control |
| 2 | Room persistence and reconnect by token | a page refresh shouldn't cost you the race |
| 3 | Deploy: Docker image, then a compose service behind the home reverse proxy | shareable URL |
| 4 | Leaderboards (Postgres): best times per course and costume | replayability |
| 5 | Relay mode (team state, baton handoff) | the signature mode from the real event |
| 6 | Spectator clients with a cheer meter | party and stream play |
| 7 | Art pass: glTF costume models from an artist (the rig joint names in `dino3d.js` are the contract), music, per-course ambience | polish |
| 8 | Real terrain: a heightfield that follows the track instead of the flat ground plus embankments | immersion |

## Tuning notes

Balance comes from a headless simulation: 180 all-bot races across three
courses, measuring each costume's average finishing place. After tuning, the
spread is roughly 3.4–5.8 across the eight costumes (1 = always wins, 8 =
always last). Bot results don't equal human results. Tail Club, Roar and
Honk are much stronger in human hands, so revisit balance after real
playtests.
