// MMAudio (Sony, video + text to sound) through the community ComfyUI-MMAudio node pack by kijai (MIT).
// The pack is installed into <ComfyUI>/custom_nodes at a pinned commit and every file is checked against the git blob
// hashes in mmaudio-manifest.json. Its weights live where the pack looks for them, <ComfyUI>/models/mmaudio.
import { normalizeEndpoint } from './connection.mjs';

export const MMAUDIO_REPO = 'kijai/ComfyUI-MMAudio';
export const MMAUDIO_COMMIT = '8eaeb72edc3aaf2059b57f2d96a1f6f689f19ae2';
export const MMAUDIO_ARCHIVE = `https://codeload.github.com/${MMAUDIO_REPO}/zip/${MMAUDIO_COMMIT}`;
export const MMAUDIO_NODE_FOLDER = 'ComfyUI-MMAudio';
const WEIGHTS = 'https://huggingface.co/Kijai/MMAudio_safetensors/resolve/5984623e6b436818c6ff287ef6eec93e3e05aa3f';
const VOCODER = 'https://huggingface.co/nvidia/bigvgan_v2_44khz_128band_512x/resolve/95a9d1dcb12906c03edd938d77b9333d6ded7dfb';
export const MMAUDIO_MODEL = 'mmaudio_large_44k_v2_fp16.safetensors';
export const MMAUDIO_VAE = 'mmaudio_vae_44k_fp16.safetensors';
export const MMAUDIO_SYNC = 'mmaudio_synchformer_fp16.safetensors';
export const MMAUDIO_CLIP = 'apple_DFN5B-CLIP-ViT-H-14-384_fp16.safetensors';
export const MMAUDIO_FILES = [
  { path: MMAUDIO_MODEL, name: 'MMAudio large 44k v2', url: `${WEIGHTS}/${MMAUDIO_MODEL}`, size: 2061198424, sha256: 'a61378951ba4e8bfde2e977c0ad8211a7e02e1e92fd6a5b1c258a6464c1d102f' },
  { path: MMAUDIO_VAE, name: 'MMAudio VAE', url: `${WEIGHTS}/${MMAUDIO_VAE}`, size: 610966060, sha256: '2598189f081bd10c86975106e5b6e2490168667429a75b52d77671283f245649' },
  { path: MMAUDIO_SYNC, name: 'Synchformer', url: `${WEIGHTS}/${MMAUDIO_SYNC}`, size: 474981098, sha256: 'b8d05128c76da6ee88720a89d25a5f86c603589883d02b53f563c3c66afe3581' },
  { path: MMAUDIO_CLIP, name: 'DFN5B CLIP', url: `${WEIGHTS}/${MMAUDIO_CLIP}`, size: 1973509450, sha256: 'd8ad903a79adc2b29bacfeedabfa3d78b03d36d3b4dcb885c0649fe8c5d763cb' },
  // The pack would download this folder itself on first use; placing it here keeps every byte hash-checked.
  { path: 'nvidia/bigvgan_v2_44khz_128band_512x/bigvgan_generator.pt', name: 'BigVGAN v2 vocoder', url: `${VOCODER}/bigvgan_generator.pt`, size: 489041291, sha256: 'd9fe7ec6bd0b44ed9d66973d5012d8181c1570b01e5c72df51973e241dccd357' },
  { path: 'nvidia/bigvgan_v2_44khz_128band_512x/config.json', name: 'BigVGAN config', url: `${VOCODER}/config.json`, size: 1403, sha256: '65b7f487bfaf15256056a75f6667ef5f640214c981922a111927873705ea4ddb' },
];
export const MMAUDIO_MAX_SECONDS = 12;
// Import names of the pack's requirements (librosa, torchdiffeq, einops, timm, omegaconf, open_clip_torch, accelerate, ftfy).
export const MMAUDIO_IMPORTS = ['librosa', 'torchdiffeq', 'einops', 'timm', 'omegaconf', 'open_clip', 'accelerate', 'ftfy'];
const join = (...parts) => parts.join('/');
export function mmaudioFolders(profile) {
  const endpoint = new URL(normalizeEndpoint(profile.comfyUrl));
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname) || !profile.installation) throw Error('MMAudio needs the selected local ComfyUI folder.');
  return { models: join(profile.installation, 'models', 'mmaudio'), node: join(profile.installation, 'custom_nodes', MMAUDIO_NODE_FOLDER) };
}
// LoadAudio '1' only supplies the timeline length. With a video, StemStudioVideoClip cuts the region at 25 fps for the sampler.
export function mmaudioGraph(brush) {
  const graph = {
    '1': { class_type: 'LoadAudio', inputs: { audio: '' } },
    '20': { class_type: 'MMAudioModelLoader', inputs: { mmaudio_model: MMAUDIO_MODEL, base_precision: 'fp16' } },
    '21': { class_type: 'MMAudioFeatureUtilsLoader', inputs: { vae_model: MMAUDIO_VAE, synchformer_model: MMAUDIO_SYNC, clip_model: MMAUDIO_CLIP, mode: '44k', precision: 'fp16' } },
    '7': { class_type: 'MMAudioSampler', inputs: { mmaudio_model: ['20', 0], feature_utils: ['21', 0], duration: brush.seconds, steps: 25, cfg: 4.5, seed: brush.seed, prompt: brush.prompt, negative_prompt: '', mask_away_clip: false, force_offload: true } },
    '9': { class_type: 'StemStudioRestoreRange', inputs: { audio: ['7', 0], reference: ['1', 0], start_seconds: brush.start } },
    '10': { class_type: 'SaveAudio', inputs: { audio: ['9', 0], filename_prefix: 'StemStudio/brush' } },
  };
  if (brush.video) {
    graph['6'] = { class_type: 'LoadVideo', inputs: { file: '' } };
    graph['22'] = { class_type: 'StemStudioVideoClip', inputs: { video: ['6', 0], start_seconds: brush.start, seconds: brush.seconds } };
    graph['7'].inputs.images = ['22', 0];
  }
  return graph;
}
export function mmaudioCapability(nodes) {
  const has = (node, input, file) => !!nodes[node]?.input?.required?.[input]?.[0]?.includes?.(file);
  const present = ['MMAudioModelLoader', 'MMAudioFeatureUtilsLoader', 'MMAudioSampler', 'StemStudioVideoClip'].every(name => nodes[name]);
  const listed = has('MMAudioModelLoader', 'mmaudio_model', MMAUDIO_MODEL) && has('MMAudioFeatureUtilsLoader', 'vae_model', MMAUDIO_VAE) && has('MMAudioFeatureUtilsLoader', 'synchformer_model', MMAUDIO_SYNC) && has('MMAudioFeatureUtilsLoader', 'clip_model', MMAUDIO_CLIP);
  return { mmaudio: present, mmaudioModel: present && listed };
}
