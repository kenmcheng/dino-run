// GPU point-sprite particles: two pools (alpha-blended and additive).
import * as THREE from 'three';
import * as T from './textures.js';

const KINDS = {
  dust:     { colors: ['#cdb89a', '#b9a07e'], size: [0.3, 1.0], life: 0.7, up: 0.6, rand: 0.7, gravity: -0.3, drag: 2, alpha: 0.7 },
  ashDust:  { colors: ['#4a3f3d', '#5c5250'], size: [0.3, 1.0], life: 0.7, up: 0.6, rand: 0.7, gravity: -0.3, drag: 2, alpha: 0.7 },
  redDust:  { colors: ['#d27a5f', '#b8604a'], size: [0.35, 1.2], life: 0.7, up: 0.6, rand: 0.8, gravity: -0.3, drag: 2 },
  steam:    { colors: ['#ffffff', '#e8eef2'], size: [0.35, 1.7], life: 1.2, up: 1.6, rand: 0.5, gravity: -0.5, drag: 1, alpha: 0.55 },
  boba:     { colors: ['#3a2418', '#4a2e1e'], size: [0.13, 0.13], life: 0.9, up: 2.5, rand: 2, gravity: 9 },
  spark:    { colors: ['#ffe14a', '#ff7ac6', '#6fd6ff', '#9dff6a', '#ffffff'], size: [0.2, 0.05], life: 0.7, up: 3, rand: 5, gravity: 7, add: true },
  yolk:     { colors: ['#ffc83a', '#fff3d0'], size: [0.25, 0.18], life: 0.8, up: 3, rand: 4, gravity: 9 },
  boom:     { colors: ['#ffb347', '#ff6a1a', '#ffe08a'], size: [1.2, 3.4], life: 0.9, up: 3, rand: 8, gravity: -1, drag: 3, add: true },
  smoke:    { colors: ['#4a4040', '#5c5454', '#3a3434'], size: [1.2, 5], life: 2.6, up: 2.2, rand: 0.8, gravity: -0.2, drag: 0.5, alpha: 0.5 },
  fire:     { colors: ['#ffb347', '#ff6a1a', '#ffd84a'], size: [0.9, 0.2], life: 0.45, up: 0.5, rand: 1, gravity: -2, add: true },
  bone:     { colors: ['#efe4c9', '#d9cba8'], size: [0.28, 0.28], life: 1.1, up: 4, rand: 4, gravity: 10 },
  note:     { colors: ['#b36bff', '#ff6bd6'], size: [0.35, 0.5], life: 1.1, up: 2, rand: 1.2, gravity: -0.5 },
  mist:     { colors: ['#d8f0ff', '#ffffff', '#a8dcff'], size: [0.25, 1.1], life: 1.2, up: -1.2, rand: 1.2, gravity: 1, drag: 1.5, alpha: 0.45 },
  ember:    { colors: ['#ff7a1a', '#ffb347', '#ff3d00'], size: [0.18, 0.05], life: 3, up: 1.6, rand: 0.8, gravity: -0.4, add: true },
  ash:      { colors: ['#6a6060', '#8a8080', '#4a4444'], size: [0.14, 0.14], life: 5, up: -0.8, rand: 0.5, gravity: 0 },
  confetti: { colors: ['#e5484d', '#ffd84a', '#3f8fd6', '#5bbf4a', '#ff8fc7', '#9a6fd1'], size: [0.2, 0.2], life: 3, up: 7, rand: 4, gravity: 4, drag: 1.2 },
  firefly:  { colors: ['#d8ff6a', '#fff27a'], size: [0.18, 0.18], life: 3.5, up: 0.1, rand: 0.4, gravity: 0, add: true, twinkle: true },
  speed:    { colors: ['#ffffff'], size: [0.12, 0.02], life: 0.3, up: 0, rand: 0.2, gravity: 0, add: true },
  // water: the blaster's jet, drips off a soaked costume, a balloon's splash
  jet:      { colors: ['#e6f6ff', '#9fd8ff', '#ffffff'], size: [0.1, 0.26], life: 0.6, up: 0.6, rand: 0.2, gravity: 7, alpha: 0.9 },
  drip:     { colors: ['#bfe6ff', '#e6f6ff'], size: [0.08, 0.05], life: 0.6, up: -0.5, rand: 0.3, gravity: 12, alpha: 0.9 },
  splash:   { colors: ['#e6f6ff', '#8fd0ff', '#ffffff'], size: [0.3, 0.12], life: 0.8, up: 4, rand: 5, gravity: 11, alpha: 0.9 },
  feather:  { colors: ['#ffd84a', '#ffb347', '#fff3d0'], size: [0.2, 0.2], life: 1.2, up: 2.5, rand: 2, gravity: 2.5, drag: 2 },
};

class Pool {
  constructor(max, additive) {
    this.max = max;
    this.i = 0;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.life = new Float32Array(max);
    this.age = new Float32Array(max).fill(1e9);
    this.kind = new Array(max).fill(null);
    this.s0 = new Float32Array(max);
    this.s1 = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.uniforms = { map: { value: T.roundSprite() }, scale: { value: 600 } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: `attribute float size; attribute float alpha; attribute vec3 color; uniform float scale;
        varying float vA; varying vec3 vC;
        void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * scale / max(0.1, -mv.z); gl_Position = projectionMatrix * mv; vA = alpha; vC = color; }`,
      fragmentShader: `uniform sampler2D map; varying float vA; varying vec3 vC;
        void main(){ vec4 t = texture2D(map, gl_PointCoord); if (t.a * vA < 0.01) discard; gl_FragColor = vec4(vC, t.a * vA); }`,
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, mat);
    this.points.frustumCulled = false;
  }
}

const tmpC = new THREE.Color();

export class Particles {
  constructor(scene) {
    this.normal = new Pool(5000, false);
    this.additive = new Pool(3000, true);
    scene.add(this.normal.points, this.additive.points);
  }

  emit(kind, at, n = 1, { spread = 0.2, vel = null, tint = null } = {}) {
    const k = KINDS[kind];
    if (!k) return;
    const P = k.add ? this.additive : this.normal;
    for (let j = 0; j < n; j++) {
      const i = P.i; P.i = (P.i + 1) % P.max;
      P.pos[i * 3] = at.x + (Math.random() - 0.5) * spread * 2;
      P.pos[i * 3 + 1] = at.y + (Math.random() - 0.5) * spread * 2;
      P.pos[i * 3 + 2] = at.z + (Math.random() - 0.5) * spread * 2;
      const a = Math.random() * Math.PI * 2;
      const u = Math.random() * 2 - 1;
      const s = Math.sqrt(1 - u * u) * k.rand * Math.random();
      P.vel[i * 3] = Math.cos(a) * s + (vel ? vel.x : 0);
      P.vel[i * 3 + 1] = u * k.rand * 0.5 + k.up + (vel ? vel.y : 0);
      P.vel[i * 3 + 2] = Math.sin(a) * s + (vel ? vel.z : 0);
      tmpC.set(tint || k.colors[Math.floor(Math.random() * k.colors.length)]);
      P.col[i * 3] = tmpC.r; P.col[i * 3 + 1] = tmpC.g; P.col[i * 3 + 2] = tmpC.b;
      P.life[i] = k.life * (0.7 + Math.random() * 0.6);
      P.age[i] = 0;
      P.kind[i] = k;
      P.s0[i] = k.size[0]; P.s1[i] = k.size[1];
    }
  }

  update(dt, camera, renderer) {
    const h = renderer.domElement.height / renderer.getPixelRatio();
    const scale = (h / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2))) * renderer.getPixelRatio();
    for (const P of [this.normal, this.additive]) {
      P.uniforms.scale.value = scale;
      for (let i = 0; i < P.max; i++) {
        if (P.age[i] >= P.life[i]) { P.alpha[i] = 0; P.size[i] = 0; continue; }
        const k = P.kind[i];
        P.age[i] += dt;
        const f = P.age[i] / P.life[i];
        const drag = Math.exp(-(k.drag || 0) * dt);
        P.vel[i * 3] *= drag; P.vel[i * 3 + 2] *= drag;
        P.vel[i * 3 + 1] = P.vel[i * 3 + 1] * drag - k.gravity * dt;
        P.pos[i * 3] += P.vel[i * 3] * dt;
        P.pos[i * 3 + 1] += P.vel[i * 3 + 1] * dt;
        P.pos[i * 3 + 2] += P.vel[i * 3 + 2] * dt;
        P.size[i] = P.s0[i] + (P.s1[i] - P.s0[i]) * f;
        let a = (k.alpha || 1) * Math.min(1, (1 - f) * 2.2) * Math.min(1, f * 12 + 0.2);
        if (k.twinkle) a *= 0.5 + 0.5 * Math.sin(P.age[i] * 9 + i);
        P.alpha[i] = a;
      }
      const g = P.points.geometry;
      g.attributes.position.needsUpdate = true;
      g.attributes.color.needsUpdate = true;
      g.attributes.size.needsUpdate = true;
      g.attributes.alpha.needsUpdate = true;
    }
  }
}
