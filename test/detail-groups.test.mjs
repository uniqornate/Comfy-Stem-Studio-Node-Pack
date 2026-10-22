import test from 'node:test';
import { stemWorkflow } from '../src/graphs.mjs';
import assert from 'node:assert/strict';
import { groupedTracks, initialMix, descendants } from '../src/detail-groups.mjs';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const stems = [{ id: 'a' }, { id: 'b' }, { id: 'c', parentId: 'a' }, { id: 'd', parentId: 'c' }, { id: 'e', parentId: 'b' }];
test('child channels retain parent color, nesting and collapse without deleting outputs', () => {
  const rows = groupedTracks(stems);
  assert.deepEqual(rows.map(row => [row.stem.id, row.depth, row.color]), [['a',0,0],['c',1,0],['d',2,0],['b',0,1],['e',1,1]]);
  assert.deepEqual(groupedTracks(stems, new Set(['a'])).map(row => row.stem.id), ['a','b','e']);
  assert.deepEqual([...descendants(stems, 'a')], ['c','d']); assert.equal(stems.length, 5);
});
test('new detail channels start muted and preserve existing mixer choices', () => {
  const previous = { a: { mute: false, solo: true, level: 0.3 } };
  const mix = initialMix(stems, previous);
  assert.deepEqual(mix.a, previous.a); assert.equal(mix.c.mute, true); assert.equal(mix.b.mute, false);
});
test('USS All receives cropped input and restores full timeline positions before saving', () => {
  const graph = stemWorkflow({ mode: 'uss', target: 'All', range: { start: 1.25, end: 4.75 }, autoThreshold: true });
  assert.deepEqual(graph['2'].inputs.audio, ['3', 0]); assert.deepEqual(graph['2'].inputs.range_reference, ['1', 0]);
  assert.equal(graph['2'].inputs.range_start, 1.25); assert.equal(graph['2'].inputs.suppress_duplicates, true);
  assert.equal(graph['3'].inputs.end_seconds, 4.75);
});
test('SAM and individual USS target graphs crop once and independently pad target/remainder', () => {
  for (const mode of ['sam', 'uss']) {
    const graph = stemWorkflow({ mode, target: 'Door', range: { start: 2, end: 3 } });
    assert.equal(graph['2'].class_type, mode === 'sam' ? 'StemStudioSAM' : 'StemStudioExtract');
    assert.deepEqual(graph['10'].inputs.audio, ['4', 0]); assert.deepEqual(graph['11'].inputs.audio, ['5', 0]);
    assert.deepEqual(graph['4'].inputs.reference, ['1', 0]); assert.deepEqual(graph['5'].inputs.audio, ['2', 1]);
  }
});