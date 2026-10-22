import test from 'node:test';
import assert from 'node:assert/strict';
import { helpKeyApplies, isTypingTarget, playbackKeyApplies } from '../src/keys.mjs';

test('text fields, selects and editable regions own the keyboard, other controls do not', () => {
  for (const target of [{ tagName: 'TEXTAREA' }, { tagName: 'textarea' }, { tagName: 'SELECT' }, { tagName: 'DIV', isContentEditable: true }, { tagName: 'INPUT', type: 'text' }, { tagName: 'INPUT', type: 'number' }, { tagName: 'INPUT', type: 'password' }, { tagName: 'INPUT', type: 'search' }, { tagName: 'INPUT' }]) assert.equal(isTypingTarget(target), true, JSON.stringify(target));
  for (const target of [null, undefined, { tagName: 'BUTTON' }, { tagName: 'INPUT', type: 'range' }, { tagName: 'INPUT', type: 'checkbox' }, { tagName: 'DIV' }, { tagName: 'VIDEO' }]) assert.equal(isTypingTarget(target), false, JSON.stringify(target));
});
test('Space reaches playback only when nothing is being typed and no dialog is open', () => {
  assert.equal(playbackKeyApplies({ target: { tagName: 'BODY' }, modalOpen: false }), true);
  assert.equal(playbackKeyApplies({ target: { tagName: 'INPUT', type: 'range' }, modalOpen: false }), true);
  assert.equal(playbackKeyApplies({ target: { tagName: 'TEXTAREA' }, modalOpen: false }), false);
  assert.equal(playbackKeyApplies({ target: { tagName: 'BODY' }, modalOpen: true }), false);
  assert.equal(playbackKeyApplies({ target: { tagName: 'TEXTAREA' }, modalOpen: true }), false);
});
test('the help key never opens over another dialog or while typing, but can close itself', () => {
  assert.equal(helpKeyApplies({ target: { tagName: 'BODY' }, modalOpen: false, helpOpen: false }), true);
  assert.equal(helpKeyApplies({ target: { tagName: 'BODY' }, modalOpen: true, helpOpen: false }), false);
  assert.equal(helpKeyApplies({ target: { tagName: 'BODY' }, modalOpen: true, helpOpen: true }), true);
  assert.equal(helpKeyApplies({ target: { tagName: 'INPUT', type: 'text' }, modalOpen: false, helpOpen: false }), false);
});
