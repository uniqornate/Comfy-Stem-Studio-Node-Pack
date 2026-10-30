import test from 'node:test';
import assert from 'node:assert/strict';
import { mixPlan, encodeWav } from '../src/mixdown.mjs';
import { analyzeSource, suggestModel } from '../src/source-profile.mjs';
import { speechLike, musicLike, effectsLike } from '../scripts/synth-signals.mjs';
test('mix plan honours mute, selection, level, clip edits and gain regions', () => {
  const tracks = [{ id: 'a', duration: 10 }, { id: 'b', duration: 10 }, { id: 'c', duration: 10 }];
  const mix = { a: { mute: false, level: 0.5 }, b: { mute: true, level: 1 }, c: { mute: false, level: 1 } };
  const edits = { a: { clips: [{ id: 'x', start: 0, end: 4 }, { id: 'y', start: 6, end: 10 }], gains: [{ start: 0, end: 2, db: -6 }] } };
  const plan = mixPlan({ tracks, mix, edits, duration: 10 });
  assert.deepEqual(plan.map(item => item.id), ['a', 'c']);
  assert.equal(plan[0].level, 0.5);
  assert.deepEqual(plan[0].segments.map(segment => [segment.start, segment.end]), [[0, 2], [2, 4], [6, 10]]);
  assert.ok(Math.abs(plan[0].segments[0].gain - 10 ** (-6 / 20)) < 1e-9);
  assert.deepEqual(mixPlan({ tracks, mix, duration: 10, selected: ['c'] }).map(item => item.id), ['c']);
  assert.deepEqual(mixPlan({ tracks, mix, duration: 5 })[0].segments, [{ start: 0, end: 5, gain: 1 }]);
});
test('mix plan places a short processed section at the source video time', () => {
  const edits = { section: { clips: [{ id: 'full', start: 0, end: 2, offset: 5 }], gains: [] } };
  const plan = mixPlan({ tracks: [{ id: 'section', duration: 2 }], mix: { section: { mute: false, level: 1 } }, edits, duration: 10 });
  assert.deepEqual(plan[0].segments, [{ start: 5, end: 7, gain: 1, source: 0 }]);
});
test('WAV encoder writes a valid header and clamps samples', () => {
  const samples = Float32Array.from([0, 1, -1, 2, -2, NaN]);
  for (const bits of [16, 24, 32]) {
    const bytes = encodeWav(samples, 44100, bits), view = new DataView(bytes.buffer);
    assert.equal(String.fromCharCode(...bytes.slice(0, 4)), 'RIFF'); assert.equal(String.fromCharCode(...bytes.slice(8, 12)), 'WAVE');
    assert.equal(view.getUint32(24, true), 44100); assert.equal(view.getUint16(34, true), bits); assert.equal(view.getUint16(20, true), bits === 32 ? 3 : 1);
    assert.equal(view.getUint32(40, true), samples.length * bits / 8); assert.equal(bytes.length, 44 + samples.length * bits / 8);
  }
  const view = new DataView(encodeWav(samples, 8000, 16).buffer);
  assert.deepEqual([1, 2, 3, 4, 5].map(i => view.getInt16(44 + i * 2, true)), [32767, -32768, 32767, -32768, 0]);
  assert.throws(() => encodeWav(samples, 8000, 8), /16, 24/);
});
test('source profiler tells speech, sustained music and effect bursts apart and suggests a model', () => {
  const rate = 44100;
  const speech = analyzeSource(speechLike(8, rate), rate), music = analyzeSource(musicLike(8, rate), rate), effects = analyzeSource(effectsLike(8, rate), rate);
  assert.equal(speech.kind, 'dialogue'); assert.equal(music.kind, 'music'); assert.equal(effects.kind, 'effects');
  assert.equal(suggestModel(speech).model, 'mrx'); assert.equal(suggestModel(music).model, 'music6'); assert.equal(suggestModel(effects).model, 'mrx');
  assert.equal(analyzeSource(new Float32Array(rate * 3), rate).kind, 'silent'); assert.equal(suggestModel(analyzeSource(new Float32Array(rate * 3), rate)), null);
  assert.equal(analyzeSource(new Float32Array(10), rate), null); assert.equal(analyzeSource(null, rate), null);
  const broken = speechLike(4, rate); broken[1000] = NaN; assert.equal(analyzeSource(broken, rate).kind, 'dialogue');
});
