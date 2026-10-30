import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyHistory, record, undo, redo } from '../src/history.mjs';
import { toggleSolo, toggleMute, normalizeSolo } from '../src/solo.mjs';
import { channelFamily, removeChannels } from '../src/channels.mjs';

const mix = () => ({ a: { mute: false, solo: false, level: 1 }, b: { mute: true, solo: false, level: .5 }, c: { mute: false, solo: false, level: 1 } });

test('history records, undoes, redoes and clears redo after a new edit', () => {
  let h = record(emptyHistory(), 'one'); h = record(h, 'two');
  const first = undo(h, 'three'); assert.equal(first.state, 'two'); assert.deepEqual(first.history.future, ['three']);
  const again = redo(first.history, 'two'); assert.equal(again.state, 'three');
  assert.deepEqual(record(first.history, 'x').future, []);
  assert.equal(undo(emptyHistory(), 'now'), null); assert.equal(redo(emptyHistory(), 'now'), null);
});
test('history is bounded', () => {
  let h = emptyHistory(); for (let i = 0; i < 150; i++) h = record(h, i, 100);
  assert.equal(h.past.length, 100); assert.equal(h.past[0], 50);
});

test('one workspace undo restores an extracted parent, its children and group view; redo removes them again', () => {
  const before = { runs: [{ runId: 'take', stems: [{ id: 'p' }, { id: 'detail', parentId: 'p' }] }], selectedRun: 'take', timelines: { take: { mix: { p: { level: 1 } }, groups: [{ id: 'g', members: ['p'] }] } } };
  const ids = channelFamily(before.runs[0].stems, 'p');
  const removed = removeChannels(before.runs, 'take', ids);
  const after = { runs: removed.runs, selectedRun: '', timelines: {} };
  const restored = undo(record(emptyHistory(), before), after);
  assert.deepEqual(restored.state, before);
  assert.equal(restored.state.runs[0].stems[1].parentId, 'p');
  const removedAgain = redo(restored.history, restored.state);
  assert.deepEqual(removedAgain.state, after);
});
test('solo mutes every other channel immediately and unsolo restores prior mute states', () => {
  const soloed = toggleSolo(mix(), 'a');
  assert.deepEqual([soloed.a.solo, soloed.a.mute, soloed.b.mute, soloed.c.mute], [true, false, true, true]);
  const restored = toggleSolo(soloed, 'a');
  assert.deepEqual(restored, mix());
});
test('plain solo is exclusive while ctrl solo is additive', () => {
  const first = toggleSolo(mix(), 'a'), second = toggleSolo(first, 'c');
  assert.deepEqual([second.a.solo, second.a.mute, second.c.solo, second.c.mute], [false, true, true, false]);
  const both = toggleSolo(first, 'c', true);
  assert.deepEqual([both.a.solo, both.c.solo, both.b.mute], [true, true, true]);
  const removed = toggleSolo(both, 'a', true);
  assert.deepEqual([removed.a.solo, removed.a.mute, removed.c.solo], [false, true, true]);
  assert.deepEqual(toggleSolo(removed, 'c', true), mix());
});
test('manual mute during a solo session edits the solo group and last release restores everything', () => {
  const soloed = toggleSolo(mix(), 'a');
  const joined = toggleMute(soloed, 'c'); assert.deepEqual([joined.c.solo, joined.c.mute], [true, false]);
  const left = toggleMute(joined, 'a'); assert.deepEqual([left.a.solo, left.a.mute], [false, true]);
  assert.deepEqual(toggleMute(left, 'c'), mix());
  assert.equal(toggleMute(mix(), 'a').a.mute, true);
});
test('legacy solo flags are materialised and stale restore flags are dropped', () => {
  const legacy = { ...mix(), a: { mute: false, solo: true, level: 1 } };
  const normal = normalizeSolo(legacy); assert.equal(normal.b.mute, true); assert.equal(normal.c.mute, true);
  assert.equal('restoreMute' in normalizeSolo(mix()).a, false);
});
