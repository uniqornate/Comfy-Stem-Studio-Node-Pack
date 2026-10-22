import test from 'node:test';
import assert from 'node:assert/strict';
import { stemWorkflow } from '../src/graphs.mjs';
import { checkRequest } from '../src/engine-status.mjs';
import { BRUSH_CHECKPOINT, BRUSH_ENCODER, BRUSH_MEDIUM_CHECKPOINT, brushCapability, brushFiles, normalizeBrush } from '../src/shared/brush.mjs';
import { MUSIC_CHANNELS, MUSIC_FILES, MUSIC_MODEL, musicCapability } from '../src/shared/music.mjs';
import { MMAUDIO_CLIP, MMAUDIO_FILES, MMAUDIO_MODEL, MMAUDIO_SYNC, MMAUDIO_VAE, mmaudioCapability } from '../src/shared/mmaudio.mjs';

const brush = { prompt: ' door slam ', seconds: 3, start: 5, seed: 1 };

test('brush settings are validated, with a longer limit for Stable Audio than for MMAudio', () => {
  assert.deepEqual(normalizeBrush(brush), { prompt: 'door slam', seconds: 3, start: 5, seed: 1, steps: 8, model: 'small', video: false });
  for (const bad of [null, {}, { ...brush, prompt: '  ' }, { ...brush, seconds: 0.1 }, { ...brush, seconds: 61 }, { ...brush, start: -1 }, { ...brush, model: 'nope' }, { ...brush, video: true }]) assert.throws(() => normalizeBrush(bad));
  assert.throws(() => normalizeBrush({ ...brush, seconds: 13, model: 'mmaudio' }), /at a time/);
  assert.doesNotThrow(() => normalizeBrush({ ...brush, seconds: 13, model: 'small' }));
});
test('Stable Audio graphs use native nodes, the right checkpoint and pad the clip to the source timeline', () => {
  const small = stemWorkflow({ mode: 'brush', target: 'x', brush });
  assert.equal(small['2'].inputs.ckpt_name, BRUSH_CHECKPOINT); assert.equal(small['3'].inputs.clip_name, BRUSH_ENCODER);
  assert.deepEqual([small['7'].inputs.steps, small['7'].inputs.cfg, small['7'].inputs.sampler_name], [8, 1, 'lcm']);
  assert.equal(small['9'].class_type, 'StemStudioRestoreRange'); assert.equal(small['9'].inputs.start_seconds, 5);
  const medium = stemWorkflow({ mode: 'brush', target: 'x', brush: { ...brush, model: 'medium' } });
  assert.equal(medium['2'].inputs.ckpt_name, BRUSH_MEDIUM_CHECKPOINT);
  assert.match(brushFiles('medium')[0].sha256, /^[0-9a-f]{64}$/);
  assert.match(stemWorkflow({ mode: 'brush', target: 'x', brush, outputPrefix: 'StemStudio/p/r' })['10'].inputs.filename_prefix, /^StemStudio\/p\/r\/brush$/);
});
test('MMAudio graph uses the pinned files and optionally the cut video', () => {
  const text = stemWorkflow({ mode: 'brush', target: 'x', brush: { ...brush, model: 'mmaudio' } });
  assert.equal(text['20'].inputs.mmaudio_model, MMAUDIO_MODEL); assert.equal(text['21'].inputs.clip_model, MMAUDIO_CLIP);
  assert.equal(text['7'].inputs.duration, 3); assert.equal(text['7'].inputs.images, undefined); assert.equal(text['6'], undefined);
  const video = stemWorkflow({ mode: 'brush', target: 'x', brush: { ...brush, model: 'mmaudio', video: true } });
  assert.equal(video['6'].class_type, 'LoadVideo'); assert.deepEqual(video['22'].inputs, { video: ['6', 0], start_seconds: 5, seconds: 3 }); assert.deepEqual(video['7'].inputs.images, ['22', 0]);
});
test('music graph saves six named channels', () => {
  const graph = stemWorkflow({ mode: 'music' });
  assert.equal(graph['2'].class_type, 'StemStudioMusicSeparate'); assert.equal(graph['2'].inputs.model, MUSIC_MODEL);
  assert.deepEqual(MUSIC_CHANNELS.map(channel => channel.label), ['Vocals', 'Drums', 'Bass', 'Guitar', 'Piano', 'Other']);
  MUSIC_CHANNELS.forEach((channel, index) => assert.deepEqual(graph[channel.node].inputs.audio, ['2', index]));
});
test('model files are pinned over HTTPS with SHA-256', () => {
  for (const file of [...MUSIC_FILES, ...MMAUDIO_FILES, ...brushFiles('small'), ...brushFiles('medium')]) { assert.match(file.sha256, /^[0-9a-f]{64}$/); assert.ok(file.url.startsWith('https://')); }
  assert.ok(MUSIC_FILES[0].sha256.startsWith('34c22ccb'));
});
test('capabilities need the nodes and the files ComfyUI lists', () => {
  const sa = (over = {}) => ({ CheckpointLoaderSimple: { input: { required: { ckpt_name: [[BRUSH_CHECKPOINT]] } } }, CLIPLoader: { input: { required: { clip_name: [[BRUSH_ENCODER]], type: [['stable_audio']] } } }, CLIPTextEncode: {}, KSampler: {}, EmptyLatentAudio: {}, VAEDecodeAudio: {}, StemStudioRestoreRange: {}, ...over });
  assert.deepEqual([brushCapability(sa()).brush, brushCapability(sa()).brushModels.small, brushCapability(sa()).brushModels.medium], [true, true, false]);
  assert.equal(brushCapability({}).brush, false);
  assert.deepEqual(musicCapability({ StemStudioMusicSeparate: { input: { required: { model: [[MUSIC_MODEL]] } } } }), { music: true, musicModel: true });
  assert.deepEqual(musicCapability({ StemStudioMusicSeparate: { input: { required: { model: [['Model not installed']] } } } }), { music: true, musicModel: false });
  const mm = { MMAudioModelLoader: { input: { required: { mmaudio_model: [[MMAUDIO_MODEL]] } } }, MMAudioFeatureUtilsLoader: { input: { required: { vae_model: [[MMAUDIO_VAE]], synchformer_model: [[MMAUDIO_SYNC]], clip_model: [[MMAUDIO_CLIP]] } } }, MMAudioSampler: {}, StemStudioVideoClip: {} };
  assert.deepEqual(mmaudioCapability(mm), { mmaudio: true, mmaudioModel: true });
  assert.deepEqual(mmaudioCapability({ ...mm, StemStudioVideoClip: undefined }), { mmaudio: false, mmaudioModel: false });
});
test('requests are refused with a clear reason until the engine can serve them', () => {
  const ready = { ready: true, models: ['mrx'], music: true, musicModel: true, brush: true, brushModels: { small: true, medium: false }, mmaudio: false, detailRange: true, samVisual: true };
  assert.doesNotThrow(() => checkRequest(ready, { mode: 'music' }));
  assert.throws(() => checkRequest({ ...ready, musicModel: false }, { mode: 'music' }), /music model/i);
  assert.throws(() => checkRequest(ready, { mode: 'brush', brush: { model: 'medium' } }), /not listed/);
  assert.throws(() => checkRequest(ready, { mode: 'brush', brush: { model: 'mmaudio' } }), /MMAudio/);
  assert.throws(() => checkRequest(ready, { mode: 'stems', model: 'bandit' }), /not downloaded yet|not installed/, 'a missing separator model is reported');
  assert.doesNotThrow(() => checkRequest(ready, { mode: 'stems', model: 'mrx' }));
});
