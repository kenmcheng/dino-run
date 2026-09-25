// Jitter-tolerant playback clock for server snapshots.
//
// Snapshots carry the server's sim time. We keep a short window of
// (snapshot time − arrival time) offsets: the largest is the fastest-arriving
// packet, and the spread below it is the network/main-thread jitter. The render
// clock trails the newest data by one snapshot interval plus that jitter, and
// is steered towards its target by gently speeding up or slowing down (never by
// jumping), so motion stays smooth even when packets bunch up.
export class Playout {
  constructor({ interval = 1 / 30, window = 4, minDelay = 0.045, maxDelay = 0.3 } = {}) {
    this.interval = interval;
    this.window = window;
    this.minDelay = minDelay;
    this.maxDelay = maxDelay;
    this.samples = [];      // [arrival, offset]
    this.delay = minDelay + interval;
    this.t = null;
    this.last = null;
    this.newest = -Infinity;
  }

  push(simTime, arrival) {
    this.samples.push([arrival, simTime - arrival]);
    while (this.samples.length && this.samples[0][0] < arrival - this.window) this.samples.shift();
    this.newest = Math.max(this.newest, simTime);
  }

  target(now) {
    let best = -Infinity;
    for (const [, o] of this.samples) best = Math.max(best, o);
    // worst recent lateness relative to the fastest packet: covering the
    // occasional stall is what keeps motion smooth, so we pay for it in delay
    let jitter = 0;
    for (const [, o] of this.samples) jitter = Math.max(jitter, best - o);
    const want = Math.min(this.maxDelay, Math.max(this.minDelay, this.interval * 1.2 + jitter + 0.01));
    this.delay += (want - this.delay) * (want > this.delay ? 0.3 : 0.004); // grow fast, shrink slowly
    return now + best - this.delay;
  }

  // Current render time in sim seconds. `now` is wall-clock seconds.
  time(now) {
    if (!this.samples.length) return null;
    const tgt = this.target(now);
    const dt = this.last === null ? 0 : Math.max(0, now - this.last);
    this.last = now;
    if (this.t === null || Math.abs(tgt - this.t) > 0.35) {
      this.t = tgt; // first frame, or we fell hopelessly behind (tab was hidden)
    } else {
      const err = tgt - this.t;
      const rate = 1 + Math.max(-0.08, Math.min(0.08, err * 3)); // at most ±8 % speed change
      this.t += dt * rate;
    }
    return this.t;
  }
}
