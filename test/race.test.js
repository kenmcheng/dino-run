import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Race, DT } from '../server/race.js';
import { DINOS, ITEMS, buildCourse, COURSES, itemWeights } from '../shared/data.js';

function rng(seed = 1) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const human = (id, dino = 'trex') => ({ id, name: id, dino, color: '#000' });
const steps = (race, seconds) => { for (let i = 0; i < seconds / DT; i++) race.step(); };

test('every course builds with eggs, hurdles clear of water stations', () => {
  for (const id of Object.keys(COURSES)) {
    const c = buildCourse(id);
    assert.ok(c.eggs.length > 0, id);
    assert.ok(c.hurdles.length > 0, id);
    for (const h of c.hurdles) {
      assert.ok(h > 0 && h < c.length, `${id} hurdle ${h} on course`);
      for (const [a, b] of c.water) assert.ok(h < a - 5 || h > b + 5, `${id} hurdle ${h} clear of water`);
    }
  }
});

test('an all-bot race finishes with a consistent ranking', () => {
  const entrants = Object.keys(DINOS).map((d, i) => ({ ...human(`b${i}`, d), bot: true }));
  const race = new Race('sprint', entrants, { rng: rng(7), countdown: 0 });
  let guard = 0;
  while (!race.over && guard++ < 200 / DT) race.step();
  assert.ok(race.over, 'race ended');
  const res = race.results();
  assert.equal(res.length, entrants.length);
  assert.deepEqual(res.map((r) => r.place), res.map((_, i) => i + 1));
  const finished = res.filter((r) => r.time !== null);
  assert.ok(finished.length >= 1, 'somebody finished');
  for (let i = 1; i < finished.length; i++) assert.ok(finished[i].time >= finished[i - 1].time);
  assert.ok(res.reduce((n, r) => n + r.items, 0) > 0, 'bots used items');
});

test('nobody moves during the countdown', () => {
  const race = new Race('sprint', [human('a')], { countdown: 3 });
  steps(race, 2.5);
  assert.equal(race.runners[0].x, 0);
  steps(race, 1);
  assert.ok(race.runners[0].x > 0);
});

test('sprinting builds heat until the costume overheats; water cools it', () => {
  const race = new Race('sprint', [human('a')], { countdown: 0 });
  const r = race.runners[0];
  race.setInput('a', { sprint: true });
  steps(race, DINOS.trex.heatCap + 0.2);
  assert.ok(r.overheat > 0, 'overheated');
  assert.ok(race.drainEvents().some((e) => e.k === 'overheat'));
  steps(race, 0.5);
  assert.ok(r.v <= 3.6, 'waddling while overheated');

  const wet = new Race('sprint', [human('b')], { countdown: 0 });
  const w = wet.runners[0];
  w.x = wet.course.water[0][0] + 1;
  w.heat = 3;
  wet.step();
  wet.step();
  assert.ok(w.heat < 3 - 0.3, 'water station cools fast');
});

test('boost and horn charge cannot break the overheat waddle', () => {
  const race = new Race('sprint', [human('a')], { countdown: 0 });
  const r = race.runners[0];
  race.setInput('a', { sprint: true });
  r.heat = DINOS.trex.heatCap;
  race.step();
  assert.ok(r.overheat > 0, 'overheated');
  steps(race, 0.6); // let v settle from sprint speed toward the waddle cap first

  let checked = 0;
  while (r.overheat > 0.05) {
    r.fx.boost = Math.max(r.fx.boost, 0.8);
    r.fx.charge = Math.max(r.fx.charge, 1.2);
    race.step();
    assert.ok(r.v <= 3.6, `waddling despite boost+charge, v=${r.v}`);
    checked++;
  }
  assert.ok(checked > 30, 'covered enough of the overheat window');
});

test('boost and charge still exceed top speed when not overheated', () => {
  const race = new Race('sprint', [human('a')], { countdown: 0 });
  const r = race.runners[0];
  for (let i = 0; i < 3 / DT; i++) {
    r.fx.boost = 1;
    r.heat = 0;
    r.overheat = 0;
    race.step();
  }
  assert.ok(r.v > DINOS.trex.top * 1.4, `boost still beats top speed, v=${r.v}`);

  const race2 = new Race('sprint', [human('c', 'trike')], { countdown: 0 });
  const c = race2.runners[0];
  for (let i = 0; i < 3 / DT; i++) {
    c.fx.charge = 1;
    c.heat = 0;
    c.overheat = 0;
    race2.step();
  }
  assert.ok(c.v > DINOS.trike.top * 1.25, `charge still beats top speed, v=${c.v}`);
});

test('an egg bomb trips the runner ahead in the same line', () => {
  const race = new Race('sprint', [human('a'), human('b')], { countdown: 0 });
  const [a, b] = race.runners;
  a.y = b.y = 3; a.x = 20; b.x = 26; a.cd = b.cd = 99;
  race.setInput('a', {}); a.item = 'egg';
  race.queueAction('a', 'item');
  steps(race, 1);
  assert.ok(race.drainEvents().some((e) => e.k === 'hit' && e.id === 'b' && e.cause === 'egg'));
  assert.equal(a.stats.hits, 1);
});

test('amber shield absorbs a hit', () => {
  const race = new Race('sprint', [human('a'), human('b')], { countdown: 0 });
  const [a, b] = race.runners;
  b.fx.shield = 10;
  assert.equal(race.hit(b, a, 'egg', 1.4), false);
  assert.equal(b.fx.shield, 0);
  assert.equal(b.fx.trip, 0);
  assert.equal(race.hit(b, a, 'egg', 1.4), true);
  assert.ok(b.fx.trip > 0);
});

test('jumping clears a fossil hurdle; running into it stumbles', () => {
  const race = new Race('sprint', [human('a'), human('b')], { countdown: 0 });
  const [a, b] = race.runners;
  const h = race.course.hurdles[0];
  a.x = b.x = h - 2; a.v = b.v = 9; a.cd = b.cd = 99;
  race.queueAction('a', 'jump');
  steps(race, 0.4);
  assert.equal(a.fx.stumble, 0, 'jumper clears it');
  assert.ok(b.fx.stumble > 0, 'non-jumper stumbles');
});

test('meteor homes in on the leader', () => {
  const race = new Race('sprint', [human('a'), human('b'), human('c')], { countdown: 0 });
  const [a, b, c] = race.runners;
  a.x = 10; b.x = 50; c.x = 30;
  for (const r of race.runners) r.cd = 99;
  race.rank();
  a.item = 'meteor';
  race.queueAction('a', 'item');
  steps(race, 2.6);
  assert.ok(race.drainEvents().some((e) => e.k === 'hit' && e.id === 'b' && e.cause === 'meteor'));
  assert.equal(c.fx.trip, 0);
});

test('parasaur honk steals the nearest rival item', () => {
  const race = new Race('sprint', [human('p', 'parasaur'), human('v')], { countdown: 0 });
  const [p, v] = race.runners;
  p.x = 10; v.x = 14; v.y = p.y + 3; p.cd = 0; v.item = 'boba';
  race.queueAction('p', 'ability');
  race.step();
  assert.equal(p.item, 'boba');
  assert.equal(v.item, null);
});

test('triceratops charge smashes hurdles and bowls runners over', () => {
  const race = new Race('sprint', [human('t', 'trike'), human('x')], { countdown: 0 });
  const [t, x] = race.runners;
  const h = race.course.hurdles[0];
  t.x = h - 3; x.x = h + 1; t.y = x.y = 3; t.v = 9; t.cd = 0; x.cd = 99;
  race.queueAction('t', 'ability');
  steps(race, 0.6);
  assert.equal(t.fx.stumble, 0, 'charge ignores the hurdle');
  assert.ok(x.fx.trip > 0 || x.fx.ifr > 0, 'runner in the way got bowled');
});

test('disconnecting mid-race hands the runner to a bot', () => {
  const race = new Race('sprint', [human('a')], { countdown: 0 });
  race.makeBot('a');
  steps(race, 2);
  assert.ok(race.runners[0].bot);
  assert.ok(race.runners[0].x > 5);
});

test('steering is analog with a little momentum, and respects the track edges', () => {
  const race = new Race('sprint', [human('a')], { countdown: 0 });
  const r = race.runners[0];
  r.y = 3;
  race.setInput('a', { steer: -1 });
  race.step();
  const firstStep = 3 - r.y;
  steps(race, 0.3);
  assert.ok(firstStep > 0 && firstStep < 0.1, 'accelerates into the turn rather than teleporting');
  assert.ok(r.y < 2, 'full steer moves across lanes quickly');
  race.setInput('a', { steer: 0.5 });
  const y0 = r.y;
  steps(race, 0.5);
  assert.ok(r.y > y0, 'half steer to the right moves right');
  race.setInput('a', { steer: 1 });
  steps(race, 3);
  assert.ok(r.y <= 5.7 + 1e-9, 'clamped at the outer edge');
  race.setInput('a', { steer: 'nonsense' });
  assert.equal(r.input.steer, 0, 'junk input is ignored');
});

test('rocket start rewards a well-timed sprint; holding early is a false start', () => {
  const race = new Race('sprint', [human('good'), human('early'), human('none')], { countdown: 3 });
  const [good, early, none] = race.runners;
  race.setInput('early', { sprint: true });            // pressed at -3 s
  steps(race, 2.7);
  race.setInput('good', { sprint: true });             // pressed ~0.3 s before GO
  steps(race, 0.4);
  const ev = race.drainEvents();
  assert.ok(ev.some((e) => e.k === 'rocket' && e.id === 'good'));
  assert.ok(good.fx.boost > 0);
  assert.ok(ev.some((e) => e.k === 'falsestart' && e.id === 'early'));
  assert.ok(early.fx.stumble > 0);
  assert.equal(none.fx.boost, 0);
});

test('a jump timed to peak over the hurdle earns a hop boost', () => {
  const race = new Race('sprint', [human('a'), human('b')], { countdown: 0 });
  const [a, b] = race.runners;
  const h = race.course.hurdles[0];
  for (const r of race.runners) { r.v = 9; r.cd = 99; }
  a.x = h - 9 * 0.25;          // jump ~0.25 s before crossing: perfect
  b.x = h - 9 * 0.05;          // jump just before the bar: clears it, no boost
  b.y = a.y + 3;
  race.queueAction('a', 'jump');
  race.queueAction('b', 'jump');
  steps(race, 0.5);
  const hops = race.drainEvents().filter((e) => e.k === 'hop').map((e) => e.id);
  assert.deepEqual(hops, ['a']);
  assert.ok(a.fx.boost > 0);
});

// A race with runners placed by hand and no cooldowns firing.
function setup(...placed) {
  const race = new Race('sprint', placed.map(([id], i) => human(id, placed[i][3] || 'trex')), { countdown: 0 });
  race.runners.forEach((r, i) => { [, r.x, r.y] = placed[i]; r.cd = 99; r.v = 8; });
  return race;
}

test('water blaster soaks the first runner in the jet, and only them', () => {
  const race = setup(['a', 20, 3], ['b', 24, 3], ['c', 28, 3], ['d', 24, 5.5]);
  const [a, b, c, d] = race.runners;
  b.heat = 3;
  a.item = 'blaster';
  race.queueAction('a', 'item');
  steps(race, 0.5);
  assert.ok(a.fx.spray > 0, 'still spraying');
  assert.ok(b.fx.soaked > 0, 'runner in the jet is soaked');
  assert.equal(c.fx.soaked, 0, 'the runner behind them is shielded by them');
  assert.equal(d.fx.soaked, 0, 'a runner off the line stays dry');
  assert.ok(b.heat < 3, 'the water cools the soaked costume');
  const soaks = race.drainEvents().filter((e) => e.k === 'soak');
  assert.deepEqual(soaks.map((e) => [e.id, e.by]), [['b', 'a']], 'announced once');
  steps(race, 0.6);
  assert.ok(b.v < DINOS.trex.top * 0.85, 'wet foam is heavy');
});

test('squeaky mallet lands at the end of the swing, on runners in reach', () => {
  const race = setup(['a', 20, 3], ['b', 21.5, 3.8], ['far', 30, 3]);
  const [a, b, far] = race.runners;
  a.item = 'mallet';
  race.queueAction('a', 'item');
  race.step();
  assert.equal(b.fx.trip, 0, 'not instant: the hammer is still winding up');
  assert.ok(a.fx.swing > 0);
  steps(race, 0.3);
  assert.ok(b.fx.trip > 0, 'bonked');
  assert.equal(far.fx.trip, 0);
  assert.ok(race.drainEvents().some((e) => e.k === 'hit' && e.id === 'b' && e.cause === 'mallet'));
});

test('water balloon splashes the runner ahead; sidestepping after it commits dodges', () => {
  const race = setup(['a', 20, 3], ['b', 32, 3]);
  const [a, b] = race.runners;
  a.item = 'balloon';
  race.queueAction('a', 'item');
  steps(race, 1.1);
  assert.ok(b.fx.soaked > 0 && b.fx.stumble > 0, 'splashed');
  assert.ok(race.drainEvents().some((e) => e.k === 'splash'));

  const dodge = setup(['a', 20, 3], ['b', 32, 3]);
  const [a2, b2] = dodge.runners;
  a2.item = 'balloon';
  dodge.queueAction('a', 'item');
  steps(dodge, 0.6);            // past the halfway commit point
  b2.y = 5.6;                    // dive for the outside lane
  steps(dodge, 0.5);
  assert.equal(b2.fx.soaked, 0, 'dodged');
});

test('raptor hatchlings chase down the runner ahead; jumping them works', () => {
  const race = setup(['a', 20, 3], ['b', 28, 3.6]);
  const [a, b] = race.runners;
  a.item = 'hatch';
  race.queueAction('a', 'item');
  race.step();
  assert.equal(race.projectiles.filter((p) => p.type === 'hatch').length, 3);
  steps(race, 3);
  assert.ok(race.drainEvents().some((e) => e.k === 'hit' && e.id === 'b' && e.cause === 'hatch'));

  const hop = setup(['a', 20, 3], ['b', 22, 3]);
  const [ha, hb] = hop.runners;
  ha.item = 'hatch';
  hop.queueAction('a', 'item');
  hop.step();
  hb.z = 1; hb.vz = 3;           // mid-jump as they run underneath
  steps(hop, 0.25);
  assert.equal(hb.fx.trip, 0, 'they scurry underneath a jumper');
});

test('every place in the field can roll the new items', () => {
  for (const frac of [0, 0.5, 1]) {
    const w = itemWeights(frac);
    for (const k of Object.keys(w)) assert.ok(ITEMS[k], `${k} is a real item`);
    assert.ok(w.mallet > 0 && w.blaster > 0 && w.balloon > 0);
  }
  assert.equal(itemWeights(0).hatch, 0, 'the leader never gets hatchlings');
  assert.ok(itemWeights(1).hatch > 0);
});

test('tucking in behind a runner gives a slipstream', () => {
  const race = new Race('sprint', [human('lead'), human('tail'), human('wide')], { countdown: 0 });
  const [lead, tail, wide] = race.runners;
  lead.x = 20; tail.x = 17; wide.x = 17;
  lead.y = tail.y = 3; wide.y = 5.5;
  for (const r of race.runners) { r.v = 9; r.cd = 99; }
  steps(race, 1);
  assert.ok(tail.fx.draft > 0, 'drafting runner gets the slipstream');
  assert.equal(wide.fx.draft, 0, 'a runner off the line does not');
  assert.ok(race.drainEvents().some((e) => e.k === 'draft' && e.id === 'tail'));
});
