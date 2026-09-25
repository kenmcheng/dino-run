import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Playout } from '../shared/playout.js';

// Replays 30 s of 30 Hz snapshots through a network with jitter and
// occasional main-thread stalls, rendering at 60 fps.
function simulate(clock, { seed = 3, jitterMs = 25, stallEvery = 90, hz = 30 } = {}) {
  let s = seed;
  const rnd = () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
  const arrivals = [];
  for (let i = 0; i < 30 * hz; i++) {
    const sim = i / hz;
    let lat = 0.02 + -Math.log(1 - rnd()) * (jitterMs / 1000) * 0.5;
    if (i % Math.round(stallEvery * hz / 30) === 0) lat += 0.06; // a long frame delays message handling
    arrivals.push([sim, sim + lat]);
  }
  arrivals.sort((a, b) => a[1] - b[1]);
  let k = 0;
  let starved = 0;
  let backwards = 0;
  const steps = [];
  let prev = null;
  for (let f = 0; f < 60 * 29; f++) {
    const now = 1 + f / 60;
    while (k < arrivals.length && arrivals[k][1] <= now) { clock.push(arrivals[k][0], arrivals[k][1]); k++; }
    const t = clock.time(now);
    if (t === null) continue;
    if (t > clock.newest + 1e-9) starved++;
    if (prev !== null) { if (t < prev) backwards++; steps.push(t - prev); }
    prev = t;
  }
  const mean = steps.reduce((a, b) => a + b, 0) / steps.length;
  const worst = Math.max(...steps.map((d) => Math.abs(d - mean)));
  return { starvedPct: (starved / steps.length) * 100, backwards, worstStepErr: worst / mean };
}

// The algorithm the client used before: lock onto the fastest packet ever seen.
class OldClock {
  constructor() { this.offset = null; this.newest = -Infinity; }
  push(sim, arrival) { const o = sim - arrival; this.offset = this.offset === null ? o : Math.max(o, this.offset + (o - this.offset) * 0.05); this.newest = Math.max(this.newest, sim); }
  time(now) { return this.offset === null ? null : now + this.offset - 0.11; }
}

// The old client at its old 15 Hz snapshot rate, on an ordinary Wi-Fi-ish link.
test('old clock starves under Wi-Fi jitter (documents the choppiness bug)', () => {
  const r = simulate(new OldClock(), { jitterMs: 40, hz: 15 });
  assert.ok(r.starvedPct > 1, `expected starvation, got ${r.starvedPct.toFixed(2)}%`);
});

test('playout clock never runs past the data and moves smoothly', () => {
  for (const jitterMs of [5, 25, 60]) {
    const r = simulate(new Playout(), { jitterMs });
    assert.ok(r.starvedPct < 0.2, `jitter ${jitterMs}ms: starved ${r.starvedPct.toFixed(2)}% of frames`);
    assert.equal(r.backwards, 0, 'render time never goes backwards');
    assert.ok(r.worstStepErr < 0.1, `jitter ${jitterMs}ms: frame step deviates ${(r.worstStepErr * 100).toFixed(1)}%`);
  }
});
