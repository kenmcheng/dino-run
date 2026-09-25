// Unified controls: keyboard, gamepad and an on-screen touch stick.
// Produces a continuous state { steer -1..1, sprint, brake } plus one-shot
// actions (jump, item, ability, taunt) through `onAction`.

const STEER_LEFT = ['ArrowLeft', 'KeyA'];
const STEER_RIGHT = ['ArrowRight', 'KeyD'];
const SPRINT = ['ArrowUp', 'KeyW', 'ShiftLeft', 'ShiftRight'];
const BRAKE = ['ArrowDown', 'KeyS'];
const ACTIONS = { Space: 'jump', KeyE: 'item', KeyJ: 'item', Enter: 'item', KeyQ: 'ability', KeyK: 'ability', KeyT: 'taunt' };
// standard gamepad mapping: A jump, B item, X ability, Y taunt, RB/RT sprint, LB/LT brake
const PAD_ACTIONS = { 0: 'jump', 1: 'item', 2: 'ability', 3: 'taunt' };

// HUD hint for a one-shot action: gamepad wins, then the on-screen touch pad, then keyboard.
const HINTS = {
  pad: { item: 'B', ability: 'X' },
  touch: { item: 'tap ITEM', ability: 'tap SKILL' },
  key: { item: 'E', ability: 'Q' },
};
export function actionHint(action, { usingPad = false, touchOn = false } = {}) {
  return HINTS[usingPad ? 'pad' : touchOn ? 'touch' : 'key'][action];
}

export class Controls {
  constructor({ onAction, isActive }) {
    this.onAction = onAction;
    this.isActive = isActive;
    this.keys = new Set();
    this.padPrev = [];
    this.touch = { steer: 0, sprint: false, stickId: null, originX: 0 };
    this.usingPad = false;
    this.touchOn = false;

    addEventListener('keydown', (e) => {
      if (!this.isActive() || e.target.tagName === 'INPUT') return;
      const all = [...STEER_LEFT, ...STEER_RIGHT, ...SPRINT, ...BRAKE];
      if (all.includes(e.code)) { e.preventDefault(); this.keys.add(e.code); this.usingPad = false; }
      else if (ACTIONS[e.code]) { e.preventDefault(); if (!e.repeat) this.onAction(ACTIONS[e.code]); }
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
  }

  // Touch: drag anywhere on the left part of the screen to steer; buttons on the right.
  attachTouch(root, knob) {
    this.touchOn = true;
    const zone = root.querySelector('.stick-zone');
    const base = root.querySelector('.stick');
    const setKnob = (dx) => { knob.style.transform = `translateX(${dx}px)`; };
    zone.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.touch.stickId = e.pointerId;
      this.touch.originX = e.clientX;
      zone.setPointerCapture(e.pointerId);
      base.style.left = `${e.clientX - base.offsetWidth / 2}px`;
      base.style.top = `${e.clientY - base.offsetHeight / 2}px`;
      base.classList.add('active');
    });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.touch.stickId) return;
      const range = 60;
      const dx = Math.max(-range, Math.min(range, e.clientX - this.touch.originX));
      this.touch.steer = Math.abs(dx) < 6 ? 0 : dx / range;
      setKnob(dx);
    });
    const end = (e) => {
      if (e.pointerId !== this.touch.stickId) return;
      this.touch.stickId = null;
      this.touch.steer = 0;
      setKnob(0);
      base.classList.remove('active');
    };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);
    for (const b of root.querySelectorAll('[data-hold]')) {
      const on = (e) => { e.preventDefault(); this.touch[b.dataset.hold] = true; b.classList.add('down'); };
      const off = (e) => { e.preventDefault(); this.touch[b.dataset.hold] = false; b.classList.remove('down'); };
      b.addEventListener('pointerdown', on);
      b.addEventListener('pointerup', off);
      b.addEventListener('pointercancel', off);
      b.addEventListener('pointerleave', off);
    }
    for (const b of root.querySelectorAll('[data-act]')) {
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); this.onAction(b.dataset.act); b.classList.add('down'); });
      b.addEventListener('pointerup', () => b.classList.remove('down'));
      b.addEventListener('pointerleave', () => b.classList.remove('down'));
    }
  }

  // Called every frame; returns the merged continuous input.
  poll() {
    const k = (codes) => codes.some((c) => this.keys.has(c));
    let steer = (k(STEER_RIGHT) ? 1 : 0) - (k(STEER_LEFT) ? 1 : 0);
    let sprint = k(SPRINT) || this.touch.sprint;
    let brake = k(BRAKE);
    if (this.touch.steer) steer = this.touch.steer;

    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const pad of pads) {
      if (!pad || !pad.connected) continue;
      const ax = pad.axes[0] || 0;
      const dead = 0.18;
      const stick = Math.abs(ax) < dead ? 0 : Math.sign(ax) * ((Math.abs(ax) - dead) / (1 - dead));
      const dpad = (pad.buttons[15]?.pressed ? 1 : 0) - (pad.buttons[14]?.pressed ? 1 : 0);
      const pSteer = dpad || stick;
      const pSprint = (pad.buttons[7]?.value || 0) > 0.25 || pad.buttons[5]?.pressed || (pad.axes[1] || 0) < -0.6;
      const pBrake = (pad.buttons[6]?.value || 0) > 0.25 || pad.buttons[4]?.pressed || (pad.axes[1] || 0) > 0.6;
      if (pSteer || pSprint || pBrake) this.usingPad = true;
      if (pSteer) steer = pSteer;
      sprint = sprint || pSprint;
      brake = brake || pBrake;
      const prev = this.padPrev[pad.index] || [];
      for (const [i, a] of Object.entries(PAD_ACTIONS)) {
        const now = !!pad.buttons[i]?.pressed;
        if (now && !prev[i] && this.isActive()) { this.onAction(a); this.usingPad = true; }
        prev[i] = now;
      }
      this.padPrev[pad.index] = prev;
    }
    return { steer: Math.max(-1, Math.min(1, steer)), sprint: !!sprint, brake: !!brake };
  }

  hint(action) {
    return actionHint(action, this);
  }
}
