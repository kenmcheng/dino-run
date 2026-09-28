// A runner in an inflatable dinosaur costume.
//
// Two builders produce the same rig (named joints the animation drives):
//  - hdRig(): the Blender-built costume from public/assets (art/blender/costumes.py),
//    one skinned mesh per material with baked normals, occlusion and colour masks.
//  - proceduralRig(): the original costume built from code. It is the fallback
//    when the Blender asset isn't loaded (yet), fails, or "Classic" models are on.
// makeRunner() then adds the shared animation, effects and name tag.
//
// Procedural build: the costume body (tail → belly → neck) is ONE skinned mesh
// swept along a spine curve, so it reads as a single inflated nylon shell. Bones
// along the spine drive the tail sway and neck bob. The head, arms, face window,
// fan and species extras hang off those bones. Model space: feet on y=0, facing +z.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { FX, WEAPONS } from '/shared/data.js';
import * as Assets from './assets.js';
import * as T from './textures.js';

const HIP = 0.92;
const V = (x, y, z) => new THREE.Vector3(x, y, z);

// spine: tail tip → neck top. prof: [t, half-width, half-height]. bones: t values, `root` = pelvis bone.
const SPECIES = {
  trex: {
    spine: [[0, 0.2, -1.95], [0, 0.4, -1.35], [0, 0.78, -0.72], [0, 1.18, -0.16], [0, 1.56, 0.04], [0, 1.88, 0.18], [0, 2.04, 0.4]],
    prof: [[0, 0.03, 0.03], [0.18, 0.12, 0.13], [0.36, 0.28, 0.3], [0.52, 0.52, 0.56], [0.68, 0.46, 0.5], [0.84, 0.32, 0.32], [1, 0.22, 0.22]],
    bones: [0, 0.14, 0.28, 0.42, 0.55, 0.7, 0.82, 0.92, 1], root: 4,
    head: { len: 0.9, w: 0.52, h: 0.44, taper: 0.42, drop: 0.07, at: [0, 0.03, 0.3] },
    pattern: 'stripes', arms: 'tiny', armT: 0.66, eyes: '#e0a020', back: 'spikes',
  },
  raptor: {
    spine: [[0, 0.5, -2.15], [0, 0.72, -1.45], [0, 1.0, -0.72], [0, 1.24, -0.12], [0, 1.52, 0.2], [0, 1.78, 0.38], [0, 1.92, 0.6]],
    prof: [[0, 0.02, 0.02], [0.2, 0.08, 0.09], [0.4, 0.22, 0.25], [0.55, 0.42, 0.47], [0.68, 0.38, 0.42], [0.82, 0.2, 0.22], [1, 0.16, 0.17]],
    bones: [0, 0.14, 0.28, 0.42, 0.55, 0.68, 0.8, 0.9, 1], root: 4,
    head: { len: 0.8, w: 0.34, h: 0.3, taper: 0.5, drop: 0.03, at: [0, 0.02, 0.28] },
    pattern: 'tiger', arms: 'feathered', armT: 0.64, eyes: '#ffc93a', back: 'feathers',
  },
  trike: {
    spine: [[0, 0.36, -1.8], [0, 0.64, -1.3], [0, 1.0, -0.72], [0, 1.3, -0.12], [0, 1.36, 0.4], [0, 1.26, 0.82], [0, 1.2, 1.02]],
    prof: [[0, 0.03, 0.03], [0.15, 0.12, 0.12], [0.35, 0.36, 0.34], [0.55, 0.62, 0.56], [0.72, 0.56, 0.5], [0.88, 0.33, 0.31], [1, 0.3, 0.28]],
    bones: [0, 0.14, 0.28, 0.42, 0.56, 0.7, 0.82, 0.92, 1], root: 4,
    head: { len: 0.72, w: 0.56, h: 0.48, taper: 0.4, drop: 0.1, at: [0, 0.02, 0.32] },
    pattern: 'spots', arms: 'stubby', armT: 0.74, eyes: '#6a3a1a',
  },
  stego: {
    spine: [[0, 0.3, -1.85], [0, 0.6, -1.3], [0, 1.05, -0.72], [0, 1.35, -0.12], [0, 1.3, 0.45], [0, 1.06, 0.86], [0, 0.96, 1.02]],
    prof: [[0, 0.03, 0.03], [0.15, 0.11, 0.12], [0.35, 0.34, 0.36], [0.55, 0.58, 0.6], [0.72, 0.5, 0.52], [0.88, 0.23, 0.23], [1, 0.18, 0.18]],
    bones: [0, 0.14, 0.28, 0.42, 0.56, 0.7, 0.82, 0.92, 1], root: 4,
    head: { len: 0.56, w: 0.34, h: 0.28, taper: 0.45, drop: 0.04, at: [0, 0.01, 0.24] },
    pattern: 'spots', arms: 'stubby', armT: 0.74, eyes: '#3a6a2a', back: 'plates',
  },
  ptera: {
    spine: [[0, 0.95, -0.62], [0, 1.05, -0.4], [0, 1.25, -0.12], [0, 1.6, 0.05], [0, 1.94, 0.14], [0, 2.2, 0.24], [0, 2.34, 0.4]],
    prof: [[0, 0.04, 0.04], [0.15, 0.12, 0.13], [0.35, 0.4, 0.42], [0.5, 0.44, 0.48], [0.65, 0.36, 0.38], [0.82, 0.15, 0.16], [1, 0.12, 0.13]],
    bones: [0, 0.2, 0.36, 0.5, 0.62, 0.74, 0.86, 1], root: 3,
    head: { len: 0.44, w: 0.3, h: 0.3, taper: 0.3, drop: 0, at: [0, 0.02, 0.14] },
    pattern: 'scales', arms: 'wings', armT: 0.66, eyes: '#c0302a',
  },
  ankylo: {
    spine: [[0, 0.48, -1.9], [0, 0.64, -1.35], [0, 0.96, -0.75], [0, 1.2, -0.12], [0, 1.2, 0.45], [0, 1.06, 0.86], [0, 1.0, 1.0]],
    prof: [[0, 0.1, 0.08], [0.15, 0.13, 0.11], [0.35, 0.4, 0.3], [0.55, 0.78, 0.52], [0.72, 0.72, 0.48], [0.88, 0.3, 0.26], [1, 0.26, 0.22]],
    bones: [0, 0.14, 0.28, 0.42, 0.56, 0.7, 0.82, 0.92, 1], root: 4,
    head: { len: 0.54, w: 0.6, h: 0.34, taper: 0.25, drop: 0.04, at: [0, 0.01, 0.26] },
    pattern: 'patches', arms: 'stubby', armT: 0.74, eyes: '#5a3a1a', back: 'armour',
  },
  parasaur: {
    spine: [[0, 0.25, -1.9], [0, 0.45, -1.3], [0, 0.8, -0.7], [0, 1.2, -0.12], [0, 1.58, 0.04], [0, 1.94, 0.18], [0, 2.12, 0.4]],
    prof: [[0, 0.03, 0.03], [0.18, 0.11, 0.12], [0.36, 0.28, 0.3], [0.52, 0.48, 0.52], [0.66, 0.44, 0.48], [0.8, 0.23, 0.25], [1, 0.18, 0.2]],
    bones: [0, 0.14, 0.28, 0.42, 0.55, 0.7, 0.82, 0.92, 1], root: 4,
    head: { len: 0.74, w: 0.4, h: 0.36, taper: 0.3, drop: 0.08, bill: 1, at: [0, 0.03, 0.28] },
    pattern: 'stripes', arms: 'small', armT: 0.66, eyes: '#2a7a3a', back: 'spikes',
  },
  pachy: {
    spine: [[0, 0.24, -1.85], [0, 0.44, -1.3], [0, 0.8, -0.7], [0, 1.2, -0.12], [0, 1.56, 0.04], [0, 1.86, 0.18], [0, 2.02, 0.38]],
    prof: [[0, 0.03, 0.03], [0.18, 0.11, 0.12], [0.36, 0.28, 0.3], [0.52, 0.49, 0.53], [0.66, 0.45, 0.49], [0.8, 0.26, 0.28], [1, 0.19, 0.2]],
    bones: [0, 0.14, 0.28, 0.42, 0.55, 0.7, 0.82, 0.92, 1], root: 4,
    head: { len: 0.6, w: 0.44, h: 0.4, taper: 0.4, drop: 0.05, at: [0, 0.03, 0.24] },
    pattern: 'spots', arms: 'small', armT: 0.66, eyes: '#3a5aa0', back: 'spikes',
  },
};

export const TAUNTS = {
  trex: 'RAWR!', raptor: 'Clever girl~', trike: 'Moooove!', stego: 'Spiky!',
  ptera: 'Kraaa!', ankylo: 'Bonk.', parasaur: 'HONK!', pachy: 'Headbutt?',
};

const SNEAKERS = ['#ff4d4d', '#2f80ed', '#27ae60', '#f2994a', '#9b51e0', '#1f1f24', '#f2c94c', '#ff7ac6'];
const SKIN = ['#f1c9a5', '#e0ac85', '#c68b62', '#8d5a3b', '#f5d7bd'];
const HAIR = ['#3b2a20', '#1d1a18', '#7a4a22', '#c9a15a', '#5a2a1a'];
const LID_OPEN = -0.75;
const LID_SHUT = 0.9;

// ------------------------------------------------------------ shared bits
const geo = new Map();
const shared = new WeakSet();
function g(key, make) {
  if (!geo.has(key)) { const x = make(); geo.set(key, x); if (x?.isBufferGeometry) shared.add(x); }
  return geo.get(key);
}
const SPHERE = () => g('sphere', () => new THREE.SphereGeometry(1, 28, 18));
const SPHERE_MID = () => g('sphereMid', () => new THREE.SphereGeometry(1, 16, 12));
const SPHERE_LO = () => g('sphereLo', () => new THREE.SphereGeometry(1, 10, 8));
const CONE = () => g('cone', () => new THREE.ConeGeometry(1, 1, 14));
const rbox = (w, h, d, r) => g(`rb${w}-${h}-${d}-${r}`, () => new RoundedBoxGeometry(w, h, d, 3, r));

const M = {
  ivory: new THREE.MeshPhysicalMaterial({ color: '#f4ecd6', roughness: 0.55, sheen: 0.5, sheenColor: new THREE.Color('#ffffff') }),
  eyeWhite: new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.05 }),
  mouth: new THREE.MeshStandardMaterial({ color: '#4a1018', roughness: 0.7 }),
  tongue: new THREE.MeshPhysicalMaterial({ color: '#e0576a', roughness: 0.5, sheen: 0.4 }),
  sole: new THREE.MeshStandardMaterial({ color: '#f4f2ec', roughness: 0.7 }),
  gum: new THREE.MeshStandardMaterial({ color: '#2a2a2e', roughness: 0.9 }),
  lace: new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.8 }),
  metal: new THREE.MeshStandardMaterial({ color: '#cfd3d8', metalness: 0.9, roughness: 0.25 }),
  plastic: new THREE.MeshStandardMaterial({ color: '#1c1d22', roughness: 0.45 }),
  blade: new THREE.MeshStandardMaterial({ color: '#3a3d46', roughness: 0.4, side: THREE.DoubleSide }),
  beak: new THREE.MeshPhysicalMaterial({ color: '#5a4a3a', roughness: 0.5, sheen: 0.3 }),
  ptBeak: new THREE.MeshPhysicalMaterial({ color: '#f0b93a', roughness: 0.5, sheen: 0.3 }),
  window: new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.04, transparent: true, opacity: 0.22, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 2 }),
  backing: new THREE.MeshBasicMaterial({ color: '#141418' }),
  probe: new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
};
const matCache = new Map();
const cached = (key, make) => { if (!matCache.has(key)) matCache.set(key, make()); return matCache.get(key); };

function palette(hex) {
  const base = new THREE.Color(hex);
  const hsl = {}; base.getHSL(hsl);
  const belly = new THREE.Color().setHSL(hsl.h, Math.max(0, hsl.s - 0.18), Math.min(0.88, hsl.l + (hsl.l > 0.7 ? -0.06 : 0.17)));
  const dark = base.clone().offsetHSL(0, 0.04, hsl.l < 0.25 ? 0.14 : -0.2);
  const accent = hsl.s < 0.1 ? new THREE.Color('#e5484d') : base.clone().offsetHSL(0.08, 0.12, -0.04);
  return { base, belly, dark, accent, light: base.clone().offsetHSL(0, -0.1, 0.18) };
}

function add(parent, geom, mat, pos = [0, 0, 0], scale = [1, 1, 1], rot = [0, 0, 0]) {
  const m = new THREE.Mesh(geom, mat);
  m.position.set(...pos);
  if (typeof scale === 'number') m.scale.setScalar(scale); else m.scale.set(...scale);
  m.rotation.set(...rot);
  m.castShadow = true;
  parent.add(m);
  return m;
}

function joint(parent, pos = [0, 0, 0], rot = [0, 0, 0]) {
  const j = new THREE.Group();
  j.position.set(...pos);
  j.rotation.set(...rot);
  j.userData.dyn = true;
  parent.add(j);
  return j;
}

function aim(mesh, dir) {
  mesh.quaternion.setFromUnitVectors(V(0, 1, 0), dir.clone().normalize());
  return mesh;
}

function tint(geom, color) {
  const n = geom.attributes.position.count;
  const c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { c[i * 3] = color.r; c[i * 3 + 1] = color.g; c[i * 3 + 2] = color.b; }
  geom.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return geom;
}

// A tapered tube along a curve: horns, crests, beaks, claws, feathers.
function taperTube(points, r0, r1, radial = 12, segs = 20, flat = 1) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => V(...p)));
  const frames = curve.computeFrenetFrames(segs, false);
  const pos = []; const uv = []; const idx = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const P = curve.getPointAt(t);
    const r = r0 + (r1 - r0) * t;
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      const n = frames.normals[i].clone().multiplyScalar(Math.cos(a) * flat).addScaledVector(frames.binormals[i], Math.sin(a));
      pos.push(P.x + n.x * r, P.y + n.y * r, P.z + n.z * r);
      uv.push(t, j / radial);
    }
  }
  for (let i = 0; i < segs; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j; const b = a + radial + 1;
      idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  const end = curve.getPointAt(1);
  const tip = pos.length / 3;
  pos.push(end.x, end.y, end.z); uv.push(1, 0.5);
  for (let j = 0; j < radial; j++) idx.push(segs * (radial + 1) + j, segs * (radial + 1) + j + 1, tip);
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geom.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geom.setIndex(idx);
  geom.computeVertexNormals();
  return geom;
}

// Merge static meshes under `group` (stopping at dynamic joints/bones) per material.
function bake(group) {
  group.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const buckets = new Map();
  const remove = [];
  const visit = (obj) => {
    for (const child of obj.children) {
      if (child.userData.dyn || child.userData.keep || child.isBone) continue;
      if (child.isMesh) {
        const m = new THREE.Matrix4().multiplyMatrices(inv, child.matrixWorld);
        let gg = child.geometry.clone().applyMatrix4(m);
        if (gg.index) gg = gg.toNonIndexed();
        const wantColor = child.material.vertexColors;
        for (const k of Object.keys(gg.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) gg.deleteAttribute(k);
        if (!wantColor && gg.attributes.color) gg.deleteAttribute('color');
        if (!gg.attributes.uv) gg.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(gg.attributes.position.count * 2), 2));
        if (!buckets.has(child.material)) buckets.set(child.material, []);
        buckets.get(child.material).push(gg);
        remove.push(child);
      }
      visit(child);
    }
  };
  visit(group);
  for (const r of remove) r.parent.remove(r);
  for (const [mat, list] of buckets) {
    const mesh = new THREE.Mesh(mergeGeometries(list, false), mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
}

// ------------------------------------------------------------ swept body
function profileAt(prof, t) {
  for (let i = 0; i < prof.length - 1; i++) {
    const [t0, w0, h0] = prof[i]; const [t1, w1, h1] = prof[i + 1];
    if (t <= t1) {
      const f = (t - t0) / (t1 - t0);
      const s = f * f * (3 - 2 * f);
      return [w0 + (w1 - w0) * s, h0 + (h1 - h0) * s];
    }
  }
  const l = prof[prof.length - 1];
  return [l[1], l[2]];
}

const SIDE = V(1, 0, 0);

function frameAt(curve, prof, t) {
  const P = curve.getPointAt(t);
  const Tg = curve.getTangentAt(t);
  const up = new THREE.Vector3().crossVectors(Tg, SIDE).normalize();
  const [rx, ry] = profileAt(prof, t);
  return { P, T: Tg, up, rx, ry };
}

// Point on the body surface: theta 0 = right side, +π/2 = dorsal, -π/2 = belly.
function surface(curve, prof, t, theta, lift = 1) {
  const f = frameAt(curve, prof, t);
  const bulge = Math.sin(theta) < 0 ? 1.06 : 1;
  const p = f.P.clone().addScaledVector(SIDE, Math.cos(theta) * f.rx * lift).addScaledVector(f.up, Math.sin(theta) * f.ry * bulge * lift);
  const n = SIDE.clone().multiplyScalar(Math.cos(theta) / f.rx).addScaledVector(f.up, Math.sin(theta) / f.ry).normalize();
  return { p, n, f };
}

function sweepBody(sp) {
  const curve = new THREE.CatmullRomCurve3(sp.spine.map((p) => V(...p)), false, 'centripetal');
  const radial = 40; const segs = 96;
  const pos = []; const uv = []; const ts = []; const bellyW = []; const idx = [];
  const length = curve.getLength();
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const f = frameAt(curve, sp.prof, t);
    for (let j = 0; j <= radial; j++) {
      const th = (j / radial) * Math.PI * 2 - Math.PI / 2;
      const s = Math.sin(th);
      const p = f.P.clone().addScaledVector(SIDE, Math.cos(th) * f.rx).addScaledVector(f.up, s * f.ry * (s < 0 ? 1.06 : 1));
      pos.push(p.x, p.y, p.z);
      uv.push((t * length) / 1.6, j / radial);
      ts.push(t);
      const b = Math.max(0, Math.min(1, (-s - 0.3) / 0.5));
      bellyW.push(b * b * (3 - 2 * b));
    }
  }
  for (let i = 0; i < segs; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j; const b = a + radial + 1;
      idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  for (const [row, flip] of [[0, true], [segs, false]]) {
    const c = curve.getPointAt(row / segs);
    const ci = pos.length / 3;
    pos.push(c.x, c.y, c.z); uv.push(0, 0); ts.push(row / segs); bellyW.push(0);
    for (let j = 0; j < radial; j++) {
      const a = row * (radial + 1) + j;
      if (flip) idx.push(a + 1, a, ci); else idx.push(a, a + 1, ci);
    }
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geom.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geom.setIndex(idx);
  geom.computeVertexNormals();
  const n = ts.length;
  const si = new Uint16Array(n * 4); const sw = new Float32Array(n * 4);
  for (let v = 0; v < n; v++) {
    const t = ts[v];
    let k = 0;
    while (k < sp.bones.length - 2 && t > sp.bones[k + 1]) k++;
    const w = Math.max(0, Math.min(1, (t - sp.bones[k]) / (sp.bones[k + 1] - sp.bones[k])));
    si[v * 4] = k; si[v * 4 + 1] = k + 1;
    sw[v * 4] = 1 - w; sw[v * 4 + 1] = w;
  }
  geom.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  geom.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  geom.userData.belly = bellyW;
  return { geom, curve };
}

// Sculpted head: an ellipsoid pulled into a snout, flattened underneath.
const smooth = (a, b, x) => { const f = Math.max(0, Math.min(1, (x - a) / (b - a))); return f * f * (3 - 2 * f); };

// Head shape as a function of (nx, ny, nz) on a unit sphere: rounded skull at
// the back, cheeks at the eyes, a snout that narrows and dips, a flatter jaw
// line underneath, and optionally a flattened duck bill at the tip.
function headPoint({ len, w, h, taper, drop, bill = 0 }, nx, ny, nz) {
  const zn = (nz + 1) / 2;
  const cheek = 1 + 0.1 * Math.exp(-(((zn - 0.42) / 0.16) ** 2));
  const wf = (1 - taper * smooth(0.35, 1, zn) + bill * 0.55 * smooth(0.62, 0.95, zn)) * cheek;
  const hf = 1 - taper * 0.55 * smooth(0.3, 1, zn) - bill * 0.35 * smooth(0.55, 0.9, zn);
  let y = ny * (h / 2) * hf;
  if (ny < 0) y *= 0.72;
  y -= drop * smooth(0.35, 1, zn);
  return new THREE.Vector3(nx * (w / 2) * wf, y, nz * (len / 2));
}

function sculptHead(H) {
  const geom = new THREE.SphereGeometry(1, 48, 32);
  const p = geom.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const v = headPoint(H, p.getX(i), p.getY(i), p.getZ(i));
    p.setXYZ(i, v.x, v.y, v.z);
  }
  geom.computeVertexNormals();
  return geom;
}

function colorBody(geom, pal) {
  const bw = geom.userData.belly;
  const n = geom.attributes.position.count;
  const c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const b = bw[i];
    c[i * 3] = pal.base.r + (pal.belly.r - pal.base.r) * b;
    c[i * 3 + 1] = pal.base.g + (pal.belly.g - pal.base.g) * b;
    c[i * 3 + 2] = pal.base.b + (pal.belly.b - pal.base.b) * b;
  }
  geom.setAttribute('color', new THREE.BufferAttribute(c, 3));
}

function colorHead(geom, pal, h, billFrom = null, len = 1) {
  const p = geom.attributes.position;
  const c = new Float32Array(p.count * 3);
  const billCol = new THREE.Color('#c9a26a');
  for (let i = 0; i < p.count; i++) {
    const b = Math.max(0, Math.min(1, (-p.getY(i) / h - 0.05) / 0.3));
    let r = pal.base.r + (pal.belly.r - pal.base.r) * b;
    let gg = pal.base.g + (pal.belly.g - pal.base.g) * b;
    let bb = pal.base.b + (pal.belly.b - pal.base.b) * b;
    if (billFrom !== null) {
      const k = smooth(billFrom - 0.04, billFrom + 0.04, p.getZ(i) / len + 0.5);
      r += (billCol.r - r) * k; gg += (billCol.g - gg) * k; bb += (billCol.b - bb) * k;
    }
    c[i * 3] = r; c[i * 3 + 1] = gg; c[i * 3 + 2] = bb;
  }
  geom.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return geom;
}

// ------------------------------------------------------------ parts
// A shallow dome with a flat (planar) projection so the whole face shows.
function faceDome() {
  return g('faceDome2', () => {
    const d = new THREE.SphereGeometry(1, 28, 12, 0, Math.PI * 2, 0, Math.PI / 2.4);
    const p = d.attributes.position; const uv = d.attributes.uv;
    const R = Math.sin(Math.PI / 2.4);
    for (let i = 0; i < p.count; i++) uv.setXY(i, 0.5 + p.getX(i) / (2 * R), 0.5 - p.getZ(i) / (2 * R));
    return d;
  });
}

// Glossy costume eye: white, printed iris and a fabric eyelid that blinks.
function eye(parent, pos, r, side, iris, lidMat) {
  const e = new THREE.Group();
  e.position.set(...pos);
  e.lookAt(V(pos[0] + side * 0.55, pos[1] + 0.1, pos[2] + 0.85));
  e.userData.keep = true;
  add(e, SPHERE_MID(), M.eyeWhite, [0, 0, 0], r);
  const irisMat = cached(`iris-${iris}`, () => new THREE.MeshPhysicalMaterial({ map: T.irisTexture(iris), roughness: 0.1, clearcoat: 1 }));
  add(e, g('irisDisc', () => new THREE.CircleGeometry(1, 28)), irisMat, [0, 0, r * 0.985], r * 0.62);
  const lid = joint(e, [0, 0, 0], [LID_OPEN, 0, 0]);
  const shell = g('lid', () => new THREE.SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2));
  add(lid, shell, lidMat, [0, 0, 0], r * 1.1);
  parent.add(e);
  return { e, lid };
}

function teeth(parent, x, y, z0, z1, n, size, down) {
  for (let i = 0; i < n; i++) {
    const z = z0 + ((z1 - z0) * i) / Math.max(1, n - 1);
    const s = size * (1 - Math.abs(i / (n - 1) - 0.4) * 0.5);
    for (const sx of [-1, 1]) {
      add(parent, CONE(), M.ivory, [sx * x * (1 - (i / n) * 0.35), y, z], [s * 0.42, s, s * 0.42], [down ? Math.PI : 0, 0, 0]);
    }
  }
}

function buildHead(head, name, sp, pal, mats) {
  const H = sp.head;
  add(head, colorHead(sculptHead(H), pal, H.h, H.bill ? 0.8 : null, H.len), mats.fabric);
  let jaw = null;
  const eyeR = Math.min(0.08, H.w * 0.15);
  // sit each eye in the surface of the cheek: only the front of it shows
  const eyeAt = (side) => {
    const nz = -0.14; const ny = 0.42; const nx = side * Math.sqrt(1 - ny * ny - nz * nz);
    const surf = headPoint(H, nx, ny, nz);
    const inward = V(-side, -0.2, 0).normalize();
    return surf.addScaledVector(inward, eyeR * 0.55);
  };
  if (['trex', 'raptor', 'parasaur', 'pachy'].includes(name)) {
    add(head, SPHERE(), M.mouth, [0, -H.h * 0.2, H.len * 0.18], [H.w * 0.34, H.h * 0.12, H.len * 0.3]);
    jaw = joint(head, [0, -H.h * 0.16, -H.len * 0.05]);
    const jawGeom = colorHead(sculptHead({ len: H.len * 0.86, w: H.w * 0.84, h: H.h * 0.42, taper: H.taper, drop: 0 }), pal, H.h * 0.1);
    add(jaw, jawGeom, mats.fabric, [0, -H.h * 0.1, H.len * 0.2], [1, 0.8, 1]);
    add(jaw, SPHERE(), M.tongue, [0, -H.h * 0.04, H.len * 0.22], [H.w * 0.24, H.h * 0.06, H.len * 0.26]);
    if (name === 'trex' || name === 'raptor') {
      teeth(head, H.w * 0.3, -H.h * 0.24, 0, H.len * 0.4, name === 'trex' ? 7 : 6, name === 'trex' ? 0.07 : 0.045, true);
      teeth(jaw, H.w * 0.27, -H.h * 0.08, H.len * 0.08, H.len * 0.42, 5, name === 'trex' ? 0.05 : 0.035, false);
    }
    for (const s of [-1, 1]) add(head, SPHERE_LO(), mats.dark, [s * H.w * 0.1, H.h * 0.02, H.len * 0.48], [0.026, 0.016, 0.02]);
  }
  const eyes = [-1, 1].map((s) => {
    const at = eyeAt(s);
    // brow ridge over each eye gives the face its expression
    add(head, taperTube([[0, 0, -0.07], [0, 0.015, 0], [0, 0, 0.07]], eyeR * 0.45, eyeR * 0.3, 8, 8, 0.6), mats.solid,
      [at.x * 0.93, at.y + eyeR * 0.95, at.z], 1, [0, 0, s * 0.35]);
    return eye(head, at.toArray(), eyeR, s, sp.eyes, mats.solid);
  });

  switch (name) {
    case 'trex':
      break;
    case 'raptor':
      for (let i = 0; i < 7; i++) {
        const m = add(head, taperTube([[0, 0, 0], [0, 0.1, -0.1], [0, 0.18, -0.28]], 0.03, 0.002, 6, 8, 0.35), mats.accent,
          [(i - 3) * 0.028, H.h * 0.3, -H.len * 0.2 - Math.abs(i - 3) * 0.02]);
        m.rotation.z = (i - 3) * 0.12;
        m.scale.setScalar(1 - Math.abs(i - 3) * 0.08);
      }
      break;
    case 'trike': {
      add(head, taperTube([[0, 0, 0], [0, -0.06, 0.1], [0, -0.14, 0.16]], 0.1, 0.01, 12, 10, 1), M.beak, [0, -H.h * 0.05, H.len * 0.42]);
      const frill = new THREE.Shape();
      const R = 0.46;
      frill.moveTo(-R, 0);
      for (let i = 0; i <= 12; i++) {
        const a = Math.PI - (i / 12) * Math.PI;
        const bump = i % 2 ? 1.06 : 0.96;
        frill.lineTo(Math.cos(a) * R * bump, Math.sin(a) * R * bump);
      }
      frill.lineTo(-R, 0);
      const fg = g('frill', () => new THREE.ExtrudeGeometry(frill, { depth: 0.03, bevelEnabled: true, bevelThickness: 0.025, bevelSize: 0.03, bevelSegments: 3, curveSegments: 6 }));
      add(head, fg, mats.accent, [0, H.h * 0.18, -H.len * 0.3], 1, [-0.3, 0, 0]);
      for (let i = 0; i < 9; i++) {
        const a = Math.PI - ((i + 0.5) / 9) * Math.PI;
        const local = V(Math.cos(a) * R * 1.02, Math.sin(a) * R * 1.02, 0.015).applyEuler(new THREE.Euler(-0.3, 0, 0));
        const c = add(head, CONE(), M.ivory, [local.x, H.h * 0.18 + local.y, -H.len * 0.3 + local.z], [0.032, 0.08, 0.032]);
        aim(c, V(local.x, local.y, local.z));
      }
      for (const s of [-1, 1]) {
        add(head, taperTube([[0, 0, 0], [s * 0.05, 0.18, 0.1], [s * 0.08, 0.3, 0.32]], 0.065, 0.006, 12, 14), M.ivory, [s * H.w * 0.26, H.h * 0.3, H.len * 0.02]);
      }
      add(head, taperTube([[0, 0, 0], [0, 0.1, 0.03], [0, 0.18, 0.1]], 0.05, 0.004, 10, 10), M.ivory, [0, H.h * 0.12, H.len * 0.34]);
      break;
    }
    case 'stego':
      add(head, taperTube([[0, 0, 0], [0, -0.04, 0.06]], 0.07, 0.03, 12, 6), M.beak, [0, -H.h * 0.1, H.len * 0.42]);
      break;
    case 'ptera':
      add(head, taperTube([[0, 0, 0], [0, -0.02, 0.35], [0, -0.06, 0.7]], 0.075, 0.004, 14, 18, 0.7), M.ptBeak, [0, -H.h * 0.08, H.len * 0.3]);
      add(head, taperTube([[0, 0, 0], [0, 0.12, -0.25], [0, 0.26, -0.62]], 0.1, 0.006, 12, 16, 0.3), mats.accent, [0, H.h * 0.2, -H.len * 0.1]);
      break;
    case 'ankylo':
      for (const [x, z] of [[1, -1], [-1, -1], [1, 0.4], [-1, 0.4]]) {
        const c = add(head, CONE(), M.ivory, [x * H.w * 0.44, H.h * 0.1, z * H.len * 0.18], [0.05, 0.14, 0.05]);
        aim(c, V(x, 0.35, z * 0.5));
      }
      add(head, taperTube([[0, 0, 0], [0, -0.03, 0.06]], 0.1, 0.05, 12, 6, 0.5), M.beak, [0, -H.h * 0.12, H.len * 0.42]);
      for (let i = 0; i < 5; i++) add(head, SPHERE_LO(), mats.dark, [(i - 2) * 0.08, H.h * 0.42, 0], [0.045, 0.025, 0.06]);
      break;
    case 'parasaur':
      add(head, taperTube([[0, 0, 0], [0, 0.12, -0.18], [0, 0.17, -0.5], [0, 0.12, -0.88]], 0.08, 0.05, 16, 24, 0.75), mats.accent, [0, H.h * 0.3, H.len * 0.12]);
      add(head, SPHERE(), mats.accent, [0, H.h * 0.3 + 0.12, H.len * 0.12 - 0.88], [0.045, 0.055, 0.06]);
      break;
    case 'pachy': {
      const dome = cached('dome', () => new THREE.MeshPhysicalMaterial({ color: '#e6d6b4', roughness: 0.55, sheen: 0.5, sheenColor: new THREE.Color('#fff4dc'), normalMap: T.fabricNormalTexture(), normalScale: new THREE.Vector2(0.3, 0.3) }));
      add(head, SPHERE(), dome, [0, H.h * 0.3, -H.len * 0.1], [H.w * 0.44, H.h * 0.36, H.len * 0.34]);
      for (let i = 0; i < 9; i++) {
        const a = Math.PI * (0.15 + (i / 8) * 0.7); // around the back of the dome only
        add(head, SPHERE_LO(), mats.dark, [Math.cos(a) * H.w * 0.44, H.h * 0.2, -H.len * 0.1 - Math.sin(a) * H.len * 0.33], 0.03);
      }
      for (let i = 0; i < 3; i++) add(head, SPHERE_LO(), mats.dark, [(i - 1) * 0.05, H.h * 0.12, H.len * 0.4], 0.026);
      break;
    }
    default: break;
  }
  return { jaw, eyes };
}

function buildLeg(pivot, side, mats, sneakerMat) {
  const hip = joint(pivot, [side * 0.2, HIP, 0.02]);
  // puffy costume trouser leg, elastic cuff, and a real running shoe
  const thigh = g('thigh', () => new THREE.LatheGeometry([[0.001, -0.46], [0.15, -0.44], [0.19, -0.2], [0.2, 0], [0.17, 0.12], [0.001, 0.14]].map(([x, y]) => new THREE.Vector2(x, y)), 24));
  add(hip, tint(thigh.clone(), mats.pal.base), mats.fabric);
  const knee = joint(hip, [0, -0.44, 0]);
  const shin = g('shin', () => new THREE.LatheGeometry([[0.001, -0.41], [0.1, -0.4], [0.115, -0.36], [0.14, -0.16], [0.15, 0.03], [0.001, 0.04]].map(([x, y]) => new THREE.Vector2(x, y)), 24));
  add(knee, tint(shin.clone(), mats.pal.base), mats.fabric);
  add(knee, g('cuff', () => new THREE.TorusGeometry(0.1, 0.025, 8, 24)), mats.dark, [0, -0.39, 0], 1, [Math.PI / 2, 0, 0]);
  const ankle = joint(knee, [0, -0.43, 0]);
  add(ankle, rbox(0.13, 0.1, 0.28, 0.045), sneakerMat, [0, -0.02, 0.06]);
  add(ankle, rbox(0.145, 0.035, 0.3, 0.015), M.sole, [0, -0.075, 0.06]);
  add(ankle, rbox(0.14, 0.012, 0.28, 0.005), M.gum, [0, -0.095, 0.06]);
  add(ankle, rbox(0.12, 0.05, 0.08, 0.02), M.sole, [0, -0.04, 0.17]);
  for (let i = 0; i < 3; i++) add(ankle, rbox(0.07, 0.01, 0.018, 0.004), M.lace, [0, 0.035, 0.08 + i * 0.04], 1, [-0.35, 0, 0]);
  add(ankle, rbox(0.08, 0.06, 0.03, 0.012), sneakerMat, [0, 0.04, -0.07]);
  return { hip, knee, ankle };
}

function buildArm(bone, at, side, kind, mats) {
  const sh = joint(bone, at.toArray());
  if (kind === 'wings') {
    const w = joint(sh, [0, 0, 0]);
    add(w, taperTube([[0, 0, 0], [side * 0.35, 0.08, 0.02], [side * 0.9, 0.12, -0.05]], 0.045, 0.015, 10, 14), mats.solid);
    const shape = new THREE.Shape();
    shape.moveTo(0, 0.02);
    shape.lineTo(0.9, 0.1);
    shape.quadraticCurveTo(0.72, -0.12, 0.64, -0.3);
    shape.quadraticCurveTo(0.44, -0.24, 0.32, -0.55);
    shape.quadraticCurveTo(0.14, -0.46, 0, -0.7);
    shape.lineTo(0, 0.02);
    add(w, g('wing', () => new THREE.ShapeGeometry(shape, 16)), mats.membrane, [0, 0, -0.02], [side, 1, 1]);
    for (const [x, y] of [[0.64, -0.3], [0.32, -0.55]]) {
      add(w, taperTube([[0, 0, 0], [side * x * 0.5, y * 0.5 + 0.05, 0], [side * x, y, 0]], 0.012, 0.004, 6, 6), mats.dark, [0, 0.03, -0.015]);
    }
    for (let i = 0; i < 3; i++) add(w, CONE(), M.ivory, [side * (0.9 - i * 0.04), 0.13, 0.02 + i * 0.025], [0.012, 0.06, 0.012], [0.7, 0, -side * 0.6]);
    sh.userData.wing = w;
    return sh;
  }
  if (kind === 'stubby') {
    add(sh, taperTube([[0, 0, 0], [side * 0.03, -0.14, 0.05], [0, -0.3, 0.08]], 0.11, 0.08, 14, 10), mats.solid);
    for (let i = -1; i <= 1; i++) add(sh, SPHERE_LO(), M.ivory, [i * 0.045, -0.36, 0.14], [0.03, 0.025, 0.04]);
    return sh;
  }
  const big = kind !== 'tiny';
  const len = big ? 0.22 : 0.17;
  add(sh, taperTube([[0, 0, 0], [side * 0.02, -len * 0.4, len * 0.5], [0, -len * 0.8, len * 0.8]], big ? 0.07 : 0.06, big ? 0.05 : 0.045, 12, 10), mats.solid);
  const claws = big ? 3 : 2;
  for (let i = 0; i < claws; i++) {
    add(sh, taperTube([[0, 0, 0], [0, -0.03, 0.03], [0, -0.07, 0.03]], 0.014, 0.002, 6, 6), M.ivory, [(i - (claws - 1) / 2) * 0.028, -len * 0.84, len * 0.84]);
  }
  if (kind === 'feathered') {
    for (let i = 0; i < 5; i++) {
      add(sh, taperTube([[0, 0, 0], [0, -0.04, -0.1], [0, -0.1, -0.22]], 0.025, 0.002, 6, 8, 0.3), mats.accent, [side * 0.03, -len * 0.2 - i * 0.03, len * 0.3 - i * 0.02]);
    }
  }
  return sh;
}

function plateGeom() {
  return g('plate2', () => {
    const s = new THREE.Shape();
    s.moveTo(-0.5, 0);
    s.quadraticCurveTo(-0.62, 0.55, 0, 1);
    s.quadraticCurveTo(0.62, 0.55, 0.5, 0);
    s.lineTo(-0.5, 0);
    const e = new THREE.ExtrudeGeometry(s, { depth: 0.05, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 4, curveSegments: 10 });
    e.translate(0, 0, -0.025);
    e.rotateY(Math.PI / 2);
    return e;
  });
}

// ------------------------------------------------------------ assembly
// opts: { number, runner, ownTextures }. ownTextures gives this model its own
// copies of the HD textures, so a second renderer (title turntable,
// thumbnails) frees its GPU copy when the model is disposed.
export function buildDino(name, color, opts = {}) {
  const asset = Assets.get('costumes', name);
  let rig = null;
  if (asset) {
    try { rig = hdRig(asset, name, color, opts); } catch (err) { console.warn(`[dino3d] HD ${name} failed, using the procedural costume`, err); }
  }
  return makeRunner(rig || proceduralRig(name, color, opts), name, opts.number ?? 1);
}

// ------------------------------------------------------------ Blender costume
// Mask texture: R dark markings, G belly, B accent, A baked occlusion (0.2..1).
// The runner's colours are applied here, so one texture set serves every colour.
const HD_FABRIC_MAP = `
  vec4 hdMask = texture2D( map, vMapUv );
  vec3 hdCol = mix( uBase, uBelly, hdMask.g );
  hdCol = mix( hdCol, uDark, hdMask.r );
  hdCol = mix( hdCol, uAccent, hdMask.b );
  diffuseColor.rgb *= hdCol;
  float hdAO = clamp( ( hdMask.a - 0.2 ) / 0.8, 0.0, 1.0 );`;
const HD_FABRIC_AO = `
  reflectedLight.indirectDiffuse *= mix( 1.0, hdAO, 0.9 );
  reflectedLight.indirectSpecular *= mix( 1.0, hdAO, 0.9 );
  reflectedLight.directDiffuse *= mix( 1.0, hdAO, 0.5 );`;

function hdFabric(tex, pal, membrane) {
  const m = new THREE.MeshPhysicalMaterial({
    map: tex.mask, normalMap: tex.normal, normalScale: new THREE.Vector2(1, -1), // glTF tangents: flip green
    roughness: 0.5, sheen: 0.7, sheenRoughness: 0.35, sheenColor: pal.light, clearcoat: 0.3, clearcoatRoughness: 0.45,
    emissive: new THREE.Color('#ff2a00'), emissiveIntensity: 0,
    ...(membrane ? { transparent: true, opacity: 0.92, side: THREE.DoubleSide } : {}),
  });
  const uniforms = { uBase: { value: pal.base }, uBelly: { value: pal.belly }, uDark: { value: pal.dark }, uAccent: { value: pal.accent } };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uBase, uBelly, uDark, uAccent;')
      .replace('#include <map_fragment>', HD_FABRIC_MAP)
      .replace('#include <aomap_fragment>', HD_FABRIC_AO);
  };
  m.customProgramCacheKey = () => 'hd-fabric';
  return m;
}

// Trim: baked colour; ORM = occlusion, roughness, and (B) where the runner's
// sneaker colour is applied.
function hdTrim(tex, sneaker) {
  const m = new THREE.MeshStandardMaterial({
    map: tex.color, roughnessMap: tex.orm, aoMap: tex.orm, aoMapIntensity: 0.9, normalMap: tex.normal,
    normalScale: new THREE.Vector2(1, -1), roughness: 1, metalness: 0,
  });
  const tint = { value: new THREE.Color(sneaker) };
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTint = tint;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uTint;')
      .replace('#include <map_fragment>', `
        vec4 sampledDiffuseColor = texture2D( map, vMapUv );
        float hdTint = texture2D( roughnessMap, vRoughnessMapUv ).b;
        diffuseColor.rgb *= mix( sampledDiffuseColor.rgb, sampledDiffuseColor.rgb * uTint, hdTint );`);
  };
  m.customProgramCacheKey = () => 'hd-trim';
  return m;
}

const HD_BOUNDS = new THREE.Sphere(new THREE.Vector3(0, 1.2, -0.2), 3.3);

function copyTextures(t) {
  return Object.fromEntries(Object.entries(t).map(([k, slots]) => [k, Object.fromEntries(Object.entries(slots).map(([s, tx]) => [s, tx.clone()]))]));
}

function hdRig(asset, name, color, { number = 1, runner = '', ownTextures = false } = {}) {
  const pal = palette(color);
  const tex = ownTextures ? copyTextures(asset.textures) : asset.textures;
  const root = new THREE.Group();
  const model = SkeletonUtils.clone(asset.scene);
  root.add(model);
  const get = (n) => model.getObjectByName(n) || null;
  const pivot = get('pivot');
  const torso = get('torso');
  if (!pivot || !torso) throw new Error('costume rig has no pivot/torso');
  const spine = [];
  for (let i = 0; get(`spine_${i}`); i++) spine.push(get(`spine_${i}`));
  const rootIdx = spine.findIndex((b) => b.parent === torso);
  const legs = [0, 1].map((i) => ({ hip: get(`hip_${i}`), knee: get(`knee_${i}`), ankle: get(`ankle_${i}`) }));
  const arms = [0, 1].map((i) => {
    const a = get(`arm_${i}`);
    const w = get(`wing_${i}`);
    if (a && w) a.userData.wing = w;
    return a;
  }).filter(Boolean);
  const eyes = [0, 1].map((i) => get(`lid_${i}`)).filter(Boolean).map((lid) => ({ lid }));

  const skin = SKIN[number % SKIN.length];
  const hair = HAIR[number % HAIR.length];
  const faceMat = new THREE.MeshStandardMaterial({ map: T.humanFace('happy', skin, hair), roughness: 0.8 });
  const bibMat = new THREE.MeshStandardMaterial({ map: T.bibTexture(number, runner), roughness: 0.85, side: THREE.DoubleSide });
  const fabric = hdFabric(tex.fabric, pal, false);
  const membrane = hdFabric(tex.fabric, pal, true);
  const trim = hdTrim(tex.trim, SNEAKERS[number % SNEAKERS.length]);
  const pick = { fabric, membrane, trim, face: faceMat, window: M.window, bib: bibMat };
  model.traverse((o) => {
    if (!o.isMesh) return;
    const kind = o.material.name;
    o.material = pick[kind] || fabric;
    // bones move the skin outside its rest-pose bounds, so cull against a fixed
    // sphere that holds the whole costume in any pose (tail, wings, a full trip)
    o.boundingSphere = HD_BOUNDS;
    o.castShadow = kind === 'fabric' || kind === 'trim' || kind === 'membrane';
    o.receiveShadow = kind === 'fabric' || kind === 'trim';
    if (kind === 'window') { o.renderOrder = 2; o.castShadow = false; }
  });
  return {
    hd: true, root, pivot, torso, legs, arms, eyes, jaw: get('jaw'), fan: get('fan'),
    tailBones: spine.slice(0, rootIdx).reverse(), neckBones: spine.slice(rootIdx + 1),
    hotMats: [fabric, membrane], faceMat, face: { skin, hair },
    lidRest: LID_OPEN, // lids are modelled open; the bone rotates them shut
    dispose() {
      for (const m of [fabric, membrane, trim, faceMat]) m.dispose();
      bibMat.map.dispose(); bibMat.dispose();
      if (ownTextures) for (const slots of Object.values(tex)) for (const t of Object.values(slots)) t.dispose();
      model.traverse((o) => { if (o.isSkinnedMesh) o.skeleton.dispose(); });
    },
  };
}

// ------------------------------------------------------------ procedural costume
function proceduralRig(name, color, { number = 1, runner = '' } = {}) {
  const sp = SPECIES[name] || SPECIES.trex;
  const pal = palette(color);
  const nrm = T.fabricNormalTexture();
  const glow = { emissive: new THREE.Color('#ff2a00'), emissiveIntensity: 0 };
  const mats = {
    pal,
    // vertex-coloured nylon for the shell, head, legs (belly blend baked into colours)
    fabric: new THREE.MeshPhysicalMaterial({
      color: '#ffffff', vertexColors: true, map: T.costumePattern(sp.pattern), normalMap: nrm, normalScale: new THREE.Vector2(0.55, 0.55),
      roughness: 0.48, sheen: 0.7, sheenRoughness: 0.35, sheenColor: pal.light, clearcoat: 0.3, clearcoatRoughness: 0.45, ...glow,
    }),
    solid: new THREE.MeshPhysicalMaterial({
      color: pal.base, normalMap: nrm, normalScale: new THREE.Vector2(0.4, 0.4),
      roughness: 0.5, sheen: 0.7, sheenColor: pal.light, clearcoat: 0.3, clearcoatRoughness: 0.45, ...glow,
    }),
    dark: new THREE.MeshPhysicalMaterial({ color: pal.dark, roughness: 0.55, sheen: 0.4 }),
    accent: new THREE.MeshPhysicalMaterial({ color: pal.accent, normalMap: nrm, normalScale: new THREE.Vector2(0.35, 0.35), roughness: 0.45, sheen: 0.6, sheenColor: pal.accent, clearcoat: 0.3 }),
    membrane: new THREE.MeshPhysicalMaterial({ color: pal.accent, roughness: 0.55, transparent: true, opacity: 0.9, side: THREE.DoubleSide, sheen: 0.5 }),
  };
  mats.solid.emissive = new THREE.Color('#ff2a00');

  const root = new THREE.Group();
  const pivot = joint(root);
  const torso = joint(pivot, [0, HIP, 0]);

  // ---- the inflated shell
  const { geom: baseGeom, curve } = g(`body-${name}`, () => sweepBody(sp));
  const bodyGeom = baseGeom.clone();
  bodyGeom.userData.belly = baseGeom.userData.belly;
  colorBody(bodyGeom, pal);
  const body = new THREE.SkinnedMesh(bodyGeom, mats.fabric);
  body.position.y = -HIP;
  body.castShadow = true;
  body.receiveShadow = true;
  body.userData.keep = true;
  body.frustumCulled = false;
  torso.add(body);

  const bones = sp.bones.map(() => new THREE.Bone());
  const bonePos = sp.bones.map((t) => curve.getPointAt(t));
  const rootIdx = sp.root;
  bones.forEach((b, i) => {
    const parent = i === rootIdx ? null : i < rootIdx ? i + 1 : i - 1;
    const p = bonePos[i].clone();
    if (parent !== null) p.sub(bonePos[parent]);
    b.position.copy(p);
  });
  bones.forEach((b, i) => {
    if (i < rootIdx) bones[i + 1].add(b);
    else if (i > rootIdx) bones[i - 1].add(b);
  });
  body.add(bones[rootIdx]);
  body.updateMatrixWorld(true);
  body.bind(new THREE.Skeleton(bones));

  const nearestBone = (t) => {
    let k = 0;
    for (let i = 1; i < sp.bones.length; i++) if (Math.abs(sp.bones[i] - t) < Math.abs(sp.bones[k] - t)) k = i;
    return k;
  };
  const onBone = (t, p) => { const k = nearestBone(t); return { bone: bones[k], local: p.clone().sub(bonePos[k]) }; };
  const probe = new THREE.Mesh(baseGeom, M.probe);
  const groupsToBake = [];
  const cast = (from, dir) => new THREE.Raycaster(from, dir).intersectObject(probe)[0];
  const mount = (t, hit, offset = 0) => {
    const { bone, local } = onBone(t, hit.point);
    const grp = new THREE.Group();
    grp.position.copy(local).addScaledVector(hit.face.normal, offset);
    grp.quaternion.setFromUnitVectors(V(0, 0, 1), hit.face.normal);
    grp.userData.keep = true;
    bone.add(grp);
    return grp;
  };

  // ---- face window: the runner's face behind clear PVC
  const skin = SKIN[number % SKIN.length];
  const hair = HAIR[number % HAIR.length];
  const faceMat = new THREE.MeshStandardMaterial({ map: T.humanFace('happy', skin, hair), roughness: 0.8 });
  const hitW = cast(V(0.003, 1.6, -0.2), V(0, 0, 1)); // off x=0: that's a vertex seam
  if (hitW) {
    const win = mount(0.66, hitW);
    add(win, g('disc', () => new THREE.CircleGeometry(1, 32)), M.backing, [0, 0, 0.004], 0.15);
    const face = add(win, faceDome(), faceMat, [0, 0, -0.02], [0.13, 0.05, 0.13], [Math.PI / 2, 0, 0]);
    face.userData.keep = true;
    const pane = add(win, g('windowDome', () => new THREE.SphereGeometry(1, 24, 12, 0, Math.PI * 2, 0, Math.PI / 3)), M.window, [0, 0, -0.035], [0.15, 0.07, 0.15], [Math.PI / 2, 0, 0]);
    pane.renderOrder = 2;
    pane.castShadow = false;
    pane.userData.keep = true;
    groupsToBake.push(win);
    add(win, g('rim', () => new THREE.TorusGeometry(1, 0.1, 10, 36)), mats.dark, [0, 0, 0.006], 0.152);
  }

  // ---- blower fan on the lower back: every real inflatable has one
  let fan = null;
  const hitB = cast(V(0.003, 1.02, 0.1), V(0, 0, -1));
  if (hitB) {
    const unit = mount(0.46, hitB);
    add(unit, rbox(0.2, 0.14, 0.06, 0.02), M.plastic, [0, 0, 0.02]);
    add(unit, g('grill', () => new THREE.TorusGeometry(0.052, 0.008, 6, 24)), M.metal, [0, 0, 0.054]);
    fan = new THREE.Group();
    fan.position.z = 0.05;
    for (let i = 0; i < 5; i++) {
      const b = new THREE.Mesh(g('bladeG', () => new THREE.CircleGeometry(0.045, 8, 0, 0.9)), M.blade);
      b.rotation.z = (i / 5) * Math.PI * 2;
      fan.add(b);
    }
    fan.userData.keep = true;
    unit.add(fan);
    groupsToBake.push(unit, fan);
  }

  // ---- race bib, pinned below the window
  const bibMat = new THREE.MeshStandardMaterial({ map: T.bibTexture(number, runner), roughness: 0.85, side: THREE.DoubleSide });
  const hitBib = cast(V(0.003, hitW ? hitW.point.y - 0.36 : 1.2, -0.2), V(0, 0, 1));
  if (hitBib) {
    const bib = mount(0.55, hitBib);
    const bibGeom = g('bib', () => {
      const pl = new THREE.PlaneGeometry(0.34, 0.25, 8, 4);
      const ps = pl.attributes.position;
      for (let i = 0; i < ps.count; i++) ps.setZ(i, -(ps.getX(i) ** 2) * 0.9 + 0.012);
      pl.computeVertexNormals();
      return pl;
    });
    add(bib, bibGeom, bibMat);
    for (const [x, y] of [[-0.15, 0.1], [0.15, 0.1], [-0.15, -0.1], [0.15, -0.1]]) add(bib, SPHERE_LO(), M.metal, [x, y, 0.016 - x * x * 0.9], 0.012);
    groupsToBake.push(bib);
  }

  // ---- species extras along the back
  if (sp.back === 'plates') {
    for (let i = 0; i < 11; i++) {
      const t = 0.2 + (i / 10) * 0.66;
      const { p, f } = surface(curve, sp.prof, t, Math.PI / 2, 0.9);
      const size = 0.22 + Math.sin((i / 10) * Math.PI) * 0.34;
      const { bone, local } = onBone(t, p);
      const m = add(bone, plateGeom(), mats.accent, local.toArray(), [size * 0.5, size, size]);
      m.quaternion.setFromUnitVectors(V(0, 1, 0), f.up);
      m.position.x = (i % 2 ? 1 : -1) * 0.05;
    }
    const { bone, local } = onBone(0, curve.getPointAt(0.05));
    for (const [x, zz] of [[0.09, 0.3], [-0.09, 0.3], [0.12, -0.1], [-0.12, -0.1]]) {
      add(bone, taperTube([[0, 0, 0], [x * 1.5, 0.15, zz * 0.3], [x * 3, 0.34, zz * 0.5]], 0.035, 0.003, 8, 10), M.ivory, local.toArray());
    }
  } else if (sp.back === 'armour') {
    for (let row = -3; row <= 3; row++) {
      for (let k = 0; k < 9; k++) {
        const t = 0.4 + (k / 8) * 0.44;
        const { p, n } = surface(curve, sp.prof, t, Math.PI / 2 + row * 0.32, 1);
        const { bone, local } = onBone(t, p);
        aim(add(bone, CONE(), mats.dark, local.toArray(), [0.055, 0.06, 0.055]), n);
      }
    }
    for (const s of [1, -1]) {
      for (let k = 0; k < 7; k++) {
        const t = 0.36 + (k / 6) * 0.44;
        const { p, n } = surface(curve, sp.prof, t, s > 0 ? -0.15 : Math.PI + 0.15, 1);
        const { bone, local } = onBone(t, p);
        aim(add(bone, CONE(), M.ivory, local.toArray(), [0.04, 0.2, 0.04]), n.clone().add(V(0, -0.3, 0)));
      }
    }
    const { bone, local } = onBone(0, curve.getPointAt(0.02));
    add(bone, SPHERE(), mats.dark, local.toArray(), [0.28, 0.18, 0.24]);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      add(bone, SPHERE_LO(), M.ivory, local.clone().add(V(Math.cos(a) * 0.25, Math.sin(a) * 0.13, 0)).toArray(), 0.05);
    }
  } else if (sp.back === 'spikes') {
    for (let k = 0; k < 12; k++) {
      const t = 0.12 + (k / 11) * 0.76;
      const { p, f } = surface(curve, sp.prof, t, Math.PI / 2, 0.96);
      const { bone, local } = onBone(t, p);
      const s = 0.05 + Math.sin((k / 11) * Math.PI) * 0.04;
      aim(add(bone, CONE(), mats.dark, local.toArray(), [s * 0.8, s * 1.8, s * 0.5]), f.up);
    }
  } else if (sp.back === 'feathers') {
    for (let k = 0; k < 16; k++) {
      const t = 0.3 + (k / 15) * 0.66;
      const { p, f } = surface(curve, sp.prof, t, Math.PI / 2, 0.95);
      const { bone, local } = onBone(t, p);
      const m = add(bone, taperTube([[0, 0, 0], [0, 0.06, -0.08], [0, 0.1, -0.2]], 0.03, 0.002, 6, 8, 0.3), mats.accent, local.toArray());
      m.quaternion.setFromUnitVectors(V(0, 1, 0), f.up);
    }
    const { bone, local } = onBone(0, curve.getPointAt(0.03));
    for (let i = -3; i <= 3; i++) {
      add(bone, taperTube([[0, 0, 0], [i * 0.03, 0.02, -0.15], [i * 0.07, 0.03, -0.32]], 0.03, 0.003, 6, 8, 0.3), mats.accent, local.toArray());
    }
  }

  // ---- head on the top neck bone, arms on the chest
  const head = joint(bones[bones.length - 1], sp.head.at);
  const { jaw, eyes } = buildHead(head, name, sp, pal, mats);
  const arms = [-1, 1].map((side) => {
    const { p } = surface(curve, sp.prof, sp.armT, side > 0 ? -0.62 : Math.PI + 0.62, 0.95);
    const { bone, local } = onBone(sp.armT, p);
    return buildArm(bone, local, side, sp.arms, mats);
  });

  const sneakerMat = cached(`sneaker-${number % SNEAKERS.length}`, () => new THREE.MeshStandardMaterial({ map: T.sneakerTexture(SNEAKERS[number % SNEAKERS.length]), roughness: 0.55 }));
  const legs = [buildLeg(pivot, -1, mats, sneakerMat), buildLeg(pivot, 1, mats, sneakerMat)];

  // merge static parts per joint/bone
  const joints = [];
  root.traverse((o) => { if (o.userData.dyn || o.isBone) joints.push(o); });
  bake(root);
  for (const j of joints) bake(j);
  for (const e of eyes) bake(e.e);
  for (const grp of groupsToBake) bake(grp);
  // tiny parts (eyes, teeth, laces, pins, fan) add nothing to the shadow but
  // would each cost a draw call in the shadow pass
  root.traverse((o) => {
    if (!o.isMesh || o.isSkinnedMesh) return;
    o.geometry.computeBoundingSphere();
    const sc = o.getWorldScale(new THREE.Vector3());
    if (o.geometry.boundingSphere.radius * Math.max(sc.x, sc.y, sc.z) < 0.14) o.castShadow = false;
  });

  return {
    hd: false, root, pivot, torso, legs, arms, eyes, jaw, fan,
    tailBones: bones.slice(0, rootIdx).reverse(), neckBones: bones.slice(rootIdx + 1),
    hotMats: [mats.fabric, mats.solid], faceMat, face: { skin, hair }, lidRest: 0,
    dispose() {
      root.traverse((o) => { if (o.isMesh && !shared.has(o.geometry)) o.geometry.dispose(); });
      for (const m of Object.values(mats)) if (m?.isMaterial) m.dispose();
      faceMat.dispose();
      bibMat.map.dispose(); bibMat.dispose();
      body.skeleton.dispose();
    },
  };
}

// ------------------------------------------------------------ held items
// The Water Blaster and Squeaky Mallet appear in the runner's hands while in
// use. Blender models when loaded (props 'blaster', 'mallet'), else simple
// shapes. Shared by every runner, so they are made once.
const heldCache = new Map();
function heldParts(kind) {
  const key = `${kind}|${Assets.get('props', kind) ? 'hd' : 'classic'}`;
  if (heldCache.has(key)) return heldCache.get(key);
  const hd = Assets.withMeshes('props', kind, [kind]);
  let parts;
  if (hd) {
    parts = [[Assets.geometry(hd, kind), Assets.material(hd, kind === 'blaster' ? { physical: true, clearcoat: 0.8 } : { physical: true, clearcoat: 0.5, sheen: 0.5 })]];
  } else if (kind === 'blaster') {
    const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.35, ...extra });
    const body = new THREE.BoxGeometry(0.14, 0.16, 0.5); body.translate(0, 0.02, 0.12);
    const tank = new THREE.CylinderGeometry(0.09, 0.09, 0.3, 16); tank.rotateX(Math.PI / 2); tank.translate(0, 0.16, 0.05);
    const barrel = new THREE.CylinderGeometry(0.03, 0.035, 0.24, 12); barrel.rotateX(Math.PI / 2); barrel.translate(0, 0.04, 0.46);
    const grip = new THREE.BoxGeometry(0.08, 0.18, 0.1); grip.translate(0, -0.1, -0.02);
    parts = [[body, std('#ff8a1f')], [grip, std('#ff8a1f')], [tank, std('#6fc6ff', { transparent: true, opacity: 0.75 })], [barrel, std('#ffd84a')]];
  } else {
    const handle = new THREE.CylinderGeometry(0.035, 0.04, 1.0, 12); handle.translate(0, 0.5, 0);
    const head = new THREE.CapsuleGeometry(0.2, 0.34, 6, 16); head.rotateZ(Math.PI / 2); head.translate(0, 1.05, 0);
    parts = [[handle, new THREE.MeshStandardMaterial({ color: '#2f80ed', roughness: 0.4 })], [head, new THREE.MeshPhysicalMaterial({ color: '#e5484d', roughness: 0.35, clearcoat: 0.6 })]];
  }
  heldCache.set(key, parts);
  return parts;
}

function heldItem(kind) {
  const g = new THREE.Group();
  for (const [geom, mat] of heldParts(kind)) {
    const m = new THREE.Mesh(geom, mat);
    m.castShadow = kind === 'mallet';
    g.add(m);
  }
  g.visible = false;
  return g;
}

// half-width of the costume at the chest, so held items sit just outside it
const chestWidth = (name) => Math.max(...(SPECIES[name] || SPECIES.trex).prof.map((p) => p[1])) + 0.06;

// ------------------------------------------------------------ runner
// Animation, status effects, name tag and taunt bubble on top of either rig.
function makeRunner(rig, name, number) {
  const { root, pivot, torso, legs, arms, eyes, jaw, fan, tailBones, neckBones, hotMats, faceMat } = rig;
  const { skin, hair } = rig.face;
  const faceTextures = ['happy', 'hot', 'dizzy'].map((m) => T.humanFace(m, skin, hair));

  // held items, carried on the runner's right (+x) at chest height
  const blaster = heldItem('blaster');
  blaster.position.set(chestWidth(name), 0.38, 0.28);
  const mallet = heldItem('mallet');
  mallet.position.set(chestWidth(name) + 0.05, 0.25, 0.2);
  torso.add(blaster, mallet);
  const MUZZLE = new THREE.Vector3(0, 0.05, 0.6);

  // ---- status visuals
  const fxGroup = new THREE.Group();
  root.add(fxGroup);
  const stars = new THREE.Group();
  const starMat = new THREE.SpriteMaterial({ map: T.starTexture(), depthWrite: false });
  for (let i = 0; i < 5; i++) { const s = new THREE.Sprite(starMat); s.scale.setScalar(0.22); stars.add(s); }
  stars.visible = false;
  fxGroup.add(stars);
  const shield = new THREE.Mesh(SPHERE(), bubbleMaterial('#ffb020'));
  shield.scale.set(1.3, 1.65, 1.6); shield.position.y = 1.4; shield.visible = false; shield.renderOrder = 5;
  fxGroup.add(shield);
  const spikes = new THREE.Group();
  const spikeMat = new THREE.MeshStandardMaterial({ color: '#ff5a2a', emissive: '#ff3a00', emissiveIntensity: 0.6, roughness: 0.3 });
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const c = new THREE.Mesh(CONE(), spikeMat);
    c.scale.set(0.07, 0.4, 0.07);
    c.position.set(Math.cos(a) * 0.95, 1.4 + Math.sin(i * 1.7) * 0.35, Math.sin(a) * 0.95);
    aim(c, V(Math.cos(a), Math.sin(i * 1.7) * 0.4, Math.sin(a)));
    spikes.add(c);
  }
  spikes.visible = false;
  fxGroup.add(spikes);

  const state = { tripT: 0, deflate: 0, bubble: null, tag: null, tagKey: '', faceMood: 'happy', roll: 0, blink: 2 + Math.random() * 4, swingT: 0, wet: 0 };

  // A soaked costume looks darker and glossy, then dries off over a second or two.
  function setWet(w) {
    for (const m of hotMats) {
      const dry = (m.userData.dry ||= { color: m.color.clone(), roughness: m.roughness, clearcoat: m.clearcoat ?? 0 });
      m.color.copy(dry.color).multiplyScalar(1 - 0.3 * w);
      m.roughness = dry.roughness * (1 - 0.6 * w);
      if (m.clearcoat !== undefined) m.clearcoat = dry.clearcoat + (1 - dry.clearcoat) * 0.7 * w;
    }
  }

  // World position of the Water Blaster's nozzle (for the jet).
  function muzzle(out = new THREE.Vector3()) {
    return blaster.visible ? blaster.localToWorld(out.copy(MUZZLE)) : null;
  }

  function showTag(on) { if (state.tag) state.tag.visible = on; }

  // Show every normally-hidden effect so the renderer can compile/upload it
  // during loading instead of mid-race (each first appearance is a hitch).
  function prewarm(on) {
    bubble(on);
    stars.visible = on; shield.visible = on; spikes.visible = on;
    blaster.visible = on; mallet.visible = on;
    return [...faceTextures, ...[...tagCache.values()].map((v) => v.tx), state.bubble?.material.map].filter(Boolean);
  }

  const tagCache = new Map();
  function setTag(text, me) {
    const key = `${text}|${me}`;
    if (key === state.tagKey) return;
    state.tagKey = key;
    if (!tagCache.has(key)) {
      const c = T.labelCanvas(text, me ? { bg: 'rgba(255,216,74,0.96)', fg: '#231a00' } : {});
      const tx = new THREE.CanvasTexture(c); tx.colorSpace = THREE.SRGBColorSpace;
      tagCache.set(key, { tx, aspect: c.width / c.height });
    }
    const { tx, aspect } = tagCache.get(key);
    if (!state.tag) {
      state.tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: tx, depthTest: false, depthWrite: false, sizeAttenuation: false }));
      state.tag.renderOrder = 10;
      fxGroup.add(state.tag);
    } else { state.tag.material.map = tx; }
    const h = me ? 0.036 : 0.028;
    state.tag.scale.set(h * aspect, h, 1);
    state.tag.position.y = 3.2;
  }

  function bubble(on) {
    if (on && !state.bubble) {
      const c = T.labelCanvas(TAUNTS[name] || 'RAWR!', { bg: '#ffffff', fg: '#222', size: 56 });
      const tx = new THREE.CanvasTexture(c); tx.colorSpace = THREE.SRGBColorSpace;
      state.bubble = new THREE.Sprite(new THREE.SpriteMaterial({ map: tx, depthTest: false }));
      state.bubble.renderOrder = 11;
      state.bubble.scale.set((0.45 * c.width) / c.height, 0.45, 1);
      state.bubble.position.set(0.9, 3.6, 0);
      fxGroup.add(state.bubble);
    }
    if (state.bubble) state.bubble.visible = on;
  }

  function setFace(mood) {
    if (mood === state.faceMood) return;
    state.faceMood = mood;
    faceMat.map = T.humanFace(mood, skin, hair);
    faceMat.needsUpdate = true;
  }

  const lerp = THREE.MathUtils.lerp;
  // s: { v, z, fx, taunt, finished, heat, phase, turn }
  function update(s, dt, t) {
    const fx = s.fx || 0;
    const k = Math.min(1.4, s.v / 9);
    const ph = s.phase;
    const tripped = fx & FX.trip;
    const air = s.z > 0.05 && !(fx & FX.glide);
    const turn = Math.max(-1, Math.min(1, s.turn || 0));
    const a = Math.min(1, dt * 20);

    legs.forEach((L, i) => {
      const p = ph + (i ? Math.PI : 0);
      let hip = -Math.sin(p) * 0.8 * k;
      let knee = (0.15 + Math.max(0, Math.sin(p + Math.PI / 2 + 0.6)) * 1.25) * k;
      if (air) { hip = -0.65; knee = 1.3; }
      if (tripped) { hip = 0.2 + Math.sin(t * 25 + i) * 0.4; knee = 0.6; }
      if (s.finished && !tripped) { hip = -Math.sin(p) * 0.3 * k; knee = 0.3 * k; }
      L.hip.rotation.x = lerp(L.hip.rotation.x, hip, a);
      L.knee.rotation.x = lerp(L.knee.rotation.x, knee, a);
      L.ankle.rotation.x = -(L.hip.rotation.x + L.knee.rotation.x) * 0.55;
      L.hip.position.y = torso.position.y;
    });

    const bob = tripped ? 0 : Math.abs(Math.sin(ph)) * 0.07 * k;
    torso.position.y = HIP + bob;
    const lean = 0.08 * Math.min(1, k) + (fx & FX.charge ? 0.3 : 0) + (fx & FX.dash ? 0.2 : 0);
    torso.rotation.x = lerp(torso.rotation.x, lean, Math.min(1, dt * 8));
    torso.rotation.y = Math.sin(ph) * 0.06 * k;
    state.roll = lerp(state.roll, -turn * 0.16, Math.min(1, dt * 6));
    torso.rotation.z = Math.sin(ph) * 0.045 * k + state.roll;

    state.tripT = lerp(state.tripT, tripped ? 1 : 0, Math.min(1, dt * (tripped ? 10 : 5)));
    pivot.rotation.x = state.tripT * 1.3;
    pivot.position.y = -state.tripT * 0.35;
    pivot.position.z = state.tripT * 0.4;

    // inflation: a gentle breathing wobble; deflating sags the whole shell
    state.deflate = lerp(state.deflate, fx & FX.deflate ? 1 : 0, Math.min(1, dt * 4));
    const d = state.deflate;
    const wob = Math.sin(t * 11 + ph) * 0.012 + Math.sin(ph * 2) * 0.01 * k;
    torso.scale.set(1 + wob + d * 0.14, 1 - wob - d * 0.34, 1 + wob + d * 0.1);

    // tail follow-through, swinging out of turns
    tailBones.forEach((b, i) => {
      const amp = (name === 'ankylo' ? 0.05 : 0.1) * (0.6 + i * 0.25);
      b.rotation.y = Math.sin(t * 3.2 + ph * 0.5 - i * 0.7) * amp * (1 + k * 0.4) + turn * 0.035 * (i + 1);
      b.rotation.x = Math.sin(ph * 2 - i * 0.6) * 0.035 * k;
    });
    neckBones.forEach((b, i) => {
      b.rotation.x = Math.sin(ph * 2 + i * 0.5) * 0.035 * k + (d * 0.75) / neckBones.length;
      b.rotation.y = i === neckBones.length - 1 ? Math.sin(t * 0.6 + number) * 0.12 - turn * 0.1 : 0;
    });

    const jawTarget = s.taunt ? 0.5 + Math.sin(t * 20) * 0.1 : fx & FX.overheat ? 0.35 : 0.08 + Math.sin(t * 1.7) * 0.03;
    if (jaw) jaw.rotation.x = lerp(jaw.rotation.x, jawTarget, Math.min(1, dt * 12));

    state.blink -= dt;
    const shut = state.blink < 0.12 || tripped;
    if (state.blink < 0) state.blink = 2.5 + Math.random() * 4;
    const lid = (shut ? LID_SHUT : LID_OPEN) - rig.lidRest;
    for (const e of eyes) e.lid.rotation.x = lerp(e.lid.rotation.x, lid, Math.min(1, dt * 30));

    arms.forEach((arm, i) => {
      const p = ph + (i ? 0 : Math.PI);
      if (arm.userData.wing) {
        const side = i ? 1 : -1;
        const spread = fx & FX.glide ? 0.05 + Math.sin(t * 6) * 0.08 : 1.15 + Math.sin(ph) * 0.18;
        arm.userData.wing.rotation.z = lerp(arm.userData.wing.rotation.z, -side * spread, Math.min(1, dt * 8));
      } else if (s.finished) {
        arm.rotation.x = -1.6 + Math.sin(t * 8 + i) * 0.3;
      } else {
        arm.rotation.x = Math.sin(p) * 0.5 * k - (fx & FX.charge ? 0.6 : 0);
      }
    });
    if (fan) fan.rotation.z += dt * (fx & FX.overheat ? 60 : 30);

    const hot = fx & FX.overheat ? 0.3 + Math.sin(t * 14) * 0.18 : Math.max(0, (s.heat || 0) - 0.75) * 0.5;
    for (const m of hotMats) m.emissiveIntensity = hot;
    setFace(tripped || fx & FX.stun ? 'dizzy' : fx & FX.overheat || s.heat > 0.8 ? 'hot' : 'happy');

    stars.visible = !!(tripped || fx & FX.stun);
    if (stars.visible) {
      stars.children.forEach((st, i) => {
        const aa = t * 5 + (i / 5) * Math.PI * 2;
        st.position.set(Math.cos(aa) * 0.5, 2.9 - state.tripT * 1.9 + Math.sin(aa * 2) * 0.05, Math.sin(aa) * 0.5 + state.tripT * 1.4);
      });
    }
    shield.visible = !!(fx & FX.shield);
    if (shield.visible) shield.material.uniforms.time.value = t;
    spikes.visible = !!(fx & FX.spikes);
    if (spikes.visible) spikes.rotation.y = t * 2;
    bubble(!!s.taunt);

    // Water Blaster: held out front, juddering with the jet
    blaster.visible = !!(fx & FX.spray);
    if (blaster.visible) blaster.rotation.set(-0.08 + Math.sin(t * 40) * 0.02, -0.12, Math.sin(t * 33) * 0.02);
    // Squeaky Mallet: wind up over the shoulder, then smash down on the beat
    // the server lands the bonk (WEAPONS.swingHit of WEAPONS.swing)
    mallet.visible = !!(fx & FX.swing);
    state.swingT = mallet.visible ? state.swingT + dt : 0;
    if (mallet.visible) {
      const k = state.swingT / WEAPONS.swing;
      const hit = WEAPONS.swingHit / WEAPONS.swing;
      mallet.rotation.x = k < hit - 0.1 ? lerp(-0.2, -1.5, k / (hit - 0.1))
        : k < hit + 0.05 ? lerp(-1.5, 1.7, (k - hit + 0.1) / 0.15) : 1.7 - (k - hit - 0.05) * 1.2;
      mallet.rotation.z = -0.35;
    }
    // soaked: darker, glossy fabric that dries off slowly
    const wet = fx & FX.soaked ? 1 : 0;
    const w = lerp(state.wet, wet, Math.min(1, dt * (wet ? 8 : 0.7)));
    if (Math.abs(w - state.wet) > 0.002 || (w === 0 && state.wet !== 0)) setWet(w < 0.005 ? 0 : w);
    state.wet = w < 0.005 ? 0 : w;
  }

  function dispose() {
    fxGroup.traverse((o) => {
      if (o.isSprite && o.material.map !== starMat.map && o !== state.tag) o.material.map?.dispose();
    });
    for (const { tx } of tagCache.values()) tx.dispose();
    rig.dispose();
  }

  return { root, update, setTag, showTag, prewarm, dispose, muzzle, name, hd: rig.hd };
}

export function bubbleMaterial(color) {
  return new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color(color) }, time: { value: 0 } },
    vertexShader: `varying vec3 vN; varying vec3 vV;
      void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }`,
    fragmentShader: `uniform vec3 color; uniform float time; varying vec3 vN; varying vec3 vV;
      void main(){ float f = pow(1.0 - abs(dot(vN, vV)), 2.2);
        float bands = 0.5 + 0.5 * sin(vN.y * 18.0 + time * 4.0);
        gl_FragColor = vec4(color * (0.7 + f), 0.06 + f * 0.75 + bands * 0.05); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
}
