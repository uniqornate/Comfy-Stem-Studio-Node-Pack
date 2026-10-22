import test from 'node:test';
import { stemWorkflow } from '../src/graphs.mjs';
import assert from 'node:assert/strict';
import { normalizeGuidance, interpolatedBox } from '../src/sam-guidance.mjs';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const range = { start: 10, end: 20 };
const box = { x: .1, y: .2, width: .3, height: .4 };
test('SAM anchors convert absolute timeline seconds into crop-local seconds exactly once', () => {
  const result = normalizeGuidance({ description: 'Heavy Footsteps', anchors: [{ kind: '+', start: 13.2, end: 13.7 }, { kind: '-', start: 16, end: 17 }], predictSpans: true }, range);
  assert.equal(result.description, 'heavy footsteps');
  assert.ok(Math.abs(result.anchors[0][1] - 3.2) < 1e-10); assert.equal(result.anchors[1][1], 6); assert.equal(result.predictSpans, false);
});
test('SAM rejects contradictory, external and empty sound examples', () => {
  for (const anchors of [[{ kind: '+', start: 9, end: 11 }], [{ kind: '-', start: 11, end: 11 }], [{ kind: '+', start: 11, end: 13 }, { kind: '-', start: 12, end: 14 }]]) assert.throws(() => normalizeGuidance({ anchors }, range));
  assert.equal(normalizeGuidance({ predictSpans: true }, range).predictSpans, true);
});
test('visual marks are bounded and normalized; empty masks and long selections fail', () => {
  const normalized = normalizeGuidance({ visual: { keyframes: [{ time: 15, box }, { time: 11, box }] } }, range);
  assert.deepEqual(normalized.keyframes.map(frame => frame.time), [1, 5]);
  for (const visual of [{ keyframes: [] }, { keyframes: [{ time: 11, box: { ...box, x: .9 } }] }]) assert.throws(() => normalizeGuidance({ visual }, range));
  assert.throws(() => normalizeGuidance({ visual: { keyframes: [{ time: 11, box }] } }, { start: 0, end: 40 }), /30 seconds/);
});
test('manual visual box interpolates between marks, exists only inside them, and a single mark holds', () => {
  const frames = [{ time: 0, box }, { time: 10, box: { ...box, x: .5 } }];
  assert.equal(interpolatedBox(frames, -1), null); assert.equal(interpolatedBox(frames, 0).x, .1); assert.ok(Math.abs(interpolatedBox(frames, 5).x - .3) < 1e-10); assert.equal(interpolatedBox(frames, 10).x, .5); assert.equal(interpolatedBox(frames, 20), null);
  assert.equal(interpolatedBox([frames[0]], 99).x, .1);
});
test('SAM multimodal graph uses native LoadVideo, correct video offset, prompt and anchors', () => {
  const graph = stemWorkflow({ mode: 'sam', target: 'Door', range, sam: { description: 'wooden door closing', anchors: [{ kind: '+', start: 12, end: 13 }], visual: { keyframes: [{ time: 12, box }] } } });
  assert.equal(graph['6'].class_type, 'LoadVideo'); assert.deepEqual(graph['2'].inputs.video, ['6', 0]); assert.equal(graph['2'].inputs.video_start, 10);
  const payload = JSON.parse(graph['2'].inputs.guidance_json);
  assert.deepEqual(payload.anchors, [['+', 2, 3]]); assert.equal(payload.keyframes[0].time, 2); assert.equal(graph['2'].inputs.description, 'wooden door closing');
  assert.deepEqual(graph['2'].inputs.audio, ['3', 0]); assert.deepEqual(graph['10'].inputs.audio, ['4', 0]);
});
test('text-only SAM guidance never uploads a video', () => {
  const graph = stemWorkflow({ mode: 'sam', target: 'Door', range, sam: { description: 'door creaking' } });
  assert.equal(graph['6'], undefined); assert.equal(graph['2'].inputs.video, undefined);
});
test('picture-only guidance sends empty text and disables text-based automatic spans', () => {
  const graph = stemWorkflow({ mode: 'sam', target: 'Visual target', range, sam: { visualOnly: true, predictSpans: true, visual: { keyframes: [{ time: 12, box }] } } });
  assert.equal(graph['2'].inputs.description, '');
  assert.equal(JSON.parse(graph['2'].inputs.guidance_json).predictSpans, false);
  assert.throws(() => normalizeGuidance({ visualOnly: true }, range), /target box/);
});