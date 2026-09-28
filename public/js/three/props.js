// Course furniture and dynamic objects: arch, hurdles, water stations, eggs,
// hazards and projectiles. Blender-built versions (Assets group 'props') are
// used when loaded; the procedural ones below are the fallback.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { WEAPONS } from '/shared/data.js';
import { HALF } from './track.js';
import { buildDino } from './dino3d.js';
import * as Assets from './assets.js';
import * as T from './textures.js';

// Meshes each Blender prop must have to be used (else: the procedural one).
const MESHES = {
  arch: ['arch'], log_hurdle: ['log'], bone_hurdle: ['bone', 'stand'], egg: ['egg'], nest: ['nest'],
  peel: ['peel'], tar: ['tar'], bomb: ['bomb'], meteor: ['meteor'], balloon: ['balloon'], hatchling: ['hatchling'],
};
const hdProp = (name) => Assets.withMeshes('props', name, MESHES[name]);

function eggGeometry(w = 0.34, h = 0.46) {
  const pts = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    const a = t * Math.PI;
    const r = Math.sin(a) * w * (1 - 0.18 * Math.cos(a));
    pts.push(new THREE.Vector2(Math.max(0.0001, r), -Math.cos(a) * h));
  }
  return new THREE.LatheGeometry(pts, 28);
}

function spottedEggTexture(base, spot) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = base; g.fillRect(0, 0, 256, 128);
  g.fillStyle = spot;
  for (let i = 0; i < 26; i++) {
    g.beginPath(); g.ellipse((i * 53) % 256, (i * 37) % 128, 6 + (i % 4) * 3, 5 + (i % 3) * 3, i, 0, Math.PI * 2); g.fill();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Props {
  constructor(track, scene) {
    this.track = track;
    this.scene = scene;
    this.root = new THREE.Group();
    scene.add(this.root);
    this.eggMeshes = [];
    this.hazards = new Map();
    this.projectiles = new Map();
    this.mistEmitters = [];
    this.buildStartFinish();
    this.buildMarkers();
    this.buildHurdles();
    this.buildZones();
    this.buildEggs();
    // Instanced props are tiny (cups, mud lumps): keeping them out of the shadow
    // pass also avoids a depth-shader variant compiling mid-race.
    this.root.traverse((o) => { if (o.isInstancedMesh) o.castShadow = false; });
  }

  // ---------------------------------------------------------- start / finish
  buildStartFinish() {
    const { track } = this;
    const checker = new THREE.MeshStandardMaterial({ map: T.checkerTexture(), roughness: 0.8 });
    checker.map = checker.map.clone(); checker.map.repeat.set(1, 1); checker.map.needsUpdate = true;
    this.root.add(track.strip(-0.8, 0.8, -HALF, HALF, 0.035, checker));

    const arch = new THREE.Group();
    const span = HALF + 1.8;
    const hd = hdProp('arch'); // striped air tube with sewn panels + sand bags
    let tube;
    if (hd) {
      tube = new THREE.Mesh(Assets.geometry(hd, 'arch'), Assets.material(hd, { physical: true, clearcoat: 0.6, clearcoatRoughness: 0.3 }));
    } else {
      const tubeMat = new THREE.MeshPhysicalMaterial({ map: T.stripeTexture('#e5484d', '#ffffff', 10), roughness: 0.4, clearcoat: 0.6 });
      tubeMat.map = tubeMat.map.clone(); tubeMat.map.repeat.set(6, 1); tubeMat.map.needsUpdate = true;
      tube = new THREE.Mesh(new THREE.TorusGeometry(span, 0.75, 20, 48, Math.PI), tubeMat);
    }
    const TALL = 1.3; // tall enough that the chase camera sees the grid under it
    tube.scale.set(1, TALL, 1);
    tube.castShadow = true;
    arch.add(tube);
    const bannerTex = T.signTexture('FINISH · 終點', { bg: '#1d1d24', fg: '#ffd84a', w: 1024, h: 160, font: '900 110px system-ui, sans-serif' });
    const banner = new THREE.Mesh(new THREE.BoxGeometry(span * 1.4, 1.4, 0.2), [
      new THREE.MeshStandardMaterial({ color: '#1d1d24' }), new THREE.MeshStandardMaterial({ color: '#1d1d24' }),
      new THREE.MeshStandardMaterial({ color: '#1d1d24' }), new THREE.MeshStandardMaterial({ color: '#1d1d24' }),
      new THREE.MeshStandardMaterial({ map: bannerTex, emissive: '#ffffff', emissiveMap: bannerTex, emissiveIntensity: 0.4 }),
      new THREE.MeshStandardMaterial({ map: bannerTex, emissive: '#ffffff', emissiveMap: bannerTex, emissiveIntensity: 0.4 }),
    ]);
    banner.position.y = span * TALL - 1.3;
    banner.castShadow = true;
    arch.add(banner);
    // start lights
    this.lights = [];
    for (let i = 0; i < 3; i++) {
      const housing = new THREE.Mesh(new RoundedBoxGeometry(0.6, 0.6, 0.4, 3, 0.1), new THREE.MeshStandardMaterial({ color: '#111' }));
      housing.position.set(-0.8 + i * 0.8, span * TALL - 2.4, 0);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.22, 20, 14), new THREE.MeshStandardMaterial({ color: '#220000', emissive: '#ff0000', emissiveIntensity: 0, toneMapped: false }));
      lamp.position.set(0, 0, -0.2); // faces the runners on the grid
      housing.add(lamp);
      arch.add(housing);
      this.lights.push(lamp);
    }
    // giant inflatable T-Rex mascot riding the arch
    this.mascot = buildDino('trex', '#5bbf4a', { number: 1, runner: 'MASCOT' });
    this.mascot.root.scale.setScalar(2.4);
    this.mascot.root.position.set(0, span * TALL + 0.3, 0);
    this.mascot.root.rotation.y = Math.PI;
    arch.add(this.mascot.root);
    // sand bags (part of the Blender arch)
    const bagMat = new THREE.MeshStandardMaterial({ color: '#c2a36b', roughness: 1 });
    for (const s of hd ? [] : [-1, 1]) {
      const bag = new THREE.Mesh(new RoundedBoxGeometry(1, 0.5, 0.7, 3, 0.2), bagMat);
      bag.position.set(s * span, 0.25, 0.9); bag.castShadow = true;
      arch.add(bag);
    }
    track.place(arch, 0, 0, 0);
    this.root.add(arch);
    this.arch = arch;
  }

  setStartLights(time) {
    // three reds during the countdown, all green at GO
    this.lights.forEach((l, i) => {
      const lit = time < 0 && -time <= 3 - i;
      const go = time >= 0 && time < 3;
      l.material.color.set(go ? '#002200' : '#220000');
      l.material.emissive.set(go ? '#22ff44' : '#ff1010');
      l.material.emissiveIntensity = go || lit ? 1.4 : 0;
    });
  }

  buildMarkers() {
    const { track } = this;
    const post = new THREE.MeshStandardMaterial({ color: '#dddddd', metalness: 0.4, roughness: 0.4 });
    for (let m = 50; m < track.length; m += 50) {
      const g = new THREE.Group();
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.2), post);
      p.position.y = 1.1;
      const tex = T.signTexture(`${m} m`, { bg: '#ffffff', fg: '#e5484d', w: 256, h: 128, font: '900 72px system-ui, sans-serif' });
      const sign = new THREE.Mesh(new RoundedBoxGeometry(1.4, 0.7, 0.08, 2, 0.05), [
        post, post, post, post,
        new THREE.MeshStandardMaterial({ map: tex }), new THREE.MeshStandardMaterial({ map: tex }),
      ]);
      sign.position.y = 2.1;
      g.add(p, sign);
      g.traverse((o) => { o.castShadow = o.isMesh; });
      track.place(g, m, HALF + 2.2, 0);
      g.rotateY(Math.PI);
      this.root.add(g);
    }
  }

  // --------------------------------------------------------------- hurdles
  buildHurdles() {
    const { track } = this;
    const theme = track.theme;
    const len = HALF * 2 + 0.6;
    const hdLog = theme === 'jungle' && hdProp('log_hurdle');
    const hdBone = theme !== 'jungle' && hdProp('bone_hurdle');
    const volcanic = theme === 'volcano';
    let hdParts = null;
    if (hdLog) hdParts = [[Assets.geometry(hdLog, 'log'), Assets.material(hdLog)]];
    if (hdBone) {
      // the volcano's bones are scorched and glow faintly
      const boneMat = Assets.material(hdBone, volcanic ? { color: '#4a3a34', emissive: '#ff4a10', emissiveIntensity: 0.25 } : {});
      if (volcanic) boneMat.emissiveMap = null;
      hdParts = [[Assets.geometry(hdBone, 'bone'), boneMat], [Assets.geometry(hdBone, 'stand'), Assets.material(hdBone)]];
    }
    for (const x of track.course.hurdles) {
      const g = new THREE.Group();
      if (hdParts) {
        for (const [geom, mat] of hdParts) g.add(new THREE.Mesh(geom, mat));
      } else if (theme === 'jungle') {
        const log = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.32, len, 14), new THREE.MeshStandardMaterial({ map: T.barkTexture(), roughness: 1 }));
        log.rotation.z = Math.PI / 2; log.position.y = 0.28;
        g.add(log);
        for (const s of [-1, 1]) {
          const end = new THREE.Mesh(new THREE.CircleGeometry(0.3, 14), new THREE.MeshStandardMaterial({ color: '#c79a62' }));
          end.position.set(s * len / 2, 0.28, 0); end.rotation.y = s * Math.PI / 2; g.add(end);
        }
        for (let i = 0; i < 6; i++) {
          const moss = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6), new THREE.MeshStandardMaterial({ color: '#5d8a34', roughness: 1 }));
          moss.position.set(-len / 2 + (i + 0.5) * (len / 6), 0.52, (i % 2 - 0.5) * 0.15); moss.scale.set(1.6, 0.4, 1);
          g.add(moss);
        }
      } else {
        // a giant fossil bone on two little trestles
        const bone = new THREE.MeshStandardMaterial({ color: volcanic ? '#3a2d2a' : '#efe4c9', roughness: 0.55, emissive: volcanic ? '#ff4a10' : '#000000', emissiveIntensity: volcanic ? 0.25 : 0 });
        const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, len - 0.6, 14), bone);
        shaft.rotation.z = Math.PI / 2; shaft.position.y = 0.5;
        g.add(shaft);
        for (const s of [-1, 1]) {
          for (const dz of [-0.14, 0.14]) {
            const knob = new THREE.Mesh(new THREE.SphereGeometry(0.24, 16, 12), bone);
            knob.position.set(s * (len / 2 - 0.3), 0.5, dz);
            g.add(knob);
          }
          const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.5, 0.5), new THREE.MeshStandardMaterial({ color: '#6b6f78', metalness: 0.5 }));
          leg.position.set(s * (len / 2 - 0.8), 0.25, 0);
          g.add(leg);
        }
      }
      g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      track.place(g, x, 0, 0);
      this.root.add(g);
    }
  }

  // ------------------------------------------------------ water / mud zones
  buildZones() {
    const { track } = this;
    const waterMat = new THREE.MeshStandardMaterial({ color: '#3aa0ff', transparent: true, opacity: 0.35, roughness: 0.05, metalness: 0.2 });
    const tentMat = new THREE.MeshStandardMaterial({ map: T.stripeTexture('#2f80ed', '#ffffff', 8), roughness: 0.6, side: THREE.DoubleSide });
    const tableMat = new THREE.MeshStandardMaterial({ color: '#f2f2f2', roughness: 0.5 });
    // (no `transmission`: it makes three.js re-render the whole scene into an extra buffer)
    const cupMat = new THREE.MeshStandardMaterial({ color: '#bfe3ff', roughness: 0.1, transparent: true, opacity: 0.7 });
    const archMat = new THREE.MeshPhysicalMaterial({ map: T.stripeTexture('#2f80ed', '#bfe3ff', 10), roughness: 0.4, clearcoat: 0.6 });
    for (const [a, b] of track.course.water) {
      this.root.add(track.strip(a, b, -HALF, HALF, 0.03, waterMat));
      const mid = (a + b) / 2;
      // tent + table of cups on the right
      for (const x of [a + 3, b - 3]) {
        const tent = new THREE.Group();
        const roof = new THREE.Mesh(new THREE.ConeGeometry(2.6, 1.4, 4, 1, true), tentMat);
        roof.position.y = 3.1; roof.rotation.y = Math.PI / 4;
        tent.add(roof);
        for (const [px, pz] of [[-1.8, -1.8], [1.8, -1.8], [-1.8, 1.8], [1.8, 1.8]]) {
          const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 2.4), tableMat);
          pole.position.set(px, 1.2, pz); tent.add(pole);
        }
        const table = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.08, 0.9), tableMat);
        table.position.set(0, 0.9, -0.9); tent.add(table);
        const cup = new THREE.CylinderGeometry(0.05, 0.04, 0.12, 10);
        const cups = new THREE.InstancedMesh(cup, cupMat, 24);
        const d = new THREE.Object3D();
        for (let i = 0; i < 24; i++) { d.position.set(-1.4 + (i % 12) * 0.25, 1.0, -1.1 + Math.floor(i / 12) * 0.3); d.updateMatrix(); cups.setMatrixAt(i, d.matrix); }
        tent.add(cups);
        for (const bx of [-1.2, 1.2]) {
          const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.9, 16), new THREE.MeshStandardMaterial({ color: '#1f6fd6', roughness: 0.3 }));
          barrel.position.set(bx, 0.45, 0.6); tent.add(barrel);
        }
        tent.traverse((o) => { if (o.isMesh) o.castShadow = true; });
        track.place(tent, x, HALF + 3.6, 0);
        tent.rotateY(Math.PI / 2);
        this.root.add(tent);
      }
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 0.9), new THREE.MeshStandardMaterial({
        map: T.signTexture('💧 WATER · 補給站', { bg: '#2f80ed', fg: '#ffffff', w: 512, h: 128, font: 'bold 54px system-ui, sans-serif' }), side: THREE.DoubleSide,
      }));
      // misting arch over the track (cools you, visually at least)
      const mist = new THREE.Group();
      const tube = new THREE.Mesh(new THREE.TorusGeometry(HALF + 1.2, 0.35, 12, 40, Math.PI), archMat);
      tube.castShadow = true;
      mist.add(tube);
      sign.position.y = HALF + 0.3;
      sign.rotation.y = Math.PI; // readable by runners approaching from behind
      mist.add(sign);
      track.place(mist, mid, 0, 0);
      this.root.add(mist);
      this.mistEmitters.push({ x: mid });
    }
    const mudMat = new THREE.MeshPhysicalMaterial({ color: '#4a3220', roughness: 0.25, clearcoat: 0.8, clearcoatRoughness: 0.2 });
    const lumpMat = new THREE.MeshStandardMaterial({ color: '#5a3d24', roughness: 0.6 });
    for (const [a, b] of track.course.mud) {
      this.root.add(track.strip(a, b, -HALF - 0.4, HALF + 0.4, 0.04, mudMat));
      const lumps = new THREE.InstancedMesh(new THREE.SphereGeometry(0.3, 10, 6), lumpMat, 40);
      const d = new THREE.Object3D();
      for (let i = 0; i < 40; i++) {
        const o = track.pose(a + ((i * 37) % 100) / 100 * (b - a), 0.4 + ((i * 53) % 100) / 100 * 5.2);
        d.position.copy(o.p); d.position.y += 0.02;
        d.scale.set(1 + (i % 3) * 0.5, 0.25, 0.8 + (i % 2) * 0.4);
        d.rotation.y = i;
        d.updateMatrix();
        lumps.setMatrixAt(i, d.matrix);
      }
      lumps.receiveShadow = true;
      this.root.add(lumps);
    }
  }

  // ------------------------------------------------------------------ eggs
  buildEggs() {
    const { track } = this;
    const hdEgg = hdProp('egg');
    const hdNest = hdProp('nest');
    const geom = hdEgg ? Assets.geometry(hdEgg, 'egg') : eggGeometry();
    const nestGeom = hdNest ? Assets.geometry(hdNest, 'nest') : new THREE.TorusGeometry(0.3, 0.08, 8, 18);
    const nestMat = hdNest ? Assets.material(hdNest) : new THREE.MeshStandardMaterial({ map: T.barkTexture(), color: '#f0d9a0', roughness: 1 });
    const qTex = T.signTexture('?', { bg: 'rgba(0,0,0,0)', fg: '#ffffff', w: 128, h: 128, font: '900 110px system-ui, sans-serif' });
    const qMat = new THREE.SpriteMaterial({ map: qTex, depthWrite: false });
    const shell = { clearcoat: 1, iridescence: 1, iridescenceIOR: 1.6, iridescenceThicknessRange: [200, 800] };
    track.course.eggs.forEach((e, i) => {
      const hue = (i * 0.137) % 1;
      const color = new THREE.Color().setHSL(hue, 0.75, 0.68);
      const mat = hdEgg
        ? Assets.material(hdEgg, { physical: true, color, ...shell })
        : new THREE.MeshPhysicalMaterial({ color, roughness: 0.15, map: spottedEggTexture('#ffffff', '#d8d8d8'), ...shell });
      const egg = new THREE.Mesh(geom, mat);
      egg.castShadow = true;
      const q = new THREE.Sprite(qMat);
      q.scale.setScalar(0.42);
      this.root.add(q);
      const nest = new THREE.Mesh(nestGeom, nestMat);
      if (!hdNest) nest.rotation.x = -Math.PI / 2; // the Blender nest is modelled lying flat
      const o = track.pose(e.x, e.y);
      nest.position.copy(o.p); nest.position.y += 0.1;
      nest.receiveShadow = true;
      this.root.add(nest, egg);
      this.eggMeshes.push({ egg, q, base: o.p.clone(), hidden: false, pop: 1, phase: i * 1.3 });
    });
  }

  updateEggs(hidden, t, dt, camera) {
    const toCam = new THREE.Vector3();
    this.eggMeshes.forEach((m, i) => {
      const h = hidden.has(i);
      m.pop = THREE.MathUtils.lerp(m.pop, h ? 0 : 1, Math.min(1, dt * (h ? 18 : 6)));
      m.egg.visible = m.pop > 0.02;
      m.egg.position.copy(m.base);
      m.egg.position.y += 0.75 + Math.sin(t * 2.5 + m.phase) * 0.12;
      m.egg.rotation.y = t * 1.6 + m.phase;
      m.egg.rotation.z = Math.sin(t * 2 + m.phase) * 0.2;
      m.egg.scale.setScalar(m.pop * (1 + Math.sin(t * 6 + m.phase) * 0.03));
      // the "?" floats on the side of the egg facing the camera
      toCam.copy(camera.position).sub(m.egg.position).normalize();
      m.q.position.copy(m.egg.position).addScaledVector(toCam, 0.42 * m.pop);
      m.q.visible = m.egg.visible;
      m.q.scale.setScalar(0.42 * m.pop);
    });
  }

  // --------------------------------------------------------------- hazards
  syncHazards(list, t) {
    const seen = new Set();
    for (const h of list) {
      seen.add(h.id);
      let m = this.hazards.get(h.id);
      if (!m) {
        m = this.template(h.type === 'peel' ? 'peel' : 'tar').clone();
        this.root.add(m);
        this.hazards.set(h.id, m);
        m.userData.born = t;
      }
      const o = this.track.pose(h.x, h.y);
      m.position.copy(o.p); m.position.y += 0.04;
      const grow = Math.min(1, (t - m.userData.born) * 4);
      m.scale.setScalar(grow);
      if (h.type === 'tar') m.children.forEach((b, i) => { if (i > 0) { const k = (t * 0.6 + i * 0.37) % 1; b.position.y = 0.02 + k * 0.1; b.scale.setScalar(Math.sin(k * Math.PI) * 0.12 + 0.01); } });
    }
    for (const [id, m] of this.hazards) {
      if (!seen.has(id)) { this.root.remove(m); this.hazards.delete(id); }
    }
  }

  // Hazards and projectiles are built once and cloned (sharing geometry and
  // materials), so a mid-race appearance never compiles or uploads anything.
  template(kind) {
    this.tpl ||= {};
    if (!this.tpl[kind]) {
      const make = {
        peel: () => this.makePeel(), tar: () => this.makeTar(), bomb: () => this.makeBomb().obj,
        meteor: () => this.makeMeteor().obj, ring: () => this.makeMeteor().ring,
        balloon: () => this.makeBalloon(), hatch: () => this.makeHatchling(), marker: () => this.makeMarker(),
      }[kind];
      this.tpl[kind] = make();
    }
    return this.tpl[kind];
  }

  // Temporarily place one of everything so the renderer can prepare it.
  prewarm() {
    const o = this.track.pose(4, 3);
    const temps = ['peel', 'tar', 'bomb', 'meteor', 'ring', 'balloon', 'hatch', 'marker'].map((k, i) => {
      const m = this.template(k).clone();
      m.position.copy(o.p).addScaledVector(o.r, i - 2);
      m.position.y += 0.5;
      this.root.add(m);
      return m;
    });
    return () => temps.forEach((m) => this.root.remove(m));
  }

  makePeel() {
    const g = new THREE.Group();
    const hd = hdProp('peel');
    if (hd) {
      g.add(new THREE.Mesh(Assets.geometry(hd, 'peel'), Assets.material(hd, { side: THREE.DoubleSide })));
      return g;
    }
    const leafShape = new THREE.Shape();
    leafShape.moveTo(0, 0); leafShape.quadraticCurveTo(0.22, 0.35, 0, 0.8); leafShape.quadraticCurveTo(-0.22, 0.35, 0, 0);
    const leaf = new THREE.ShapeGeometry(leafShape, 8);
    const mat = new THREE.MeshStandardMaterial({ color: '#46a83a', roughness: 0.35, side: THREE.DoubleSide });
    const rib = new THREE.MeshStandardMaterial({ color: '#b8e27a' });
    for (let i = 0; i < 5; i++) {
      const l = new THREE.Mesh(leaf, mat);
      l.rotation.set(-Math.PI / 2 + 0.25, 0, (i / 5) * Math.PI * 2);
      l.position.y = 0.02 + i * 0.005;
      const r = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.7, 0.01), rib);
      r.position.y = 0.38; l.add(r);
      g.add(l);
    }
    return g;
  }

  makeTar() {
    const g = new THREE.Group();
    const hd = hdProp('tar');
    let pit;
    if (hd) {
      // lumpy glossy puddle; children after the first are the animated bubbles
      // glossy but black: damp the sky reflection or it reads as a silver puddle
      pit = new THREE.Mesh(Assets.geometry(hd, 'tar'), Assets.material(hd, { physical: true, clearcoat: 1, clearcoatRoughness: 0.08, envMapIntensity: 0.35 }));
    } else {
      pit = new THREE.Mesh(new THREE.CircleGeometry(1, 28), new THREE.MeshPhysicalMaterial({ color: '#0b0a0c', roughness: 0.05, clearcoat: 1, metalness: 0.2 }));
      pit.rotation.x = -Math.PI / 2;
      pit.scale.set(1.5, 1.1, 1);
    }
    g.add(pit);
    for (let i = 0; i < 5; i++) {
      const b = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), new THREE.MeshPhysicalMaterial({ color: '#141216', roughness: 0.05, clearcoat: 1 }));
      b.position.set(Math.cos(i * 2.1) * 0.8, 0.03, Math.sin(i * 2.1) * 0.5);
      g.add(b);
    }
    return g;
  }

  // ----------------------------------------------------------- projectiles
  syncProjectiles(list, t, fx) {
    const seen = new Set();
    for (const p of list) {
      seen.add(p.id);
      let m = this.projectiles.get(p.id);
      if (!m) {
        m = {
          egg: () => ({ obj: this.template('bomb').clone() }),
          balloon: () => ({ obj: this.template('balloon').clone(), ring: this.template('marker').clone() }),
          hatch: () => ({ obj: this.template('hatch').clone(), seed: p.id * 1.7 }),
          meteor: () => ({ obj: this.template('meteor').clone(), ring: this.template('ring').clone() }),
        }[p.type]?.();
        if (!m) continue;
        this.root.add(m.obj);
        if (m.ring) this.root.add(m.ring);
        this.projectiles.set(p.id, m);
      }
      const o = this.track.pose(p.x, p.y);
      if (p.type === 'egg') {
        m.obj.position.copy(o.p); m.obj.position.y += 1.1 + Math.abs(Math.sin(t * 9)) * 0.2;
        m.obj.rotation.x = t * 20;
        fx.emit('spark', m.obj.position, 1, { spread: 0.1 });
      } else if (p.type === 'balloon') {
        // a lob: up from the thrower's hands, over the pack, down on the marker
        const k = 1 - Math.max(0, p.delay) / WEAPONS.balloonFlight;
        m.obj.position.copy(o.p);
        m.obj.position.y += 1.4 - 1.0 * k + 12.8 * k * (1 - k);
        m.obj.rotation.set(t * 5, t * 3, Math.sin(t * 11) * 0.3);
        const wob = 1 + Math.sin(t * 16) * 0.08;
        m.obj.scale.set(wob, 2 - wob, wob);
        const land = this.track.pose(p.tx, p.ty);
        m.ring.position.copy(land.p); m.ring.position.y += 0.07;
        const pulse = 1 + Math.sin(t * 14) * 0.1;
        m.ring.scale.setScalar(1.6 * pulse);
        m.ring.lookAt(m.ring.position.clone().add(new THREE.Vector3(0, 1, 0)));
      } else if (p.type === 'hatch') {
        // a baby raptor scurrying along the track: bobbing, waddling, facing ahead
        m.obj.position.copy(o.p);
        m.obj.position.y += Math.abs(Math.sin(t * 20 + m.seed)) * 0.1;
        m.obj.lookAt(m.obj.position.clone().add(o.t));
        m.obj.rotateZ(Math.sin(t * 20 + m.seed) * 0.18);
        if (Math.random() < 0.3) fx.emit('dust', o.p.clone().add(new THREE.Vector3(0, 0.05, 0)), 1, { spread: 0.1 });
      } else {
        m.ring.position.copy(o.p); m.ring.position.y += 0.06;
        const pulse = 1 + Math.sin(t * 18) * 0.08;
        m.ring.scale.set(2.2 * pulse, 1.6 * pulse, 1);
        m.ring.lookAt(m.ring.position.clone().add(new THREE.Vector3(0, 1, 0)));
        const f = Math.max(0, p.delay) / 2.2;
        m.obj.position.copy(o.p).add(new THREE.Vector3(f * 40, 2 + f * 90, -f * 20));
        m.obj.rotation.x += 0.1; m.obj.rotation.y += 0.07;
        fx.emit('fire', m.obj.position, 3, { spread: 0.8 });
        fx.emit('smoke', m.obj.position, 1, { spread: 0.8 });
      }
    }
    for (const [id, m] of this.projectiles) {
      if (!seen.has(id)) { this.root.remove(m.obj); if (m.ring) this.root.remove(m.ring); this.projectiles.delete(id); }
    }
  }

  // Water Balloon: a knotted, glossy, slightly see-through latex balloon.
  makeBalloon() {
    const hd = hdProp('balloon');
    if (hd) {
      const m = new THREE.Mesh(Assets.geometry(hd, 'balloon'), Assets.material(hd, { physical: true, clearcoat: 1, clearcoatRoughness: 0.1, transparent: true, opacity: 0.9 }));
      m.castShadow = true;
      return m;
    }
    const g = new THREE.Group();
    const mat = new THREE.MeshPhysicalMaterial({ color: '#4aa8ff', roughness: 0.15, clearcoat: 1, transparent: true, opacity: 0.85 });
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.24, 20, 14), mat);
    body.scale.set(1, 1.15, 1);
    const knot = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.08, 8), mat);
    knot.position.y = -0.3;
    g.add(body, knot);
    return g;
  }

  // Where the balloon will land: a pulsing blue target on the track.
  makeMarker() {
    return new THREE.Mesh(new THREE.RingGeometry(0.75, 1, 40), new THREE.MeshBasicMaterial({ color: '#4aa8ff', transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }));
  }

  // Raptor Hatchling: a baby inflatable raptor with bits of eggshell on its head.
  makeHatchling() {
    const hd = hdProp('hatchling');
    if (hd) {
      const m = new THREE.Mesh(Assets.geometry(hd, 'hatchling'), Assets.material(hd, { physical: true, sheen: 0.6, clearcoat: 0.3 }));
      m.castShadow = true;
      return m;
    }
    const g = new THREE.Group();
    const skin = new THREE.MeshPhysicalMaterial({ color: '#f2a93b', roughness: 0.5, sheen: 0.6 });
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 12), skin); body.position.y = 0.3; body.scale.set(1, 0.9, 1.3);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 16, 12), skin); head.position.set(0, 0.52, 0.2);
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.35, 10), skin); tail.rotation.x = -Math.PI / 2 - 0.3; tail.position.set(0, 0.32, -0.35);
    const shell = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2.4), new THREE.MeshStandardMaterial({ color: '#fbf4e2', roughness: 0.6, side: THREE.DoubleSide }));
    shell.position.set(0, 0.56, 0.2);
    g.add(body, head, tail, shell);
    return g;
  }

  makeBomb() {
    const hd = hdProp('bomb');
    if (hd) {
      const obj = new THREE.Mesh(Assets.geometry(hd, 'bomb'), Assets.material(hd, { emissive: '#ff8a2a', emissiveIntensity: 2.5 }));
      obj.castShadow = true;
      return { obj };
    }
    const egg = new THREE.Mesh(eggGeometry(0.22, 0.3), new THREE.MeshPhysicalMaterial({ map: spottedEggTexture('#fbf4e2', '#e5484d'), roughness: 0.3, clearcoat: 0.8 }));
    egg.castShadow = true;
    const fuse = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.2), new THREE.MeshStandardMaterial({ color: '#333' }));
    fuse.position.y = 0.38; egg.add(fuse);
    return { obj: egg };
  }

  makeMeteor() {
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 40), new THREE.MeshBasicMaterial({ color: '#ff2a10', transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }));
    const hd = hdProp('meteor');
    if (hd) {
      // basalt with molten cracks: the glow mask drives the bloom
      return { obj: new THREE.Mesh(Assets.geometry(hd, 'meteor'), Assets.material(hd, { emissive: '#ff6a1a', emissiveIntensity: 3 })), ring };
    }
    const geom = new THREE.IcosahedronGeometry(1.2, 2);
    const p = geom.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const k = 1 + Math.sin(p.getX(i) * 5) * Math.cos(p.getY(i) * 4) * 0.15;
      p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k);
    }
    geom.computeVertexNormals();
    const rock = new THREE.Mesh(geom, new THREE.MeshStandardMaterial({ color: '#3a2620', emissive: '#ff5a10', emissiveIntensity: 0.9, roughness: 0.8, flatShading: true }));
    return { obj: rock, ring };
  }
}
