// Tiny synthesized sound effects (no audio files).
let ac = null;
let muted = false;
try { muted = localStorage.getItem('dino-run-muted') === '1'; } catch { /* storage unavailable */ }

export function unlockAudio() {
  if (!ac) {
    try { ac = new AudioContext(); } catch { ac = null; }
  }
  if (ac?.state === 'suspended') ac.resume();
}

export function isMuted() { return muted; }

export function toggleMute() {
  muted = !muted;
  try { localStorage.setItem('dino-run-muted', muted ? '1' : '0'); } catch { /* ignore */ }
  return muted;
}

function tone(freq, dur, { type = 'square', vol = 0.08, slide = 0, delay = 0 } = {}) {
  if (!ac || muted) return;
  const t0 = ac.currentTime + delay;
  const o = ac.createOscillator();
  const g = ac.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t0 + dur);
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(ac.destination);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}

function noise(dur, vol = 0.15) {
  if (!ac || muted) return;
  const buf = ac.createBuffer(1, Math.floor(ac.sampleRate * dur), ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const s = ac.createBufferSource();
  const g = ac.createGain();
  g.gain.value = vol;
  s.buffer = buf;
  s.connect(g).connect(ac.destination);
  s.start();
}

export const sfx = {
  beep: () => tone(440, 0.15),
  go: () => tone(880, 0.35),
  pickup: () => { tone(660, 0.08); tone(990, 0.1, { delay: 0.07 }); },
  item: () => tone(520, 0.12, { type: 'triangle', slide: 300 }),
  jump: () => tone(300, 0.12, { type: 'triangle', slide: 250, vol: 0.05 }),
  hit: () => { noise(0.2, 0.2); tone(180, 0.25, { slide: -120 }); },
  boom: () => { noise(0.6, 0.3); tone(90, 0.5, { type: 'sawtooth', slide: -50 }); },
  roar: () => { tone(110, 0.5, { type: 'sawtooth', slide: -40, vol: 0.12 }); noise(0.4, 0.08); },
  honk: () => { tone(233, 0.35, { type: 'sawtooth', vol: 0.1 }); tone(311, 0.35, { type: 'sawtooth', vol: 0.06 }); },
  shield: () => tone(1200, 0.2, { type: 'sine', slide: -600 }),
  overheat: () => { tone(900, 0.1); tone(700, 0.1, { delay: 0.12 }); tone(500, 0.2, { delay: 0.24 }); },
  finish: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.2, { delay: i * 0.12, type: 'triangle' })),
  spray: () => { noise(0.9, 0.06); tone(1400, 0.6, { type: 'sine', slide: -300, vol: 0.02 }); },
  squeak: () => { tone(900, 0.09, { type: 'sine', slide: 900, vol: 0.1 }); tone(1500, 0.14, { type: 'sine', slide: -700, vol: 0.08, delay: 0.09 }); },
  splash: () => { noise(0.45, 0.22); tone(420, 0.2, { type: 'sine', slide: -300, vol: 0.06 }); },
  chirp: () => [0, 0.08, 0.16].forEach((d, i) => tone(1800 + i * 200, 0.06, { type: 'sine', slide: 600, vol: 0.05, delay: d })),
};
