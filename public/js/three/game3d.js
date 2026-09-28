// The 3D race view: owns the renderer, scene, camera and all course objects.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { buildCourse, FX } from '/shared/data.js';
import { Track, HALF } from './track.js';
import { buildScenery } from './scenery.js';
import { Props } from './props.js';
import { Particles } from './fx.js';
import { buildDino } from './dino3d.js';
import * as Assets from './assets.js';
import * as T from './textures.js';
import { QUALITY, createPerf, nextTier } from './quality.js';

const UP = new THREE.Vector3(0, 1, 0);

export { QUALITY };

// Final grade: gentle vignette, a touch more saturation and warmth.
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, amount: { value: 1 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float amount; varying vec2 vUv;
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      c.rgb = mix(vec3(l), c.rgb, 1.0 + 0.12 * amount);
      c.rgb *= vec3(1.02, 1.0, 0.97);
      vec2 d = vUv - 0.5;
      c.rgb *= 1.0 - dot(d, d) * 0.55 * amount;
      gl_FragColor = c;
    }`,
};

function blobTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(0,0,0,0.55)'); grd.addColorStop(0.6, 'rgba(0,0,0,0.25)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}
const damp = (rate, dt) => 1 - Math.exp(-rate * dt);

function angleLerp(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export class Game3D {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.camera = new THREE.PerspectiveCamera(62, 1, 0.1, 3200);
    this.clock = { value: 0 };
    this.scene = null;
    this.transients = [];
    this.shake = 0;
    this.blobTex = blobTexture();
    this.ringGeom = new THREE.RingGeometry(0.8, 1, 48);
    this.tmpV = new THREE.Vector3();
    this.tmpD = new THREE.Vector3();
    this.tmpW = new THREE.Vector3();
    this.perf = createPerf();
    this.onTierChange = null;
    let pref = 'auto';
    try { pref = localStorage.getItem('dino-run-quality') || 'auto'; } catch { /* ignore */ }
    if (new URLSearchParams(location.search).has('hq')) pref = 'high';
    this.setQuality(pref);
    addEventListener('resize', () => this.resize());
  }

  // pref: 'auto' | 'high' | 'medium' | 'low' | 'lowest'
  setQuality(pref) {
    this.qualityPref = pref;
    this.tier = pref === 'auto' ? 'high' : pref;
    this.perf = createPerf();
    this.applyTier();
  }

  applyTier() {
    const q = QUALITY[this.tier];
    this.q = q;
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, q.ratio));
    const shadowSwitch = this.renderer.shadowMap.enabled !== q.shadows;
    this.renderer.shadowMap.enabled = q.shadows;
    if (this.sun) {
      this.sun.castShadow = q.shadows;
      if (this.sun.shadow.mapSize.x !== q.shadow) {
        this.sun.shadow.mapSize.set(q.shadow, q.shadow);
        this.sun.shadow.map?.dispose();
        this.sun.shadow.map = null;
      }
    }
    if (shadowSwitch) this.scene?.traverse((o) => { if (o.material && !Array.isArray(o.material)) o.material.needsUpdate = true; });
    this.buildComposer();
    this.resize();
  }

  buildComposer() {
    this.composer?.dispose();
    this.composer = null;
    if (!this.q.post || !this.scene) return;
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: this.q.msaa });
    const c = new EffectComposer(this.renderer, rt);
    c.addPass(new RenderPass(this.scene, this.camera));
    // only genuinely bright things (lava, lamps, sparks, sun glints) glow
    const bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.25, 0.45, 1.05);
    c.addPass(bloom);
    c.addPass(new ShaderPass(GradeShader));
    c.addPass(new OutputPass());
    this.composer = c;
  }

  // In auto mode, drop a tier when frames stay slow, and climb back after a longer fast streak.
  adapt(dt) {
    if (this.qualityPref !== 'auto') return;
    const prev = this.tier;
    const next = nextTier(this.perf, prev, dt);
    if (next === prev) return;
    this.tier = next;
    this.applyTier();
    this.onTierChange?.(next, prev);
  }

  resize() {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.composer) {
      const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
      this.composer.setPixelRatio(1);
      this.composer.setSize(size.x, size.y);
    }
  }

  // --------------------------------------------------------------- setup
  async load(courseId, runners, meId) {
    // Blender costumes for everyone in the race (and the arch mascot); anything
    // that isn't ready in time falls back to its procedural model
    await Promise.all([
      Assets.ready('costumes', [...runners.map((r) => r.dino), 'trex']),
      Assets.ready('props'),
      Assets.ready('scenery'),
    ]);
    this.clear();
    this.ready = false;
    this.meId = meId;
    const course = buildCourse(courseId);
    const track = new Track(course);
    this.track = track;
    const scene = new THREE.Scene();
    this.scene = scene;

    const sc = buildScenery(track, this.clock, { grass: this.q.grass });
    this.scenery = sc;
    scene.add(sc.root);
    scene.environment = this.envTex;
    scene.environmentIntensity = sc.theme.env;
    scene.fog = new THREE.FogExp2(sc.theme.fog, sc.theme.fogD);

    const hemi = new THREE.HemisphereLight(...sc.theme.hemi);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(sc.theme.sun, sc.theme.sunI);
    this.sunDir = new THREE.Vector3(...sc.theme.sunDir).normalize();
    sun.castShadow = this.q.shadows;
    sun.shadow.mapSize.set(this.q.shadow, this.q.shadow);
    const sc2 = sun.shadow.camera;
    sc2.left = -32; sc2.right = 32; sc2.top = 32; sc2.bottom = -32; sc2.near = 1; sc2.far = 220;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.03;
    scene.add(sun, sun.target);
    this.sun = sun;

    scene.add(track.buildSurface());
    this.props = new Props(track, scene);
    this.fx = new Particles(scene);

    this.models = new Map();
    const blobGeom = new THREE.PlaneGeometry(1, 1);
    blobGeom.rotateX(-Math.PI / 2);
    runners.forEach((r, i) => {
      const m = buildDino(r.dino, r.color, { number: r.bib || i + 1, runner: r.name });
      scene.add(m.root);
      // soft contact shadow: grounds runners even when shadow maps are off
      const blob = new THREE.Mesh(blobGeom, new THREE.MeshBasicMaterial({ map: this.blobTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
      blob.renderOrder = 1;
      scene.add(blob);
      this.models.set(r.id, { m, blob, phase: Math.random() * 6, yaw: null, prevY: null, turn: 0, puff: 0 });
    });
    this.camPos = null;
    this.camLook = null;
    this.camRoll = 0;
    this.screenT = 0;
    this.buildComposer();
    this.resize();
    // every "place. name" tag each runner can show, made now rather than mid-race
    runners.forEach((r) => {
      const { m } = this.models.get(r.id);
      for (let place = runners.length; place >= 1; place--) m.setTag(`${place}. ${r.name}`, r.id === meId);
    });
    await this.prewarm();
    this.loadedAt = performance.now() / 1000;
    this.ready = true;
    this.perf.slowFor = 0;
    this.perf.fastFor = 0;
    this.perf.ema = 1 / 60;
  }

  // Everything that could appear later in the race is made visible once,
  // compiled, uploaded and rendered here, behind the loading screen. Without
  // this, the first meteor/shield/taunt/etc. compiles a shader mid-race and
  // the game visibly hitches.
  async prewarm() {
    const { scene, renderer, camera, track } = this;
    const restoreProps = this.props.prewarm();
    const textures = new Set();
    for (const { m } of this.models.values()) for (const t of m.prewarm(true)) textures.add(t);
    const ring = new THREE.Mesh(this.ringGeom, new THREE.MeshBasicMaterial({ color: '#fff', transparent: true, side: THREE.DoubleSide, depthWrite: false }));
    ring.position.copy(track.pose(3, 3).p);
    scene.add(ring);
    const start = track.pose(0, 3);
    camera.position.copy(start.p).addScaledVector(start.t, -7).add(new THREE.Vector3(0, 3, 0));
    camera.lookAt(start.p);
    camera.updateMatrixWorld();
    // Compile for BOTH output paths: straight to screen (sRGB + tone mapping)
    // and into the post-processing target (linear, no tone mapping). They are
    // different shader programs, and auto quality may switch between them.
    const parallel = renderer.extensions.has('KHR_parallel_shader_compile');
    const compile = async () => {
      if (parallel) await renderer.compileAsync(scene, camera);
      else renderer.compile(scene, camera);
    };
    await compile();
    const rt = this.composer ? this.composer.renderTarget1 : new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType });
    renderer.setRenderTarget(rt);
    await compile();
    renderer.setRenderTarget(null);
    if (!this.composer) rt.dispose();
    const keys = ['map', 'normalMap', 'emissiveMap', 'alphaMap', 'roughnessMap', 'bumpMap'];
    scene.traverse((o) => {
      const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      for (const mt of mats) for (const k of keys) if (mt[k]?.isTexture) textures.add(mt[k]);
    });
    for (const t of textures) renderer.initTexture(t);
    // one real frame: shadow map, bloom targets and depth-material variants
    if (this.composer) this.composer.render(1 / 60); else renderer.render(scene, camera);
    for (const { m } of this.models.values()) m.prewarm(false);
    restoreProps();
    scene.remove(ring);
    ring.material.dispose();
  }

  clear() {
    this.ready = false;
    if (!this.scene) return;
    for (const { m } of this.models.values()) m.dispose();
    this.props?.mascot?.dispose();
    this.scene.traverse((o) => {
      if (o.geometry && o.geometry !== this.ringGeom) o.geometry.dispose?.();
    });
    this.scene = null;
    this.transients = [];
    this.composer?.dispose();
    this.composer = null;
    this.renderer.renderLists.dispose();
  }

  // --------------------------------------------------------------- events
  runnerPos(id) {
    const r = this.lastRunners?.get(id);
    if (!r) return null;
    const o = this.track.pose(r.x, r.y);
    return o.p.clone().add(new THREE.Vector3(0, r.z, 0));
  }

  onEvent(e) {
    if (!this.scene) return;
    const me = this.meId;
    const at = (id, h = 1.4) => { const p = this.runnerPos(id); return p ? p.add(new THREE.Vector3(0, h, 0)) : null; };
    switch (e.k) {
      case 'splash': {
        // water balloon bursts: a crown of droplets, mist and a ripple
        const o = this.track.pose(e.x, e.y);
        const p = o.p.clone().add(new THREE.Vector3(0, 0.5, 0));
        this.fx.emit('splash', p, 80, { spread: 0.5 });
        this.fx.emit('mist', p, 30, { spread: 1.2 });
        this.ring(o.p.clone().add(new THREE.Vector3(0, 0.08, 0)), '#8fd0ff', 3.2, 0.6);
        break;
      }
      case 'soak': { const p = at(e.id, 1.6); if (p) this.fx.emit('splash', p, 18, { spread: 0.4 }); break; }
      case 'hit': {
        const p = at(e.id, 1.6);
        if (p) this.fx.emit(e.cause === 'egg' ? 'yolk' : 'spark', p, 26, { spread: 0.4 });
        if (p && e.cause === 'hatch') this.fx.emit('feather', p.clone().setY(p.y - 1.2), 16, { spread: 0.3 });
        if (p && e.cause === 'mallet') this.ring(p.clone().setY(p.y + 0.9), '#ffe14a', 1.6, 0.35);
        if (p && e.cause === 'peel') this.fx.emit('dust', p.clone().setY(p.y - 1.4), 10, { spread: 0.5 });
        if (e.id === me) this.shake = 0.6;
        break;
      }
      case 'boom': {
        const o = this.track.pose(e.x, e.y);
        const p = o.p.clone().add(new THREE.Vector3(0, 0.5, 0));
        this.fx.emit('boom', p, 60, { spread: 1 });
        this.fx.emit('smoke', p, 25, { spread: 1.5 });
        this.fx.emit('ember', p, 30, { spread: 1 });
        this.ring(p, '#ff6a1a', 5, 0.7);
        if (this.runnerPos(me)?.distanceTo(p) < 25) this.shake = 1;
        break;
      }
      case 'splat': { const o = this.track.pose(e.x, e.y); this.fx.emit('yolk', o.p.clone().setY(o.p.y + 1.1), 22, { spread: 0.3 }); break; }
      case 'pickup': {
        const o = this.track.pose(e.x, e.y);
        this.fx.emit('spark', o.p.clone().setY(o.p.y + 0.8), 30, { spread: 0.3 });
        break;
      }
      case 'smash': { const p = at(e.id, 0.5); if (p) this.fx.emit('bone', p, 30, { spread: 1.5 }); break; }
      case 'ability': {
        const p = at(e.id, 1.8);
        if (!p) break;
        if (e.ability === 'roar') { this.ring(p, '#ffe14a', 9, 0.6); this.fx.emit('spark', p, 20, { spread: 0.6 }); }
        if (e.ability === 'honk') { this.ring(p, '#c77dff', 6, 0.6); this.fx.emit('note', p, 12, { spread: 0.5 }); }
        if (e.ability === 'club') this.ring(p.setY(p.y - 1.2), '#ffffff', 4, 0.35);
        if (e.ability === 'spikes') this.fx.emit('spark', p, 24, { spread: 0.8, tint: '#ff6a3d' });
        if (e.ability === 'pounce' || e.ability === 'headbutt') this.fx.emit('dust', p.setY(p.y - 1.7), 18, { spread: 0.6 });
        break;
      }
      case 'steal': { const p = at(e.id, 2.4); if (p) this.fx.emit('note', p, 16, { spread: 0.5 }); break; }
      case 'overheat': { const p = at(e.id, 2.4); if (p) this.fx.emit('steam', p, 40, { spread: 0.5 }); break; }
      case 'finish': { const p = at(e.id, 2); if (p) this.fx.emit('confetti', p, e.id === me ? 160 : 50, { spread: 1 }); break; }
      case 'item': {
        const p = at(e.id, 1.6);
        if (p && (e.item === 'pin' || e.item === 'ash')) this.ring(p, e.item === 'pin' ? '#ff6bd6' : '#777', 14, 0.9);
        if (p && e.item === 'water') this.fx.emit('mist', p.setY(p.y + 1), 40, { spread: 0.6 });
        break;
      }
      case 'shield': { const p = at(e.id, 1.4); if (p) this.fx.emit('spark', p, 30, { spread: 0.9, tint: '#ffb020' }); break; }
      default: break;
    }
  }

  // An expanding shockwave ring on the ground.
  ring(p, color, radius, life) {
    const m = new THREE.Mesh(this.ringGeom, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }));
    m.position.copy(p);
    m.rotation.x = -Math.PI / 2;
    this.scene.add(m);
    this.transients.push({ m, age: 0, life, radius });
  }

  // --------------------------------------------------------------- frame
  update(view, dt, t) {
    if (!this.scene) return;
    if (view.time > 1 && t - this.loadedAt > 5) this.adapt(dt);
    this.clock.value = t;
    const { track, fx, props } = this;
    this.lastRunners = new Map(view.runners.map((r) => [r.id, r]));
    const me = this.lastRunners.get(this.meId) || [...view.runners].sort((a, b) => a.place - b.place)[0];

    const o = {};
    for (const r of view.runners) {
      const M = this.models.get(r.id);
      if (!M) continue;
      M.phase += r.v * dt * 1.1;
      track.pose(r.x, r.y, o);
      const root = M.m.root;
      root.position.copy(o.p);
      root.position.y += r.z;
      const dy = M.prevY === null ? 0 : (r.y - M.prevY) / Math.max(dt, 1e-3);
      M.prevY = r.y;
      M.turn += (THREE.MathUtils.clamp(dy / 4.6, -1, 1) - M.turn) * damp(8, dt);
      const yaw = Math.atan2(o.t.x, o.t.z) - M.turn * 0.32;
      M.yaw = M.yaw === null ? yaw : angleLerp(M.yaw, yaw, damp(10, dt));
      root.rotation.y = M.yaw;
      M.m.update({ v: r.v, z: r.z, fx: r.fx, taunt: r.taunt, finished: !!r.finished, heat: r.heat, phase: M.phase, turn: M.turn }, dt, t);
      M.blob.position.set(root.position.x, root.position.y - r.z + 0.03, root.position.z);
      const bs = 1.7 / (1 + r.z * 0.6);
      M.blob.scale.set(bs, 1, bs * 1.25);
      M.blob.rotation.y = M.yaw;
      M.blob.material.opacity = 1 / (1 + r.z * 1.5);
      M.m.setTag(`${r.place}. ${r.name}`, r.id === this.meId);
      const camD = root.position.distanceTo(this.camera.position);
      M.m.showTag(r.id === this.meId ? camD > 3 : camD > 4 && camD < 70);

      // footfall dust, overheating steam, boba trail, charge streaks
      M.puff += dt;
      const near = r.id === this.meId || root.position.distanceToSquared(this.camera.position) < 60 * 60;
      if (near && M.puff > 0.07) {
        M.puff = 0;
        const foot = root.position.clone().add(new THREE.Vector3(0, 0.1, 0)).addScaledVector(o.t, -0.3);
        if (r.v > 3 && r.z < 0.05) fx.emit({ stadium: 'redDust', jungle: 'dust', volcano: 'ashDust' }[track.theme], foot, 1, { spread: 0.25 });
        if (r.fx & FX.overheat || r.heat > 0.85) fx.emit('steam', root.position.clone().add(new THREE.Vector3(0, 2.5, 0)), 2, { spread: 0.25 });
        if (r.fx & FX.boost) fx.emit('boba', root.position.clone().add(new THREE.Vector3(0, 1.2, 0)).addScaledVector(o.t, -0.6), 3, { spread: 0.2 });
        if (r.fx & (FX.charge | FX.dash)) {
          for (let k = 0; k < 3; k++) {
            const p = root.position.clone().add(new THREE.Vector3(0, 0.6 + Math.random() * 1.6, 0)).addScaledVector(o.r, (Math.random() - 0.5) * 1.6);
            fx.emit('speed', p, 1, { spread: 0.05, vel: o.t.clone().multiplyScalar(-14) });
          }
        }
        if (r.fx & FX.slow) fx.emit('smoke', foot, 1, { spread: 0.3, tint: '#111111' });
        if (r.fx & FX.soaked) fx.emit('drip', root.position.clone().add(new THREE.Vector3(0, 0.5 + Math.random() * 1.5, 0)), 3, { spread: 0.45 });
      }
      // Water Blaster jet: a stream from the nozzle along the runner's heading
      if (r.fx & FX.spray && M.m.muzzle(this.tmpV)) {
        const dir = root.getWorldDirection(this.tmpD);
        // droplets launched at slightly different speeds spread out into a stream
        for (let k = 0; k < 3; k++) {
          const vel = this.tmpW.copy(dir).multiplyScalar(r.v + 11 + k * 2.5);
          vel.y += 1.1;
          fx.emit('jet', this.tmpV, 5, { spread: 0.03, vel });
        }
      }
    }

    props.updateEggs(view.hiddenEggs, t, dt, this.camera);
    props.syncHazards(view.hazards, t);
    props.syncProjectiles(view.projectiles, t, fx);
    props.setStartLights(view.time);
    props.mascot.update({ v: 0, z: 0, fx: 0, taunt: Math.sin(t * 0.8) > 0.6, finished: true, heat: 0, phase: t * 3 }, dt, t);
    this.ambient(dt, t, view, me);

    for (const tr of this.transients) {
      tr.age += dt;
      const f = tr.age / tr.life;
      tr.m.scale.setScalar(0.5 + f * tr.radius);
      tr.m.material.opacity = 0.9 * (1 - f);
    }
    this.transients = this.transients.filter((tr) => {
      if (tr.age < tr.life) return true;
      this.scene.remove(tr.m); tr.m.material.dispose();
      return false;
    });

    this.updateCamera(me, view, dt, t);
    this.sun.target.position.copy(this.camLook);
    this.sun.position.copy(this.camLook).addScaledVector(this.sunDir, 120);
    fx.update(dt, this.camera, this.renderer);
    if (this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, this.camera);
  }

  ambient(dt, t, view, me) {
    const { fx, scenery, track } = this;
    const lava = T.lavaTexture();
    lava.offset.x = (lava.offset.x + dt * 0.03) % 1;
    lava.offset.y = (lava.offset.y + dt * 0.011) % 1;
    const cam = this.camera.position;
    for (const a of scenery.anim) {
      if (a.smoke && Math.random() < dt * 8) fx.emit('smoke', a.smoke, 1, { spread: 4, vel: new THREE.Vector3(1.5, 3, 0) });
      if (a.lava && Math.random() < dt * 10) fx.emit('ember', a.smoke, 2, { spread: 3, vel: new THREE.Vector3(0, 6, 0) });
      if (a.flags) a.flags.forEach((f, i) => { f.rotation.y = Math.sin(t * 2.2 + i) * 0.35; });
      if (a.screen && t - this.screenT > 0.5) { this.screenT = t; this.drawScreen(a.screen, view); }
      if (a.sky) a.sky.time.value = t;
    }
    scenery.root.children.forEach((c) => { if (c.userData.drift) c.rotation.y += dt * 0.004; });
    const around = (n, r, h) => cam.clone().add(new THREE.Vector3((Math.random() - 0.5) * r, h + (Math.random() - 0.5) * r * 0.4, (Math.random() - 0.5) * r));
    if (track.theme === 'jungle' && Math.random() < dt * 14) fx.emit('firefly', around(1, 30, 0), 1, { spread: 0 });
    if (track.theme === 'volcano') {
      if (Math.random() < dt * 30) fx.emit('ash', around(1, 40, 8), 1, { spread: 0 });
      if (Math.random() < dt * 12) fx.emit('ember', around(1, 30, -1), 1, { spread: 0 });
    }
    for (const w of this.props.mistEmitters) {
      const o = track.pose(w.x, 3);
      if (o.p.distanceToSquared(cam) > 80 * 80) continue;
      for (let i = 0; i < 3; i++) {
        const a = Math.random() * Math.PI;
        const p = o.p.clone().addScaledVector(o.r, Math.cos(a) * (HALF + 1.2)).add(new THREE.Vector3(0, Math.sin(a) * (HALF + 1.2), 0));
        fx.emit('mist', p, 1, { spread: 0.2 });
      }
    }
  }

  drawScreen(s, view) {
    const g = s.canvas.getContext('2d');
    const leader = [...view.runners].sort((a, b) => a.place - b.place)[0];
    const grd = g.createLinearGradient(0, 0, 0, 512);
    grd.addColorStop(0, '#10233f'); grd.addColorStop(1, '#050a14');
    g.fillStyle = grd; g.fillRect(0, 0, 1024, 512);
    g.fillStyle = '#ffd84a'; g.font = '900 64px system-ui, sans-serif'; g.textAlign = 'center';
    g.fillText('DINO RUN 2027 · 最速恐龍', 512, 90);
    g.fillStyle = '#ffffff'; g.font = 'bold 44px system-ui, sans-serif';
    g.fillText(view.time < 0 ? 'GET READY!' : 'LEADER', 512, 190);
    g.font = '900 96px system-ui, sans-serif';
    g.fillStyle = leader?.color || '#fff';
    g.fillText(leader ? leader.name : '', 512, 300);
    g.fillStyle = '#9fd1ff'; g.font = 'bold 60px system-ui, sans-serif';
    g.fillText(`${Math.max(0, view.time).toFixed(1)} s`, 512, 410);
    s.tex.needsUpdate = true;
  }

  updateCamera(me, view, dt, t) {
    const { track } = this;
    const me3 = track.pose(me.x, me.y).p.clone().add(new THREE.Vector3(0, me.z, 0));
    const behind = track.pose(me.x - 6.8, 3 + (me.y - 3) * 0.6).p.clone();
    let desired = behind.add(new THREE.Vector3(0, 3.0 + me.z * 0.5, 0));
    let look = track.pose(me.x + 5.5, 3 + (me.y - 3) * 0.8).p.clone().add(new THREE.Vector3(0, 1.3 + me.z * 0.6, 0));

    if (view.time < 0) {
      // grid intro: start in front of your runner and swing round behind
      const k = THREE.MathUtils.smoothstep(view.time, -2.6, -0.2);
      const off = desired.clone().sub(me3).applyAxisAngle(UP, (1 - k) * Math.PI * 0.85);
      off.multiplyScalar(1 + (1 - k) * 0.25);
      off.y += (1 - k) * 1.2;
      desired = me3.clone().add(off);
      look = me3.clone().add(new THREE.Vector3(0, 1.6, 0)).lerp(look, k);
    } else if (me.finished) {
      const a = t * 0.35;
      desired = me3.clone().add(new THREE.Vector3(Math.cos(a) * 6.5, 2.4, Math.sin(a) * 6.5));
      look = me3.clone().add(new THREE.Vector3(0, 1.5, 0));
    }
    const minY = Math.max(track.heightAt(me.x - 6.8), me3.y - me.z) + 1.2;
    desired.y = Math.max(desired.y, minY);

    if (!this.camPos) { this.camPos = desired.clone(); this.camLook = look.clone(); }
    this.camPos.lerp(desired, damp(view.time < 0 ? 3 : 6, dt));
    this.camLook.lerp(look, damp(9, dt));
    this.shake = Math.max(0, this.shake - dt * 1.6);
    const sh = this.shake * this.shake * 0.35;
    this.camera.position.copy(this.camPos).add(new THREE.Vector3((Math.random() - 0.5) * sh, (Math.random() - 0.5) * sh, (Math.random() - 0.5) * sh));
    this.camera.lookAt(this.camLook);
    const turn = this.models.get(me.id)?.turn || 0;
    this.camRoll += (turn * 0.045 - this.camRoll) * damp(4, dt);
    this.camera.rotateZ(this.camRoll);
    const fov = 60 + THREE.MathUtils.clamp((me.v - 8.5) * 2.4, 0, 14) + (me.fx & FX.boost ? 4 : 0);
    this.camera.fov = THREE.MathUtils.lerp(this.camera.fov, fov, damp(4, dt));
    this.camera.updateProjectionMatrix();
  }
}
