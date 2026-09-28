import { test } from 'node:test';
import assert from 'node:assert/strict';
import { capInterval, createPerf, nextTier, TIERS } from '../public/js/three/quality.js';

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

function simulate(dtFor, seconds, tier = 'high') {
  const perf = createPerf();
  const changes = [];
  let t = 0;
  let frameIndex = 0;
  while (t < seconds) {
    const dt = dtFor(tier, frameIndex);
    const next = nextTier(perf, tier, dt);
    t += dt;
    frameIndex++;
    if (next !== tier) {
      tier = next;
      changes.push({ t, tier });
    }
  }
  return { perf, tier, changes };
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

test('a 30 Hz cap on a fast GPU is probed, undone, and then ignored for five minutes', () => {
  const { perf, tier, changes } = simulate(() => 1 / 30, 420);
  assert.equal(tier, 'high');
  assert.deepEqual(changes.map(change => change.tier), ['medium', 'high']);
  assert.ok(changes[1].t <= 7, `High returned too late at ${changes[1].t}s`);
  assert.ok(changes.every(change => change.tier === 'medium' || change.tier === 'high'));
  assert.equal(perf.drops.high, undefined);
  assert.ok(Math.abs(perf.capped - 1 / 30) < 0.00001);
});

test('jittery 30 Hz and steady 24 Hz caps recover to high, while a jittery 40 Hz cap stays high', () => {
  const jittery30 = simulate((tier, frame) => frame % 2 ? 0.0367 : 0.030, 120);
  assert.equal(jittery30.tier, 'high');
  assert.ok(jittery30.changes.length <= 2);

  const cap24 = simulate(() => 1 / 24, 120);
  assert.equal(cap24.tier, 'high');

  const cap40 = simulate((tier, frame) => frame % 2 ? 0.0265 : 0.0235, 120);
  assert.equal(cap40.tier, 'high');
  assert.equal(cap40.changes.length, 0);
});

test('a tier-switch hitch is excluded from the cap probe', () => {
  let mediumHitchPending = true;
  const { perf, tier } = simulate((currentTier) => {
    if (currentTier === 'medium' && mediumHitchPending) {
      mediumHitchPending = false;
      return 0.25;
    }
    return 1 / 30;
  }, 120);
  assert.equal(tier, 'high');
  assert.ok(Math.abs(perf.capped - 1 / 30) < 0.00001);
});

test('after learning a cap, genuinely slow frames still cause a counted downgrade', () => {
  const switchFrame = 250;
  const { perf, changes } = simulate((tier, frame) => frame < switchFrame ? 1 / 30 : 1 / 20, 30);
  const switchTime = switchFrame / 30;
  assert.equal(perf.capped, 1 / 30);
  assert.equal(changes[0].tier, 'medium');
  assert.equal(changes[1].tier, 'high');
  assert.equal(changes[2].tier, 'medium');
  assert.ok(changes[2].t - switchTime < 3.5, `slow frames took too long to downgrade: ${changes[2].t - switchTime}s`);
  assert.equal(perf.drops.high, 1);
});

test('a 30 Hz interval that improves at medium confirms real load instead of capping', () => {
  const { perf, tier, changes } = simulate(currentTier => currentTier === 'high' ? 1 / 30 : 1 / 60, 11.5);
  assert.equal(changes[0].tier, 'medium');
  assert.equal(tier, 'medium');
  assert.equal(perf.drops.high, 1);
  assert.equal(perf.capped, 0);
});

test('a non-cap slow interval still walks down at the original frames', () => {
  const oldPerf = { ema: 1 / 60, slowFor: 0 };
  const perf = createPerf();
  let oldTier = 'high';
  let tier = 'high';
  const oldChanges = [];
  const changes = [];
  const dt = 1 / 20;

  for (let frame = 0; frame < 2000; frame++) {
    const oldNext = oldNextTier(oldPerf, oldTier, dt);
    const next = nextTier(perf, tier, dt);
    if (oldNext !== oldTier) {
      oldTier = oldNext;
      oldChanges.push({ tier: oldTier, frame });
    }
    if (next !== tier) {
      tier = next;
      changes.push({ tier, frame });
    }
  }

  assert.deepEqual(changes, oldChanges);
  assert.deepEqual(changes.map(change => change.tier), ['medium', 'low', 'lowest']);
});

test('capInterval matches common caps within tolerance', () => {
  assert.equal(capInterval(1 / 30), 1 / 30);
  assert.equal(capInterval(0.0345), 1 / 30);
  assert.equal(capInterval(1 / 20), 0);
  assert.equal(capInterval(1 / 45), 0);
});
