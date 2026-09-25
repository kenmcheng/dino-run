// HTTP static server + WebSocket game server on one port.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { RoomManager } from './rooms.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 8090;
const HOST = process.env.HOST || '0.0.0.0';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.ico': 'image/x-icon', '.json': 'application/json',
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

const rooms = new RoomManager();
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4096 });

wss.on('connection', (ws) => {
  const id = `p${rooms.nextClient++}`;
  let room = null;
  const send = (s) => { if (ws.readyState === ws.OPEN) ws.send(s); };
  const reply = (msg) => send(JSON.stringify(msg));
  reply({ t: 'hello', id });

  ws.on('message', (raw) => {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    switch (m.t) {
      case 'create':
      case 'join': {
        if (room) room.leave(id);
        room = null;
        const target = m.t === 'create' ? rooms.create() : rooms.get(m.code);
        if (!target) { reply({ t: 'error', msg: 'No room with that code' }); return; }
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
  });

  ws.on('close', () => room?.leave(id));
});

server.listen(PORT, HOST, () => {
  console.log(`Dino Run listening on http://${HOST}:${PORT}`);
});
