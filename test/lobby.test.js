import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { COURSES, MIN_FIELD } from '../shared/data.js';
import { lobbySetup } from '../shared/lobby.js';

test('lobbySetup reflects every course', () => {
  for (const [id, c] of Object.entries(COURSES)) {
    const setup = lobbySetup({ course: id, fillBots: true });
    assert.equal(setup.id, id);
    assert.equal(setup.theme, c.theme);
    assert.equal(setup.name, c.name);
    assert.equal(setup.detail, `${c.length} m · ${c.blurb}`);
  }
});

test('lobbySetup falls back to sprint for unknown or missing course', () => {
  assert.equal(lobbySetup({ course: 'nope' }).id, 'sprint');
  assert.doesNotThrow(() => lobbySetup());
  assert.equal(lobbySetup().id, 'sprint');
});

test('lobbySetup bots text reflects fillBots', () => {
  const on = lobbySetup({ course: 'sprint', fillBots: true });
  const off = lobbySetup({ course: 'sprint', fillBots: false });
  assert.notEqual(on.bots, off.bots);
  assert.ok(on.bots.includes(String(MIN_FIELD)));
  assert.match(off.bots, /no bots/i);
});

test('lobby-setup markup exists outside .host-only and is read-only', () => {
  const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(html, /id="lobby-setup"/);
  assert.match(html, /id="lobby-course"/);
  assert.match(html, /id="lobby-bots"/);
  const start = html.indexOf('class="host-only"');
  const end = html.indexOf('id="btn-start"');
  const hostOnlySlice = html.slice(start, end);
  assert.ok(!hostOnlySlice.includes('lobby-setup'), 'lobby-setup must not be nested inside .host-only');
  const setupStart = html.indexOf('id="lobby-setup"');
  const setupEnd = html.indexOf('</div>', html.indexOf('</div>', setupStart) + 1);
  const setupSlice = html.slice(setupStart, setupEnd);
  assert.ok(!setupSlice.includes('<button'), 'lobby-setup must have no buttons');
  assert.ok(!setupSlice.includes('<input'), 'lobby-setup must have no inputs');
});

test('main.js imports and wires lobbySetup into renderLobby', () => {
  const js = fs.readFileSync(new URL('../public/js/main.js', import.meta.url), 'utf8');
  assert.match(js, /import\s*\{\s*lobbySetup\s*\}\s*from\s*'\/shared\/lobby\.js'/);
  assert.ok(js.includes("$('#lobby-setup').classList.toggle('hidden', isHost)"));
});
