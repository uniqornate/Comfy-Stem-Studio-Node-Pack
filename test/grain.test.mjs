import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanGrain, noiseTile, GRAIN_DEFAULTS } from '../src/grain.mjs';
test('grain settings are clamped and unknown values fall back', () => {
  assert.deepEqual(cleanGrain(null), GRAIN_DEFAULTS);
  const value = cleanGrain({ opacity: 9, size: 0, amount: -1, blend: 'nope', fps: 100, seed: 0 });
  assert.equal(value.opacity, 0.3); assert.equal(value.size, 0.5); assert.equal(value.amount, 0); assert.equal(value.blend, 'overlay'); assert.equal(value.fps, 24); assert.equal(value.seed, 1); assert.equal(cleanGrain({}).seed, 56);
});
test('the same seed gives the same tile, mono grain has equal channels, overlay grain is opaque grey', () => {
  const a = noiseTile({ seed: 5 }, 16), b = noiseTile({ seed: 5 }, 16), c = noiseTile({ seed: 6 }, 16);
  assert.deepEqual(a, b); assert.notDeepEqual(a, c);
  for (let i = 0; i < a.length; i += 4) assert.ok(a[i] === a[i + 1] && a[i + 1] === a[i + 2]);
  const grey = noiseTile({ blend: 'overlay', mono: false }, 16);
  for (let i = 0; i < grey.length; i += 4) assert.equal(grey[i + 3], 255);
  assert.ok(noiseTile({ blend: 'overlay', mono: false }, 16).some((value, i) => i % 4 === 0 && value !== grey[i + 1]));
});
