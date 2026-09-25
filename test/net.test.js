import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeConnector } from '../public/js/net.js';

class FakeSocket {
  constructor() {
    this.readyState = 0; // CONNECTING
    this.sent = [];
    this.onopen = null;
    this.onmessage = null;
    this.onclose = null;
  }

  open() { this.readyState = 1; this.onopen?.(); }

  recv(obj) { this.onmessage?.({ data: JSON.stringify(obj) }); }

  close() { this.readyState = 3; this.onclose?.(); }
}

function setup() {
  const state = { ws: null };
  const sockets = [];
  const opens = [];
  const messages = [];
  const disconnects = [];
  const connect = makeConnector({
    state,
    createSocket: () => { const s = new FakeSocket(); sockets.push(s); return s; },
    onOpen: (first) => opens.push(first),
    onMessage: (m) => messages.push(m),
    onDisconnect: () => disconnects.push(true),
  });
  return {
    state, sockets, opens, messages, disconnects, connect,
  };
}

test('a second connect() while CONNECTING creates no new socket and does not resend', () => {
  const {
    sockets, opens, connect,
  } = setup();
  const r1 = connect({ t: 'create' });
  const r2 = connect({ t: 'create' });
  assert.equal(r1, 'connecting');
  assert.equal(r2, 'pending');
  assert.equal(sockets.length, 1);
  assert.equal(opens.length, 0);
  sockets[0].open();
  assert.deepEqual(opens, [{ t: 'create' }]);
});

test('connect() while OPEN sends immediately on the existing socket', () => {
  const {
    sockets, opens, connect,
  } = setup();
  connect({ t: 'create' });
  sockets[0].open();
  const r = connect({ t: 'join', code: 'ABCD' });
  assert.equal(r, 'sent');
  assert.equal(sockets.length, 1);
  assert.deepEqual(opens, [{ t: 'create' }, { t: 'join', code: 'ABCD' }]);
});

test('a stale socket cannot mutate state after a newer socket replaces it', () => {
  const {
    state, sockets, opens, messages, disconnects, connect,
  } = setup();
  connect({ t: 'create' });
  const a = sockets[0];
  a.readyState = 3; // simulate close without firing onclose yet
  connect({ t: 'create' });
  const b = sockets[1];
  assert.equal(state.ws, b);

  a.recv({ t: 'hello', id: 'stale' });
  a.open();
  a.onclose();
  assert.equal(messages.length, 0);
  assert.equal(opens.length, 0);
  assert.equal(disconnects.length, 0);
  assert.equal(state.ws, b);

  b.recv({ t: 'hello', id: 'current' });
  assert.deepEqual(messages, [{ t: 'hello', id: 'current' }]);
});

test('onclose on the current socket clears state.ws and fires onDisconnect once', () => {
  const {
    state, sockets, disconnects, connect,
  } = setup();
  connect({ t: 'create' });
  sockets[0].close();
  assert.equal(state.ws, null);
  assert.equal(disconnects.length, 1);

  const r = connect({ t: 'create' });
  assert.equal(r, 'connecting');
  assert.equal(sockets.length, 2);
});
