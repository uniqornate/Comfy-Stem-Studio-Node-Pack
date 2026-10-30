import assert from 'node:assert/strict';
import test from 'node:test';
import { MediaTransport } from '../src/media-transport.mjs';
class Video extends EventTarget {
  duration = 10; currentTime = 0; paused = true; ended = false; seeking = false; playbackRate = 1; muted = false;
  async play() { this.paused = false; this.ended = false; this.dispatchEvent(new Event('play')); this.dispatchEvent(new Event('playing')); }
  pause() { this.paused = true; this.dispatchEvent(new Event('pause')); }
}
function fixture() {
  const made = [];
  const ctx = { state: 'running', currentTime: 20, destination: {}, resume: async () => {},
    createBufferSource() { const node = { playbackRate: { value: 1 }, connect() {}, disconnect() {}, stop() { this.stopped = true; }, start(...args) { this.started = args; } }; made.push(node); return node; },
    createGain() { return { gain: { value: 0, setTargetAtTime(value) { this.value = value; } }, connect() {}, disconnect() {} }; }
  };
  const transport = new MediaTransport({ requestFrame: () => 1, cancelFrame: () => {} });
  const video = new Video(); transport.attachVideo(video);
  const tracks = ['a', 'b'].map(id => ({ stem: { id }, buffer: { duration: 10 } }));
  const mix = { a: { mute: false, solo: false, level: 1 }, b: { mute: false, solo: false, level: 0.5 } };
  transport.setAudio(ctx, tracks, mix); return { transport, video, ctx, made, mix };
}

test('session restore waits for metadata and restores range/playhead without playing', () => {
  const transport = new MediaTransport({ requestFrame: () => 1, cancelFrame: () => {} });
  const video = new Video(); video.duration = NaN; transport.attachVideo(video);
  transport.restore({ position: 3.5, duration: 10, selection: { start: 2, end: 4 }, loopLocked: true });
  assert.equal(transport.snapshot().position, 3.5); assert.equal(video.currentTime, 0);
  video.duration = 10; video.dispatchEvent(new Event('loadedmetadata'));
  assert.equal(video.currentTime, 3.5); assert.equal(video.paused, true); assert.equal(transport.snapshot().loopLocked, true);
  assert.deepEqual(transport.snapshot().selection, { start: 2, end: 4 }); transport.dispose();
});
test('edited playback schedules trimmed audio at original timeline positions and gain boundaries', async () => {
  const { transport,video }=fixture(); video.currentTime=.5;
  transport.setEdits({a:{clips:[{id:'a',start:0,end:2},{id:'b',start:4,end:6}],gains:[{start:1,end:5,db:20}]}});
  await transport.play();
  assert.deepEqual(transport.sources.slice(0,4).map(source=>source.started),[[20,.5,.5],[20.5,1,1],[23.5,4,1],[24.5,5,1]]);
  transport.dispose();
});
test('a short processed section plays at its original video time', async () => {
  const { transport, video, ctx } = fixture();
  transport.setAudio(ctx, [{ stem: { id: 'section' }, buffer: { duration: 2 } }], { section: { mute: false, solo: false, level: 1 } });
  transport.setEdits({ section: { clips: [{ id: 'full', start: 0, end: 2, offset: 5 }], gains: [] } });
  video.currentTime = 5.5; await transport.play();
  assert.deepEqual(transport.sources.map(source => source.started), [[20, 0.5, 1.5]]);
  transport.dispose();
});
test('restored session clamps changed duration and never resumes playback automatically', () => {
  const { transport, video } = fixture();
  transport.restore({ position: 25, duration: 30, selection: { start: 20, end: 29 }, loopLocked: true });
  assert.equal(video.currentTime, 10); assert.equal(video.paused, true); assert.equal(transport.snapshot().selection, null); transport.dispose();
});

test('committing a selected range locks it and starts shared video/audio playback automatically', async () => {
  const { transport, video } = fixture();
  transport.setSelection(4, 2); await transport.commitSelection();
  assert.equal(video.currentTime, 2); assert.equal(video.paused, false); assert.equal(transport.snapshot().loopLocked, true);
  assert.deepEqual(transport.sources.map(node => node.started), [[20, 2, 2], [20, 2, 2]]);
  transport.clearSelection(); transport.pause(); await transport.commitSelection(); assert.equal(video.paused, true); transport.dispose();
});
test('video clock starts all audio at one timestamp and offset', async () => {
  const { transport, video } = fixture(); video.currentTime = 3; await transport.play();
  assert.deepEqual(transport.sources.map(node => node.started), [[20, 3], [20, 3]]);
  assert.equal(video.muted, true); assert.equal(transport.snapshot().playing, true); transport.dispose();
});
test('paused seek changes both playheads without starting playback and bounds the end', () => {
  const { transport, video } = fixture(); transport.seek(50);
  assert.equal(video.currentTime, 10); assert.equal(transport.snapshot().position, 10);
  assert.equal(transport.sources.length, 0); assert.equal(video.paused, true); transport.dispose();
});
test('waiting stops audio, playing realigns at actual video position', async () => {
  const { transport, video } = fixture(); await transport.play(); const old = transport.sources[0];
  video.dispatchEvent(new Event('waiting')); assert.equal(old.stopped, true); assert.equal(transport.sources.length, 0);
  video.currentTime = 4; video.dispatchEvent(new Event('playing')); assert.deepEqual(transport.sources[0].started, [20, 4]); transport.dispose();
});
test('original and stems route audio exclusively, mute/solo updates live gains', async () => {
  const { transport, video, mix } = fixture(); await transport.play(); transport.setMode('original');
  assert.equal(video.muted, false); assert.equal(transport.sources.length, 0);
  transport.setMode('stems'); transport.setMix({ ...mix, a: { ...mix.a, solo: true } });
  assert.equal(video.muted, true); assert.equal(transport.gains.get('b').gain.value, 0); transport.dispose();
});

test('removing the last preview track stops stem sources and unmutes the original video', async () => {
  const { transport, video } = fixture(); await transport.play();
  assert.equal(video.muted, true); assert.equal(transport.sources.length, 2);
  transport.setTracks([]);
  assert.equal(transport.snapshot().mode, 'original');
  assert.equal(video.muted, false); assert.equal(transport.sources.length, 0);
  assert.equal(video.paused, false);
  transport.dispose();
});
test('drift and playback-rate changes reschedule audio against video', async () => {
  const { transport, video, ctx } = fixture(); await transport.play(); ctx.currentTime = 21; video.currentTime = 0.5; transport.tick();
  assert.deepEqual(transport.sources[0].started, [21, 0.5]); video.playbackRate = 2; video.dispatchEvent(new Event('ratechange'));
  assert.equal(transport.sources[0].playbackRate.value, 2); transport.dispose();
});
test('reaching the end while playing starts over from the beginning until paused', async () => {
  const { transport, video } = fixture(); await transport.play(); video.currentTime = 10; video.ended = true; video.paused = true; video.dispatchEvent(new Event('ended'));
  await new Promise(resolve => setImmediate(resolve)); assert.equal(video.currentTime, 0); assert.equal(video.paused, false);
  transport.pause(); video.currentTime = 10; video.paused = true; video.ended = true; video.dispatchEvent(new Event('ended'));
  await new Promise(resolve => setImmediate(resolve)); assert.equal(video.paused, true); assert.equal(transport.sources.length, 0); transport.dispose();
});
test('pause cancels a pending AudioContext resume', async () => {
  const { transport, video, ctx } = fixture(); let resolve; ctx.resume = () => new Promise(done => { resolve = done; });
  const pending = transport.play(); transport.pause(); resolve(); await pending;
  assert.equal(video.paused, true); assert.equal(transport.sources.length, 0); transport.dispose();
});

test('a second toggle cancels a pending resume rather than queueing another play', async () => {
  const { transport, video, ctx } = fixture(); let resolve; ctx.resume = () => new Promise(done => { resolve = done; });
  const pending = transport.toggle(); transport.toggle(); resolve(); await pending;
  assert.equal(video.paused, true); assert.equal(transport.sources.length, 0); transport.dispose();
});

test('seeking to interior points preserves fractional video positions rather than endpoints', () => {
  const { transport, video } = fixture();
  for (const position of [0.25, 2.5, 4.125, 7.75, 9.5]) { transport.seek(position); assert.equal(video.currentTime, position); assert.equal(transport.snapshot().position, position); }
  transport.dispose();
});

test('range selection normalizes reverse drags, clamps bounds and rejects empty/nonfinite ranges', () => {
  const { transport } = fixture(); transport.setSelection(8, 2); assert.deepEqual(transport.snapshot().selection, { start: 2, end: 8 });
  transport.setSelection(-10, 50); assert.deepEqual(transport.snapshot().selection, { start: 0, end: 10 });
  transport.setSelection(4, 4); assert.equal(transport.snapshot().selection, null);
  transport.setSelection(NaN, 5); assert.equal(transport.snapshot().selection, null); transport.dispose();
});
test('selection alone leaves playback free; loop lock starts at selection and limits scheduled audio', async () => {
  const { transport, video } = fixture(); transport.setSelection(2, 4); transport.seek(7); assert.equal(video.currentTime, 7);
  transport.setLoopLocked(true); assert.equal(video.currentTime, 2); assert.equal(transport.snapshot().loopLocked, true);
  await transport.play(); assert.deepEqual(transport.sources.map(node => node.started), [[20, 2, 2], [20, 2, 2]]); transport.dispose();
});
test('loop boundary returns video and all audio to the same selection start', async () => {
  const { transport, video } = fixture(); transport.setSelection(2, 4); transport.setLoopLocked(true); await transport.play();
  video.currentTime = 4.04; transport.tick(); assert.equal(video.currentTime, 2); assert.deepEqual(transport.sources[0].started, [20, 2, 2]);
  transport.seek(9); assert.equal(video.currentTime, 2); transport.seek(3); assert.equal(video.currentTime, 3); transport.dispose();
});
test('unlock and clear restore free seeking without discarding the retained range prematurely', async () => {
  const { transport, video } = fixture(); transport.setSelection(2, 4); transport.setLoopLocked(true); await transport.play();
  transport.setLoopLocked(false); assert.deepEqual(transport.snapshot().selection, { start: 2, end: 4 });
  transport.seek(8); assert.equal(video.currentTime, 8); assert.equal(transport.sources[0].started.length, 2);
  transport.clearSelection(); assert.equal(transport.snapshot().selection, null); assert.equal(transport.snapshot().loopLocked, false); transport.dispose();
});
test('new selection unlocks the old range and source changes clear selection state', () => {
  const { transport } = fixture(); transport.setSelection(2, 4); transport.setLoopLocked(true); transport.setSelection(5, 7);
  assert.equal(transport.snapshot().loopLocked, false); assert.deepEqual(transport.snapshot().selection, { start: 5, end: 7 });
  transport.attachVideo(new Video()); assert.equal(transport.snapshot().selection, null); transport.dispose();
});
test('selection ending at EOF restarts both media streams, while explicit pause prevents restart', async () => {
  const { transport, video } = fixture(); transport.setSelection(8, 10); transport.setLoopLocked(true); await transport.play();
  video.currentTime = 10; video.paused = true; video.ended = true; video.dispatchEvent(new Event('ended'));
  await new Promise(resolve => setImmediate(resolve)); assert.equal(video.currentTime, 8); assert.equal(video.paused, false);
  transport.pause(); video.currentTime = 10; video.paused = true; video.ended = true; video.dispatchEvent(new Event('ended'));
  await new Promise(resolve => setImmediate(resolve)); assert.equal(video.paused, true); assert.equal(video.currentTime, 10); transport.dispose();
});

test('scrubbing keeps only the newest target while a seek is in flight and shows it immediately', () => {
  const { transport, video } = fixture();
  transport.scrub(2); assert.equal(video.currentTime, 2);
  video.seeking = true; transport.scrub(4); transport.scrub(6);
  assert.equal(video.currentTime, 2); assert.equal(transport.snapshot().position, 6);
  video.seeking = false; video.dispatchEvent(new Event('seeked'));
  assert.equal(video.currentTime, 6); assert.equal(transport.snapshot().position, 6);
  video.seeking = true; transport.scrub(8); transport.seek(1);
  video.seeking = false; video.dispatchEvent(new Event('seeked'));
  assert.equal(video.currentTime, 1); assert.equal(transport.snapshot().position, 1);
  transport.dispose();
});
test('scrubbing respects a locked loop range and a failed video clears the pending target', () => {
  const { transport, video } = fixture();
  transport.setSelection(2, 4); transport.setLoopLocked(true); transport.scrub(9);
  assert.equal(video.currentTime, 2);
  video.seeking = true; transport.scrub(3.5); video.dispatchEvent(new Event('error'));
  assert.equal(transport.snapshot().position, 2);
  transport.dispose();
});

test('a moved clip is scheduled at its timeline position but reads from its own part of the audio', async () => {
  const { transport, video } = fixture();
  transport.setEdits({ a: { clips: [{ id: 'x', start: 1, end: 3, offset: 4 }], gains: [] } });
  video.currentTime = 6; await transport.play();
  assert.deepEqual(transport.sources[0].started, [20, 2, 1]); // timeline 6 is source 2, and the clip ends at timeline 7
  transport.pause(); video.currentTime = 0; await transport.play();
  assert.deepEqual(transport.sources[0].started, [25, 1, 2]); // the clip starts 5 s after the playhead and reads from source 1
  transport.dispose();
});
test('channel meters tap each fader, read the peak and vanish when playback stops', async () => {
  const { transport, ctx } = fixture();
  ctx.createAnalyser = () => ({ fftSize: 0, smoothingTimeConstant: 1, connect() {}, getFloatTimeDomainData(data) { data.fill(0); data[3] = -0.5; data[9] = 0.25; } });
  assert.equal(transport.level('a'), 0); transport.setMetering(true);
  await transport.play();
  assert.equal(transport.level('a'), 0.5);
  transport.setMetering(false); assert.equal(transport.level('a'), 0); transport.setMetering(true); assert.equal(transport.level('a'), 0.5); assert.equal(transport.level('b'), 0.5); assert.equal(transport.level('missing'), 0);
  transport.pause(); assert.equal(transport.level('a'), 0);
  transport.dispose();
});

test('plain navigation clears the selected loop before seeking outside it without stopping playback', async () => {
  const { transport, video } = fixture();
  transport.setSelection(2,4); transport.setLoopLocked(true); await transport.play();
  transport.seek(8); assert.equal(video.currentTime,2);
  transport.clearSelection(); transport.seek(8);
  assert.equal(video.currentTime,8); assert.equal(video.paused,false);
  assert.equal(transport.snapshot().selection,null); assert.equal(transport.snapshot().loopLocked,false);
  transport.dispose();
});
