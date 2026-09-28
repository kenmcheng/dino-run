// Game data shared by the server simulation and the browser client.
// Units: distance in metres, time in seconds. `y` is the lateral position
// across the track, 0 (far side) .. TRACK_W (near side).

export const TICK_RATE = 30;
export const SNAPSHOT_EVERY = 1;       // ticks per snapshot → 30 Hz
export const TRACK_W = 6;
export const MAX_PLAYERS = 8;
export const MIN_FIELD = 6;            // bots top the field up to this when enabled

// ---------------------------------------------------------------- dinosaurs
// top: cruising speed (m/s); accel: m/s²; heatCap: seconds of sprinting before
// the costume overheats; mass: shoves others, shortens trips; cd: ability cooldown.
export const DINOS = {
  trex: {
    name: 'T-Rex', color: '#5bbf4a', top: 9.4, accel: 6.0, heatCap: 4.5, mass: 1.2, cd: 9,
    ability: 'roar', abilityName: 'Mighty Roar',
    abilityDesc: 'Stuns everyone just ahead of you.',
    tagline: 'Tiny arms. Enormous ego.',
  },
  raptor: {
    name: 'Velociraptor', color: '#d98b3a', top: 9.0, accel: 9.5, heatCap: 3.6, mass: 0.8, cd: 7,
    ability: 'pounce', abilityName: 'Pounce',
    abilityDesc: 'Leap forward in a burst, clearing anything low.',
    tagline: 'Clever girl. Fast starter.',
  },
  trike: {
    name: 'Triceratops', color: '#3f8fd6', top: 9.15, accel: 5.5, heatCap: 5.0, mass: 1.4, cd: 12,
    ability: 'charge', abilityName: 'Horn Charge',
    abilityDesc: 'Unstoppable rush: bowls runners over and smashes hurdles.',
    tagline: 'Three horns, zero brakes.',
  },
  stego: {
    name: 'Stegosaurus', color: '#c9577a', top: 9.0, accel: 6.0, heatCap: 5.0, mass: 1.2, cd: 10,
    ability: 'spikes', abilityName: 'Spike Guard',
    abilityDesc: 'Plates up: immune for 3 s and reflects Egg Bombs.',
    tagline: 'Brain the size of a walnut. Defence of a castle.',
  },
  ptera: {
    name: 'Pteranodon', color: '#9a6fd1', top: 9.2, accel: 7.0, heatCap: 4.0, mass: 0.7, cd: 11,
    ability: 'glide', abilityName: 'Glide',
    abilityDesc: 'Take off and sail over hazards, a little faster.',
    tagline: 'Technically not a dinosaur. Doesn\'t care.',
  },
  ankylo: {
    name: 'Ankylosaurus', color: '#8a8f3c', top: 9.05, accel: 5.0, heatCap: 6.2, mass: 1.8, cd: 8,
    ability: 'club', abilityName: 'Tail Club',
    abilityDesc: 'Swing at everyone right behind or beside you.',
    tagline: 'A tank in a onesie.',
  },
  parasaur: {
    name: 'Parasaurolophus', color: '#e0b43a', top: 9.25, accel: 6.5, heatCap: 5.0, mass: 1.0, cd: 11,
    ability: 'honk', abilityName: 'Crest Honk',
    abilityDesc: 'Steal the nearest rival\'s item and startle those close by.',
    tagline: 'Bringing the trombone section.',
  },
  pachy: {
    name: 'Pachycephalosaurus', color: '#4bb3a8', top: 9.0, accel: 7.2, heatCap: 4.6, mass: 1.1, cd: 8,
    ability: 'headbutt', abilityName: 'Dome Slam',
    abilityDesc: 'Dash forward and knock over the first runner you hit.',
    tagline: 'Thinks with its head. Hits with it too.',
  },
};

export const COSTUME_COLORS = [
  '#5bbf4a', '#d98b3a', '#3f8fd6', '#c9577a', '#9a6fd1', '#8a8f3c', '#e0b43a', '#4bb3a8',
  '#e5484d', '#f2f2f2', '#333a45', '#ff8fc7',
];

// -------------------------------------------------------------------- items
export const ITEMS = {
  peel:   { name: 'Fern Peel',    icon: '🌿', desc: 'Drop behind you. Very slippery.' },
  egg:    { name: 'Egg Bomb',     icon: '🥚', desc: 'Hurl it straight ahead along your line.' },
  meteor: { name: 'Meteor',       icon: '☄️', desc: 'Homes in on whoever is leading.' },
  amber:  { name: 'Amber Shield', icon: '🔶', desc: 'Blocks the next hit.' },
  boba:   { name: 'Boba Boost',   icon: '🧋', desc: 'Big burst of speed, no heat.' },
  tar:    { name: 'Tar Pit',      icon: '🕳️', desc: 'Leave a sticky pit behind you.' },
  pin:    { name: 'Deflator Pin', icon: '📌', desc: 'Deflates every inflatable costume ahead.' },
  ash:    { name: 'Ash Cloud',    icon: '🌋', desc: 'Smokes the view of everyone ahead.' },
  water:  { name: 'Ice Water',    icon: '💧', desc: 'Instantly cools your costume.' },
  blaster: { name: 'Water Blaster', icon: '🔫', desc: 'Soak whoever is ahead: steer to aim the jet. Wet foam is heavy.' },
  mallet: { name: 'Squeaky Mallet', icon: '🔨', desc: 'Swing a giant inflatable hammer at runners beside or just ahead.' },
  balloon: { name: 'Water Balloon', icon: '🎈', desc: 'Lob it over the pack onto the runner ahead. Big splash.' },
  hatch:  { name: 'Raptor Hatchlings', icon: '🐣', desc: 'Three babies chase the runners ahead. Jump them!' },
};

// Tuning for the attack items (seconds, metres).
export const WEAPONS = {
  spray: 2.5,          // Water Blaster jet duration
  sprayReach: 11,      // how far ahead the jet reaches
  soak: 1.2,           // soaked time after leaving the jet
  soakSlow: 0.78,      // speed multiplier while soaked
  swing: 0.45,         // mallet wind-up + swing; the bonk lands at swingHit
  swingHit: 0.22,
  balloonFlight: 0.9,  // water balloon time in the air
  balloonSoak: 3,
  hatchLife: 6,        // raptor hatchlings give up after this
};

const lerp = (a, b, t) => a + (b - a) * t;

// Mario Kart-style rubber band: leaders get defensive items, stragglers get
// the big equalisers. `frac` is 0 for the leader .. 1 for last place.
export function itemWeights(frac) {
  return {
    peel: lerp(28, 4, frac),
    egg: lerp(24, 12, frac),
    amber: lerp(20, 4, frac),
    water: lerp(12, 6, frac),
    tar: lerp(10, 6, frac),
    mallet: lerp(10, 8, frac),
    blaster: lerp(6, 14, frac),
    balloon: lerp(4, 14, frac),
    boba: lerp(3, 26, frac),
    pin: lerp(0, 14, frac),
    ash: lerp(0, 12, frac),
    hatch: frac > 0.25 ? lerp(0, 12, frac) : 0,
    meteor: frac > 0.45 ? lerp(0, 14, frac) : 0,
  };
}

// ------------------------------------------------------------------ courses
export const COURSES = {
  sprint: {
    name: 'Stadium Sprint', length: 400, theme: 'stadium',
    blurb: 'One lap of the stadium. Short, loud, chaotic.',
    eggEvery: 55, hurdleEvery: 75, water: [200], mud: [],
  },
  jungle: {
    name: 'Jurassic Jungle 800', length: 800, theme: 'jungle',
    blurb: 'Mud, fallen logs and two water stations. Pace your costume.',
    eggEvery: 60, hurdleEvery: 65, water: [270, 540], mud: [140, 420, 660],
  },
  volcano: {
    name: 'Volcano Dash', length: 600, theme: 'volcano',
    blurb: 'It is very hot in there. Sprint wisely.',
    eggEvery: 50, hurdleEvery: 60, water: [300], mud: [180, 450], heatMul: 1.35,
  },
};

export const WATER_LEN = 14;
export const MUD_LEN = 16;

// Deterministic course layout so client and server agree without sending it.
export function buildCourse(id) {
  const c = Object.hasOwn(COURSES, id) ? COURSES[id] : COURSES.sprint;
  const eggs = [];
  const hurdles = [];
  for (let x = 30, row = 0; x < c.length - 25; x += c.eggEvery, row++) {
    const lanes = row % 2 === 0 ? [1, 3, 5] : [0.8, 2.2, 3.8, 5.2];
    for (const y of lanes) eggs.push({ x, y });
  }
  const busy = [...c.water.map((w) => [w - 5, w + WATER_LEN + 5])];
  for (let x = 60; x < c.length - 30; x += c.hurdleEvery) {
    if (busy.some(([a, b]) => x > a && x < b)) continue;
    if (eggs.some((e) => Math.abs(e.x - x) < 6)) { hurdles.push(x + 8); continue; }
    hurdles.push(x);
  }
  return {
    id: Object.hasOwn(COURSES, id) ? id : 'sprint',
    ...c,
    heatMul: c.heatMul || 1,
    eggs,
    hurdles,
    water: c.water.map((x) => [x, x + WATER_LEN]),
    mud: c.mud.map((x) => [x, x + MUD_LEN]),
  };
}

// Status-effect bit flags used in snapshots.
export const FX = {
  trip: 1, stun: 2, boost: 4, deflate: 8, ash: 16, shield: 32, spikes: 64,
  glide: 128, charge: 256, dash: 512, stumble: 1024, overheat: 2048, slow: 4096, draft: 8192,
  soaked: 16384, spray: 32768, swing: 65536,
};

// Sideways movement with a little momentum. Shared so the client can predict
// its own runner with exactly the server's physics.
export const LATERAL = { speed: 4.6, accel: 32 };
export function lateralStep(y, vy, steer, dt) {
  const target = Math.max(-1, Math.min(1, steer)) * LATERAL.speed;
  const step = LATERAL.accel * dt;
  vy = vy < target ? Math.min(target, vy + step) : Math.max(target, vy - step);
  y += vy * dt;
  if (y < 0.3) { y = 0.3; vy = Math.max(0, vy); }
  if (y > TRACK_W - 0.3) { y = TRACK_W - 0.3; vy = Math.min(0, vy); }
  return [y, vy];
}

export const JUMP = { v: 6.2, g: 22 };

// Timing windows for the skill mechanics.
export const SKILL = {
  rocketWindow: 0.45,   // press sprint within this many seconds before GO
  falseStart: 1.2,      // holding sprint longer than this before GO wobbles you
  hopWindow: [0.1, 0.38], // jump this long before crossing a hurdle = perfect hop
  draftAfter: 0.5,      // seconds tucked in behind someone before slipstream kicks in
};

// Bot names, per costume so a 'Stegz' is always actually a stegosaurus.
export const BOT_NAMES = {
  trex: ['Rexy McRexface', 'Jurassic Mark'],
  raptor: ['Raptor Swift', 'Clever Girl'],
  trike: ['Tricia Tops', 'Horn Please'],
  stego: ['Stegz', 'Plate Expectations'],
  ptera: ['Ptera Parker', 'Wing It'],
  ankylo: ['Anky Panky', 'Club Penguin'],
  parasaur: ['Sir Honks-a-Lot', 'Tuba Tina'],
  pachy: ['Dome Alone', 'Bonehead Betty'],
};
