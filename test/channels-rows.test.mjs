import test from 'node:test';
import assert from 'node:assert/strict';
import { ROW_DEFAULT, ROW_MAX, ROW_MIN, clampRow, knobFromRow, rowFromKnob } from '../src/row-height.mjs';
import { channelFamily, removeChannels } from '../src/channels.mjs';

test('row heights stay within limits and the knob scale round-trips', () => {
  assert.equal(clampRow(10), ROW_MIN); assert.equal(clampRow(9999), ROW_MAX); assert.equal(clampRow(NaN), ROW_DEFAULT); assert.equal(clampRow(100.4), 100);
  assert.equal(rowFromKnob(0.1), ROW_MIN); assert.equal(rowFromKnob(1), ROW_MAX); assert.equal(rowFromKnob(5), ROW_MAX); assert.equal(rowFromKnob(-1), ROW_MIN);
  for (const px of [58, 68, 100, 180, 260]) assert.ok(Math.abs(rowFromKnob(knobFromRow(px)) - px) <= 1, String(px));
  assert.ok(knobFromRow(ROW_DEFAULT) > 0.1 && knobFromRow(ROW_DEFAULT) < 0.3);
});
test('a channel family is the channel plus all of its detail channels at any depth', () => {
  const stems = [{ id: 'a' }, { id: 'b', parentId: 'a' }, { id: 'c', parentId: 'b' }, { id: 'd' }];
  assert.deepEqual(new Set(channelFamily(stems, 'a')), new Set(['a', 'b', 'c'])); assert.deepEqual(channelFamily(stems, 'd'), ['d']);
});
test('removing channels keeps the other takes, and an emptied take disappears', () => {
  const runs = [{ runId: 'one', stems: [{ id: 'a' }, { id: 'b' }] }, { runId: 'two', stems: [{ id: 'c' }] }];
  const partly = removeChannels(runs, 'one', ['a']);
  assert.deepEqual(partly.runs.map(run => run.stems.map(stem => stem.id)), [['b'], ['c']]); assert.equal(partly.takeRemoved, false);
  const emptied = removeChannels(runs, 'two', ['c', 'zzz']);
  assert.deepEqual(emptied.runs.map(run => run.runId), ['one']); assert.equal(emptied.takeRemoved, true);
  assert.equal(removeChannels(runs, 'one', []).runs.length, 2); assert.equal(runs[0].stems.length, 2);
});
