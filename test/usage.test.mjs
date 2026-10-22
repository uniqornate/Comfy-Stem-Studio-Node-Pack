import test from 'node:test';
import assert from 'node:assert/strict';
import { startTracker, sampleTracker, finishTracker, readUsage, remember } from '../src/usage.mjs';
import { MODEL_INFO, formatBytes } from '../src/model-info.mjs';

const gb = 1073741824;
test('the tracker keeps the highest increase over the starting level and the highest CPU load', () => {
  let tracker = startTracker({ vram: { used: 4 * gb, total: 24 * gb }, ram: { used: 20 * gb, total: 64 * gb }, cpuLoad: 5 }, 1000);
  tracker = sampleTracker(tracker, { vram: { used: 7 * gb }, ram: { used: 21 * gb }, cpuLoad: 40 });
  tracker = sampleTracker(tracker, { vram: { used: 6 * gb }, ram: { used: 25 * gb }, cpuLoad: 22 });
  assert.deepEqual(finishTracker(tracker, 91000), { vram: 3 * gb, ram: 5 * gb, cpu: 40, seconds: 90, at: 91000 });
});
test('an unavailable meter stays unknown instead of becoming zero', () => {
  const tracker = sampleTracker(startTracker({ vram: null, ram: { used: 1 * gb }, cpuLoad: null }), { vram: null, ram: { used: 2 * gb }, cpuLoad: null });
  const result = finishTracker(tracker);
  assert.equal(result.vram, null); assert.equal(result.ram, gb); assert.equal(result.cpu, null);
});
test('stored usage is validated and replaced per model', () => {
  const stored = JSON.stringify({ mrx: { vram: 1, ram: 2, cpu: 3, seconds: 4, at: 5 }, 'bad key!': { at: 1 }, sfc: { at: 'x' }, uss: { vram: -1, ram: null, cpu: 'x', seconds: -3, at: 9 } });
  const usage = readUsage(stored);
  assert.deepEqual(Object.keys(usage), ['mrx', 'uss']); assert.equal(usage.uss.vram, null); assert.equal(usage.uss.seconds, 0);
  assert.equal(remember(usage, 'mrx', { vram: 9, ram: null, cpu: null, seconds: 1, at: 2 }).mrx.vram, 9);
  assert.deepEqual(readUsage('not json'), {});
});
test('every model has a row and sizes print readably', () => {
  assert.equal(new Set(MODEL_INFO.map(row => row.key)).size, MODEL_INFO.length);
  for (const key of ['mrx', 'bandit', 'sfc', 'music6', 'uss', 'sam', 'guidesep', 'brush-small', 'brush-medium', 'brush-mmaudio']) assert.ok(MODEL_INFO.some(row => row.key === key), key);
  assert.equal(formatBytes(122317657), '122 MB'); assert.equal(formatBytes(9222116660), '9.2 GB'); assert.equal(formatBytes(null), '');
  assert.equal(MODEL_INFO.find(row => row.key === 'music6').disk, 54996327);
});
