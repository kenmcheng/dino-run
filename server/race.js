// Server-authoritative race simulation. Pure logic: no sockets, no timers,
// so it can be stepped deterministically in tests.
import {
  DINOS, TRACK_W, TICK_RATE, FX, SKILL, JUMP, buildCourse, itemWeights, lateralStep,
} from '../shared/data.js';

export const DT = 1 / TICK_RATE;
const GRAVITY = JUMP.g;
const JUMP_V = JUMP.v;
const DECEL = 14;
const FX_KEYS = Object.keys(FX).filter((k) => k !== 'overheat');

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const approach = (v, target, step) => (v < target ? Math.min(target, v + step) : Math.max(target, v - step));
const inZones = (zones, x) => zones.some(([a, b]) => x >= a && x <= b);
const round = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

function makeRunner(e, i, n) {
  const fx = {};
  for (const k of FX_KEYS) fx[k] = 0;
  fx.ifr = 0;
  return {
    id: e.id, name: e.name, dino: DINOS[e.dino] ? e.dino : 'trex', color: e.color, bot: !!e.bot,
    x: 0, y: ((i + 0.5) * TRACK_W) / n, z: 0, vz: 0, v: 0, vy: 0,
    sprintSince: null, jumpT: -99, draftT: 0,
    heat: 0, overheat: 0, item: null, pending: null, roll: 0, cd: 5, taunt: 0,
    fx, input: { steer: 0, sprint: false, brake: false },
    queued: { jump: false, item: false, ability: false, taunt: false },
    finished: false, finishTime: null, place: i + 1,
    stats: { hits: 0, items: 0 },
    ai: { t: 0, ty: null, sprint: true, itemT: 0.5, hurdles: new Map() },
  };
}

export class Race {
  constructor(courseId, entrants, { rng = Math.random, countdown = 3 } = {}) {
    this.course = buildCourse(courseId);
    this.rng = rng;
    this.time = -countdown;
    this.runners = entrants.map((e, i) => makeRunner(e, i, entrants.length));
    this.byId = new Map(this.runners.map((r) => [r.id, r]));
    this.eggs = this.course.eggs.map((e, i) => ({ id: i, x: e.x, y: e.y, respawn: 0 }));
    this.projectiles = [];
    this.hazards = [];
    this.events = [];
    this.finishOrder = [];
    this.firstFinishAt = null;
    this.over = false;
    this.nextId = 1;
  }

  emit(k, data = {}) { this.events.push({ k, ...data }); }

  drainEvents() { const e = this.events; this.events = []; return e; }

  // ------------------------------------------------------------ input API
  setInput(id, input) {
    const r = this.byId.get(id);
    if (!r) return;
    const steer = Number(input.steer);
    r.input.steer = Number.isFinite(steer) ? clamp(steer, -1, 1) : 0;
    const sprint = !!input.sprint;
    if (sprint && !r.input.sprint) r.sprintSince = this.time;
    if (!sprint) r.sprintSince = null;
    r.input.sprint = sprint;
    r.input.brake = !!input.brake;
  }

  queueAction(id, action) {
    const r = this.byId.get(id);
    if (r && action in r.queued) r.queued[action] = true;
  }

  makeBot(id) {
    const r = this.byId.get(id);
    if (r) r.bot = true;
  }

  // ----------------------------------------------------------------- tick
  step() {
    if (this.over) return;
    const before = this.time;
    this.time += DT;
    if (before < 0 && this.time >= 0) this.startGun();
    if (this.time < 0) return;
    for (const r of this.runners) if (r.bot && !r.finished) this.botThink(r);
    for (const r of this.runners) this.stepRunner(r);
    this.collide();
    this.stepProjectiles();
    this.stepHazards();
    this.stepEggs();
    this.rank();
    this.checkEnd();
  }

  // Mario Kart-style rocket start: hit sprint just before GO for a boost,
  // hold it way too early and you wobble off the line instead.
  startGun() {
    for (const r of this.runners) {
      let held = r.input.sprint && r.sprintSince !== null ? -r.sprintSince : null;
      if (r.bot) held = this.rng() < 0.35 ? 0.2 : null;
      if (held !== null && held <= SKILL.rocketWindow) {
        r.fx.boost = 1.4;
        this.emit('rocket', { id: r.id });
      } else if (held !== null && held > SKILL.falseStart) {
        r.fx.stumble = 0.7;
        this.emit('falsestart', { id: r.id });
      }
    }
  }

  others(r) { return this.runners.filter((o) => o !== r && !o.finished); }

  stepRunner(r) {
    const d = DINOS[r.dino];
    const f = r.fx;
    for (const k in f) if (f[k] > 0) f[k] = Math.max(0, f[k] - DT);
    r.cd = Math.max(0, r.cd - DT);
    r.taunt = Math.max(0, r.taunt - DT);
    if (r.roll > 0) {
      r.roll -= DT;
      if (r.roll <= 0) { r.roll = 0; r.item = r.pending; r.pending = null; }
    }
    const q = r.queued;

    if (r.finished) {
      r.v = approach(r.v, 2.5, 5 * DT);
      r.x += r.v * DT;
      r.z = Math.max(0, r.z - 3 * DT);
      q.jump = q.item = q.ability = false;
      return;
    }

    const disabled = f.trip > 0;
    if (!disabled) {
      if (q.jump && r.z === 0 && !f.glide) { r.vz = JUMP_V; r.jumpT = this.time; }
      if (q.item && r.item && r.roll === 0) this.useItem(r);
      if (q.ability && r.cd === 0) this.useAbility(r);
      if (q.taunt) { r.taunt = 1.6; this.emit('taunt', { id: r.id }); }
    }
    q.jump = q.item = q.ability = q.taunt = false;

    // Costume heat: sprinting in a foam suit is hot work.
    const inWater = inZones(this.course.water, r.x);
    const sprinting = r.input.sprint && !disabled && r.overheat === 0 && !f.boost && !f.charge;
    if (r.overheat > 0) {
      r.overheat = Math.max(0, r.overheat - DT);
      r.heat = Math.max(0, r.heat - (d.heatCap / 2.5) * DT);
    } else if (sprinting || f.charge) {
      r.heat += DT * this.course.heatMul * (f.charge ? 1.5 : 1) * (f.draft ? 0.5 : 1);
    } else {
      r.heat = Math.max(0, r.heat - DT * (inWater ? 5 : 0.55));
    }
    if (inWater && r.overheat === 0) r.heat = Math.max(0, r.heat - DT * 2);
    if (r.heat >= d.heatCap && r.overheat === 0) {
      r.heat = d.heatCap;
      r.overheat = 2.5;
      this.emit('overheat', { id: r.id });
    }

    const grounded = r.z <= 0.05 && !f.glide;
    let target = d.top;
    if (r.input.brake) target *= 0.55;
    if (sprinting) target *= 1.28;
    if (r.overheat > 0) target = 3.5;
    if (f.boost) target = Math.max(target, d.top * 1.45);
    if (f.charge) target = d.top * 1.3;
    if (f.glide) target *= 1.06;
    if (f.draft) target *= 1.07;
    if (f.deflate) target *= 0.72;
    if (grounded && inZones(this.course.mud, r.x)) target *= 0.72;
    if (grounded && this.inTar(r)) target *= 0.42;
    if (f.stumble) target *= 0.45;
    if (f.stun) target *= 0.25;
    if (f.trip) target = 0;
    r.v = approach(r.v, target, (target > r.v ? d.accel : DECEL) * DT);
    if (f.dash) r.v = Math.max(r.v, 17);

    const prevX = r.x;
    r.x += r.v * DT;

    let steer = disabled ? 0 : r.input.steer;
    if (f.ash && r.bot) steer += Math.sin(this.time * 7 + r.x) * 0.8;
    [r.y, r.vy] = lateralStep(r.y, r.vy, steer, DT);

    // slipstream: tuck in right behind someone to cut drag and keep cool
    const leader = this.runners.find((o) => o !== r && !o.finished && o.x - r.x > 1 && o.x - r.x < 7 && Math.abs(o.y - r.y) < 0.7);
    if (leader && !disabled) {
      r.draftT += DT;
      if (r.draftT >= SKILL.draftAfter) {
        if (!f.draft) this.emit('draft', { id: r.id, behind: leader.id });
        f.draft = 0.25;
      }
    } else {
      r.draftT = Math.max(0, r.draftT - DT * 2);
    }

    if (f.glide) {
      r.z = approach(r.z, 1.4, 6 * DT);
      r.vz = 0;
    } else if (r.z > 0 || r.vz > 0) {
      r.vz -= GRAVITY * DT;
      r.z += r.vz * DT;
      if (r.z <= 0) { r.z = 0; r.vz = 0; }
    }

    for (const h of this.course.hurdles) {
      if (prevX < h && r.x >= h) {
        if (f.charge) this.emit('smash', { id: r.id, x: h });
        else if (r.z < 0.35 && !f.glide) {
          f.stumble = 0.9;
          r.v *= 0.5;
          this.emit('stumble', { id: r.id });
        } else if (!f.glide) {
          const since = this.time - r.jumpT;
          if (since >= SKILL.hopWindow[0] && since <= SKILL.hopWindow[1]) {
            f.boost = Math.max(f.boost, 0.8);
            this.emit('hop', { id: r.id });
          }
        }
      }
    }

    if (r.x >= this.course.length) {
      const over = (r.x - this.course.length) / Math.max(r.v, 0.1);
      r.finished = true;
      r.finishTime = round(this.time - over, 3);
      this.finishOrder.push(r.id);
      if (this.firstFinishAt === null) this.firstFinishAt = this.time;
      this.emit('finish', { id: r.id, place: this.finishOrder.length, time: r.finishTime });
    }
  }

  inTar(r) {
    return this.hazards.some((h) => h.type === 'tar'
      && r.x > h.x - 1.5 && r.x < h.x + 1.5 && Math.abs(r.y - h.y) < 0.9);
  }

  // ---------------------------------------------------------- hits/status
  immune(t) { return t.fx.charge > 0 || t.fx.spikes > 0; }

  hit(t, src, cause, dur) {
    if (t.finished) return false;
    const f = t.fx;
    if (f.trip > 0 || f.ifr > 0) return false;
    if (this.immune(t)) { this.emit('block', { id: t.id, cause }); return false; }
    if (f.shield > 0) { f.shield = 0; this.emit('shield', { id: t.id, by: src?.id, cause }); return false; }
    const trip = dur / Math.sqrt(DINOS[t.dino].mass);
    f.trip = trip;
    f.ifr = trip + 1;
    f.dash = 0;
    t.v *= 0.3;
    if (src && src !== t) src.stats.hits++;
    this.emit('hit', { id: t.id, by: src?.id, cause });
    return true;
  }

  status(t, src, key, dur, cause) {
    if (t.finished) return false;
    if (this.immune(t)) { this.emit('block', { id: t.id, cause }); return false; }
    if (t.fx.shield > 0 && key !== 'ash') {
      t.fx.shield = 0;
      this.emit('shield', { id: t.id, by: src?.id, cause });
      return false;
    }
    t.fx[key] = Math.max(t.fx[key], dur);
    this.emit('status', { id: t.id, by: src?.id, cause });
    return true;
  }

  // ---------------------------------------------------------------- items
  rollItem(r) {
    const n = this.runners.length;
    const frac = n > 1 ? (r.place - 1) / (n - 1) : 0;
    const w = itemWeights(frac);
    let total = 0;
    for (const k in w) total += w[k];
    let pick = this.rng() * total;
    for (const k in w) { pick -= w[k]; if (pick <= 0) return k; }
    return 'peel';
  }

  useItem(r) {
    const item = r.item;
    r.item = null;
    r.stats.items++;
    this.emit('item', { id: r.id, item });
    const ahead = this.others(r).filter((o) => o.x > r.x);
    switch (item) {
      case 'peel':
        this.hazards.push({ id: this.nextId++, type: 'peel', x: r.x - 1.4, y: r.y, owner: r.id, life: 40 });
        break;
      case 'tar':
        this.hazards.push({ id: this.nextId++, type: 'tar', x: r.x - 2.8, y: r.y, owner: r.id, life: 14 });
        break;
      case 'egg':
        this.projectiles.push({ id: this.nextId++, type: 'egg', x: r.x + 0.9, y: r.y, vx: r.v + 16, owner: r.id, life: 2.5 });
        break;
      case 'meteor': {
        const target = this.runners.filter((o) => o !== r && !o.finished).sort((a, b) => a.place - b.place)[0];
        if (target) {
          this.projectiles.push({ id: this.nextId++, type: 'meteor', x: target.x, y: target.y, target: target.id, owner: r.id, delay: 2.2 });
          this.emit('meteor', { id: target.id, by: r.id });
        }
        break;
      }
      case 'amber': r.fx.shield = 15; break;
      case 'boba': r.fx.boost = 2.5; break;
      case 'water': r.heat = 0; r.overheat = 0; r.fx.boost = Math.max(r.fx.boost, 0.7); break;
      case 'pin':
        for (const o of ahead) if (o.x - r.x < 40) this.status(o, r, 'deflate', 3, 'pin');
        break;
      case 'ash':
        for (const o of ahead) this.status(o, r, 'ash', 3.5, 'ash');
        break;
      default: break;
    }
  }

  useAbility(r) {
    const d = DINOS[r.dino];
    const f = r.fx;
    r.cd = d.cd;
    this.emit('ability', { id: r.id, ability: d.ability });
    const others = this.others(r);
    switch (d.ability) {
      case 'roar':
        for (const o of others) {
          const dx = o.x - r.x;
          if (dx > -1 && dx < 9 && Math.abs(o.y - r.y) < 2.5) this.status(o, r, 'stun', 1.1, 'roar');
        }
        break;
      case 'pounce': f.dash = 0.3; r.vz = Math.max(r.vz, 4.5); break;
      case 'charge': f.charge = 1.2; break;
      case 'spikes': f.spikes = 3; break;
      case 'glide': f.glide = 2.0; break;
      case 'club':
        for (const o of others) {
          const dx = o.x - r.x;
          if (dx > -3.5 && dx < 1 && Math.abs(o.y - r.y) < 1.6) this.hit(o, r, 'club', 1.3);
        }
        break;
      case 'honk': {
        const victim = others
          .filter((o) => o.item && Math.abs(o.x - r.x) < 12)
          .sort((a, b) => Math.abs(a.x - r.x) - Math.abs(b.x - r.x))[0];
        if (victim && !r.item && r.roll === 0) {
          r.item = victim.item;
          victim.item = null;
          this.emit('steal', { id: r.id, from: victim.id, item: r.item });
        }
        for (const o of others) {
          if (Math.abs(o.x - r.x) < 5 && Math.abs(o.y - r.y) < 2) this.status(o, r, 'stun', 0.6, 'honk');
        }
        break;
      }
      case 'headbutt': f.dash = 0.35; f.charge = 0; r.butt = true; break;
      default: break;
    }
  }

  // --------------------------------------------------------------- world
  collide() {
    const rs = this.runners.filter((r) => !r.finished);
    for (let i = 0; i < rs.length; i++) {
      for (let j = i + 1; j < rs.length; j++) {
        const a = rs[i];
        const b = rs[j];
        if (Math.abs(a.x - b.x) > 0.9 || Math.abs(a.z - b.z) > 0.7) continue;
        const dy = b.y - a.y;
        if (Math.abs(dy) > 0.55) continue;
        for (const [p, q] of [[a, b], [b, a]]) {
          if (p.fx.charge > 0) this.hit(q, p, 'charge', 1.0);
          else if (p.fx.spikes > 0) this.hit(q, p, 'spikes', 0.8);
          else if (p.butt && p.fx.dash > 0 && q.x >= p.x) {
            if (this.hit(q, p, 'headbutt', 1.6)) { p.fx.dash = 0; p.butt = false; }
          }
        }
        const overlap = 0.55 - Math.abs(dy);
        const ma = DINOS[a.dino].mass;
        const mb = DINOS[b.dino].mass;
        const sign = dy >= 0 ? 1 : -1;
        a.y = clamp(a.y - sign * overlap * (mb / (ma + mb)), 0.3, TRACK_W - 0.3);
        b.y = clamp(b.y + sign * overlap * (ma / (ma + mb)), 0.3, TRACK_W - 0.3);
      }
    }
    for (const r of rs) if (r.butt && r.fx.dash === 0) r.butt = false;
  }

  stepProjectiles() {
    const keep = [];
    for (const p of this.projectiles) {
      if (p.type === 'egg') {
        p.x += p.vx * DT;
        p.life -= DT;
        let alive = p.life > 0;
        for (const t of this.runners) {
          if (!alive || t.id === p.owner || t.finished) continue;
          if (Math.abs(t.x - p.x) < 0.8 && Math.abs(t.y - p.y) < 0.55 && t.z < 0.9) {
            if (t.fx.spikes > 0) {
              p.owner = t.id;
              p.vx = -p.vx;
              p.life = 1.5;
              this.emit('reflect', { id: t.id });
            } else {
              this.hit(t, this.byId.get(p.owner), 'egg', 1.4);
              this.emit('splat', { x: p.x, y: p.y });
              alive = false;
            }
          }
        }
        if (alive) keep.push(p);
      } else if (p.type === 'meteor') {
        const t = this.byId.get(p.target);
        if (t && !t.finished) { p.x = t.x; p.y = t.y; }
        p.delay -= DT;
        if (p.delay > 0) { keep.push(p); continue; }
        this.emit('boom', { x: p.x, y: p.y });
        const src = this.byId.get(p.owner);
        for (const o of this.runners) {
          if (Math.abs(o.x - p.x) < 2.2 && Math.abs(o.y - p.y) < 1.6) this.hit(o, src, 'meteor', 1.8);
        }
      }
    }
    this.projectiles = keep;
  }

  stepHazards() {
    const keep = [];
    for (const h of this.hazards) {
      h.life -= DT;
      let alive = h.life > 0;
      if (h.type === 'peel') {
        for (const r of this.runners) {
          if (!alive || r.finished || r.z > 0.2 || r.fx.glide) continue;
          if (Math.abs(r.x - h.x) < 0.6 && Math.abs(r.y - h.y) < 0.5) {
            if (r.fx.trip > 0 || r.fx.ifr > 0) continue;
            this.hit(r, this.byId.get(h.owner), 'peel', 1.0);
            alive = false;
          }
        }
      }
      if (alive) keep.push(h);
    }
    this.hazards = keep;
  }

  stepEggs() {
    for (const e of this.eggs) {
      if (e.respawn > 0) { e.respawn = Math.max(0, e.respawn - DT); continue; }
      for (const r of this.runners) {
        if (r.finished || r.item || r.roll > 0 || r.z > 1.6) continue;
        if (Math.abs(r.x - e.x) < 0.9 && Math.abs(r.y - e.y) < 0.6) {
          e.respawn = 4;
          r.roll = 1.0;
          r.pending = this.rollItem(r);
          this.emit('pickup', { id: r.id, x: e.x, y: e.y });
          break;
        }
      }
    }
  }

  rank() {
    const order = [...this.runners].sort((a, b) => {
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      if (a.finished) return -1;
      if (b.finished) return 1;
      return b.x - a.x;
    });
    order.forEach((r, i) => { r.place = i + 1; });
  }

  checkEnd() {
    const humans = this.runners.filter((r) => !r.bot);
    const allDone = this.runners.every((r) => r.finished);
    const humansDone = humans.length > 0 && humans.every((r) => r.finished);
    const grace = this.firstFinishAt !== null && this.time - this.firstFinishAt > 30;
    const cap = this.time > this.course.length / 3 + 60;
    if (allDone || (humansDone && this.time - (this.lastHumanAt ??= this.time) > 4) || grace || cap) {
      this.over = true;
      this.emit('over');
    }
  }

  results() {
    return [...this.runners].sort((a, b) => a.place - b.place).map((r) => ({
      id: r.id, name: r.name, dino: r.dino, color: r.color, bot: r.bot, place: r.place,
      time: r.finished ? r.finishTime : null, dist: round(Math.min(r.x, this.course.length), 1),
      hits: r.stats.hits, items: r.stats.items,
    }));
  }

  // --------------------------------------------------------------- bots
  botThink(r) {
    const d = DINOS[r.dino];
    const ai = r.ai;
    const inp = r.input;
    const f = r.fx;
    ai.t -= DT;

    if (ai.t <= 0) {
      ai.t = 0.35 + this.rng() * 0.35;
      let ty = ai.ty ?? r.y;
      if (!r.item && r.roll === 0) {
        const egg = this.eggs
          .filter((e) => e.respawn === 0 && e.x - r.x > 2 && e.x - r.x < 22)
          .sort((a, b) => Math.abs(a.y - r.y) - Math.abs(b.y - r.y))[0];
        if (egg) ty = egg.y;
      } else if (this.rng() < 0.2) {
        ty = clamp(r.y + (this.rng() - 0.5) * 2, 0.5, TRACK_W - 0.5);
      }
      for (const h of this.hazards) {
        if (h.x - r.x > 0 && h.x - r.x < 9 && Math.abs(h.y - ty) < 1) {
          ty = h.y + (h.y < TRACK_W / 2 ? 1.6 : -1.6);
        }
      }
      ai.ty = clamp(ty, 0.4, TRACK_W - 0.4);
    }
    inp.steer = clamp((ai.ty - r.y) * 2.2, -1, 1);

    if (inZones(this.course.water, r.x)) ai.sprint = true;
    else if (r.heat > d.heatCap * 0.82) ai.sprint = false;
    else if (r.heat < d.heatCap * 0.3) ai.sprint = true;
    inp.sprint = ai.sprint;

    const jumpWindow = (dist) => dist > r.v * 0.08 && dist < r.v * 0.3;
    for (const h of this.course.hurdles) {
      const dist = h - r.x;
      if (dist < 0 || dist > 12) continue;
      if (!ai.hurdles.has(h)) ai.hurdles.set(h, this.rng() > 0.12); // decide once: ~12% fumble
      if (jumpWindow(dist) && ai.hurdles.get(h)) r.queued.jump = true;
    }
    for (const h of this.hazards) {
      if (h.type === 'peel' && Math.abs(h.y - r.y) < 0.6 && jumpWindow(h.x - r.x)) r.queued.jump = true;
    }

    if (r.item && r.roll === 0) {
      ai.itemT -= DT;
      if (ai.itemT <= 0) {
        ai.itemT = 0.3;
        const others = this.others(r);
        const ahead = others.some((o) => o.x - r.x > 1 && o.x - r.x < 14 && Math.abs(o.y - r.y) < 0.5);
        const behind = others.some((o) => r.x - o.x > 0.5 && r.x - o.x < 8);
        const use = {
          egg: ahead, peel: behind || this.rng() < 0.05, tar: behind || this.rng() < 0.05,
          water: r.heat > d.heatCap * 0.6, boba: true, meteor: true, pin: true, ash: true, amber: true,
        }[r.item];
        if (use) r.queued.item = true;
      }
    } else {
      ai.itemT = 0.4 + this.rng();
    }

    if (r.cd === 0 && !f.trip) {
      const others = this.others(r);
      const near = (lo, hi, dy) => others.some((o) => o.x - r.x > lo && o.x - r.x < hi && Math.abs(o.y - r.y) < dy);
      const hurdleSoon = this.course.hurdles.some((h) => h - r.x > 2 && h - r.x < 10);
      const want = {
        roar: near(0, 7, 2),
        headbutt: near(0.5, 5, 0.5),
        club: near(-3, 0.5, 1.4),
        spikes: near(-2, 2, 1) || this.projectiles.some((p) => p.type === 'egg' && p.owner !== r.id && Math.abs(p.x - r.x) < 6),
        charge: near(0, 4, 0.8) || hurdleSoon,
        pounce: hurdleSoon || this.rng() < 0.01,
        glide: hurdleSoon || this.hazards.some((h) => h.x - r.x > 0 && h.x - r.x < 8),
        honk: !r.item && others.some((o) => o.item && Math.abs(o.x - r.x) < 11),
      }[d.ability];
      if (want && this.rng() < 0.25) r.queued.ability = true;
    }
  }

  // ----------------------------------------------------------- snapshot
  snapshot() {
    return {
      time: round(this.time, 2),
      rs: this.runners.map((r) => {
        let fx = 0;
        for (const k of FX_KEYS) if (r.fx[k] > 0) fx |= FX[k];
        if (r.overheat > 0) fx |= FX.overheat;
        if (this.inTar(r)) fx |= FX.slow;
        return [
          r.id, round(r.x), round(r.y), round(r.z), round(r.v, 1),
          round(r.heat / DINOS[r.dino].heatCap), r.item || (r.roll > 0 ? '?' : 0), fx, r.place,
          round(r.cd / DINOS[r.dino].cd), r.taunt > 0 ? 1 : 0, r.finished ? r.finishTime : 0,
        ];
      }),
      pj: this.projectiles.map((p) => [p.id, p.type, round(p.x), round(p.y), round(p.delay ?? 0)]),
      hz: this.hazards.map((h) => [h.id, h.type, round(h.x), round(h.y)]),
      eg: this.eggs.filter((e) => e.respawn > 0).map((e) => e.id),
    };
  }
}
