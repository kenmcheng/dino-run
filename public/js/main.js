import {
  DINOS, ITEMS, COURSES, COSTUME_COLORS, FX,
} from '/shared/data.js';
import { Game3D } from './three/game3d.js';
import { Studio, thumbnail } from './three/studio.js';
import { sfx, unlockAudio, toggleMute, isMuted } from './audio.js';
import { Playout } from '/shared/playout.js';
import { Controls } from './controls.js';
import { Predictor } from './predict.js';
import { makeConnector } from './net.js';

const $ = (s) => document.querySelector(s);
const ORD = (n) => `${n}${['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) ? 0 : n % 10] || 'th'}`;

// --------------------------------------------------------------- profile
const store = {
  get() { try { return JSON.parse(localStorage.getItem('dino-run-profile')) || {}; } catch { return {}; } },
  set(p) { try { localStorage.setItem('dino-run-profile', JSON.stringify(p)); } catch { /* ignore */ } },
};
const saved = store.get();
const profile = {
  name: saved.name || '',
  dino: DINOS[saved.dino] ? saved.dino : 'trex',
  color: COSTUME_COLORS.includes(saved.color) ? saved.color : DINOS[saved.dino]?.color || DINOS.trex.color,
};

const S = {
  ws: null, myId: null, lobby: null, screen: 'title',
  race: null, results: null,
};

// ------------------------------------------------------------- screens
function show(name) {
  S.screen = name;
  for (const s of ['title', 'lobby', 'race']) $(`#screen-${s}`).classList.toggle('hidden', s !== name);
  if (name !== 'race') $('#results').classList.add('hidden');
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.h);
  toast.h = setTimeout(() => t.classList.remove('show'), 2600);
}

// ---------------------------------------------------------------- title
const cards = [];
function buildTitle() {
  $('#name').value = profile.name;
  $('#name').addEventListener('input', (e) => { profile.name = e.target.value; saveProfile(); });
  const grid = $('#dino-grid');
  for (const [id, d] of Object.entries(DINOS)) {
    const b = document.createElement('button');
    b.className = 'dino-card';
    b.innerHTML = `<img alt="">${d.name}`;
    b.addEventListener('click', () => {
      profile.dino = id;
      // follow the species colour unless the player picked a non-default one
      if (Object.values(DINOS).some((x) => x.color === profile.color)) profile.color = d.color;
      saveProfile();
      refreshTitle();
    });
    grid.append(b);
    cards.push({ id, el: b, img: b.querySelector('img') });
  }
  const sw = $('#swatches');
  for (const c of COSTUME_COLORS) {
    const b = document.createElement('button');
    b.className = 'swatch';
    b.style.background = c;
    b.dataset.color = c;
    b.addEventListener('click', () => { profile.color = c; saveProfile(); refreshTitle(); });
    sw.append(b);
  }
  const params = new URLSearchParams(location.search);
  if (params.get('room')) $('#join-code').value = params.get('room').toUpperCase().slice(0, 4);
  $('#btn-create').addEventListener('click', () => { unlockAudio(); connect({ t: 'create' }); });
  $('#btn-join').addEventListener('click', joinFromInput);
  $('#join-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinFromInput(); });
  refreshTitle();
}

function joinFromInput() {
  unlockAudio();
  const code = $('#join-code').value.trim().toUpperCase();
  if (code.length !== 4) { toast('Room codes are 4 characters'); return; }
  connect({ t: 'join', code });
}

function saveProfile() {
  store.set(profile);
  if (S.ws?.readyState === 1 && S.lobby) send({ t: 'profile', profile });
}

function refreshTitle() {
  for (const c of cards) c.el.classList.toggle('selected', c.id === profile.dino);
  for (const b of document.querySelectorAll('.swatch')) b.classList.toggle('selected', b.dataset.color === profile.color);
  const d = DINOS[profile.dino];
  const bar = (label, v) => `<div class="stat"><span>${label}</span><i><b style="width:${Math.round(v * 100)}%"></b></i></div>`;
  const norm = (v, lo, hi) => Math.max(0.08, (v - lo) / (hi - lo));
  $('#dino-info').innerHTML = `
    <div class="tag">${d.name} <i>${d.tagline}</i></div>
    ${bar('Speed', norm(d.top, 8.4, 9.6))}${bar('Accel', norm(d.accel, 4.5, 10))}
    ${bar('Cooling', norm(d.heatCap, 3, 6.5))}${bar('Weight', norm(d.mass, 0.5, 2))}
    <div class="ab">⚡ <b>${d.abilityName}</b> (Q) — ${d.abilityDesc}</div>`;
}

// Thumbnails are rendered one per frame so the title screen appears instantly.
function fillThumbnails() {
  const next = cards.find((c) => !c.img.src);
  if (!next) return;
  next.img.src = thumbnail(next.id, DINOS[next.id].color);
  requestAnimationFrame(fillThumbnails);
}

// ---------------------------------------------------------------- lobby
function renderLobby() {
  const L = S.lobby;
  const isHost = L.host === S.myId;
  $('#lobby-code').textContent = L.code;
  const ul = $('#lobby-players');
  ul.innerHTML = '';
  for (const p of L.players) {
    const li = document.createElement('li');
    const img = document.createElement('img');
    img.alt = '';
    img.src = thumbnail(p.dino, p.color);
    li.append(img);
    const label = document.createElement('div');
    label.innerHTML = `<b></b><br><small>${DINOS[p.dino].name}</small>`;
    label.querySelector('b').textContent = p.name + (p.id === S.myId ? ' (you)' : '');
    li.append(label);
    if (p.id === L.host) { const h = document.createElement('span'); h.className = 'host'; h.textContent = '👑 host'; li.append(h); }
    ul.append(li);
  }
  for (const el of document.querySelectorAll('.host-only')) el.classList.toggle('hidden', !isHost);
  $('#lobby-wait').classList.toggle('hidden', isHost);
  const cl = $('#course-list');
  cl.innerHTML = '';
  for (const [id, c] of Object.entries(COURSES)) {
    const b = document.createElement('button');
    b.className = `course course-${c.theme}${id === L.course ? ' selected' : ''}`;
    b.innerHTML = `<b>${c.name}</b><small>${c.length} m · ${c.blurb}</small>`;
    b.addEventListener('click', () => send({ t: 'config', course: id }));
    cl.append(b);
  }
  $('#fill-bots').checked = L.fillBots;
}

// ------------------------------------------------------------ networking
function send(m) { if (S.ws?.readyState === 1) S.ws.send(JSON.stringify(m)); }

const openOrSend = makeConnector({
  state: S,
  createSocket: () => new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`),
  onOpen: (first) => send({ ...first, profile }),
  onMessage,
  onDisconnect: () => {
    S.lobby = null;
    S.race = null;
    show('title');
    toast('Disconnected from server');
  },
});

function connect(first) {
  if (!profile.name.trim()) {
    profile.name = `${DINOS[profile.dino].name} ${Math.floor(Math.random() * 90 + 10)}`;
    $('#name').value = profile.name;
    saveProfile();
  }
  openOrSend(first);
}

function onMessage(m) {
  switch (m.t) {
    case 'hello': S.myId = m.id; break;
    case 'pong': rtt += ((performance.now() - m.c) / 1000 - rtt) * 0.3; break;
    case 'error': toast(m.msg); break;
    case 'lobby': {
      S.lobby = m;
      history.replaceState(null, '', `?room=${m.code}`);
      if (m.state === 'lobby' || !S.race) { S.race = null; S.results = null; game.clear(); show('lobby'); }
      renderLobby();
      if (S.results) renderResults();
      break;
    }
    case 'start': startRace(m); break;
    case 'snap': onSnap(m); break;
    case 'results': S.results = m; renderResults(); break;
    default: break;
  }
}

// ------------------------------------------------------------------ race
function startRace(m) {
  S.results = null;
  $('#results').classList.add('hidden');
  const runners = m.runners.map((r, i) => ({ ...r, bib: i + 1 }));
  const meta = new Map(runners.map((r) => [r.id, r]));
  S.race = {
    meta, snaps: [], play: new Playout(), events: [], prevZ: 0, lastCount: null, rollIdx: 0,
    predict: new Predictor(), predictReady: false, hud: {},
  };
  const R = S.race;
  $('#feed').innerHTML = '';
  banner('');
  buildProgress();
  show('race');
  $('#loading').classList.remove('hidden');
  // let the loading card paint before the (synchronous) course build
  requestAnimationFrame(() => setTimeout(async () => {
    await game.load(m.course, runners, S.myId);
    if (S.race !== R) return; // left or restarted while loading
    buildMinimap();
    // snapshots that queued up while the course was being built all look
    // "late"; start the playback clock fresh so it doesn't over-buffer
    R.play = new Playout();
    const newest = R.snaps[R.snaps.length - 1];
    if (newest) R.play.push(newest.time, performance.now() / 1000);
    $('#loading').classList.add('hidden');
  }, 0));
}

function buildProgress() {
  const p = $('#hud-progress');
  p.querySelectorAll('.dot').forEach((d) => d.remove());
  for (const r of S.race.meta.values()) {
    const d = document.createElement('div');
    d.className = `dot${r.id === S.myId ? ' me' : ''}`;
    d.style.background = r.color;
    d.dataset.id = r.id;
    d.title = r.name;
    p.append(d);
  }
}

function onSnap(m) {
  const R = S.race;
  if (!R) return;
  R.play.push(m.time, performance.now() / 1000);
  R.snaps.push(m);
  if (R.snaps.length > 60) R.snaps.shift();
  // events play out when the rendered world reaches them, not on arrival
  for (const e of m.ev || []) R.events.push([m.time, e]);
}

const name = (id) => S.race?.meta.get(id)?.name || '???';
const HIT_TEXT = {
  egg: (a, b) => `🥚 ${a} egg-bombed ${b}`,
  peel: (a, b) => `🌿 ${b} slipped on ${a}'s fern peel`,
  meteor: (a, b) => `☄️ ${a}'s meteor flattened ${b}`,
  club: (a, b) => `🔨 ${a} tail-clubbed ${b}`,
  charge: (a, b) => `🦏 ${a} bulldozed ${b}`,
  headbutt: (a, b) => `💥 ${a} dome-slammed ${b}`,
  spikes: (a, b) => `🌵 ${b} ran into ${a}'s spikes`,
};

function feed(text, mine) {
  const li = document.createElement('li');
  li.textContent = text;
  if (mine) li.style.background = 'rgba(255,176,32,0.55)';
  const f = $('#feed');
  f.append(li);
  while (f.children.length > 5) f.firstChild.remove();
  setTimeout(() => li.remove(), 5000);
}

function onEvent(e) {
  const me = S.myId;
  const mine = e.id === me || e.by === me;
  game.onEvent(e);
  switch (e.k) {
    case 'hit': {
      const f = HIT_TEXT[e.cause];
      if (f) feed(f(e.by ? name(e.by) : 'Someone', name(e.id)), mine);
      if (mine) sfx.hit();
      break;
    }
    case 'boom': sfx.boom(); break;
    case 'pickup': if (e.id === me) sfx.pickup(); break;
    case 'finish':
      feed(`🏁 ${name(e.id)} finished ${ORD(e.place)} (${e.time.toFixed(2)} s)`, e.id === me);
      if (e.id === me) { sfx.finish(); banner(`You finished ${ORD(e.place)}!`, true); }
      break;
    case 'steal': feed(`📯 ${name(e.id)} honked away ${name(e.from)}'s ${ITEMS[e.item].name}`, mine); break;
    case 'meteor':
      feed(`☄️ Meteor incoming on ${name(e.id)}!`, e.id === me);
      if (e.id === me) banner('☄️ INCOMING!');
      break;
    case 'shield': feed(`🔶 ${name(e.id)}'s amber shield blocked it`, mine); if (mine) sfx.shield(); break;
    case 'item':
      if (e.item === 'pin') feed(`📌 ${name(e.id)} popped everyone's costume!`, mine);
      if (e.item === 'ash') feed(`🌋 ${name(e.id)} unleashed an ash cloud`, mine);
      if (e.id === me) sfx.item();
      break;
    case 'overheat':
      if (e.id === me) { sfx.overheat(); feed('🥵 Your costume overheated! Ease off / find water', true); }
      break;
    case 'ability': {
      const close = Math.abs(runnerX(e.id) - runnerX(me)) < 15;
      if (e.ability === 'roar' && close) sfx.roar();
      if (e.ability === 'honk' && close) sfx.honk();
      if (e.id === me && !['roar', 'honk'].includes(e.ability)) sfx.item();
      break;
    }
    case 'reflect': feed(`🛡️ ${name(e.id)} reflected an egg bomb!`, mine); break;
    case 'rocket': if (e.id === me) { flash('🚀 ROCKET START!', 'good'); sfx.go(); } break;
    case 'falsestart': if (e.id === me) flash('😵 False start! (too early)', 'bad'); break;
    case 'hop': if (e.id === me) { flash('✨ PERFECT HOP!', 'good'); sfx.pickup(); } break;
    case 'draft': if (e.id === me) flash('💨 SLIPSTREAM', 'info'); break;
    case 'stumble': if (e.id === me) flash('Oof! Jump the hurdles (Space)', 'bad'); break;
    default: break;
  }
}

function runnerX(id) {
  const snap = S.race.snaps[S.race.snaps.length - 1];
  return snap?.rs.find((x) => x[0] === id)?.[1] ?? 0;
}

function sample(R, now) {
  const snaps = R.snaps;
  if (!snaps.length) return null;
  const rt = R.play.time(now);
  while (R.events.length && R.events[0][0] <= rt) onEvent(R.events.shift()[1]);
  let a = snaps[0];
  let b = snaps[snaps.length - 1];
  for (let i = snaps.length - 1; i > 0; i--) {
    if (snaps[i - 1].time <= rt) { a = snaps[i - 1]; b = snaps[i]; break; }
  }
  const k = b.time > a.time ? Math.max(0, Math.min(1, (rt - a.time) / (b.time - a.time))) : 1;
  const prevById = new Map(a.rs.map((r) => [r[0], r]));
  const runners = b.rs.map((r) => {
    const p = prevById.get(r[0]) || r;
    const lerp = (i) => p[i] + (r[i] - p[i]) * k;
    const meta = R.meta.get(r[0]) || {};
    return {
      id: r[0], x: lerp(1), y: lerp(2), z: Math.max(0, lerp(3)), v: r[4], heat: r[5], item: r[6], fx: r[7],
      place: r[8], cd: r[9], taunt: r[10], finished: r[11], name: meta.name, dino: meta.dino, color: meta.color,
    };
  });
  const prevPj = new Map(a.pj.map((p) => [p[0], p]));
  const projectiles = b.pj.map((p) => {
    const q = prevPj.get(p[0]) || p;
    return { id: p[0], type: p[1], x: q[2] + (p[2] - q[2]) * k, y: q[3] + (p[3] - q[3]) * k, delay: p[4] };
  });
  return {
    time: a.time + (b.time - a.time) * k,
    runners,
    projectiles,
    hazards: b.hz.map((h) => ({ id: h[0], type: h[1], x: h[2], y: h[3] })),
    hiddenEggs: new Set(b.eg),
  };
}

let lastFrame = performance.now() / 1000;
function frame() {
  const now = performance.now() / 1000;
  const dt = Math.min(0.25, now - lastFrame);
  lastFrame = now;
  if (S.screen === 'title') { studio.show(profile.dino, profile.color, profile.name); studio.frame(now, dt); }
  if (S.screen === 'race' && S.race) raceFrame(now, dt);
  requestAnimationFrame(frame);
}

function raceFrame(now, dt) {
  const R = S.race;
  const view = sample(R, now);
  if (!view) return;
  if (!game.ready) return;
  for (const r of view.runners) {
    const meta = R.meta.get(r.id);
    r.name = meta?.name; r.color = meta?.color; r.dino = meta?.dino;
  }
  let me = view.runners.find((r) => r.id === S.myId);

  // controls → server, and local prediction of your own runner
  const input = controls.poll();
  sendInput(input, now);
  if (me) {
    const latest = R.snaps[R.snaps.length - 1].rs.find((r) => r[0] === S.myId);
    const tripped = latest && latest[7] & FX.trip;
    if (!R.predictReady) { R.predict.reset(me.y); R.predictReady = true; }
    R.predict.step(now, dt, input.steer, !tripped && !me.finished && view.time >= 0);
    const lag = R.play.delay + rtt / 2;
    me.y = R.predict.displayY(me.y, now, lag);
    me.z = R.predict.displayZ(me.z, now, lag);
    R.canJump = latest && latest[3] === 0 && !tripped && !latest[11] && view.time >= 0;
    if (R.prevZ === 0 && me.z > 0.05 && !(me.fx & FX.glide)) sfx.jump();
    R.prevZ = me.z > 0.05 ? me.z : 0;
  } else {
    me = [...view.runners].sort((a, b) => a.place - b.place)[0];
  }
  game.update(view, dt, now);
  $('#ash').style.opacity = me.fx & FX.ash ? 1 : 0;
  $('#vignette').style.opacity = me.fx & FX.overheat ? 1 : Math.max(0, (me.heat - 0.75) * 3);
  hud(view, me, now);
  drawMinimap(view, me);
}

// ---------------------------------------------------------------- minimap
let mini = null;
function buildMinimap() {
  const tr = game.track;
  let minX = Infinity; let maxX = -Infinity; let minZ = Infinity; let maxZ = -Infinity;
  for (const p of tr.pos) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z); }
  const size = 340; const pad = 26;
  const k = (size - pad * 2) / Math.max(maxX - minX, maxZ - minZ);
  const ox = (size - (maxX - minX) * k) / 2; const oz = (size - (maxZ - minZ) * k) / 2;
  const map = (p) => [ox + (p.x - minX) * k, oz + (p.z - minZ) * k];
  const bg = document.createElement('canvas'); bg.width = bg.height = size;
  const g = bg.getContext('2d');
  g.lineJoin = 'round';
  g.beginPath();
  tr.pos.forEach((p, i) => { const [x, y] = map(p); if (i) g.lineTo(x, y); else g.moveTo(x, y); });
  g.closePath();
  g.strokeStyle = 'rgba(0,0,0,0.55)'; g.lineWidth = 22; g.stroke();
  g.strokeStyle = '#f4efe2'; g.lineWidth = 14; g.stroke();
  g.strokeStyle = { stadium: '#c8553d', jungle: '#8a6440', volcano: '#4a3a3a' }[tr.theme]; g.lineWidth = 9; g.stroke();
  const zone = (ranges, color) => {
    for (const [a, b] of ranges) {
      g.beginPath();
      for (let s = a; s <= b; s += 1) { const [x, y] = map(tr.pose(s).p); if (s === a) g.moveTo(x, y); else g.lineTo(x, y); }
      g.strokeStyle = color; g.lineWidth = 9; g.stroke();
    }
  };
  zone(tr.course.water, '#3aa0ff');
  zone(tr.course.mud, '#5a3d24');
  const [sx, sy] = map(tr.pose(0).p);
  g.fillStyle = '#111'; g.fillRect(sx - 7, sy - 7, 14, 14);
  g.fillStyle = '#fff'; g.fillRect(sx - 7, sy - 7, 7, 7); g.fillRect(sx, sy, 7, 7);
  mini = { bg, map };
}

function drawMinimap(view, me) {
  if (!mini) return;
  const c = $('#minimap');
  const g = c.getContext('2d');
  g.clearRect(0, 0, c.width, c.height);
  g.drawImage(mini.bg, 0, 0);
  const sorted = [...view.runners].sort((a, b) => (a.id === me.id) - (b.id === me.id));
  for (const r of sorted) {
    const [x, y] = mini.map(game.track.pose(r.x, r.y).p);
    const isMe = r.id === me.id;
    g.beginPath(); g.arc(x, y, isMe ? 13 : 9, 0, Math.PI * 2);
    g.fillStyle = r.color || '#fff'; g.fill();
    g.lineWidth = isMe ? 5 : 3; g.strokeStyle = isMe ? '#ffe38a' : '#fff'; g.stroke();
  }
  for (const p of view.projectiles) {
    if (p.type !== 'meteor') continue;
    const [x, y] = mini.map(game.track.pose(p.x, p.y).p);
    g.fillStyle = '#ff3a10'; g.beginPath(); g.arc(x, y, 7 + Math.sin(performance.now() / 60) * 2, 0, Math.PI * 2); g.fill();
  }
}

// DOM writes are only made when a value actually changes.
function put(key, el, prop, value) {
  const H = S.race.hud;
  if (H[key] === value) return;
  H[key] = value;
  if (prop === 'html') el.innerHTML = value;
  else if (prop === 'text') el.textContent = value;
  else if (prop === 'class') el.className = value;
  else el.style[prop] = value;
}

function hud(view, me, now) {
  const R = S.race;
  const n = view.runners.length;
  put('place', $('#hud-place'), 'html', `${ORD(me.place)}<small> / ${n}</small>`);
  const t = view.time;
  const cd = t < 0 ? Math.ceil(-t) : null;
  const cdEl = $('#countdown');
  if (cd !== R.lastCount) {
    if (cd) sfx.beep(); else if (R.lastCount) sfx.go();
    R.lastCount = cd;
    cdEl.textContent = cd || (t < 1 ? 'GO!' : '');
    cdEl.classList.remove('pop'); void cdEl.offsetWidth; cdEl.classList.add('pop');
    $('#start-hint').classList.toggle('hidden', !cd);
  }
  if (!cd && t > 1 && cdEl.textContent) cdEl.textContent = '';
  put('time', $('#hud-time'), 'text', me.finished ? `${me.finished.toFixed(2)} s` : `${Math.max(0, t).toFixed(1)} s`);
  for (const d of document.querySelectorAll('#hud-progress .dot')) {
    const r = view.runners.find((x) => x.id === d.dataset.id);
    if (r) put(`dot-${r.id}`, d, 'left', `${Math.min(100, (r.x / game.track.length) * 100).toFixed(1)}%`);
  }
  const slot = $('#hud-item');
  const item = me.item;
  slot.classList.toggle('rolling', item === '?');
  const keys = Object.keys(ITEMS);
  const keyItem = controls.usingPad ? 'B' : 'E';
  const keySkill = controls.usingPad ? 'X' : 'Q';
  if (item === '?') {
    R.rollIdx = (R.rollIdx + 1) % (keys.length * 3);
    put('itemIcon', slot.querySelector('.emoji'), 'text', ITEMS[keys[Math.floor(R.rollIdx / 3)]].icon);
    put('itemLabel', slot.querySelector('.label'), 'text', '…');
  } else {
    put('itemIcon', slot.querySelector('.emoji'), 'text', item ? ITEMS[item].icon : '');
    put('itemLabel', slot.querySelector('.label'), 'text', item ? `${ITEMS[item].name} (${keyItem})` : 'no item');
  }
  put('heat', $('#hud-heat'), 'width', `${Math.min(100, me.heat * 100).toFixed(0)}%`);
  put('hot', $('#hud-heat').closest('.meter'), 'class', me.fx & FX.overheat || me.heat > 0.8 ? 'meter hot' : 'meter');
  put('abil', $('#hud-ability'), 'width', `${((1 - me.cd) * 100).toFixed(0)}%`);
  const d = DINOS[me.dino];
  put('abilName', $('#hud-ability-name'), 'text', me.cd <= 0 ? `⚡ ${d.abilityName} ready (${keySkill})` : d.abilityName);
  put('speed', $('#hud-speed'), 'html', `${Math.round(me.v * 3.6)}<small>km/h</small>`);
  put('draft', $('#speedlines'), 'opacity', me.fx & (FX.boost | FX.draft | FX.charge) ? '1' : '0');
}

// Short celebratory/feedback call-outs (rocket start, perfect hop…).
function flash(text, kind) {
  const el = document.createElement('div');
  el.className = `flash ${kind}`;
  el.textContent = text;
  $('#flashes').append(el);
  setTimeout(() => el.remove(), 1600);
}

function banner(text, sticky = false) {
  $('#banner').textContent = text;
  clearTimeout(banner.h);
  if (!sticky) banner.h = setTimeout(() => { $('#banner').textContent = ''; }, 1800);
}

// -------------------------------------------------------------- results
function renderResults() {
  const m = S.results;
  if (!m || !S.race) return;
  const ov = $('#results');
  ov.classList.remove('hidden');
  const list = $('#results-list');
  list.innerHTML = '';
  const medals = ['🥇', '🥈', '🥉'];
  for (const r of m.results) {
    const li = document.createElement('li');
    if (r.id === S.myId) li.className = 'me';
    const time = r.time !== null ? `${r.time.toFixed(2)} s` : `DNF · ${r.dist} m`;
    li.innerHTML = `<span class="medal">${medals[r.place - 1] || r.place}</span>
      <div><b></b><small>${DINOS[r.dino].name}${r.bot ? ' · bot' : ''} · ${r.hits} hits · ${r.items} items</small></div>
      <span class="t">${time}</span>`;
    li.querySelector('b').textContent = r.name;
    list.append(li);
  }
  const mine = m.results.find((r) => r.id === S.myId);
  $('#results-title').textContent = mine && mine.place === 1 ? '🏆 Fastest Dinosaur!' : `${COURSES[m.course].name} — Results`;
  const isHost = S.lobby?.host === S.myId;
  $('#btn-again').classList.toggle('hidden', !isHost);
  $('#results-wait').classList.toggle('hidden', isHost);
}

// ---------------------------------------------------------------- input
let rtt = 0.05;
const controls = new Controls({
  isActive: () => S.screen === 'race',
  onAction: (a) => {
    if (a === 'jump' && S.race?.canJump) S.race.predict.jump(performance.now() / 1000, true);
    send({ t: 'act', a });
  },
});
let lastSent = { steer: 0, sprint: false, brake: false };
let lastSentAt = 0;
function sendInput(input, now) {
  const steer = Math.round(input.steer * 20) / 20;
  const changed = steer !== lastSent.steer || input.sprint !== lastSent.sprint || input.brake !== lastSent.brake;
  if (!changed && now - lastSentAt < 0.2) return;
  lastSent = { steer, sprint: input.sprint, brake: input.brake };
  lastSentAt = now;
  send({ t: 'input', k: lastSent });
}
setInterval(() => { if (S.ws?.readyState === 1) send({ t: 'ping', c: performance.now() }); }, 1000);

function setupTouch() {
  const touch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
  if (!touch) return;
  document.body.classList.add('touch-on');
  $('#touch').classList.remove('hidden');
  controls.attachTouch($('#touch'), $('#touch .knob'));
}

// ----------------------------------------------------------------- wiring
$('#btn-start').addEventListener('click', () => send({ t: 'start' }));
$('#fill-bots').addEventListener('change', (e) => send({ t: 'config', fillBots: e.target.checked }));
$('#btn-copy').addEventListener('click', async () => {
  const url = `${location.origin}${location.pathname}?room=${S.lobby.code}`;
  try { await navigator.clipboard.writeText(url); toast('Invite link copied!'); } catch { toast(url); }
});
const leave = () => {
  send({ t: 'leave' });
  game.clear();
  S.lobby = null; S.race = null; S.results = null;
  history.replaceState(null, '', location.pathname);
  show('title');
};
$('#btn-leave').addEventListener('click', leave);
$('#btn-results-leave').addEventListener('click', leave);
$('#btn-again').addEventListener('click', () => send({ t: 'again' }));
$('#mute').textContent = isMuted() ? '🔇' : '🔊';
$('#mute').addEventListener('click', () => { $('#mute').textContent = toggleMute() ? '🔇' : '🔊'; unlockAudio(); });

let game;
let studio;
try {
  game = new Game3D($('#game'));
  studio = new Studio($('#preview'));
} catch (err) {
  document.body.innerHTML = `<div class="nogl"><h1>Dino Run 🦖</h1>
    <p>This game needs 3D graphics (WebGL), which this browser or device has turned off.</p>
    <p>Try an up-to-date Chrome, Edge, Firefox or Safari, or enable hardware acceleration.</p></div>`;
  throw err;
}
window.dinoRun = { game, studio }; // handy from the devtools console
const qSel = $('#quality');
qSel.value = game.qualityPref;
qSel.addEventListener('change', () => {
  game.setQuality(qSel.value);
  try { localStorage.setItem('dino-run-quality', qSel.value); } catch { /* ignore */ }
});
buildTitle();
requestAnimationFrame(fillThumbnails);
setupTouch();
requestAnimationFrame(frame);
