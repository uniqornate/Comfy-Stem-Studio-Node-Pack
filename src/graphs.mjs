// Browser-safe ComfyUI API-format graph builders shared by the Electron main process and node pack mode.
// This module must not import Node built-ins or Electron.
import { normalizeGuidance } from './sam-guidance.mjs';
import { channelEdit } from './clip-edits.mjs';
import { brushGraph } from './shared/brush.mjs';
import { musicGraph } from './shared/music.mjs';

export const CHANNELS = [{ key: 'dialogue', label: 'Dialogue', node: '10' }, { key: 'music', label: 'Music', node: '11' }, { key: 'effects', label: 'Effects', node: '12' }];
function baseWorkflow(options = {}) {
  if (options.mode === 'brush') return brushGraph(options);
  if (options.mode === 'music') return musicGraph();
  if (options.mode === 'uss' && options.target === 'All') return {
    '1': { class_type: 'LoadAudio', inputs: { audio: '' } },
    '2': { class_type: 'StemStudioExtractAll', inputs: { audio: ['1', 0], threshold: options.threshold ?? 0.1, ...(options.autoThreshold ? { auto_threshold: true } : {}) } },
  };
  if (options.mode === 'uss') return {
    '1': { class_type: 'LoadAudio', inputs: { audio: '' } },
    '2': { class_type: 'StemStudioExtract', inputs: { audio: ['1', 0], target: options.target, threshold: options.threshold ?? 0.1, ...(options.autoThreshold ? { auto_threshold: true } : {}) } },
    '10': { class_type: 'SaveAudio', inputs: { audio: ['2', 0], filename_prefix: 'StemStudio/target' } },
    '11': { class_type: 'SaveAudio', inputs: { audio: ['2', 1], filename_prefix: 'StemStudio/remainder' } },
  };
  if (options.mode === 'guidesep') return {
    '1': { class_type: 'LoadAudio', inputs: { audio: '' } },
    '8': { class_type: 'LoadAudio', inputs: { audio: '' } },
    '2': { class_type: 'StemStudioGuideSep', inputs: { audio: ['1', 0], reference: ['8', 0], steps: 8, reference_offset: Number(options.referenceOffset) || 0 } },
    '10': { class_type: 'SaveAudio', inputs: { audio: ['2', 0], filename_prefix: 'StemStudio/guidesep-target' } },
    '11': { class_type: 'SaveAudio', inputs: { audio: ['2', 1], filename_prefix: 'StemStudio/guidesep-remainder' } },
  };
  if (options.mode === 'sam') {
    const prompts = options.sam ? normalizeGuidance(options.sam, options.range) : null;
    const visual = !!prompts?.keyframes.length;
    return {
    '1': { class_type: 'LoadAudio', inputs: { audio: '' } },
    '2': { class_type: 'StemStudioSAM', inputs: { audio: ['1', 0], description: prompts?.visualOnly ? '' : prompts?.description || options.target, ...(options.samModel ? { model_variant: options.samModel } : {}), ...(prompts ? { guidance_json: JSON.stringify(prompts) } : {}), ...(visual ? { video: ['6', 0], video_start: options.range.start } : {}) } },
    '10': { class_type: 'SaveAudio', inputs: { audio: ['2', 0], filename_prefix: 'StemStudio/sam-target' } },
    '11': { class_type: 'SaveAudio', inputs: { audio: ['2', 1], filename_prefix: 'StemStudio/sam-remainder' } },
    ...(visual ? { '6': { class_type: 'LoadVideo', inputs: { file: '' } } } : {}),
  };
  }
  const graph = { '1': { class_type: 'LoadAudio', inputs: { audio: '' } }, '2': { class_type: 'StemStudioSeparate', inputs: { audio: ['1', 0], segment_seconds: 12, model: options.model || 'mrx' } } };
  CHANNELS.forEach((channel, i) => { graph[channel.node] = { class_type: 'SaveAudio', inputs: { audio: ['2', i], filename_prefix: `StemStudio/${channel.key}` } }; });
  return graph;
}
export function stemWorkflow(options = {}) {
  const graph = baseWorkflow(options);
  if (options.outputPrefix) {
    if (!/^StemStudio\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+$/.test(options.outputPrefix)) throw Error('Invalid project output prefix.');
    for (const node of Object.values(graph)) if (node.class_type === 'SaveAudio') node.inputs.filename_prefix = `${options.outputPrefix}/${node.inputs.filename_prefix.split('/').at(-1)}`;
    if (options.mode === 'uss' && options.target === 'All') graph['2'].inputs.filename_prefix = options.outputPrefix;
  }
  if (options.edits) {
    channelEdit(options.edits,864000);
    graph['7'] = { class_type:'StemStudioEditAudio',inputs:{ audio:['1',0],edits_json:JSON.stringify(options.edits) } };
    graph['2'].inputs.audio=['7',0];
  }
  if (!options.range) return graph;
  const { start, end } = options.range;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end > 864000) throw Error('Select a valid channel range.');
  graph['3'] = { class_type: 'StemStudioAudioRange', inputs: { audio: [options.edits ? '7' : '1', 0], start_seconds: start, end_seconds: end } };
  graph['2'].inputs.audio = ['3', 0];
  if (options.mode === 'uss' && options.target === 'All') Object.assign(graph['2'].inputs, { range_reference: [options.edits ? '7' : '1', 0], range_start: start, suppress_duplicates: true });
  else for (const [save, restore, index] of [['10', '4', 0], ['11', '5', 1]]) {
    graph[restore] = { class_type: 'StemStudioRestoreRange', inputs: { audio: ['2', index], reference: [options.edits ? '7' : '1', 0], start_seconds: start } };
    graph[save].inputs.audio = [restore, 0];
  }
  return graph;
}
export function editWorkflow(edits, prefix) {
  channelEdit(edits, 864000);
  return { '1': { class_type: 'LoadAudio', inputs: { audio: '' } }, '2': { class_type: 'StemStudioEditAudio', inputs: { audio: ['1', 0], edits_json: JSON.stringify(edits) } }, '3': { class_type: 'SaveAudio', inputs: { audio: ['2', 0], filename_prefix: prefix } } };
}

export function validateVideoExport(stems, options) {
  if (options.format !== 'mp4' || !['mix', 'tracks'].includes(options.mode)) throw new Error('Native lossless export requires MP4 and a valid audio mode.');
  if (!Array.isArray(stems) || !stems.length || stems.length > 527 || new Set(stems.map(item => item.id)).size !== stems.length) throw new Error('Choose available stem channels.');
  for (const stem of stems) if (!Number.isFinite(stem.level) || stem.level < 0 || stem.level > 1 || typeof stem.mute !== 'boolean' || typeof stem.solo !== 'boolean') throw new Error('Invalid channel mix.');
}
export function videoWorkflow(stems, options) {
  validateVideoExport(stems, options);
  const graph = { '1': { class_type: 'LoadVideo', inputs: { file: '' } } };
  let previous;
  stems.forEach((stem, index) => {
    const id = String(10 + index);
    graph[id] = { class_type: 'StemStudioVideoTrack', inputs: { file: '', label: String(stem.label).replace(/[\r\n]/g, ' ').slice(0, 120), mute: stem.mute, solo: stem.solo, level: stem.level, ...(Number.isFinite(stem.pan) && stem.pan >= -1 && stem.pan <= 1 && stem.pan !== 0 ? { pan: stem.pan } : {}), ...(previous ? { previous: [previous, 0] } : {}) } };
    previous = id;
  });
  graph['2'] = { class_type: 'StemStudioVideo', inputs: { video: ['1', 0], tracks: [previous, 0], mode: options.mode } };
  graph['3'] = { class_type: 'SaveVideo', inputs: { video: ['2', 0], filename_prefix: `StemStudio/Exports/${globalThis.crypto.randomUUID()}`, format: 'mp4', 'format.codec': 'auto' } };
  return graph;
}
