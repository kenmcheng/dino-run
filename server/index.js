// HTTP static server + WebSocket game server on one port.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { RoomManager } from './rooms.js';
import { LIMITS, messageLimiter, IpCounter, clientIp } from './limits.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = process.env.PORT !== undefined && process.env.PORT !== '' ? Number(process.env.PORT) : 8090;
const HOST = process.env.HOST || '0.0.0.0';

process.on('uncaughtException', (e) => console.error('uncaughtException', e));

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.ico': 'image/x-icon', '.json': 'application/json',
  '.glb': 'model/gltf-binary', '.webp': 'image/webp', '.wasm': 'application/wasm',
};

// Only /public/*, /shared/* and the three.js package (as /vendor/three/*) are reachable.
const MOUNTS = [
  ['/shared/', 'shared'],
  ['/vendor/three/', 'node_modules/three'],
];

function resolvePath(urlPath) {
  const p = decodeURIComponent(urlPath.split('?')[0]);
  const mount = MOUNTS.find(([prefix]) => p.startsWith(prefix));
  const [base, rel] = mount ? [mount[1], p.slice(mount[0].length)] : ['public', p === '/' ? 'index.html' : p.slice(1)];
  const dir = path.join(ROOT, base);
  const file = path.resolve(dir, rel);
  return file.startsWith(dir + path.sep) ? file : null;
}

const server = http.createServer(async (req, res) => {
  if (req.url === '/healthz') { res.writeHead(200).end('ok'); return; }
  const file = resolvePath(req.url);
  try {
    if (!file) throw new Error('forbidden');
    const body = await fs.readFile(file);
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
  }
});

const rooms = new RoomManager({ maxRooms: LIMITS.maxRooms });
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4096 });
const ipCounter = new IpCounter();

wss.on('connection', (ws, req) => {
  const ip = clientIp(req, LIMITS.trustProxy);
  // wss.clients already counts this socket, so `>` (not `>=`) is the ceiling.
  if (wss.clients.size > LIMITS.maxConnections) {
    ws.send(JSON.stringify({ t: 'error', msg: 'Server is busy — try again in a moment' }));
    ws.close(1013, 'Server busy');
    return;
  }
  if (ipCounter.add(ip) > LIMITS.maxConnectionsPerIp) {
    ipCounter.remove(ip);
    ws.send(JSON.stringify({ t: 'error', msg: 'Too many connections from your network' }));
    ws.close(1013, 'Too many connections');
    return;
  }

  const id = `p${rooms.nextClient++}`;
  let room = null;
  const send = (s) => { if (ws.readyState === ws.OPEN) ws.send(s); };
  const reply = (msg) => send(JSON.stringify(msg));
  const limiter = messageLimiter(LIMITS);
  reply({ t: 'hello', id });

  const handle = (m) => {
    switch (m.t) {
      case 'create':
      case 'join': {
        if (room) room.leave(id);
        room = null;
        const target = m.t === 'create' ? rooms.create() : rooms.get(m.code);
        if (!target) {
          reply({ t: 'error', msg: m.t === 'create' ? 'Server is full — too many rooms open, try again later' : 'No room with that code' });
          return;
        }
        const err = target.join(id, send, m.profile);
        if (err) { reply({ t: 'error', msg: err }); if (target.clients.size === 0) rooms.drop(target); return; }
        room = target;
        return;
      }
      case 'profile': room?.update(id, m.profile); return;
      case 'config': room?.configure(id, m); return;
      case 'start': room?.start(id); return;
      case 'input': room?.input(id, m.k); return;
      case 'act': room?.act(id, m.a); return;
      case 'again': room?.again(id); return;
      case 'ping': reply({ t: 'pong', c: m.c }); return;
      case 'leave': room?.leave(id); room = null; return;
      default:
    }
  };

  ws.on('message', (raw) => {
    const v = limiter.hit();
    if (v === 'drop') return;
    if (v === 'close') { ws.close(1008, 'Rate limit exceeded'); return; }
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m !== 'object' || Array.isArray(m)) return;
    try {
      handle(m);
    } catch (e) {
      console.error('ws message handler error', id, e);
      try { ws.close(1011, 'internal error'); } catch {}
    }
  });

  ws.on('close', () => { room?.leave(id); ipCounter.remove(ip); });
});

server.listen(PORT, HOST, () => {
  const { port } = server.address();
  console.log(`Dino Run listening on http://${HOST}:${port}`);
  console.log('Limits:', LIMITS);
});
