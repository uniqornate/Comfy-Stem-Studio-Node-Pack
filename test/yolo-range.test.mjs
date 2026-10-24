import test from 'node:test';
import assert from 'node:assert/strict';
import { stemWorkflow } from '../src/graphs.mjs';
test('a classic separator run on a channel range crops once and puts every channel back at its place on the timeline', () => {
  const graph = stemWorkflow({ mode: 'stems', model: 'bandit', range: { start: 12, end: 40 }, parentId: 'parent' });
  assert.equal(graph['3'].class_type, 'StemStudioAudioRange'); assert.equal(graph['3'].inputs.start_seconds, 12); assert.deepEqual(graph['2'].inputs.audio, ['3', 0]); assert.equal(graph['2'].inputs.model, 'bandit');
  for (const [index, node] of ['10', '11', '12'].entries()) {
    const restore = graph[`r${node}`]; assert.equal(restore.class_type, 'StemStudioRestoreRange'); assert.deepEqual(restore.inputs.audio, ['2', index]); assert.equal(restore.inputs.start_seconds, 12);
    assert.deepEqual(graph[node].inputs.audio, [`r${node}`, 0]);
  }
});
test('target modes still restore their target and remainder only', () => {
  const graph = stemWorkflow({ mode: 'uss', target: 'Rain', range: { start: 1, end: 3 } });
  assert.deepEqual(graph['10'].inputs.audio, ['4', 0]); assert.deepEqual(graph['11'].inputs.audio, ['5', 0]); assert.equal(graph.r12, undefined);
});
