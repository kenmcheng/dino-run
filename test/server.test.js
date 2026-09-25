// Integration test: runs the real server as a child process and drives it
// over a real WebSocket, so a crash actually kills the process under test
// instead of just throwing inside the test runner.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import { DINOS } from '../shared/data.js';

const ROOT = new URL('..', import.meta.url);

let child;
let port;

before(async () => {
  child = spawn(process.execPath, ['server/index.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: '0', HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  port = await new Promise((resolve, reject) => {
    let buf = '';
    const timer = setTimeout(() => reject(new Error('server did not start in time')), 5000);
    child.stdout.on('data', (d) => {
      buf += d.toString();
      const m = buf.match(/listening on http:\/\/[^:]+:(\d+)/);
      if (m) { clearTimeout(timer); resolve(Number(m[1])); }
    });
    child.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));
    child.on('exit', (code) => { clearTimeout(timer); reject(new Error(`server exited early (${code})`)); });
  });
});

after(() => { if (child && child.exitCode === null) child.kill(); });

function connect() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const timer = setTimeout(() => reject(new Error('connect timeout')), 2000);
    const pending = [];
    const waiters = [];
    ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString());
      const i = waiters.findIndex((w) => w.pred(msg));
      if (i >= 0) { const [w] = waiters.splice(i, 1); w.resolve(msg); }
      else pending.push(msg);
    });
    ws.on('error', reject);
    ws.on('open', () => {
      clearTimeout(timer);
      resolve({
        ws,
        send: (msg) => ws.send(JSON.stringify(msg)),
        sendRaw: (raw) => ws.send(raw),
        next(pred, timeoutMs = 2000) {
          const i = pending.findIndex(pred);
          if (i >= 0) return Promise.resolve(pending.splice(i, 1)[0]);
          return new Promise((res, rej) => {
            const t = setTimeout(() => {
              const j = waiters.findIndex((w) => w.resolve === res);
              if (j >= 0) waiters.splice(j, 1);
              rej(new Error('timed out waiting for message'));
            }, timeoutMs);
            waiters.push({ pred, resolve: (m) => { clearTimeout(t); res(m); } });
          });
        },
      });
    });
  });
}

async function assertAlive() {
  assert.equal(child.exitCode, null, 'server process is still running');
  const c = await connect();
  await c.next((m) => m.t === 'hello');
  c.send({ t: 'ping', c: 42 });
  const pong = await c.next((m) => m.t === 'pong');
  assert.equal(pong.c, 42);
  c.ws.close();
}

test('create with profile:null gets a sanitized default profile and the server stays up', async () => {
  const c = await connect();
  await c.next((m) => m.t === 'hello');
  c.send({ t: 'create', profile: null });
  const lobby = await c.next((m) => m.t === 'lobby');
  assert.equal(lobby.players.length, 1);
  assert.equal(lobby.players[0].name, 'Mystery Dino');
  assert.equal(lobby.players[0].dino, 'trex');
  assert.equal(lobby.players[0].color, DINOS.trex.color);
  c.ws.close();
  await assertAlive();
});

test('join with profile:null gets a sanitized default profile and the server stays up', async () => {
  const a = await connect();
  await a.next((m) => m.t === 'hello');
  a.send({ t: 'create', profile: { name: 'Host', dino: 'raptor' } });
  const hostLobby = await a.next((m) => m.t === 'lobby');
  const { code } = hostLobby;

  const b = await connect();
  await b.next((m) => m.t === 'hello');
  b.send({ t: 'join', code, profile: null });
  const lobby = await b.next((m) => m.t === 'lobby' && m.players.length === 2);
  const joined = lobby.players.find((p) => p.name !== 'Host');
  assert.ok(joined, 'joining player present');
  assert.equal(joined.name, 'Mystery Dino');
  assert.equal(joined.dino, 'trex');

  a.ws.close();
  b.ws.close();
  await assertAlive();
});

test('other malformed profile shapes on create fall back to defaults', async () => {
  const shapes = [5, 'str', [], { dino: 'constructor' }, { dino: '__proto__', color: 'nope' }];
  for (const profile of shapes) {
    const c = await connect();
    await c.next((m) => m.t === 'hello');
    c.send({ t: 'create', profile });
    const lobby = await c.next((m) => m.t === 'lobby');
    assert.equal(lobby.players[0].dino, 'trex', JSON.stringify(profile));
    assert.ok(DINOS[lobby.players[0].dino], 'color corresponds to a real dino');
    c.ws.close();
  }
  await assertAlive();
});

test('profile update with null or non-object payload leaves the existing profile unchanged', async () => {
  const c = await connect();
  await c.next((m) => m.t === 'hello');
  c.send({ t: 'create', profile: { name: 'Keepme', dino: 'stego' } });
  await c.next((m) => m.t === 'lobby');

  c.send({ t: 'profile', profile: null });
  let lobby = await c.next((m) => m.t === 'lobby');
  assert.equal(lobby.players[0].name, 'Keepme');
  assert.equal(lobby.players[0].dino, 'stego');

  c.send({ t: 'profile', profile: 'abc' });
  lobby = await c.next((m) => m.t === 'lobby');
  assert.equal(lobby.players[0].name, 'Keepme');
  assert.equal(lobby.players[0].dino, 'stego');

  c.ws.close();
  await assertAlive();
});

test('raw non-object WebSocket payloads are ignored', async () => {
  for (const raw of ['null', '5', '"x"', '[]']) {
    const c = await connect();
    await c.next((m) => m.t === 'hello');
    c.sendRaw(raw);
    c.ws.close();
  }
  await assertAlive();
});

test('config with an inherited course key is ignored and the race still starts', async () => {
  const c = await connect();
  await c.next((m) => m.t === 'hello');
  c.send({ t: 'create', profile: { name: 'Host' } });
  await c.next((m) => m.t === 'lobby');

  c.send({ t: 'config', course: 'toString' });
  await c.next((m) => m.t === 'lobby');

  c.send({ t: 'start' });
  const start = await c.next((m) => m.t === 'start');
  assert.equal(start.course, 'sprint');

  c.ws.close();
  await assertAlive();
});
