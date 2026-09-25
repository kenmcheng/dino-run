// Procedurally painted canvas textures: no image assets anywhere.
import * as THREE from 'three';

const cache = new Map();

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}

function tex(c, { repeat = [1, 1], srgb = true, wrap = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (wrap) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  t.repeat.set(...repeat);
  t.anisotropy = 8;
  return t;
}

function once(key, make) {
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key);
}

// Seeded noise so textures look the same every load.
function rng(seed) {
  let s = seed;
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
}

function speckle(g, w, h, n, colors, rMin, rMax, seed = 7) {
  const r = rng(seed);
  for (let i = 0; i < n; i++) {
    g.fillStyle = colors[Math.floor(r() * colors.length)];
    g.globalAlpha = 0.25 + r() * 0.5;
    g.beginPath();
    g.arc(r() * w, r() * h, rMin + r() * (rMax - rMin), 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;
}

// ------------------------------------------------------------ track surfaces
// u runs across the track (0 = left edge, 1 = right edge), v along it.
export function trackTexture(theme, lanes) {
  return once(`track-${theme}`, () => {
    const [c, g] = canvas(512, 512);
    if (theme === 'stadium') {
      g.fillStyle = '#b8452f'; g.fillRect(0, 0, 512, 512);
      speckle(g, 512, 512, 9000, ['#c9563d', '#9d3826', '#d4674b'], 0.6, 1.6, 3);
      g.fillStyle = '#f7f3ea';
      for (let i = 0; i <= lanes; i++) {
        const x = Math.round((i / lanes) * 504) + 2;
        g.fillRect(x - 3, 0, 6, 512);
      }
    } else if (theme === 'jungle') {
      g.fillStyle = '#8a6440'; g.fillRect(0, 0, 512, 512);
      speckle(g, 512, 512, 5000, ['#6f4f31', '#a07a52', '#5e4128', '#b08a60'], 1, 5, 11);
      // tyre-like ruts from earlier racers
      g.strokeStyle = 'rgba(60,40,20,0.25)'; g.lineWidth = 18;
      for (const x of [150, 360]) { g.beginPath(); g.moveTo(x, 0); g.bezierCurveTo(x + 30, 170, x - 30, 340, x, 512); g.stroke(); }
      speckle(g, 512, 512, 60, ['#7e8a4a', '#5d7a38'], 4, 10, 5);
    } else {
      g.fillStyle = '#2d2628'; g.fillRect(0, 0, 512, 512);
      speckle(g, 512, 512, 7000, ['#3b3235', '#1f1a1c', '#463b3e'], 1, 4, 13);
      // glowing cracks
      const r = rng(21);
      g.strokeStyle = '#ff6a1a'; g.lineWidth = 2.5; g.shadowColor = '#ff8a2a'; g.shadowBlur = 8;
      for (let i = 0; i < 14; i++) {
        let x = r() * 512; let y = r() * 512;
        g.beginPath(); g.moveTo(x, y);
        for (let k = 0; k < 6; k++) { x += (r() - 0.5) * 60; y += r() * 50; g.lineTo(x, y); }
        g.stroke();
      }
      g.shadowBlur = 0;
    }
    return tex(c);
  });
}

export function groundTexture(theme) {
  return once(`ground-${theme}`, () => {
    const [c, g] = canvas(512, 512);
    if (theme === 'volcano') {
      g.fillStyle = '#231c1d'; g.fillRect(0, 0, 512, 512);
      speckle(g, 512, 512, 6000, ['#2e2526', '#171213', '#3a2f2f', '#4a2a20'], 1, 6, 17);
    } else {
      g.fillStyle = theme === 'jungle' ? '#3f6d2f' : '#4f9a45';
      g.fillRect(0, 0, 512, 512);
      const blades = theme === 'jungle' ? ['#365f28', '#4c7d36', '#2d5021', '#5a8a3d'] : ['#5aa84f', '#43873b', '#63b457', '#3d7a35'];
      const r = rng(theme === 'jungle' ? 5 : 9);
      for (let i = 0; i < 14000; i++) {
        g.strokeStyle = blades[Math.floor(r() * blades.length)];
        g.globalAlpha = 0.5;
        const x = r() * 512; const y = r() * 512;
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 3, y - 3 - r() * 5); g.stroke();
      }
      g.globalAlpha = 1;
      if (theme === 'jungle') speckle(g, 512, 512, 120, ['#6b4f30', '#553c24'], 6, 16, 3);
    }
    return tex(c, { repeat: [60, 60] });
  });
}

export function lavaTexture() {
  return once('lava', () => {
    const [c, g] = canvas(256, 256);
    const grd = g.createLinearGradient(0, 0, 256, 256);
    grd.addColorStop(0, '#ff5a00'); grd.addColorStop(0.5, '#ffb000'); grd.addColorStop(1, '#ff3d00');
    g.fillStyle = grd; g.fillRect(0, 0, 256, 256);
    speckle(g, 256, 256, 260, ['#5a1500', '#8a2600', '#3a0d00'], 4, 18, 31);
    speckle(g, 256, 256, 200, ['#fff2a0', '#ffd24a'], 1, 5, 32);
    return tex(c, { repeat: [3, 3] });
  });
}

export function pitchTexture() {
  return once('pitch', () => {
    const [c, g] = canvas(1024, 660);
    for (let i = 0; i < 12; i++) { g.fillStyle = i % 2 ? '#4c9a42' : '#58a84c'; g.fillRect((i * 1024) / 12, 0, 1024 / 12 + 1, 660); }
    g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 6;
    g.strokeRect(20, 20, 984, 620);
    g.beginPath(); g.moveTo(512, 20); g.lineTo(512, 640); g.stroke();
    g.beginPath(); g.arc(512, 330, 90, 0, Math.PI * 2); g.stroke();
    g.strokeRect(20, 180, 160, 300); g.strokeRect(844, 180, 160, 300);
    g.strokeRect(20, 250, 60, 160); g.strokeRect(944, 250, 60, 160);
    // a giant footprint painted in the middle of the pitch
    g.fillStyle = 'rgba(255,255,255,0.35)';
    g.beginPath(); g.ellipse(512, 350, 40, 55, 0, 0, Math.PI * 2); g.fill();
    for (const [dx, dy, r] of [[-45, -70, 14], [0, -95, 16], [45, -70, 14]]) {
      g.beginPath(); g.ellipse(512 + dx, 350 + dy, r * 0.8, r * 1.6, dx * 0.01, 0, Math.PI * 2); g.fill();
    }
    return tex(c, { wrap: false });
  });
}

// ------------------------------------------------------------ bibs
export function bibTexture(number, name) {
  const [c, g] = canvas(256, 192);
  g.fillStyle = '#fbfbf6'; g.fillRect(0, 0, 256, 192);
  g.fillStyle = '#e5484d'; g.fillRect(0, 0, 256, 38);
  g.fillStyle = '#fff'; g.font = 'bold 22px system-ui, sans-serif'; g.textAlign = 'center';
  g.fillText('DINO RUN 2027', 128, 27);
  g.fillStyle = '#111'; g.font = '900 96px system-ui, sans-serif';
  g.fillText(String(number).padStart(3, '0'), 128, 132);
  g.font = 'bold 22px system-ui, sans-serif';
  g.fillText(String(name).slice(0, 16).toUpperCase(), 128, 172);
  g.strokeStyle = '#ccc'; g.lineWidth = 4; g.strokeRect(2, 2, 252, 188);
  return tex(c, { wrap: false });
}

// ------------------------------------------------------------ signage
export function signTexture(text, { bg = '#ffd84a', fg = '#3a2000', w = 512, h = 128, font = 'bold 64px system-ui, sans-serif' } = {}) {
  return once(`sign-${text}-${bg}-${fg}-${w}x${h}`, () => {
    const [c, g] = canvas(w, h);
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.fillStyle = fg; g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, w / 2, h / 2 + 4);
    return tex(c, { wrap: false });
  });
}

export function checkerTexture() {
  return once('checker', () => {
    const [c, g] = canvas(256, 64);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 16; x++) { g.fillStyle = (x + y) % 2 ? '#111' : '#fff'; g.fillRect(x * 16, y * 16, 16, 16); }
    const t = tex(c);
    t.magFilter = THREE.NearestFilter;
    return t;
  });
}

export function stripeTexture(a, b, n = 8) {
  return once(`stripe-${a}-${b}-${n}`, () => {
    const [c, g] = canvas(256, 32);
    for (let i = 0; i < n; i++) { g.fillStyle = i % 2 ? b : a; g.fillRect((i * 256) / n, 0, 256 / n + 1, 32); }
    return tex(c);
  });
}

export function barkTexture() {
  return once('bark', () => {
    const [c, g] = canvas(128, 256);
    g.fillStyle = '#6b4a2b'; g.fillRect(0, 0, 128, 256);
    const r = rng(41);
    g.strokeStyle = '#4a321c'; g.lineWidth = 3;
    for (let i = 0; i < 26; i++) {
      const x = r() * 128; g.beginPath(); g.moveTo(x, 0);
      for (let y = 0; y < 256; y += 32) g.lineTo(x + (r() - 0.5) * 10, y);
      g.stroke();
    }
    speckle(g, 128, 256, 40, ['#4f7a2f', '#6a9a3a'], 3, 9, 42);
    return tex(c);
  });
}

// Text label rendered to a canvas, returned with its aspect ratio (for sprites).
export function labelCanvas(text, { bg = 'rgba(20,20,30,0.7)', fg = '#fff', size = 42 } = {}) {
  const [c, g] = canvas(8, 8);
  g.font = `bold ${size}px system-ui, sans-serif`;
  const w = Math.ceil(g.measureText(text).width) + size;
  c.width = w; c.height = Math.round(size * 1.6);
  g.font = `bold ${size}px system-ui, sans-serif`;
  g.fillStyle = bg;
  g.beginPath(); g.roundRect(0, 0, c.width, c.height, c.height / 2); g.fill();
  g.fillStyle = fg; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, c.width / 2, c.height / 2 + 2);
  return c;
}

export function roundSprite() {
  return once('round', () => {
    const [c, g] = canvas(64, 64);
    const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.5, 'rgba(255,255,255,0.6)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
    return tex(c, { wrap: false, srgb: false });
  });
}

export function starTexture() {
  return once('star', () => {
    const [c, g] = canvas(64, 64);
    g.fillStyle = '#ffd84a'; g.strokeStyle = '#b8860b'; g.lineWidth = 3;
    g.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? 12 : 28; const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
      g.lineTo(32 + Math.cos(a) * r, 32 + Math.sin(a) * r);
    }
    g.closePath(); g.fill(); g.stroke();
    return tex(c, { wrap: false });
  });
}

// ------------------------------------------------------------ costume fabric
// Costume UV convention (swept bodies): u runs along the spine, v runs around
// the body: v=0 belly seam, 0.25 right side, 0.5 dorsal seam, 0.75 left side.

function valueNoise(seed) {
  const r = rng(seed);
  const N = 256;
  const g = new Float32Array(N * N).map(() => r());
  const at = (x, y) => g[((y & (N - 1)) * N) + (x & (N - 1))];
  return (x, y) => {
    const xi = Math.floor(x); const yi = Math.floor(y);
    const fx = x - xi; const fy = y - yi;
    const sx = fx * fx * (3 - 2 * fx); const sy = fy * fy * (3 - 2 * fy);
    const a = at(xi, yi) + (at(xi + 1, yi) - at(xi, yi)) * sx;
    const b = at(xi, yi + 1) + (at(xi + 1, yi + 1) - at(xi, yi + 1)) * sx;
    return a + (b - a) * sy;
  };
}

// Normal map: stitched panel seams, soft inflation creases and a nylon weave.
export function fabricNormalTexture() {
  return once('fabricNormal', () => {
    const W = 1024; const H = 512;
    const h = new Float32Array(W * H);
    const n1 = valueNoise(11); const n2 = valueNoise(23);
    const seams = [0, 0.25, 0.5, 0.75, 1].map((f) => f * H);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        // creases run around the body (stretched along v)
        let v = (n1(x / 90, y / 14) - 0.5) * 1.4 + (n2(x / 30, y / 6) - 0.5) * 0.5;
        v += Math.sin(x * 1.7) * Math.sin(y * 1.7) * 0.05; // weave
        for (const sy of seams) {
          const d = Math.abs(y - sy);
          if (d < 6) {
            v -= 1.6 * Math.exp(-(d * d) / 3);
            if (d > 2.5 && d < 5 && x % 9 < 4) v += 0.9; // stitches either side
          }
        }
        h[y * W + x] = v;
      }
    }
    const [c, g] = canvas(W, H);
    const img = g.createImageData(W, H);
    const k = 2.2;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const hx = h[y * W + ((x + 1) % W)] - h[y * W + ((x - 1 + W) % W)];
        const hy = h[((y + 1) % H) * W + x] - h[((y - 1 + H) % H) * W + x];
        let nx = -hx * k; let ny = -hy * k; let nz = 1;
        const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
        const i = (y * W + x) * 4;
        img.data[i] = (nx * 0.5 + 0.5) * 255;
        img.data[i + 1] = (ny * 0.5 + 0.5) * 255;
        img.data[i + 2] = (nz * 0.5 + 0.5) * 255;
        img.data[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    return tex(c, { srgb: false });
  });
}

// Printed markings, as a greyscale multiply map in the costume UV convention.
export function costumePattern(kind) {
  return once(`costume-${kind}`, () => {
    const W = 1024; const H = 512;
    const [c, g] = canvas(W, H);
    g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
    const r = rng(kind.length * 131 + 7);
    const ink = 'rgba(40,40,40,0.34)';
    g.fillStyle = ink;
    const dorsal = H * 0.5;
    if (kind === 'stripes' || kind === 'tiger') {
      const n = kind === 'tiger' ? 26 : 16;
      for (let i = 0; i < n; i++) {
        const x = (i / n) * W + r() * 20;
        const wdt = kind === 'tiger' ? 8 + r() * 8 : 16 + r() * 14;
        const reach = H * (0.16 + r() * 0.1);
        g.beginPath();
        g.moveTo(x - wdt, dorsal);
        g.quadraticCurveTo(x - wdt * 0.2, dorsal - reach * 0.6, x + wdt * 0.6, dorsal - reach);
        g.quadraticCurveTo(x + wdt * 0.4, dorsal - reach * 0.4, x + wdt, dorsal);
        g.quadraticCurveTo(x + wdt * 0.4, dorsal + reach * 0.4, x + wdt * 0.6, dorsal + reach);
        g.quadraticCurveTo(x - wdt * 0.2, dorsal + reach * 0.6, x - wdt, dorsal);
        g.fill();
      }
    } else if (kind === 'spots') {
      for (let i = 0; i < 70; i++) {
        const y = dorsal + (r() - 0.5) * H * 0.42;
        g.beginPath(); g.ellipse(r() * W, y, 8 + r() * 22, 6 + r() * 14, r() * 3, 0, Math.PI * 2); g.fill();
      }
    } else if (kind === 'scales') {
      g.strokeStyle = 'rgba(40,40,40,0.18)'; g.lineWidth = 3;
      for (let y = H * 0.2; y < H * 0.8; y += 18) {
        for (let x = (y / 18) % 2 ? 9 : 0; x < W; x += 18) { g.beginPath(); g.arc(x, y, 9, 0, Math.PI); g.stroke(); }
      }
    } else if (kind === 'patches') {
      for (let i = 0; i < 60; i++) {
        const cx = r() * W; const cy = dorsal + (r() - 0.5) * H * 0.5; const rr = 12 + r() * 18;
        g.beginPath();
        for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2; g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); }
        g.fill();
      }
    }
    return tex(c);
  });
}

export function irisTexture(color) {
  return once(`iris-${color}`, () => {
    const [c, g] = canvas(128, 128);
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, 128, 128);
    const grd = g.createRadialGradient(64, 64, 8, 64, 64, 46);
    grd.addColorStop(0, '#111'); grd.addColorStop(0.32, '#111');
    grd.addColorStop(0.36, color); grd.addColorStop(0.9, color); grd.addColorStop(1, '#222');
    g.fillStyle = grd; g.beginPath(); g.arc(64, 64, 46, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 2;
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      g.beginPath(); g.moveTo(64 + Math.cos(a) * 18, 64 + Math.sin(a) * 18); g.lineTo(64 + Math.cos(a) * 42, 64 + Math.sin(a) * 42); g.stroke();
    }
    g.fillStyle = 'rgba(255,255,255,0.95)';
    g.beginPath(); g.ellipse(48, 46, 10, 8, -0.5, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.arc(78, 80, 4, 0, Math.PI * 2); g.fill();
    return tex(c, { wrap: false });
  });
}

// The runner's face seen through the costume window.
export function humanFace(mood = 'happy', skin = '#f1c9a5', hair = '#3b2a20') {
  return once(`human-${mood}-${skin}-${hair}`, () => {
    const [c, g] = canvas(256, 256);
    const grd = g.createRadialGradient(128, 120, 20, 128, 140, 150);
    grd.addColorStop(0, mood === 'hot' ? '#f7a88f' : skin);
    grd.addColorStop(1, '#b07a5a');
    g.fillStyle = grd; g.fillRect(0, 0, 256, 256);
    g.fillStyle = hair;
    g.beginPath(); g.ellipse(128, 18, 150, 62, 0, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.ellipse(40, 60, 30, 50, 0.3, 0, Math.PI * 2); g.fill();
    // sweatband
    g.fillStyle = '#e5484d'; g.fillRect(0, 64, 256, 16);
    g.fillStyle = '#fff'; g.fillRect(0, 70, 256, 3);
    const eyeY = 120;
    if (mood === 'dizzy') {
      g.strokeStyle = '#2a1a14'; g.lineWidth = 7; g.lineCap = 'round';
      for (const x of [86, 170]) {
        g.beginPath();
        for (let a = 0; a < 12; a += 0.3) g.lineTo(x + Math.cos(a) * a * 1.4, eyeY + Math.sin(a) * a * 1.4);
        g.stroke();
      }
      g.beginPath(); g.ellipse(128, 190, 18, 12, 0, 0, Math.PI * 2); g.stroke();
    } else {
      for (const x of [86, 170]) {
        g.fillStyle = '#fff'; g.beginPath(); g.ellipse(x, eyeY, 17, 13, 0, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#4a2e1c'; g.beginPath(); g.arc(x + 2, eyeY + 1, 9, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#111'; g.beginPath(); g.arc(x + 2, eyeY + 1, 5, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#fff'; g.beginPath(); g.arc(x - 2, eyeY - 3, 3, 0, Math.PI * 2); g.fill();
        g.strokeStyle = hair; g.lineWidth = 6; g.lineCap = 'round';
        g.beginPath(); g.moveTo(x - 18, eyeY - (mood === 'hot' ? 18 : 24)); g.quadraticCurveTo(x, eyeY - 32, x + 18, eyeY - 22); g.stroke();
      }
      g.fillStyle = 'rgba(160,90,70,0.5)';
      g.beginPath(); g.ellipse(128, 150, 9, 6, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#7a2a22';
      g.beginPath();
      if (mood === 'hot') { g.ellipse(128, 194, 20, 14, 0, 0, Math.PI * 2); }
      else { g.moveTo(92, 178); g.quadraticCurveTo(128, 222, 164, 178); g.quadraticCurveTo(128, 196, 92, 178); }
      g.fill();
      g.fillStyle = 'rgba(255,110,110,0.35)';
      for (const x of [58, 198]) { g.beginPath(); g.ellipse(x, 164, 20, 12, 0, 0, Math.PI * 2); g.fill(); }
      if (mood === 'hot') {
        g.fillStyle = 'rgba(140,210,255,0.9)';
        for (const [x, y] of [[210, 96], [40, 110], [222, 140]]) { g.beginPath(); g.ellipse(x, y, 7, 12, 0, 0, Math.PI * 2); g.fill(); }
      }
    }
    return tex(c, { wrap: false });
  });
}

export function sneakerTexture(color) {
  return once(`sneaker-${color}`, () => {
    const [c, g] = canvas(256, 128);
    g.fillStyle = color; g.fillRect(0, 0, 256, 128);
    g.fillStyle = 'rgba(255,255,255,0.85)';
    g.beginPath(); g.moveTo(30, 90); g.quadraticCurveTo(140, 110, 230, 40); g.quadraticCurveTo(150, 86, 40, 76); g.fill();
    g.fillStyle = 'rgba(0,0,0,0.12)';
    for (let y = 8; y < 128; y += 10) for (let x = (y / 10) % 2 ? 5 : 0; x < 256; x += 10) g.fillRect(x, y, 3, 3);
    return tex(c, { wrap: false });
  });
}
