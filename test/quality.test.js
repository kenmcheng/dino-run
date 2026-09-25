import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPerf, nextTier, TIERS } from '../public/js/three/quality.js';

// The original one-way-downgrade algorithm from game3d.js, kept here only as
// a reference to prove the new state machine drops at the same rate.
function oldNextTier(perf, tier, dt) {
  perf.ema += (dt - perf.ema) * 0.05;
  perf.slowFor = perf.ema > 1 / 40 ? perf.slowFor + dt : 0;
  if (perf.slowFor < 2.5) return tier;
  const i = TIERS.indexOf(tier);
  if (i >= TIERS.length - 1) return tier;
  perf.slowFor = 0;
  perf.ema = 1 / 60;
  return TIERS[i + 1];
}

function firstChange(perf, tier, dt, maxFrames) {
  for (let f = 0; f < maxFrames; f++) {
    const next = nextTier(perf, tier, dt);
    if (next !== tier) return { tier: next, frame: f };
  }
  throw new Error('expected a tier change');
}

function runFor(perf, tier, dt, seconds) {
  let t = 0;
  while (t < seconds) {
    const next = nextTier(perf, tier, dt);
    t += dt;
    if (next !== tier) return { tier: next, elapsed: t };
    tier = next;
  }
  return { tier, elapsed: null };
}

test('downgrade responsiveness is unchanged from the pre-existing algorithm', () => {
  const dt = 1 / 20;
  const oldPerf = { ema: 1 / 60, slowFor: 0 };
  let oldTier = 'high';
  let oldFrame = -1;
  for (let f = 0; f < 1000; f++) {
    const next = oldNextTier(oldPerf, oldTier, dt);
    if (next !== oldTier) { oldTier = next; oldFrame = f; break; }
  }

  const { tier, frame } = firstChange(createPerf(), 'high', dt, 1000);
  assert.equal(tier, 'medium');
  assert.equal(tier, oldTier);
  assert.equal(frame, oldFrame);
});

test('sustained slow frames walk down to lowest and stay there', () => {
  const perf = createPerf();
  let tier = 'high';
  for (let f = 0; f < 2000; f++) tier = nextTier(perf, tier, 1 / 20);
  assert.equal(tier, 'lowest');
  for (let f = 0; f < 500; f++) tier = nextTier(perf, tier, 1 / 20);
  assert.equal(tier, 'lowest');
});

test('recovers to high after a sustained fast streak, not before 10s', () => {
  const perf = createPerf();
  const dropped = firstChange(perf, 'high', 1 / 20, 1000);
  assert.equal(dropped.tier, 'medium');

  const early = runFor(perf, dropped.tier, 1 / 60, 9.5);
  assert.equal(early.tier, 'medium');
  assert.equal(early.elapsed, null);

  const recovered = firstChange(perf, 'medium', 1 / 60, 60 * 60);
  assert.equal(recovered.tier, 'high');
  const totalFast = 9.5 + (recovered.frame + 1) / 60;
  assert.ok(totalFast >= 10, `recovered too soon: ${totalFast}s`);
  assert.ok(totalFast <= 12, `recovered too late: ${totalFast}s`);
});

test('frames between the fast and slow thresholds neither drop nor recover', () => {
  const perf = createPerf();
  let tier = 'medium';
  for (let f = 0; f < 60 * 45; f++) tier = nextTier(perf, tier, 1 / 45);
  assert.equal(tier, 'medium');
});

test('repeated recoveries into the same tier back off, then give up', () => {
  const perf = createPerf();
  let tier = 'high';

  const slowUntilDrop = () => {
    const r = firstChange(perf, tier, 1 / 20, 1000);
    tier = r.tier;
  };
  const fastUntilRecoverOrTimeout = (seconds) => {
    const r = runFor(perf, tier, 1 / 60, seconds);
    tier = r.tier;
    return r.elapsed;
  };

  slowUntilDrop();
  assert.equal(tier, 'medium');
  let elapsed = fastUntilRecoverOrTimeout(12);
  assert.ok(elapsed !== null && elapsed >= 10 && elapsed <= 12, `1st recovery: ${elapsed}`);
  assert.equal(tier, 'high');

  slowUntilDrop();
  assert.equal(tier, 'medium');
  assert.equal(fastUntilRecoverOrTimeout(15), null, '2nd recovery must not happen before 20s');
  assert.equal(tier, 'medium');
  elapsed = fastUntilRecoverOrTimeout(10);
  assert.ok(elapsed !== null, '2nd recovery should complete once 20s of fast frames accrue');
  assert.equal(tier, 'high');

  slowUntilDrop();
  assert.equal(tier, 'medium');
  assert.equal(fastUntilRecoverOrTimeout(35), null, '3rd recovery must not happen before 40s');
  assert.equal(tier, 'medium');
  elapsed = fastUntilRecoverOrTimeout(10);
  assert.ok(elapsed !== null, '3rd recovery should complete once 40s of fast frames accrue');
  assert.equal(tier, 'high');

  slowUntilDrop();
  assert.equal(tier, 'medium');
  assert.equal(fastUntilRecoverOrTimeout(300), null, 'auto should give up on high after MAX_DROPS drops');
  assert.equal(tier, 'medium');
});

test('never steps above high or below lowest', () => {
  let perf = createPerf();
  let tier = 'high';
  for (let f = 0; f < 2000; f++) tier = nextTier(perf, tier, 1 / 60);
  assert.equal(tier, 'high');

  perf = createPerf();
  tier = 'lowest';
  for (let f = 0; f < 2000; f++) tier = nextTier(perf, tier, 1 / 20);
  assert.equal(tier, 'lowest');
});

test('a single slow spike restarts an in-progress fast streak', () => {
  const perf = createPerf();
  perf.drops.high = 1;
  let tier = 'medium';

  const before = runFor(perf, tier, 1 / 60, 9);
  assert.equal(before.tier, 'medium');
  assert.equal(before.elapsed, null);
  assert.ok(perf.fastFor > 8.9, `expected fastFor near 9s, got ${perf.fastFor}`);

  tier = nextTier(perf, tier, 0.25); // matches main.js's dt clamp
  assert.equal(perf.fastFor, 0, 'a slow-ish spike frame should reset the fast streak');
  assert.equal(tier, 'medium');

  const after = runFor(perf, tier, 1 / 60, 9);
  assert.equal(after.tier, 'medium', 'the reset streak should not reach 10s again after only 9 more seconds');
});
