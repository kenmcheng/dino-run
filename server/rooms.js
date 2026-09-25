// Rooms: lobby state, race lifecycle and the per-room tick loop.
import { Race } from './race.js';
import {
  DINOS, COURSES, COSTUME_COLORS, MAX_PLAYERS, MIN_FIELD, TICK_RATE, SNAPSHOT_EVERY, BOT_NAMES,
} from '../shared/data.js';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const clean = (s, n) => String(s ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, n);

export class RoomManager {
  constructor() { this.rooms = new Map(); this.nextClient = 1; }

  newCode() {
    for (;;) {
      let c = '';
      for (let i = 0; i < 4; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
      if (!this.rooms.has(c)) return c;
    }
  }

  create() {
    const room = new Room(this.newCode(), this);
    this.rooms.set(room.code, room);
    return room;
  }

  get(code) { return this.rooms.get(String(code || '').toUpperCase()); }

  drop(room) { room.stop(); this.rooms.delete(room.code); }
}

export class Room {
  constructor(code, manager) {
    this.code = code;
    this.manager = manager;
    this.clients = new Map();     // id -> { send, name, dino, color }
    this.hostId = null;
    this.state = 'lobby';         // lobby | racing | results
    this.course = 'sprint';
    this.fillBots = true;
    this.race = null;
    this.loop = null;
    this.tick = 0;
    this.lastResults = null;
  }

  broadcast(msg) {
    const s = JSON.stringify(msg);
    for (const c of this.clients.values()) c.send(s);
  }

  join(id, send, profile) {
    if (this.clients.size >= MAX_PLAYERS) return 'Room is full';
    if (this.state === 'racing') return 'A race is in progress — try again in a moment';
    this.clients.set(id, { send, ...sanitizeProfile(profile) });
    if (!this.hostId) this.hostId = id;
    this.sendLobby();
    return null;
  }

  leave(id) {
    this.clients.delete(id);
    if (this.race) this.race.makeBot(id);
    if (this.clients.size === 0) { this.manager.drop(this); return; }
    if (this.hostId === id) this.hostId = this.clients.keys().next().value;
    if (this.state !== 'racing') this.sendLobby();
  }

  update(id, profile) {
    const c = this.clients.get(id);
    if (!c || this.state === 'racing') return;
    Object.assign(c, sanitizeProfile({ ...c, ...profile }));
    this.sendLobby();
  }

  configure(id, { course, fillBots }) {
    if (id !== this.hostId || this.state === 'racing') return;
    if (COURSES[course]) this.course = course;
    if (typeof fillBots === 'boolean') this.fillBots = fillBots;
    this.sendLobby();
  }

  sendLobby() {
    this.broadcast({
      t: 'lobby', code: this.code, host: this.hostId, state: this.state,
      course: this.course, fillBots: this.fillBots,
      players: [...this.clients].map(([id, c]) => ({ id, name: c.name, dino: c.dino, color: c.color })),
    });
  }

  start(id) {
    if (id !== this.hostId || this.state === 'racing') return;
    const entrants = [...this.clients].map(([cid, c]) => ({ id: cid, name: c.name, dino: c.dino, color: c.color }));
    if (this.fillBots) {
      const dinos = Object.keys(DINOS).sort(() => Math.random() - 0.5);
      for (let i = 0; entrants.length < MIN_FIELD; i++) {
        const dino = dinos[i % dinos.length];
        const names = BOT_NAMES[dino];
        const name = names[Math.floor(Math.random() * names.length)];
        entrants.push({ id: `bot${i}`, name, dino, color: DINOS[dino].color, bot: true });
      }
    }
    entrants.sort(() => Math.random() - 0.5);
    this.race = new Race(this.course, entrants);
    this.state = 'racing';
    this.tick = 0;
    this.broadcast({
      t: 'start', course: this.course,
      runners: this.race.runners.map((r) => ({ id: r.id, name: r.name, dino: r.dino, color: r.color, bot: r.bot })),
    });
    this.loop = setInterval(() => this.step(), 1000 / TICK_RATE);
  }

  step() {
    const race = this.race;
    race.step();
    this.tick++;
    if (this.tick % SNAPSHOT_EVERY === 0 || race.over) {
      this.broadcast({ t: 'snap', ...race.snapshot(), ev: race.drainEvents() });
    }
    if (race.over) {
      this.stop();
      this.state = 'results';
      this.lastResults = race.results();
      this.broadcast({ t: 'results', course: this.course, results: this.lastResults });
      this.race = null;
    }
  }

  stop() { if (this.loop) clearInterval(this.loop); this.loop = null; }

  input(id, k) { this.race?.setInput(id, k || {}); }

  act(id, a) { this.race?.queueAction(id, a); }

  again(id) {
    if (id !== this.hostId || this.state !== 'results') return;
    this.state = 'lobby';
    this.sendLobby();
  }
}

function sanitizeProfile(p = {}) {
  const dino = DINOS[p.dino] ? p.dino : 'trex';
  return {
    name: clean(p.name, 18) || 'Mystery Dino',
    dino,
    color: COSTUME_COLORS.includes(p.color) ? p.color : DINOS[dino].color,
  };
}
