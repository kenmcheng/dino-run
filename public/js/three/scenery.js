// Themed environments: sky, lighting, ground and all the set dressing.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { HALF } from './track.js';
import * as T from './textures.js';

// sunDir: direction *towards* the sun (also drives the directional light).
const THEMES = {
  stadium: {
    fog: '#b9d3e6', fogD: 0.0016, sun: '#fff1d6', sunI: 2.5, hemi: ['#cfe6ff', '#5d7a44', 0.75], env: 0.5,
    sunDir: [0.55, 0.42, 0.35], sky: { turbidity: 2.5, rayleigh: 1.1, mie: 0.004, g: 0.8, clouds: 0.35, exposure: 0.42 },
  },
  jungle: {
    fog: '#94b88c', fogD: 0.0055, sun: '#ffe9b8', sunI: 2.3, hemi: ['#e2f2c8', '#34502a', 0.8], env: 0.45,
    sunDir: [-0.4, 0.5, 0.45], sky: { turbidity: 6, rayleigh: 1.8, mie: 0.008, g: 0.85, clouds: 0.55, exposure: 0.4 },
  },
  volcano: {
    top: '#1a0d14', bottom: '#b8482a', fog: '#4a2020', fogD: 0.007, sun: '#ffb070', sunI: 1.5, hemi: ['#ff9a6a', '#2a0f0f', 0.8], env: 0.35,
    sunDir: [0.3, 0.35, -0.6],
  },
};

function physicalSky(th) {
  const sky = new Sky();
  sky.scale.setScalar(2800);
  const u = sky.material.uniforms;
  u.turbidity.value = th.sky.turbidity;
  u.rayleigh.value = th.sky.rayleigh;
  u.mieCoefficient.value = th.sky.mie;
  u.mieDirectionalG.value = th.sky.g;
  u.cloudCoverage.value = th.sky.clouds;
  u.cloudDensity.value = 0.55;
  u.sunPosition.value.set(...th.sunDir).normalize();
  // The Sky shader is calibrated for ~0.5 exposure; the rest of our scene is
  // lit for 1.0, so scale the sky down or it floods everything (and bloom).
  u.skyExposure = { value: th.sky.exposure };
  sky.material.fragmentShader = 'uniform float skyExposure;\n' + sky.material.fragmentShader
    .replace('gl_FragColor = vec4( texColor, 1.0 );', 'gl_FragColor = vec4( texColor * skyExposure, 1.0 );');
  sky.userData.sky = true;
  return sky;
}

// Gentle wind sway for instanced foliage, driven on the GPU. Taller parts of
// each instance move more; every instance gets its own phase.
export function windy(mat, clock, strength = 0.12, height = 2) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = clock;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float wph = instanceMatrix[3][0] * 0.31 + instanceMatrix[3][2] * 0.17;
        float wk = clamp(position.y / ${height.toFixed(2)}, 0.0, 1.0);
        wk *= wk;
        transformed.x += (sin(uTime * 1.6 + wph) * 0.7 + sin(uTime * 3.7 + wph * 2.3) * 0.3) * ${strength.toFixed(3)} * wk;
        transformed.z += cos(uTime * 1.3 + wph) * ${(strength * 0.6).toFixed(3)} * wk;`);
  };
  // distinct strengths must compile distinct programs
  mat.customProgramCacheKey = () => `wind-${strength}-${height}`;
  return mat;
}

// A clump of grass blades.
function grassGeom() {
  const blades = [];
  for (let i = 0; i < 5; i++) {
    const b = new THREE.PlaneGeometry(0.06, 0.42, 1, 2);
    const p = b.attributes.position;
    for (let v = 0; v < p.count; v++) {
      const y = p.getY(v) + 0.21;
      p.setX(v, p.getX(v) * (1 - y / 0.46));
      p.setZ(v, y * y * 0.6);
      p.setY(v, y);
    }
    b.rotateY((i / 5) * Math.PI * 2 + i);
    b.translate(Math.cos(i * 2.4) * 0.08, 0, Math.sin(i * 2.4) * 0.08);
    b.scale(1, 0.7 + (i % 3) * 0.25, 1);
    blades.push(b);
  }
  return mergeGeometries(blades);
}

function rng(seed) { let s = seed; return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; }; }

function skyDome(th) {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: { top: { value: new THREE.Color(th.top) }, bottom: { value: new THREE.Color(th.bottom) }, sunDir: { value: new THREE.Vector3(0.4, 0.5, 0.3).normalize() } },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform vec3 top; uniform vec3 bottom; uniform vec3 sunDir; varying vec3 vP;
      void main(){ float h = clamp(vP.y * 1.6 + 0.1, 0.0, 1.0);
        vec3 c = mix(bottom, top, pow(h, 0.7));
        float sun = pow(max(dot(vP, sunDir), 0.0), 220.0) * 3.0 + pow(max(dot(vP, sunDir), 0.0), 8.0) * 0.25;
        gl_FragColor = vec4(c + vec3(1.0, 0.9, 0.7) * sun, 1.0); }`,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(1400, 32, 16), mat);
  m.renderOrder = -1;
  m.userData.sky = true;
  return m;
}

function clouds(r, theme) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: theme === 'volcano' ? '#3a2a2a' : '#ffffff', roughness: 1, flatShading: true, transparent: theme === 'volcano', opacity: 0.85 });
  const parts = [];
  for (let i = 0; i < 7; i++) {
    const s = new THREE.IcosahedronGeometry(1, 1);
    s.scale(8 + r() * 6, 5 + r() * 3, 7 + r() * 4);
    s.translate(i * 7 - 20, r() * 3, r() * 6 - 3);
    parts.push(s);
  }
  const geom = mergeGeometries(parts);
  for (let i = 0; i < 14; i++) {
    const c = new THREE.Mesh(geom, mat);
    const a = r() * Math.PI * 2; const d = 250 + r() * 500;
    c.position.set(Math.cos(a) * d, 90 + r() * 90, Math.sin(a) * d);
    c.rotation.y = r() * 3;
    c.scale.setScalar(0.8 + r() * 1.4);
    g.add(c);
  }
  g.userData.drift = true;
  return g;
}

// Low-poly person used for the stadium crowd (body, head, and optional dino hat).
function crowdGeoms() {
  const body = new THREE.CylinderGeometry(0.2, 0.26, 0.62, 6, 1, true); body.translate(0, 0.31, 0);
  const arms = new THREE.BoxGeometry(0.72, 0.1, 0.1); arms.translate(0, 0.5, 0.05);
  const head = new THREE.IcosahedronGeometry(0.14, 0); head.translate(0, 0.78, 0);
  const hat = new THREE.ConeGeometry(0.15, 0.22, 7); hat.translate(0, 0.95, 0);
  const snout = new THREE.BoxGeometry(0.12, 0.08, 0.14); snout.translate(0, 0.9, 0.12);
  return { body: mergeGeometries([body, arms]), head, hat: mergeGeometries([hat.toNonIndexed(), snout.toNonIndexed()]) };
}

// Crowd bounce: done on the GPU per instance so thousands of fans cost nothing.
function bouncy(mat, clock) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = clock;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float ph = instanceMatrix[3][0] * 1.7 + instanceMatrix[3][2] * 0.9;
        transformed.y += max(0.0, sin(uTime * 7.0 + ph)) * 0.22 * step(0.35, fract(ph * 0.13));`);
  };
  return mat;
}

function palmGeoms() {
  const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.5, 3, 0), new THREE.Vector3(1.4, 6, 0), new THREE.Vector3(2.4, 8.4, 0)]);
  const trunk = new THREE.TubeGeometry(curve, 12, 0.26, 7);
  const leaves = [];
  for (let i = 0; i < 8; i++) {
    const leaf = new THREE.PlaneGeometry(0.9, 4.2, 1, 6);
    const pos = leaf.attributes.position;
    for (let v = 0; v < pos.count; v++) {
      const y = pos.getY(v) + 2.1;
      pos.setZ(v, -(y * y) * 0.09);
      pos.setX(v, pos.getX(v) * (1 - y / 5));
      pos.setY(v, y);
    }
    leaf.rotateX(-1.1);
    leaf.rotateY((i / 8) * Math.PI * 2);
    leaf.translate(2.4, 8.4, 0);
    leaves.push(leaf);
  }
  return { trunk, fronds: mergeGeometries(leaves) };
}

function treeGeoms(r) {
  const trunk = new THREE.CylinderGeometry(0.35, 0.6, 9, 8); trunk.translate(0, 4.5, 0);
  const blobs = [];
  for (let i = 0; i < 5; i++) {
    const b = new THREE.IcosahedronGeometry(2.2 + r() * 1.2, 1);
    b.translate((r() - 0.5) * 3.5, 8.5 + r() * 2.5, (r() - 0.5) * 3.5);
    blobs.push(b);
  }
  return { trunk, canopy: mergeGeometries(blobs) };
}

function fernGeom() {
  const fronds = [];
  for (let i = 0; i < 9; i++) {
    const f = new THREE.PlaneGeometry(0.5, 1.8, 1, 5);
    const pos = f.attributes.position;
    for (let v = 0; v < pos.count; v++) {
      const y = pos.getY(v) + 0.9;
      pos.setZ(v, (y * y) * 0.28);
      pos.setX(v, pos.getX(v) * Math.sin((y / 1.8) * Math.PI) * 1.2);
      pos.setY(v, y);
    }
    f.rotateX(-0.5 - (i % 3) * 0.15);
    f.rotateY((i / 9) * Math.PI * 2);
    fronds.push(f);
  }
  return mergeGeometries(fronds);
}

function instanced(geom, mat, transforms, colors) {
  const m = new THREE.InstancedMesh(geom, mat, transforms.length);
  const d = new THREE.Object3D();
  transforms.forEach((t, i) => {
    d.position.copy(t.p); d.rotation.set(t.rx || 0, t.ry || 0, t.rz || 0); d.scale.setScalar(t.s || 1);
    if (t.sv) d.scale.copy(t.sv);
    d.updateMatrix();
    m.setMatrixAt(i, d.matrix);
    if (colors) m.setColorAt(i, colors[i]);
  });
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

// Scatter points around the course that keep clear of the track.
function scatter(track, n, minD, maxD, r) {
  const out = [];
  let guard = 0;
  while (out.length < n && guard++ < n * 30) {
    const i = Math.floor(r() * track.n);
    const p = track.pos[i];
    const side = r() < 0.5 ? -1 : 1;
    const d = minD + r() * (maxD - minD);
    const q = p.clone().addScaledVector(track.right[i], side * d);
    if (track.distToTrack(q.x, q.z) < minD) continue;
    // follow the embankment that slopes from raised track down to the ground
    q.y = Math.max(0, p.y * (1 - Math.max(0, d - HALF - 1.2) / 12.8)) - 0.05;
    out.push(q);
  }
  return out;
}

export function buildScenery(track, clock, { grass = 1 } = {}) {
  const theme = track.theme;
  const th = THEMES[theme];
  const r = rng(theme.length * 7919);
  const root = new THREE.Group();
  const anim = [];

  if (th.sky) {
    const sky = physicalSky(th);
    root.add(sky);
    anim.push({ sky: sky.material.uniforms });
  } else {
    root.add(skyDome(th));
    root.add(clouds(r, theme));
  }

  const ground = new THREE.Mesh(new THREE.CircleGeometry(1300, 64), new THREE.MeshStandardMaterial({ map: T.groundTexture(theme), roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.06;
  ground.receiveShadow = true;
  root.add(ground);

  if (theme === 'stadium') buildStadium(track, root, r, clock, anim);
  if (theme === 'jungle') buildJungle(track, root, r, clock, anim);
  if (theme === 'volcano') buildVolcano(track, root, r, clock, anim);

  // grass clumps hugging the track edges, swaying in the wind
  if (theme !== 'volcano' && grass > 0) {
    const n = Math.round((theme === 'jungle' ? 9000 : 5000) * grass);
    const spots = scatter(track, n, HALF + 1.3, HALF + (theme === 'jungle' ? 16 : 4.5), r)
      .map((p) => ({ p, ry: r() * 6.28, s: 0.7 + r() * 0.8 }));
    const cols = spots.map(() => new THREE.Color().setHSL(0.22 + r() * 0.08, 0.45 + r() * 0.2, 0.3 + r() * 0.14));
    const mat = windy(new THREE.MeshStandardMaterial({ roughness: 0.9, side: THREE.DoubleSide }), clock, 0.08, 0.45);
    const g = instanced(grassGeom(), mat, spots, cols);
    g.castShadow = false;
    root.add(g);
  }

  // big scenery never casts into the (camera-following) shadow map: it is
  // one instanced draw spanning the whole course and would be re-rendered
  // there every frame
  root.traverse((o) => { if (o.isInstancedMesh) o.castShadow = false; });

  return { root, theme: th, anim };
}

// ------------------------------------------------------------------ stadium
function buildStadium(track, root, r, clock, anim) {
  // football pitch in the infield
  const pitch = new THREE.Mesh(new THREE.PlaneGeometry(100, 64), new THREE.MeshStandardMaterial({ map: T.pitchTexture(), roughness: 0.95 }));
  pitch.rotation.x = -Math.PI / 2; pitch.position.y = 0.01; pitch.receiveShadow = true;
  root.add(pitch);
  // goals
  const white = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.4 });
  for (const s of [-1, 1]) {
    const goal = new THREE.Group();
    for (const z of [-3.66, 3.66]) { const p = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.44), white); p.position.set(0, 1.22, z); goal.add(p); }
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 7.32), white); bar.rotation.x = Math.PI / 2; bar.position.y = 2.44; goal.add(bar);
    const net = new THREE.Mesh(new THREE.PlaneGeometry(7.32, 2.44), new THREE.MeshStandardMaterial({ color: '#fff', transparent: true, opacity: 0.25, side: THREE.DoubleSide }));
    net.rotation.y = Math.PI / 2; net.position.set(s * 1.5, 1.22, 0); goal.add(net);
    goal.position.x = s * 49;
    goal.traverse((o) => { o.castShadow = true; });
    root.add(goal);
  }

  // grandstands on the outside (right-hand side of the running direction)
  const o = HALF + 5;
  const tiers = 14;
  const prof = [[o, 0], [o, 1.1]];
  for (let i = 0; i < tiers; i++) {
    prof.push([o + i * 0.95, 1.1 + i * 0.6]);
    prof.push([o + (i + 1) * 0.95, 1.1 + i * 0.6]);
  }
  prof.push([o + tiers * 0.95, 1.1 + tiers * 0.6 + 2.5]);
  prof.push([o + tiers * 0.95 + 0.4, 1.1 + tiers * 0.6 + 2.5]);
  prof.push([o + tiers * 0.95 + 0.4, 0]);
  const concrete = new THREE.MeshStandardMaterial({ color: '#b9bec7', roughness: 0.85, side: THREE.DoubleSide });
  root.add(track.extrude(prof, { mat: concrete, step: 2, cast: true }));
  // coloured seat bands
  const seatMat = new THREE.MeshStandardMaterial({ color: '#2f6fc4', roughness: 0.6, side: THREE.DoubleSide });
  const seatMat2 = new THREE.MeshStandardMaterial({ color: '#f2c230', roughness: 0.6, side: THREE.DoubleSide });
  for (let i = 0; i < tiers; i++) {
    const y = 1.1 + i * 0.6 + 0.02;
    root.add(track.extrude([[o + i * 0.95 + 0.1, y], [o + i * 0.95 + 0.45, y + 0.28], [o + i * 0.95 + 0.5, y]], { mat: i % 5 === 4 ? seatMat2 : seatMat, step: 2 }));
  }
  // pitch-side wall with advert boards
  const boardTexts = [['DINO RUN', '#e5484d', '#fff'], ['RAWR!', '#ffd84a', '#3a2000'], ['最速恐龍', '#2f6fc4', '#fff'], ['BOBA BOOST', '#6b3e26', '#ffe9c6'], ['KAOHSIUNG 2027', '#1f9a6a', '#fff']];
  boardTexts.forEach(([text, bg, fg], bi) => {
    const mat = new THREE.MeshStandardMaterial({ map: T.signTexture(text, { bg, fg }), roughness: 0.5, emissive: '#ffffff', emissiveIntensity: 0.08, emissiveMap: T.signTexture(text, { bg, fg }) });
    const ts = [];
    for (let x = bi * 7; x < track.length; x += 7 * boardTexts.length) {
      const pose = track.pose(x, 3);
      const p = pose.p.clone().addScaledVector(pose.r, HALF + 4.2);
      p.y += 0.55;
      const ry = Math.atan2(-pose.r.x, -pose.r.z);
      ts.push({ p, ry });
    }
    root.add(instanced(new THREE.BoxGeometry(6.4, 1.0, 0.12), mat, ts));
  });

  // crowd: thousands of instanced fans, some in dino hats
  const g = crowdGeoms();
  const bodies = []; const heads = []; const hats = [];
  const bodyCols = []; const headCols = []; const hatCols = [];
  const shirt = ['#e5484d', '#ffd84a', '#3f8fd6', '#5bbf4a', '#ff8fc7', '#ffffff', '#9a6fd1', '#f28c28', '#222'];
  const skin = ['#f1c9a5', '#d9a47e', '#a8704f', '#f5d7bd'];
  const dinoHat = ['#5bbf4a', '#3f8fd6', '#d98b3a', '#9a6fd1'];
  for (let x = 0; x < track.length; x += 0.85) {
    const pose = track.pose(x, 3);
    const ry = Math.atan2(-pose.r.x, -pose.r.z);
    for (let i = 0; i < tiers; i++) {
      if (r() < 0.22) continue;
      const lat = o + i * 0.95 + 0.62 + (r() - 0.5) * 0.15;
      const p = pose.p.clone().addScaledVector(pose.r, lat);
      p.y = 1.1 + i * 0.6 + 0.02;
      const t = { p, ry: ry + (r() - 0.5) * 0.4, s: 0.9 + r() * 0.25 };
      bodies.push(t); heads.push(t);
      bodyCols.push(new THREE.Color(shirt[Math.floor(r() * shirt.length)]));
      headCols.push(new THREE.Color(skin[Math.floor(r() * skin.length)]));
      if (r() < 0.3) { hats.push(t); hatCols.push(new THREE.Color(dinoHat[Math.floor(r() * dinoHat.length)])); }
    }
  }
  const crowdMat = () => bouncy(new THREE.MeshStandardMaterial({ roughness: 0.8 }), clock);
  const cb = instanced(g.body, crowdMat(), bodies, bodyCols);
  const ch = instanced(g.head, crowdMat(), heads, headCols);
  const chat = instanced(g.hat, crowdMat(), hats, hatCols);
  for (const m of [cb, ch, chat]) { m.castShadow = false; root.add(m); }

  // roof over the main stand (home straight) and floodlight towers
  const roofMat = new THREE.MeshStandardMaterial({ color: '#e8ecf2', roughness: 0.4, metalness: 0.3, side: THREE.DoubleSide });
  const steel = new THREE.MeshStandardMaterial({ color: '#8d96a3', roughness: 0.4, metalness: 0.7 });
  root.add(track.extrude([[o + tiers * 0.95 + 0.4, 1.1 + tiers * 0.6 + 7], [o - 1, 1.1 + tiers * 0.6 + 4.5]], { mat: roofMat, step: 2, cast: true }));
  for (let x = 0; x < track.length; x += 12) {
    const pose = track.pose(x, 3);
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 1.1 + tiers * 0.6 + 7), steel);
    col.position.copy(pose.p).addScaledVector(pose.r, o + tiers * 0.95 + 0.2);
    col.position.y = (1.1 + tiers * 0.6 + 7) / 2;
    col.castShadow = true;
    root.add(col);
  }
  const lampMat = new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#fffbe6', emissiveIntensity: 2.2 });
  for (const [x, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const tower = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.8, 38, 8), steel); pole.position.y = 19; tower.add(pole);
    const head = new THREE.Mesh(new THREE.BoxGeometry(7, 4.5, 0.6), steel); head.position.y = 39; tower.add(head);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) {
      const l = new THREE.Mesh(new THREE.CircleGeometry(0.62, 16), lampMat);
      l.position.set(-2.4 + i * 1.6, 37.6 + j * 1.4, 0.31); head.add(l);
    }
    tower.position.set(x * 78, 0, z * 70);
    tower.lookAt(0, 0, 0);
    tower.traverse((ob) => { ob.castShadow = ob.isMesh; });
    root.add(tower);
  }

  // giant video screen behind the far curve (text updated live by the game)
  const screenCanvas = document.createElement('canvas');
  screenCanvas.width = 1024; screenCanvas.height = 512;
  const screenTex = new THREE.CanvasTexture(screenCanvas); screenTex.colorSpace = THREE.SRGBColorSpace;
  const screen = new THREE.Group();
  const frame = new THREE.Mesh(new THREE.BoxGeometry(26, 14, 1), new THREE.MeshStandardMaterial({ color: '#222' }));
  const face = new THREE.Mesh(new THREE.PlaneGeometry(24, 12), new THREE.MeshBasicMaterial({ map: screenTex, toneMapped: false }));
  face.position.z = 0.51;
  const leg1 = new THREE.Mesh(new THREE.BoxGeometry(1, 16, 1), steel); leg1.position.set(-8, -14, 0);
  const leg2 = leg1.clone(); leg2.position.x = 8;
  screen.add(frame, face, leg1, leg2);
  screen.position.set(-118, 22, 0);
  screen.lookAt(0, 22, 0);
  root.add(screen);
  anim.push({ screen: { canvas: screenCanvas, tex: screenTex } });

  // flags along the top of the stand
  const flagCols = ['#e5484d', '#ffd84a', '#3f8fd6', '#5bbf4a', '#ffffff'];
  const flags = [];
  for (let x = 0, i = 0; x < track.length; x += 16, i++) {
    const pose = track.pose(x, 3);
    const base = pose.p.clone().addScaledVector(pose.r, o + tiers * 0.95 + 0.2);
    base.y = 1.1 + tiers * 0.6 + 7;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 4), steel);
    pole.position.copy(base).add(new THREE.Vector3(0, 2, 0));
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(2, 1.2, 6, 1), new THREE.MeshStandardMaterial({ color: flagCols[i % flagCols.length], side: THREE.DoubleSide, roughness: 0.7 }));
    flag.geometry.translate(1, 0, 0);
    flag.position.copy(base).add(new THREE.Vector3(0, 3.4, 0));
    root.add(pole, flag);
    flags.push(flag);
  }
  anim.push({ flags });

  // palm trees and a distant city skyline
  const pg = palmGeoms();
  const palms = scatter(track, 70, HALF + 38, HALF + 80, r).map((p) => ({ p, ry: r() * 6.28, s: 0.9 + r() * 0.5 }));
  root.add(instanced(pg.trunk, new THREE.MeshStandardMaterial({ map: T.barkTexture(), roughness: 0.9 }), palms));
  root.add(instanced(pg.fronds, windy(new THREE.MeshStandardMaterial({ color: '#3e9a44', roughness: 0.7, side: THREE.DoubleSide }), clock, 0.35, 9), palms));
  const bld = [];
  const bldCols = [];
  for (let i = 0; i < 90; i++) {
    const a = (i / 90) * Math.PI * 2 + r() * 0.05;
    const d = 380 + r() * 160;
    const h = 20 + r() * 70;
    bld.push({ p: new THREE.Vector3(Math.cos(a) * d, h / 2, Math.sin(a) * d), sv: new THREE.Vector3(18 + r() * 20, h, 18 + r() * 20), ry: r() });
    bldCols.push(new THREE.Color().setHSL(0.58 + r() * 0.05, 0.15, 0.55 + r() * 0.2));
  }
  const city = instanced(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.2 }), bld, bldCols);
  city.castShadow = false;
  root.add(city);
  // a landmark skyscraper on the horizon
  const tower = new THREE.Group();
  const glass = new THREE.MeshStandardMaterial({ color: '#8fb4d8', metalness: 0.6, roughness: 0.2 });
  const t1 = new THREE.Mesh(new THREE.BoxGeometry(30, 150, 30), glass); t1.position.y = 75;
  const t2 = new THREE.Mesh(new THREE.BoxGeometry(18, 80, 18), glass); t2.position.y = 190;
  const sp = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1.5, 40), steel); sp.position.y = 250;
  tower.add(t1, t2, sp);
  tower.position.set(-420, 0, -300);
  root.add(tower);
}

// ------------------------------------------------------------------- jungle
function buildJungle(track, root, r, clock, anim) {
  const tg = treeGeoms(r);
  const trees = scatter(track, 420, HALF + 7, HALF + 110, r).map((p) => ({ p, ry: r() * 6.28, s: 0.7 + r() * 0.9 }));
  const canopyCols = trees.map(() => new THREE.Color().setHSL(0.27 + r() * 0.08, 0.5 + r() * 0.2, 0.22 + r() * 0.12));
  root.add(instanced(tg.trunk, new THREE.MeshStandardMaterial({ map: T.barkTexture(), roughness: 0.95 }), trees));
  root.add(instanced(tg.canopy, windy(new THREE.MeshStandardMaterial({ roughness: 0.85 }), clock, 0.25, 12), trees, canopyCols));

  const fg = fernGeom();
  const ferns = scatter(track, 1100, HALF + 1.6, HALF + 26, r).map((p) => ({ p, ry: r() * 6.28, s: 0.7 + r() * 1.1 }));
  const fernCols = ferns.map(() => new THREE.Color().setHSL(0.28 + r() * 0.06, 0.55, 0.28 + r() * 0.1));
  const fern = instanced(fg, windy(new THREE.MeshStandardMaterial({ roughness: 0.8, side: THREE.DoubleSide }), clock, 0.12, 1.2), ferns, fernCols);
  root.add(fern);

  // palms / cycads near the path
  const pg = palmGeoms();
  const palms = scatter(track, 80, HALF + 5, HALF + 30, r).map((p) => ({ p, ry: r() * 6.28, s: 0.6 + r() * 0.6 }));
  root.add(instanced(pg.trunk, new THREE.MeshStandardMaterial({ map: T.barkTexture(), roughness: 0.9 }), palms));
  root.add(instanced(pg.fronds, windy(new THREE.MeshStandardMaterial({ color: '#2f7a36', roughness: 0.7, side: THREE.DoubleSide }), clock, 0.3, 9), palms));

  // mossy boulders
  const rock = new THREE.DodecahedronGeometry(1, 1);
  const rp = rock.attributes.position;
  for (let i = 0; i < rp.count; i++) rp.setXYZ(i, rp.getX(i) * (0.8 + Math.sin(i * 12.9) * 0.2), rp.getY(i) * 0.7, rp.getZ(i) * (0.8 + Math.cos(i * 7.1) * 0.2));
  rock.computeVertexNormals();
  const rocks = scatter(track, 140, HALF + 3, HALF + 50, r).map((p) => ({ p, ry: r() * 6, s: 0.6 + r() * 2 }));
  root.add(instanced(rock, new THREE.MeshStandardMaterial({ color: '#6f7a5f', roughness: 1, flatShading: true }), rocks));

  // giant glowing flowers
  const petal = new THREE.SphereGeometry(0.35, 8, 6); petal.scale(1, 0.3, 2); petal.translate(0, 0, 0.5);
  const petals = [];
  for (let i = 0; i < 5; i++) { const p = petal.clone(); p.rotateY((i / 5) * Math.PI * 2); petals.push(p); }
  const bloom = mergeGeometries(petals); bloom.translate(0, 1.2, 0);
  const flowers = scatter(track, 160, HALF + 2, HALF + 18, r).map((p) => ({ p, ry: r() * 6, s: 0.6 + r() * 0.8 }));
  const flowerCols = flowers.map(() => new THREE.Color().setHSL(r() < 0.5 ? 0.9 + r() * 0.08 : 0.08 + r() * 0.06, 0.8, 0.6));
  root.add(instanced(bloom, new THREE.MeshStandardMaterial({ roughness: 0.5, emissive: '#ff4fa0', emissiveIntensity: 0.15 }), flowers, flowerCols));

  // distant smoking volcano
  root.add(volcanoCone(160, 110, new THREE.Vector3(-420, 0, -380), '#4f5f4c', false));
  anim.push({ smoke: new THREE.Vector3(-420, 110, -380) });
}

function volcanoCone(radius, height, pos, color, lava) {
  const pts = [];
  for (let i = 0; i <= 20; i++) {
    const t = i / 20;
    const rr = radius * (1 - t * 0.86);
    pts.push(new THREE.Vector2(rr, height * Math.pow(t, 0.85)));
  }
  pts.push(new THREE.Vector2(radius * 0.1, height * 0.93));
  const geom = new THREE.LatheGeometry(pts, 48);
  const p = geom.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const n = Math.sin(p.getX(i) * 0.08) * Math.cos(p.getZ(i) * 0.07) * 4;
    p.setXYZ(i, p.getX(i) + n, p.getY(i) + Math.abs(n) * 0.4, p.getZ(i) + n);
  }
  geom.computeVertexNormals();
  const g = new THREE.Group();
  const m = new THREE.Mesh(geom, new THREE.MeshStandardMaterial({ color, roughness: 1, flatShading: true }));
  m.receiveShadow = true;
  g.add(m);
  if (lava) {
    const lake = new THREE.Mesh(new THREE.CircleGeometry(radius * 0.13, 24), new THREE.MeshBasicMaterial({ map: T.lavaTexture(), toneMapped: false }));
    lake.rotation.x = -Math.PI / 2; lake.position.y = height * 0.9;
    g.add(lake);
    // lava rivers down the slopes
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2 + 0.3;
      const pathPts = [];
      for (let i = 0; i <= 12; i++) {
        const t = i / 12;
        const rr = radius * (0.12 + t * 0.8);
        const aa = a + Math.sin(t * 5 + k) * 0.08;
        pathPts.push(new THREE.Vector3(Math.cos(aa) * rr, height * (0.9 - t * 0.9) + 1.2, Math.sin(aa) * rr));
      }
      const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pathPts), 40, 1.6 - k * 0.1, 6), new THREE.MeshBasicMaterial({ map: T.lavaTexture(), toneMapped: false }));
      g.add(tube);
    }
  }
  g.position.copy(pos);
  return g;
}

// ------------------------------------------------------------------ volcano
function buildVolcano(track, root, r, clock, anim) {
  // the volcano sits inside the loop
  let minR = Infinity;
  for (const p of track.pos) minR = Math.min(minR, Math.hypot(p.x, p.z));
  const volc = volcanoCone(minR - 24, 80, new THREE.Vector3(0, -1, 0), '#2a2022', true);
  root.add(volc);
  anim.push({ smoke: new THREE.Vector3(0, 78, 0), lava: true });
  const glow = new THREE.PointLight('#ff6a20', 900, 260, 1.6);
  glow.position.set(0, 90, 0);
  root.add(glow);

  // lava pools outside the track
  const lavaMat = new THREE.MeshBasicMaterial({ map: T.lavaTexture(), toneMapped: false });
  scatter(track, 22, HALF + 10, HALF + 60, r).forEach((p) => {
    const pool = new THREE.Mesh(new THREE.CircleGeometry(3 + r() * 6, 20), lavaMat);
    pool.rotation.x = -Math.PI / 2; pool.position.copy(p); pool.position.y = 0.02;
    pool.scale.set(1, 0.6 + r() * 0.6, 1);
    root.add(pool);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(1, 0.35, 6, 20), new THREE.MeshStandardMaterial({ color: '#1a1414', roughness: 1 }));
    rim.rotation.x = -Math.PI / 2; rim.position.copy(pool.position); rim.scale.setScalar((pool.geometry.parameters.radius));
    rim.scale.z = 1; root.add(rim);
  });

  // obsidian spires and scorched dead trees
  const spire = new THREE.ConeGeometry(1, 1, 5);
  const spires = scatter(track, 260, HALF + 4, HALF + 90, r).map((p) => ({ p: p.add(new THREE.Vector3(0, 0, 0)), ry: r() * 6, rz: (r() - 0.5) * 0.4, sv: new THREE.Vector3(0.8 + r() * 1.5, 2 + r() * 7, 0.8 + r() * 1.5) }));
  spires.forEach((s) => { s.p.y = s.sv.y / 2; });
  root.add(instanced(spire, new THREE.MeshStandardMaterial({ color: '#141016', roughness: 0.25, metalness: 0.4, flatShading: true }), spires));
  const branchParts = [];
  const trunkG = new THREE.CylinderGeometry(0.15, 0.3, 5, 6); trunkG.translate(0, 2.5, 0); branchParts.push(trunkG);
  for (let i = 0; i < 4; i++) {
    const b = new THREE.CylinderGeometry(0.05, 0.12, 2, 5); b.translate(0, 1, 0);
    b.rotateZ(0.7 + i * 0.1); b.rotateY((i / 4) * Math.PI * 2); b.translate(0, 2.5 + i * 0.6, 0);
    branchParts.push(b);
  }
  const deadTree = mergeGeometries(branchParts);
  const dead = scatter(track, 70, HALF + 5, HALF + 45, r).map((p) => ({ p, ry: r() * 6, s: 0.8 + r() * 0.6 }));
  root.add(instanced(deadTree, new THREE.MeshStandardMaterial({ color: '#2a1d18', roughness: 1 }), dead));

  // a giant fossil ribcage the track runs through
  const boneMat = new THREE.MeshStandardMaterial({ color: '#d9ccb0', roughness: 0.6 });
  const cage = new THREE.Group();
  const x0 = track.length * 0.38;
  for (let i = 0; i < 9; i++) {
    const rib = new THREE.Mesh(new THREE.TorusGeometry(HALF + 3.5, 0.45 - Math.abs(i - 4) * 0.03, 8, 24, Math.PI), boneMat);
    const s = 0.85 + Math.sin((i / 8) * Math.PI) * 0.35;
    track.place(rib, x0 + i * 3.2, 0, 0); // torus arc lies in local XY: spans across the track
    rib.scale.set(1, s, 1);
    rib.castShadow = true;
    cage.add(rib);
  }
  for (let i = 0; i < 12; i++) {
    const v = new THREE.Mesh(new THREE.SphereGeometry(0.8, 10, 8), boneMat);
    const o = track.pose(x0 - 2 + i * 2.6, 3);
    v.position.copy(o.p); v.position.y += (HALF + 3.5) * (0.85 + Math.sin((i / 11) * Math.PI) * 0.35);
    v.scale.set(1, 0.7, 1.3); v.castShadow = true;
    cage.add(v);
  }
  const skull = new THREE.Group();
  const sk = new THREE.Mesh(new THREE.SphereGeometry(3.2, 16, 12), boneMat); sk.scale.set(1, 0.8, 1.6);
  const jawM = new THREE.Mesh(new THREE.BoxGeometry(3.6, 1, 5), boneMat); jawM.position.set(0, -2.2, 1.5); jawM.rotation.x = 0.35;
  const socket = new THREE.Mesh(new THREE.SphereGeometry(0.9, 10, 8), new THREE.MeshBasicMaterial({ color: '#ff4a10' }));
  const s2 = socket.clone(); socket.position.set(1.8, 0.8, 1.8); s2.position.set(-1.8, 0.8, 1.8);
  skull.add(sk, jawM, socket, s2);
  track.place(skull, x0 - 8, HALF + 9, 2.4);
  skull.rotateY(-0.8);
  cage.add(skull);
  root.add(cage);
}
