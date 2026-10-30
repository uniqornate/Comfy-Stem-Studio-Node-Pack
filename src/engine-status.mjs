// Pure, browser-safe engine capability probe and request validation shared by Electron and node pack mode.
import { normalizeEndpoint } from './shared/connection.mjs';
import { audioNodes } from './shared/node-capabilities.mjs';
import { brushCapability } from './shared/brush.mjs';
import { musicCapability } from './shared/music.mjs';

async function probeEngine(profile, fetchImpl = fetch) {
  try {
    const nodes = await audioNodes(normalizeEndpoint(profile.comfyUrl), fetchImpl);
    const missing = ['LoadAudio', 'StemStudioSeparate', 'SaveAudio'].filter(name => !nodes[name]);
    const models = nodes.StemStudioSeparate?.input?.required?.model?.[0] || ['sfc'];
    const targets = nodes.StemStudioExtract?.input?.required?.target?.[0] || [];
    return { ...brushCapability(nodes), ...musicCapability(nodes), chunkAudio: !!nodes.StemStudioLoadAudioRange, samModels: !!nodes.StemStudioSAM?.input?.optional?.model_variant, editAudio: !!nodes.StemStudioEditAudio, projectOutputs: !!nodes.StemStudioExtractAll?.input?.optional?.filename_prefix, detailRange: !!nodes.StemStudioAudioRange && !!nodes.StemStudioRestoreRange, sam: !!nodes.StemStudioSAM, guidesep: !!nodes.StemStudioGuideSep, samPrompts: !!nodes.StemStudioSAM?.input?.optional?.guidance_json, samVisual: !!nodes.StemStudioSAM?.input?.optional?.video && !!nodes.LoadVideo, ready: missing.length === 0, models, autoThreshold: !!nodes.StemStudioExtract?.input?.optional?.auto_threshold && !!nodes.StemStudioExtractAll?.input?.optional?.auto_threshold, targets: targets.filter(name => name !== 'USS models not installed' && (name !== 'All' || nodes.StemStudioExtractAll)), message: missing.length ? `Missing audio nodes: ${missing.join(', ')}. Install the integration, restart ComfyUI, then check again.` : 'Audio nodes available. Choose an installed separation model or USS target extraction.' };
  } catch (error) { return { ready: false, message: `Audio engine could not be checked: ${error.message}` }; }
}
const lastReady = new Map();
// A slow or briefly unreachable ComfyUI (a running job can hold it up) must not stop work that was possible a moment ago:
// when the probe times out, the last good answer is used and marked stale.
export async function engineStatus(profile, fetchImpl = fetch) {
  const result = await probeEngine(profile, fetchImpl);
  if (result.ready) { lastReady.set(profile.comfyUrl, result); return result; }
  const earlier = lastReady.get(profile.comfyUrl);
  if (earlier && /timed out|timeout|aborted|fetch failed|failed to fetch|network/i.test(result.message || '')) return { ...earlier, stale: true };
  return result;
}

// Throws the first problem found. `have` says whether the host resolved the optional media inputs.
export function checkRequest(status, options, have = {}) {
  if (options.mode === 'uss' && (!status.targets?.includes(options.target) || !Number.isFinite(options.threshold ?? 0.1) || (options.threshold ?? 0.1) < 0 || (options.threshold ?? 0.1) > 1)) throw new Error('Choose an installed USS target and valid threshold. Run setup with USS selected if it is missing.');
  if (options.mode === 'uss' && options.autoThreshold && !status.autoThreshold) throw new Error('Auto threshold needs the updated Stem Studio integration. Retry setup and restart ComfyUI, or select Manual.');
  if (options.outputPrefix && options.mode === 'uss' && options.target === 'All' && !status.projectOutputs) throw Error('Update the integration and restart idle ComfyUI to enable project-organized USS outputs.');
  if (options.mode === 'uss' && options.target === 'All' && (options.threshold ?? 0.1) <= 0) throw new Error('All needs a detection threshold above zero.');
  if (options.mode === 'sam' && (!status.sam || typeof options.target !== 'string' || !options.target.trim() || options.target.length > 200)) throw new Error('SAM integration or target is unavailable. Update integration and prepare SAM Audio.');
  if (options.range && !status.detailRange) throw new Error('Range extraction needs the updated integration. Retry setup and restart idle ComfyUI.');
  if (!['uss', 'sam', 'guidesep', 'music', 'brush'].includes(options.mode) && status.models && !status.models.includes(options.model || 'mrx')) throw new Error(have.nodePack ? 'This model is not downloaded yet. Open Connection, download its model pack, then try again.' : 'This model is not installed. Select it in setup and restart ComfyUI.');
  if (options.mode === 'guidesep' && options.referenceOffset !== undefined && (!Number.isFinite(options.referenceOffset) || Math.abs(options.referenceOffset) > 600)) throw new Error('Reference offset must be within 10 minutes.');
  if (options.mode === 'guidesep' && (!status.guidesep || !have.reference || typeof options.target !== 'string' || !options.target.trim())) throw new Error('GuideSep integration or reference sound is unavailable. Update the integration, prepare GuideSep and choose a reference.');
  if (options.mode === 'brush') {
    const model = options.brush?.model ?? 'small';
    if (model === 'mmaudio') {
      if (!status.mmaudio || !status.detailRange) throw new Error('MMAudio needs the updated Stem Studio integration and its node pack. Prepare it from the brush dialog and restart ComfyUI.');
      if (!status.mmaudioModel) throw new Error('ComfyUI does not list the MMAudio files yet. Finish preparing MMAudio in the brush dialog and restart ComfyUI.');
      if (options.brush?.video && (!status.samVisual || !have.video)) throw new Error('Using the video needs native LoadVideo and the original source video.');
    } else {
      const listed = status.brushModels ? status.brushModels[model] : model === 'small' && status.brushModel;
      if (!status.brush || !listed) throw new Error(status.brush ? 'The sound model is not listed by ComfyUI yet. Download it from the brush dialog and restart ComfyUI.' : 'Brush needs the updated Stem Studio integration and a ComfyUI with Stable Audio 3 support. Update both and restart ComfyUI.');
    }
  }
  if (options.mode === 'music' && (!status.music || !status.musicModel)) throw new Error(status.music ? 'The music model is not installed yet. Download it from the 6-stem dialog.' : 'Music stems need the updated Stem Studio integration. Update it and restart ComfyUI.');
  if (options.samModel && !['small-tv','large-tv'].includes(options.samModel)) throw Error('Unsupported SAM model.');
  if (options.samModel === 'large-tv' && !status.samModels) throw Error('Update integration and restart idle ComfyUI to choose SAM Large.');
  if (options.edits && !status.editAudio) throw Error('Update integration and restart idle ComfyUI for edited-channel extraction.');
  if (options.sam && !status.samPrompts) throw Error('Update integration and restart idle ComfyUI to enable SAM guidance.');
  if (options.sam?.visual && (!status.samVisual || !have.video)) throw Error('Visual guidance needs native LoadVideo and the original source video.');
}
