// Course geometry: every course is a closed 3D loop whose arc length equals the
// simulation's course length, so sim distance `x` maps straight onto the path.
import * as THREE from 'three';
import { TRACK_W } from '/shared/data.js';
import * as T from './textures.js';

export const LAT = 1.35;                 // metres per sim lateral unit
export const HALF = (TRACK_W * LAT) / 2; // half the running surface
const DS = 0.5;                          // sample spacing (m)

// Raw shapes before scaling to the course length. p(u), u in [0,1) → Vector3.
const SHAPES = {
  stadium: (u) => {
    // IAAF-style oval: two straights and two semicircles, start near the end of
    // the home straight so the finish is in front of the main grandstand.
    const S = 84.39; const R = 36.5;
    const total = 2 * S + 2 * Math.PI * R;
    let s = (u * total + (S - 12)) % total;
    if (s < S) return new THREE.Vector3(-S / 2 + s, 0, R);
    s -= S;
    if (s < Math.PI * R) { const a = s / R; return new THREE.Vector3(S / 2 + R * Math.sin(a), 0, R * Math.cos(a)); }
    s -= Math.PI * R;
    if (s < S) return new THREE.Vector3(S / 2 - s, 0, -R);
    s -= S;
    const a = s / R;
    return new THREE.Vector3(-S / 2 - R * Math.sin(a), 0, -R * Math.cos(a));
  },
  jungle: (u) => {
    const th = u * Math.PI * 2;
    const r = 60 + 14 * Math.sin(3 * th) + 8 * Math.cos(5 * th + 1);
    return new THREE.Vector3(r * Math.cos(th), 0, r * Math.sin(th) * 0.78);
  },
  volcano: (u) => {
    const th = u * Math.PI * 2;
    const r = 58 + 10 * Math.sin(2 * th + 0.4) + 5 * Math.sin(5 * th);
    return new THREE.Vector3(r * Math.cos(th), 0, r * Math.sin(th));
  },
};

const ELEVATION = {
  stadium: () => 0,
  jungle: (u) => 2.6 + 2.4 * Math.sin(u * Math.PI * 4 + 0.5) + 0.8 * Math.sin(u * Math.PI * 10),
  volcano: (u) => 3 + 3.2 * Math.sin(u * Math.PI * 2 - 0.6) + 0.8 * Math.sin(u * Math.PI * 8),
};

export class Track {
  constructor(course) {
    this.course = course;
    this.theme = course.theme;
    this.length = course.length;
    const shape = SHAPES[this.theme] || SHAPES.stadium;
    const elev = ELEVATION[this.theme] || ELEVATION.stadium;

    // dense polyline → cumulative length → scale xz to hit the target length
    const N = 6000;
    const raw = [];
    for (let i = 0; i < N; i++) raw.push(shape(i / N));
    let len = 0;
    for (let i = 0; i < N; i++) len += raw[i].distanceTo(raw[(i + 1) % N]);
    const k = this.length / len;
    const pts = raw.map((p) => new THREE.Vector3(p.x * k, 0, p.z * k));
    const cum = [0];
    for (let i = 1; i <= N; i++) cum.push(cum[i - 1] + pts[i - 1].distanceTo(pts[i % N]));
    const total = cum[N];

    // resample uniformly by arc length
    this.n = Math.round(this.length / DS);
    this.pos = [];
    let j = 0;
    for (let i = 0; i < this.n; i++) {
      const s = (i / this.n) * total;
      while (cum[j + 1] < s) j++;
      const f = (s - cum[j]) / (cum[j + 1] - cum[j]);
      const p = pts[j].clone().lerp(pts[(j + 1) % N], f);
      p.y = elev(i / this.n);
      this.pos.push(p);
    }
    this.tan = [];
    this.right = [];
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < this.n; i++) {
      const a = this.pos[(i - 2 + this.n) % this.n];
      const b = this.pos[(i + 2) % this.n];
      const t = b.clone().sub(a).normalize();
      this.tan.push(t);
      this.right.push(new THREE.Vector3().crossVectors(t, up).normalize());
    }
    this.buildGrid();
  }

  wrap(s) { return ((s % this.length) + this.length) % this.length; }

  // Sim (x, y) → world position/tangent/right at the track surface.
  pose(x, y = 3, out = {}) {
    const s = this.wrap(x) / DS;
    const i = Math.floor(s) % this.n;
    const i2 = (i + 1) % this.n;
    const f = s - Math.floor(s);
    const p = (out.p ||= new THREE.Vector3()).copy(this.pos[i]).lerp(this.pos[i2], f);
    const t = (out.t ||= new THREE.Vector3()).copy(this.tan[i]).lerp(this.tan[i2], f).normalize();
    const r = (out.r ||= new THREE.Vector3()).copy(this.right[i]).lerp(this.right[i2], f).normalize();
    p.addScaledVector(r, (y - TRACK_W / 2) * LAT);
    return out;
  }

  heightAt(x) { return this.pose(x, TRACK_W / 2).p.y; }

  // Coarse spatial hash of centreline samples, for keeping scenery off the track.
  buildGrid() {
    this.grid = new Map();
    for (let i = 0; i < this.n; i += 4) {
      const p = this.pos[i];
      const key = `${Math.floor(p.x / 12)},${Math.floor(p.z / 12)}`;
      if (!this.grid.has(key)) this.grid.set(key, []);
      this.grid.get(key).push(p);
    }
  }

  distToTrack(x, z) {
    let best = Infinity;
    const cx = Math.floor(x / 12); const cz = Math.floor(z / 12);
    for (let a = -1; a <= 1; a++) {
      for (let b = -1; b <= 1; b++) {
        for (const p of this.grid.get(`${cx + a},${cz + b}`) || []) {
          best = Math.min(best, Math.hypot(p.x - x, p.z - z));
        }
      }
    }
    return best;
  }

  // Extrude a cross-section profile [[lateral, height], ...] along the loop.
  // Non-indexed so every quad gets flat normals.
  extrude(profile, { step = 2, mat, vScale = 1, uvAcross = null, cast = false }) {
    const verts = [];
    const uvs = [];
    const count = Math.ceil(this.n / (step / DS));
    // profile point: [lateral, height] relative to the track, or [lateral, y, true] absolute
    const at = (i, [lat, h, abs]) => {
      const idx = Math.round(i * (step / DS)) % this.n;
      const p = this.pos[idx].clone().addScaledVector(this.right[idx], lat);
      p.y = abs ? h : p.y + h;
      return p;
    };
    for (let i = 0; i < count; i++) {
      for (let k = 0; k < profile.length - 1; k++) {
        const a = at(i, profile[k]); const b = at(i, profile[k + 1]);
        const c = at(i + 1, profile[k]); const d = at(i + 1, profile[k + 1]);
        const v0 = (i * step) / vScale; const v1 = ((i + 1) * step) / vScale;
        const u0 = uvAcross ? uvAcross[k] : k / (profile.length - 1);
        const u1 = uvAcross ? uvAcross[k + 1] : (k + 1) / (profile.length - 1);
        // profile runs left→right, so (a, b, c) winds counter-clockwise seen from above
        verts.push(...a.toArray(), ...b.toArray(), ...c.toArray(), ...b.toArray(), ...d.toArray(), ...c.toArray());
        uvs.push(u0, v0, u1, v0, u0, v1, u1, v0, u1, v1, u0, v1);
      }
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    geom.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geom.computeVertexNormals();
    const mesh = new THREE.Mesh(geom, mat);
    mesh.receiveShadow = true;
    mesh.castShadow = cast;
    return mesh;
  }

  // A flat ribbon over [x0, x1] of the course between two lateral offsets (metres).
  strip(x0, x1, lat0, lat1, h, mat, { vScale = 1 } = {}) {
    const verts = [];
    const uvs = [];
    const steps = Math.max(1, Math.ceil((x1 - x0) / 0.5));
    const o = {};
    for (let i = 0; i < steps; i++) {
      const sa = x0 + ((x1 - x0) * i) / steps;
      const sb = x0 + ((x1 - x0) * (i + 1)) / steps;
      const q = (s, lat) => { this.pose(s, TRACK_W / 2, o); return o.p.clone().addScaledVector(o.r, lat).add(new THREE.Vector3(0, h, 0)); };
      const a = q(sa, lat0); const b = q(sa, lat1); const c = q(sb, lat0); const d = q(sb, lat1);
      verts.push(...a.toArray(), ...b.toArray(), ...c.toArray(), ...b.toArray(), ...d.toArray(), ...c.toArray());
      const v0 = (sa - x0) / vScale; const v1 = (sb - x0) / vScale;
      uvs.push(0, v0, 1, v0, 0, v1, 1, v0, 1, v1, 0, v1);
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    geom.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geom.computeVertexNormals();
    const m = new THREE.Mesh(geom, mat);
    m.receiveShadow = true;
    return m;
  }

  // Place an object at course distance x, lateral offset `lat` (m), facing along the track.
  place(obj, x, lat = 0, h = 0) {
    const o = this.pose(x, TRACK_W / 2);
    obj.position.copy(o.p).addScaledVector(o.r, lat);
    obj.position.y += h;
    obj.lookAt(obj.position.clone().add(o.t));
    return obj;
  }

  buildSurface() {
    const group = new THREE.Group();
    const th = this.theme;
    const surf = new THREE.MeshStandardMaterial({ map: T.trackTexture(th, TRACK_W), roughness: th === 'volcano' ? 0.75 : 0.9 });
    if (th === 'volcano') { surf.emissiveMap = T.trackTexture(th, TRACK_W); surf.emissive = new THREE.Color('#ff5a1a'); surf.emissiveIntensity = 0.25; }
    group.add(this.extrude([[-HALF, 0.02], [HALF, 0.02]], { mat: surf, vScale: 8, step: 1 }));

    const vergeColor = { stadium: '#8e3a28', jungle: '#6b5236', volcano: '#1b1516' }[th];
    const verge = new THREE.MeshStandardMaterial({ color: vergeColor, roughness: 0.95 });
    const skirt = new THREE.MeshStandardMaterial({ map: T.groundTexture(th), roughness: 1 });
    skirt.map = skirt.map.clone(); skirt.map.repeat.set(1, 1); skirt.map.needsUpdate = true;
    for (const side of [-1, 1]) {
      const inner = side * HALF; const outer = side * (HALF + 1.2);
      const prof = side < 0 ? [[outer, 0.01], [inner, 0.015]] : [[inner, 0.015], [outer, 0.01]];
      group.add(this.extrude(prof, { mat: verge, step: 2 }));
      // embankment down to the ground for elevated sections
      if (th !== 'stadium') {
        const far = side * (HALF + 14);
        const p2 = side < 0 ? [[far, -0.05, true], [outer, 0.0]] : [[outer, 0.0], [far, -0.05, true]];
        group.add(this.extrude(p2, { mat: skirt, step: 2, vScale: 12 }));
      }
    }
    if (th === 'stadium') {
      const kerb = new THREE.MeshStandardMaterial({ color: '#f4f4f0', roughness: 0.6, side: THREE.DoubleSide });
      group.add(this.extrude([[-HALF - 1.25, 0.0], [-HALF - 1.25, 0.14], [-HALF - 1.05, 0.14], [-HALF - 1.05, 0.0]], { mat: kerb, step: 2, cast: true }));
    }
    return group;
  }
}
