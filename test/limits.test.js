import { test } from 'node:test';
import assert from 'node:assert/strict';
import { envInt, MessageLimiter, IpCounter, clientIp, LIMITS, messageLimiter } from '../server/limits.js';
import { RoomManager } from '../server/rooms.js';

test('envInt: valid values pass through, everything else falls back', () => {
  process.env.LIMITS_TEST = '42';
  assert.equal(envInt('LIMITS_TEST', 7), 42);
  process.env.LIMITS_TEST = '0';
  assert.equal(envInt('LIMITS_TEST', 7), 7);
  process.env.LIMITS_TEST = '-3';
  assert.equal(envInt('LIMITS_TEST', 7), 7);
  process.env.LIMITS_TEST = '1.5';
  assert.equal(envInt('LIMITS_TEST', 7), 7);
  process.env.LIMITS_TEST = 'nope';
  assert.equal(envInt('LIMITS_TEST', 7), 7);
  delete process.env.LIMITS_TEST;
  assert.equal(envInt('LIMITS_TEST', 7), 7);
});

test('MessageLimiter: burst is consumed then drops, and refills over time', () => {
  const now = 1000;
  const limiter = new MessageLimiter({ rate: 150, burst: 300, floodDrops: 300, floodWindowMs: 10000 }, now);
  for (let i = 0; i < 300; i++) assert.equal(limiter.hit(now), 'ok');
  assert.equal(limiter.hit(now), 'drop');
  const results = [];
  for (let i = 0; i < 150; i++) results.push(limiter.hit(now + 1000));
  assert.ok(results.every((r) => r === 'ok'), 'a second worth of budget refilled');
  assert.equal(limiter.hit(now + 1000), 'drop');
});

test('MessageLimiter: a legitimate 144 msg/s stream is never dropped with defaults', () => {
  const rate = 150;
  const burst = 300;
  const limiter = new MessageLimiter({ rate, burst, floodDrops: 300, floodWindowMs: 10000 }, 0);
  const hz = 144;
  const stepMs = 1000 / hz;
  let now = 0;
  for (let i = 0; i < hz * 10; i++) {
    now += stepMs;
    assert.equal(limiter.hit(now), 'ok', `hit ${i} at t=${now}`);
  }
});

test('MessageLimiter: a sustained flood closes once drops pile up in the window', () => {
  const limiter = new MessageLimiter({ rate: 150, burst: 300, floodDrops: 300, floodWindowMs: 10000 }, 0);
  let closedAt = -1;
  for (let i = 0; i < 1000; i++) {
    const v = limiter.hit(0);
    if (v === 'close') { closedAt = i; break; }
  }
  assert.ok(closedAt >= 300, 'burst is exhausted before any close');
  assert.ok(closedAt < 1000, 'flood eventually closes');
});

test('MessageLimiter: thin drops spread across windows never close', () => {
  const limiter = new MessageLimiter({ rate: 150, burst: 1, floodDrops: 300, floodWindowMs: 10000 }, 0);
  let now = 0;
  for (let i = 0; i < 500; i++) {
    now += 20000; // well past the flood window and the refill, one drop per window
    assert.equal(limiter.hit(now), 'ok', `refilled hit ${i}`);
    now += 1;
    const v = limiter.hit(now);
    assert.notEqual(v, 'close', `isolated drop ${i} should not close`);
  }
});

test('MessageLimiter: clock going backwards does not grant free tokens', () => {
  const limiter = new MessageLimiter({ rate: 150, burst: 5, floodDrops: 300, floodWindowMs: 10000 }, 1000);
  for (let i = 0; i < 5; i++) assert.equal(limiter.hit(1000), 'ok');
  assert.equal(limiter.hit(500), 'drop');
});

test('messageLimiter: wires the real LIMITS keys (msgRate/msgBurst), not rate/burst', () => {
  const limiter = messageLimiter(LIMITS, 0);
  assert.equal(limiter.hit(0), 'ok', 'first hit must be ok, not a NaN-tokens drop');
  const hz = 144;
  const stepMs = 1000 / hz;
  let now = 0;
  for (let i = 0; i < hz * 10; i++) {
    now += stepMs;
    assert.equal(limiter.hit(now), 'ok', `hit ${i} at t=${now}`);
  }
});

test('IpCounter: counts up and down, deletes the key at zero', () => {
  const counter = new IpCounter();
  assert.equal(counter.add('1.2.3.4'), 1);
  assert.equal(counter.add('1.2.3.4'), 2);
  assert.equal(counter.counts.get('1.2.3.4'), 2);
  counter.remove('1.2.3.4');
  assert.equal(counter.counts.get('1.2.3.4'), 1);
  counter.remove('1.2.3.4');
  assert.equal(counter.counts.has('1.2.3.4'), false);
  assert.equal(counter.counts.size, 0);
});

test('clientIp: uses the last XFF hop only when trustProxy is on', () => {
  const req = { headers: { 'x-forwarded-for': '203.0.113.1, 10.0.0.2, 10.0.0.3' }, socket: { remoteAddress: '127.0.0.1' } };
  assert.equal(clientIp(req, true), '10.0.0.3');
  assert.equal(clientIp(req, false), '127.0.0.1');
});

test('clientIp: falls back to socket address, then unknown', () => {
  assert.equal(clientIp({ headers: {}, socket: { remoteAddress: '192.0.2.1' } }, true), '192.0.2.1');
  assert.equal(clientIp({ headers: {}, socket: {} }, true), 'unknown');
});

test('RoomManager: create() is capped and recovers after drop()', () => {
  const rooms = new RoomManager({ maxRooms: 2 });
  const a = rooms.create();
  const b = rooms.create();
  assert.ok(a && b);
  assert.equal(rooms.rooms.size, 2);
  assert.equal(rooms.create(), null);
  rooms.drop(a);
  assert.equal(rooms.rooms.size, 1);
  const c = rooms.create();
  assert.ok(c);
  rooms.drop(b);
  rooms.drop(c);
});

test('RoomManager: no options means uncapped', () => {
  const rooms = new RoomManager();
  const created = [];
  for (let i = 0; i < 50; i++) created.push(rooms.create());
  assert.ok(created.every(Boolean));
  assert.equal(rooms.rooms.size, 50);
  for (const r of created) rooms.drop(r);
});
