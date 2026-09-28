// Title-screen turntable preview and costume thumbnails.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildDino } from './dino3d.js';
import * as Assets from './assets.js';

function stage(renderer) {
  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.6;
  scene.add(new THREE.HemisphereLight('#fff6e0', '#44603a', 1.2));
  const key = new THREE.DirectionalLight('#ffffff', 2.4);
  key.position.set(3, 6, 4);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -3; key.shadow.camera.right = 3; key.shadow.camera.top = 4; key.shadow.camera.bottom = -2;
  scene.add(key);
  const rim = new THREE.DirectionalLight('#9fd1ff', 1.4);
  rim.position.set(-4, 3, -4);
  scene.add(rim);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(4, 48), new THREE.ShadowMaterial({ opacity: 0.28 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  return scene;
}

export class Studio {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.scene = stage(this.renderer);
    // a little podium with a race-track stripe
    const podium = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.6, 0.25, 48), new THREE.MeshStandardMaterial({ color: '#c8553d', roughness: 0.8 }));
    podium.position.y = -0.125; podium.receiveShadow = true;
    const band = new THREE.Mesh(new THREE.TorusGeometry(1.55, 0.03, 6, 64), new THREE.MeshStandardMaterial({ color: '#ffffff' }));
    band.rotation.x = Math.PI / 2;
    this.scene.add(podium, band);
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
    this.camera.position.set(3.4, 2.4, 5.6);
    this.camera.lookAt(0, 1.35, 0);
    this.model = null;
    this.key = '';
    this.spin = 0;
  }

  show(dino, color, name) {
    // the key includes the model kind, so the turntable swaps to the Blender
    // costume as soon as it finishes loading
    const key = `${dino}|${color}|${name}|${Assets.get('costumes', dino) ? 'hd' : 'classic'}`;
    if (key === this.key) return;
    this.key = key;
    if (this.model) { this.scene.remove(this.model.root); this.model.dispose(); }
    this.model = buildDino(dino, color, { number: 27, runner: name || 'YOU', ownTextures: true });
    this.scene.add(this.model.root);
    this.hop = 0.35;
  }

  frame(t, dt) {
    const w = this.canvas.clientWidth; const h = this.canvas.clientHeight;
    if (!w || !h || !this.model) return;
    const size = this.renderer.getSize(new THREE.Vector2());
    if (size.x !== w || size.y !== h) {
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
    this.spin += dt * 0.6;
    this.hop = Math.max(0, (this.hop || 0) - dt);
    const m = this.model;
    m.root.rotation.y = this.hold ?? Math.sin(this.spin) * 0.9 + 0.35;
    m.root.position.y = Math.sin((this.hop / 0.35) * Math.PI) * 0.35;
    m.update({ v: 4.5, z: 0, fx: 0, taunt: Math.sin(t * 0.9) > 0.85, finished: false, heat: 0, phase: t * 5 }, dt, t);
    this.renderer.render(this.scene, this.camera);
  }
}

// Offscreen renderer producing cached PNG thumbnails of each costume. It is
// released after a few idle seconds so its GPU memory isn't held all game.
let thumbRenderer = null;
let thumbScene = null;
let thumbCam = null;
let thumbIdle = 0;
const thumbs = new Map();

function releaseThumbRenderer() {
  thumbScene.environment?.dispose();
  thumbRenderer.dispose();
  thumbRenderer.forceContextLoss();
  thumbRenderer = null;
}

export function thumbnail(dino, color) {
  const key = `${dino}|${color}|${Assets.get('costumes', dino) ? 'hd' : 'classic'}`;
  if (thumbs.has(key)) return thumbs.get(key);
  clearTimeout(thumbIdle);
  thumbIdle = setTimeout(releaseThumbRenderer, 4000);
  if (!thumbRenderer) {
    thumbRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    thumbRenderer.setSize(220, 200, false);
    thumbRenderer.setPixelRatio(1);
    thumbRenderer.shadowMap.enabled = true;
    thumbRenderer.toneMapping = THREE.ACESFilmicToneMapping;
    thumbScene = stage(thumbRenderer);
    thumbCam = new THREE.PerspectiveCamera(30, 220 / 200, 0.1, 50);
    thumbCam.position.set(2.9, 1.9, 4.1);
    thumbCam.lookAt(0, 1.3, 0);
  }
  const m = buildDino(dino, color, { number: 0, runner: '', ownTextures: true });
  m.update({ v: 6, z: 0, fx: 0, taunt: false, finished: false, heat: 0, phase: 0.9 }, 1, 0);
  m.root.rotation.y = 0.5;
  thumbScene.add(m.root);
  thumbRenderer.render(thumbScene, thumbCam);
  const url = thumbRenderer.domElement.toDataURL('image/png');
  thumbScene.remove(m.root);
  m.dispose();
  thumbs.set(key, url);
  return url;
}

