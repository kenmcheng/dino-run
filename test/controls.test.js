import { test } from 'node:test';
import assert from 'node:assert/strict';
import { actionHint, Controls } from '../public/js/controls.js';

test('actionHint defaults to keyboard hints', () => {
  assert.equal(actionHint('item'), 'E');
  assert.equal(actionHint('ability'), 'Q');
  assert.equal(actionHint('item', { usingPad: false, touchOn: false }), 'E');
  assert.equal(actionHint('ability', { usingPad: false, touchOn: false }), 'Q');
});

test('actionHint shows gamepad hints when usingPad', () => {
  assert.equal(actionHint('item', { usingPad: true }), 'B');
  assert.equal(actionHint('ability', { usingPad: true }), 'X');
});

test('actionHint shows on-screen touch hints for a touch session', () => {
  const item = actionHint('item', { touchOn: true });
  const ability = actionHint('ability', { touchOn: true });
  assert.equal(item, 'tap ITEM');
  assert.equal(ability, 'tap SKILL');
  assert.ok(!/^[EQ]$/.test(item));
  assert.ok(!/^[EQ]$/.test(ability));
});

test('actionHint gives gamepad precedence over touch', () => {
  assert.equal(actionHint('item', { usingPad: true, touchOn: true }), 'B');
  assert.equal(actionHint('ability', { usingPad: true, touchOn: true }), 'X');
});

test('Controls wires hint() to usingPad/touchOn state', () => {
  globalThis.addEventListener ??= () => {};
  const c = new Controls({ onAction() {}, isActive: () => true });
  assert.equal(c.hint('item'), 'E');
  c.touchOn = true;
  assert.equal(c.hint('item'), 'tap ITEM');
  c.usingPad = true;
  assert.equal(c.hint('item'), 'B');
});

test('attachTouch sets touchOn', () => {
  globalThis.addEventListener ??= () => {};
  const c = new Controls({ onAction() {}, isActive: () => true });
  assert.equal(c.touchOn, false);
  const fakeEl = () => ({
    addEventListener() {},
    setPointerCapture() {},
    classList: { add() {}, remove() {} },
    style: {},
    offsetWidth: 0,
    offsetHeight: 0,
  });
  const root = { querySelector: () => fakeEl(), querySelectorAll: () => [] };
  const knob = { style: {} };
  c.attachTouch(root, knob);
  assert.equal(c.touchOn, true);
});
