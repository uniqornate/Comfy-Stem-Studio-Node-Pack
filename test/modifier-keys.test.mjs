import test from 'node:test';
import assert from 'node:assert/strict';
import { createModifierStore, waveformMode } from '../src/modifier-keys.mjs';

function fixture() {
  const target = new EventTarget(), doc = new EventTarget(); doc.hidden = false;
  const store = createModifierStore(() => target, () => doc);
  const changes = []; const off = store.subscribe(() => changes.push(store.getSnapshot()));
  const send = (type, flags = {}) => { const event = new Event(type); Object.assign(event, { altKey: false, ctrlKey: false, ...flags }); target.dispatchEvent(event); };
  return { target, doc, store, changes, off, send };
}

test('rings follow held keys and key-up explicitly releases even stale modifier flags', () => {
  const f = fixture();
  f.send('keydown', { key: 'Alt', altKey: true });
  assert.equal(waveformMode(f.store.getSnapshot(), true), 'row');
  f.send('keyup', { key: 'Alt', altKey: true });
  assert.equal(waveformMode(f.store.getSnapshot(), true), 'wave');
  f.send('keydown', { code: 'ControlLeft', ctrlKey: true });
  assert.equal(waveformMode(f.store.getSnapshot(), true), 'video');
  assert.equal(waveformMode(f.store.getSnapshot(), false), 'wave');
  f.send('keyup', { code: 'ControlLeft', ctrlKey: true });
  assert.deepEqual(f.store.getSnapshot(), { alt: false, ctrl: false }); f.off();
});

test('Alt wins over Ctrl; releasing Alt restores the still-held Ctrl function', () => {
  const f = fixture(); f.send('keydown', { key: 'Alt', altKey: true, ctrlKey: true });
  assert.equal(waveformMode(f.store.getSnapshot(), true), 'row');
  f.send('keyup', { key: 'Alt', ctrlKey: true });
  assert.equal(waveformMode(f.store.getSnapshot(), true), 'video'); f.off();
});

test('focus loss, hidden tabs and page navigation clear modifier state', () => {
  const f = fixture();
  for (const type of ['blur', 'pagehide']) {
    f.send('keydown', { key: 'Alt', altKey: true, ctrlKey: true }); f.send(type);
    assert.deepEqual(f.store.getSnapshot(), { alt: false, ctrl: false });
  }
  f.send('keydown', { key: 'Control', ctrlKey: true });
  f.doc.hidden = true; f.doc.dispatchEvent(new Event('visibilitychange'));
  assert.equal(f.store.getSnapshot().ctrl, false); f.off();
});

test('pointer flags repair a missed key-up and snapshots stay stable during unchanged movement', () => {
  const f = fixture(); f.send('keydown', { key: 'Alt', altKey: true });
  f.send('pointermove'); assert.equal(f.store.getSnapshot().alt, false);
  const snapshot = f.store.getSnapshot(), count = f.changes.length;
  f.send('pointermove'); f.send('pointerup'); f.send('wheel');
  assert.equal(f.store.getSnapshot(), snapshot); assert.equal(f.changes.length, count); f.off();
});

test('listeners use capture, share one subscription set and clean up after the last knob', () => {
  const registrations = [], removals = [], target = new EventTarget(), doc = new EventTarget();
  const add = target.addEventListener.bind(target), remove = target.removeEventListener.bind(target);
  target.addEventListener = (name, fn, capture) => { registrations.push([name, capture]); add(name, fn, capture); };
  target.removeEventListener = (name, fn, capture) => { removals.push([name, capture]); remove(name, fn, capture); };
  const store = createModifierStore(() => target, () => doc);
  const a = store.subscribe(() => {}), b = store.subscribe(() => {});
  assert.equal(registrations.filter(([name]) => name === 'keyup').length, 1);
  assert.ok(registrations.some(([name, capture]) => name === 'keyup' && capture === true));
  a(); assert.equal(removals.length, 0); b();
  assert.deepEqual(removals, registrations); assert.deepEqual(store.getSnapshot(), { alt: false, ctrl: false });
});
