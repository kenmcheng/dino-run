// Client-side prediction for your own runner.
//
// Everyone is drawn slightly in the past (see shared/playout.js), which is
// what keeps motion smooth. Your own steering and jumps must not wait for
// that, so we run the same lateral physics locally and add the movement you
// made during the display delay on top of the interpolated server position.
import { lateralStep, TRACK_W, JUMP } from '/shared/data.js';

const AIR = (2 * JUMP.v) / JUMP.g;

export class Predictor {
  constructor() { this.reset(3); }

  reset(y) {
    this.y = y;
    this.vy = 0;
    this.hist = [];
    this.arc = null;
  }

  // Advance local lateral physics with the input actually being sent.
  step(now, dt, steer, canSteer) {
    [this.y, this.vy] = lateralStep(this.y, this.vy, canSteer ? steer : 0, dt);
    this.hist.push([now, this.y]);
    while (this.hist.length > 2 && this.hist[1][0] < now - 1.5) this.hist.shift();
  }

  yAt(t) {
    const h = this.hist;
    if (!h.length) return this.y;
    if (t <= h[0][0]) return h[0][1];
    for (let i = h.length - 1; i > 0; i--) {
      if (h[i - 1][0] <= t) {
        const [t0, y0] = h[i - 1]; const [t1, y1] = h[i];
        return y0 + (y1 - y0) * ((t - t0) / Math.max(1e-6, t1 - t0));
      }
    }
    return this.y;
  }

  // Server y (interpolated, `lag` seconds old) → where you really are now.
  displayY(serverY, now, lag) {
    const lead = this.y - this.yAt(now - lag);
    return Math.max(0.3, Math.min(TRACK_W - 0.3, serverY + lead));
  }

  jump(now, canJump) {
    if (canJump && !this.arc) this.arc = now;
  }

  // Show the jump the moment you press it; hide the server's delayed copy.
  displayZ(serverZ, now, lag) {
    if (!this.arc) return serverZ;
    const t = now - this.arc;
    if (t < AIR) return Math.max(0, JUMP.v * t - 0.5 * JUMP.g * t * t);
    if (t < AIR + lag + 0.15) return serverZ > 1 ? serverZ : 0; // still let glides/pounces through
    this.arc = null;
    return serverZ;
  }
}
