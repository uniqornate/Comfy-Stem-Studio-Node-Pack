import test from 'node:test';
import assert from 'node:assert/strict';
import { mixPlan, encodeWav } from '../src/mixdown.mjs';
import { MediaTransport } from '../src/media-transport.mjs';
import { videoWorkflow } from '../src/graphs.mjs';

test('the mix plan carries each channel pan (centre when unset)', () => {
  const plan = mixPlan({ tracks: [{ id: 'a', duration: 2 }, { id: 'b', duration: 2 }], mix: { a: { mute: false, level: 1, pan: -0.5 }, b: { mute: false, level: 1 } }, duration: 2 });
  assert.deepEqual(plan.map(item => item.pan), [-0.5, 0]);
});
test('a two channel WAV interleaves left and right and states its layout', () => {
  const bytes = encodeWav([Float32Array.from([1, 0]), Float32Array.from([0, 1])], 8000, 16), view = new DataView(bytes.buffer);
  assert.equal(view.getUint16(22, true), 2); assert.equal(view.getUint32(28, true), 8000 * 2 * 2); assert.equal(view.getUint16(32, true), 4);
  assert.deepEqual([view.getInt16(44, true), view.getInt16(46, true), view.getInt16(48, true), view.getInt16(50, true)], [32767, 0, 0, 32767]);
  assert.throws(() => encodeWav([new Float32Array(2), new Float32Array(3)], 8000, 16), /equal length/);
});
test('panning routes a channel through left and right gains with the balance law, centre goes straight out', () => {
  const made = [];
  const node = name => ({ name, gain: { value: 1, setTargetAtTime(value) { this.value = value; } }, links: [], connect(target) { this.links.push(target); }, disconnect() {} });
  const ctx = { state: 'running', currentTime: 0, destination: { name: 'out' }, createGain() { const item = node('gain'); made.push(item); return item; }, createChannelSplitter() { return node('split'); }, createChannelMerger() { return node('merge'); } };
  const transport = new MediaTransport(); transport.context = ctx;
  const gain = node('channel'); transport.wire('a', gain, 0);
  assert.deepEqual(gain.links, [ctx.destination]);
  transport.wire('a', gain, 0.5);
  const [, left, right] = made; // made: [double, left, right] assert.equal(left.gain.value, 0.5); assert.equal(right.gain.value, 1);
  transport.wire('a', gain, -0.25); assert.equal(left.gain.value, 1); assert.equal(right.gain.value, 0.75);
});
test('the video export graph passes a non-zero pan to the channel node', () => {
  const graph = videoWorkflow([{ id: 'a', label: 'A', path: 'a.flac', level: 1, mute: false, solo: false, pan: 0.4 }, { id: 'b', label: 'B', path: 'b.flac', level: 1, mute: false, solo: false }], { mode: 'mix', format: 'mp4' });
  const tracks = Object.values(graph).filter(item => item.class_type === 'StemStudioVideoTrack');
  assert.equal(tracks[0].inputs.pan, 0.4); assert.equal('pan' in tracks[1].inputs, false);
});
