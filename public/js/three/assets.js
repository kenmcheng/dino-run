// Blender-built models (public/assets, made by art/build.ps1 or art/build.sh).
//
// The game works without them: every model has a procedural fallback, used
// when the manifest or a file fails to load, while an asset is still
// downloading, and when the player picks "Classic" models.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const BASE = '/assets/';
const KEY = 'dino-run-models';

let pref = 'hd';
try { pref = localStorage.getItem(KEY) || 'hd'; } catch { /* private mode */ }
if (new URLSearchParams(location.search).has('classic')) pref = 'classic';

const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const texLoader = new THREE.TextureLoader();
const listeners = new Set();
const loaded = new Map(); // 'costumes/trex' -> asset
const pending = new Map(); // same key -> Promise<asset|null>
let manifestP = null;

// 'hd' (Blender models) or 'classic' (procedural models)
export function modelPref() { return pref; }
export function setModelPref(p) {
  pref = p === 'classic' ? 'classic' : 'hd';
  try { localStorage.setItem(KEY, pref); } catch { /* ignore */ }
  emit();
}

// Called whenever an asset finishes loading or the preference changes.
export function onAssets(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit() { for (const fn of listeners) fn(); }

export function manifest() {
  manifestP ||= fetch(`${BASE}manifest.json`, { cache: 'no-cache' })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
  return manifestP;
}

function texture(file, { color = false } = {}) {
  return new Promise((resolve, reject) => {
    texLoader.load(`${BASE}${file}`, (t) => {
      t.flipY = false; // glTF UV convention
      t.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      t.anisotropy = 4;
      resolve(t);
    }, undefined, reject);
  });
}

// Load one asset of a group ('costumes', 'props', 'scenery'). Resolves to null
// (never rejects) when it isn't available, so callers can fall back.
export function load(group, name) {
  const key = `${group}/${name}`;
  if (loaded.has(key)) return Promise.resolve(loaded.get(key));
  if (!pending.has(key)) {
    pending.set(key, (async () => {
      try {
        const man = await manifest();
        const entry = man?.[group]?.[name];
        if (!entry) return null;
        const dir = entry.file.slice(0, entry.file.lastIndexOf('/') + 1);
        const texJobs = [];
        const textures = {};
        for (const [mat, slots] of Object.entries(entry.textures || {})) {
          textures[mat] = {};
          for (const [slot, file] of Object.entries(slots)) {
            texJobs.push(texture(dir + file, { color: slot === 'color' }).then((t) => { textures[mat][slot] = t; }));
          }
        }
        const [gltf] = await Promise.all([loader.loadAsync(`${BASE}${entry.file}`), ...texJobs]);
        const asset = { name, group, entry, scene: gltf.scene, textures };
        loaded.set(key, asset);
        emit();
        return asset;
      } catch (err) {
        console.warn(`[assets] ${key} unavailable, using the procedural model`, err);
        return null;
      }
    })());
  }
  return pending.get(key);
}

// Synchronous lookup: the asset if HD models are on and it has finished loading.
export function get(group, name) {
  return pref === 'hd' ? loaded.get(`${group}/${name}`) || null : null;
}

// Wait for a set of assets (default: the whole group), but never longer than
// `timeout` ms.
export async function ready(group, names = null, timeout = 10000) {
  if (pref !== 'hd') return;
  const all = (async () => {
    const list = names || Object.keys((await manifest())?.[group] || {});
    await Promise.all([...new Set(list)].map((n) => load(group, n)));
  })();
  await Promise.race([all, new Promise((r) => setTimeout(r, timeout))]);
}

// A static asset, but only if it's loaded and has every mesh the caller needs
// (a stale or partial file then falls back instead of breaking the scene).
export function withMeshes(group, name, meshes) {
  const a = get(group, name);
  if (!a) return null;
  for (const m of meshes) {
    if (!geometry(a, m)) {
      console.warn(`[assets] ${group}/${name} has no '${m}' mesh, using the procedural model`);
      return null;
    }
  }
  return a;
}

// The geometry of one mesh in a static asset (meshes are named after their
// part: 'trunk', 'fronds', 'bone', ...). Shared: don't dispose it.
export function geometry(asset, mesh) {
  let g = null;
  asset.scene.traverse((o) => { if (!g && o.isMesh && o.name === mesh) g = o.geometry; });
  return g;
}

// A standard material on a static asset's baked atlas (colour, ORM, normal,
// optional glow mask). `emissive` turns the glow mask on in that colour.
export function material(asset, { emissive = null, emissiveIntensity = 1, physical = false, ...params } = {}) {
  const t = asset.textures.pbr;
  const Mat = physical ? THREE.MeshPhysicalMaterial : THREE.MeshStandardMaterial;
  const m = new Mat({
    map: t.color, aoMap: t.orm, roughnessMap: t.orm, metalnessMap: t.orm, normalMap: t.normal,
    normalScale: new THREE.Vector2(1, -1), // glTF tangents: flip green
    roughness: 1, metalness: 1, ...params,
  });
  if (emissive && t.emit) {
    m.emissive = new THREE.Color(emissive);
    m.emissiveMap = t.emit;
    m.emissiveIntensity = emissiveIntensity;
  }
  return m;
}
