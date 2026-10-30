import test from 'node:test';
import assert from 'node:assert/strict';
import { pickChannelSelection } from '../src/channel-selection.mjs';

const order = ['dialogue', 'music', 'effects', 'footsteps'];
const ids = state => [...state.selected];

test('Shift keeps the first channel as anchor across repeated range picks', () => {
  const first = pickChannelSelection(order, new Set(), '', 'dialogue');
  const second = pickChannelSelection(order, first.selected, first.anchor, 'effects', { shift: true });
  const third = pickChannelSelection(order, second.selected, second.anchor, 'footsteps', { shift: true });
  assert.deepEqual(ids(second), ['dialogue', 'music', 'effects']);
  assert.deepEqual(ids(third), order);
  assert.equal(third.anchor, 'dialogue');
});

test('Ctrl toggles individual channels and Ctrl+Shift adds a contiguous range', () => {
  const first = pickChannelSelection(order, new Set(), '', 'dialogue');
  const second = pickChannelSelection(order, first.selected, first.anchor, 'effects', { toggle: true });
  const third = pickChannelSelection(order, second.selected, second.anchor, 'footsteps', { shift: true, toggle: true });
  assert.deepEqual(ids(third), ['dialogue', 'effects', 'footsteps']);
  const reanchored = pickChannelSelection(order, new Set(['effects']), 'effects', 'effects');
  assert.deepEqual(ids(reanchored), ['effects']);
  assert.equal(reanchored.anchor, 'effects');
});

test('clicking the already selected channel keeps a usable Shift anchor', () => {
  const first = pickChannelSelection(order, new Set(['music']), 'music', 'music');
  const range = pickChannelSelection(order, first.selected, first.anchor, 'footsteps', { shift: true });
  assert.deepEqual(ids(range), ['music', 'effects', 'footsteps']);
});

test('a collapsed or deleted anchor falls back to a visible selected channel', () => {
  const visible = ['dialogue', 'effects', 'footsteps'];
  const next = pickChannelSelection(visible, new Set(['dialogue']), 'music', 'footsteps', { shift: true });
  assert.deepEqual(ids(next), visible);
  assert.equal(next.anchor, 'dialogue');
});
