// Generates the ComfyUI workflows shipped in /workflows:
//  - workflows/*.json      graph format, open with Workflow > Open (or drag into ComfyUI)
//  - workflows/api/*.json  API format, exactly what Stem Studio submits (built from src/graphs.mjs)
// Run: node scripts/make-workflows.mjs
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stemWorkflow } from '../src/graphs.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'workflows');

// ---- node definitions (input order matches each node's INPUT_TYPES; widgets are the non-link inputs)
const L = (name, type) => ({ name, type });
const W = (name, type) => ({ name, type, widget: { name } });
const defs = {
  LoadAudio: { inputs: [W('audio', 'COMBO'), W('audioUI', 'AUDIO_UI'), W('upload', 'AUDIOUPLOAD')], outputs: [['AUDIO', 'AUDIO']], size: [300, 140] },
  SaveAudio: { inputs: [L('audio', 'AUDIO'), W('filename_prefix', 'STRING'), W('audioUI', 'AUDIO_UI')], outputs: [['audio', 'AUDIO']], size: [320, 110] },
  StemStudioSeparate: { inputs: [L('audio', 'AUDIO'), W('segment_seconds', 'INT'), W('model', 'COMBO')], outputs: [['dialogue', 'AUDIO'], ['music', 'AUDIO'], ['effects', 'AUDIO']], size: [320, 120] },
  StemStudioExtract: { inputs: [L('audio', 'AUDIO'), W('target', 'COMBO'), W('threshold', 'FLOAT'), W('auto_threshold', 'BOOLEAN')], outputs: [['target_sound', 'AUDIO'], ['remainder', 'AUDIO']], size: [320, 150] },
  StemStudioSAM: { inputs: [L('audio', 'AUDIO'), W('description', 'STRING'), W('model_variant', 'COMBO'), W('guidance_json', 'STRING'), L('video', 'VIDEO'), W('video_start', 'FLOAT')], outputs: [['target', 'AUDIO'], ['remainder', 'AUDIO']], size: [340, 220] },
  StemStudioGuideSep: { inputs: [L('audio', 'AUDIO'), L('reference', 'AUDIO'), W('steps', 'INT'), W('reference_offset', 'FLOAT')], outputs: [['target', 'AUDIO'], ['remainder', 'AUDIO']], size: [320, 110] },
  CheckpointLoaderSimple: { inputs: [W('ckpt_name', 'COMBO')], outputs: [['MODEL', 'MODEL'], ['CLIP', 'CLIP'], ['VAE', 'VAE']], size: [330, 100] },
  CLIPLoader: { inputs: [W('clip_name', 'COMBO'), W('type', 'COMBO'), W('device', 'COMBO')], outputs: [['CLIP', 'CLIP']], size: [330, 120] },
  CLIPTextEncode: { inputs: [L('clip', 'CLIP'), W('text', 'STRING')], outputs: [['CONDITIONING', 'CONDITIONING']], size: [330, 120] },
  EmptyLatentAudio: { inputs: [W('seconds', 'FLOAT'), W('batch_size', 'INT')], outputs: [['LATENT', 'LATENT']], size: [300, 90] },
  KSampler: { inputs: [L('model', 'MODEL'), L('positive', 'CONDITIONING'), L('negative', 'CONDITIONING'), L('latent_image', 'LATENT'), W('seed', 'INT'), W('steps', 'INT'), W('cfg', 'FLOAT'), W('sampler_name', 'COMBO'), W('scheduler', 'COMBO'), W('denoise', 'FLOAT')], outputs: [['LATENT', 'LATENT']], size: [320, 260] },
  VAEDecodeAudio: { inputs: [L('samples', 'LATENT'), L('vae', 'VAE')], outputs: [['AUDIO', 'AUDIO']], size: [260, 70] },
  StemStudioRestoreRange: { inputs: [L('audio', 'AUDIO'), L('reference', 'AUDIO'), W('start_seconds', 'FLOAT')], outputs: [['AUDIO', 'AUDIO']], size: [320, 100] },
  Note: { inputs: [], outputs: [], size: [420, 200] },
};

const stableId = title => { const hex = createHash('sha1').update(`stem-studio:${title}`).digest('hex'); return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`; };
function build(title, notes, spec) {
  const nodes = [], links = [];
  let nodeId = 0, linkId = 0;
  const byKey = new Map();
  for (const item of spec.nodes) {
    const def = defs[item.type];
    const node = {
      id: ++nodeId, type: item.type, pos: item.pos, size: item.size || def.size, flags: {}, order: nodeId - 1, mode: 0,
      inputs: def.inputs.filter(input => !item.hideOptional || input.name !== 'video').map(input => ({ ...input, link: null })),
      outputs: def.outputs.map(([name, type], slot) => ({ name, type, links: null, slot_index: slot })),
      properties: { 'Node name for S&R': item.type }, widgets_values: item.widgets || [],
      ...(item.title ? { title: item.title } : {}),
    };
    if (item.type === 'Note') node.properties = {};
    nodes.push(node); byKey.set(item.key, node);
  }
  for (const [from, slot, to, input] of spec.links) {
    const source = byKey.get(from), target = byKey.get(to);
    const targetInput = target.inputs.find(entry => entry.name === input);
    if (!source || !target || !targetInput || !source.outputs[slot]) throw Error(`Bad link ${from}:${slot} -> ${to}:${input}`);
    const id = ++linkId;
    links.push([id, source.id, slot, target.id, target.inputs.indexOf(targetInput), source.outputs[slot].type]);
    source.outputs[slot].links = [...(source.outputs[slot].links || []), id];
    targetInput.link = id;
  }
  return {
    id: stableId(title), revision: 0, last_node_id: nodeId, last_link_id: linkId, nodes, links, groups: [],
    config: {}, extra: { ds: { scale: 0.8, offset: [40, 40] }, workflowTitle: title, notes }, version: 0.4,
  };
}
const note = text => ({ key: 'note', type: 'Note', pos: [20, -230], size: [560, 190], widgets: [text] });
const save = (key, pos, prefix) => ({ key, type: 'SaveAudio', pos, widgets: [prefix, null] });
const load = { key: 'load', type: 'LoadAudio', pos: [20, 40], widgets: ['your-audio-or-video.wav', null, null] };
const setup = 'Requires the Stem Studio integration in ComfyUI/custom_nodes/StemStudio (installed by the Stem Studio setup) and the model files it prepared. Put your file in ComfyUI/input and pick it in Load Audio (video files work too). Outputs are FLAC files in ComfyUI/output/StemStudio.';

const workflows = {
  'Stem-Studio_01_Separate-Dialogue-Music-Effects': {
    title: 'Separate dialogue, music and effects',
    ui: build('Separate dialogue, music and effects', setup, {
      nodes: [
        note(`${setup}\n\nModel: mrx (MIT weights, default), bandit or sfc (non-commercial). Mono stems, 44.1 or 48 kHz depending on the model.`),
        load,
        { key: 'sep', type: 'StemStudioSeparate', pos: [400, 40], widgets: [12, 'mrx'] },
        save('dialogue', [800, -20], 'StemStudio/dialogue'), save('music', [800, 140], 'StemStudio/music'), save('effects', [800, 300], 'StemStudio/effects'),
      ],
      links: [['load', 0, 'sep', 'audio'], ['sep', 0, 'dialogue', 'audio'], ['sep', 1, 'music', 'audio'], ['sep', 2, 'effects', 'audio']],
    }),
    api: stemWorkflow({ mode: 'stems', model: 'mrx' }),
  },
  'Stem-Studio_02_Pull-A-Named-Sound-USS': {
    title: 'Pull a named sound (USS)',
    ui: build('Pull a named sound (USS)', setup, {
      nodes: [
        note(`${setup}\n\nPick any AudioSet class in Target (for example "Walk, footsteps" or "Door"). Auto threshold calibrates detection per class; turn it off to use the manual threshold. Output is the sound plus the arithmetic remainder at 32 kHz mono.`),
        load,
        { key: 'uss', type: 'StemStudioExtract', pos: [400, 40], widgets: ['Walk, footsteps', 0.1, true] },
        save('target', [800, 0], 'StemStudio/target'), save('remainder', [800, 160], 'StemStudio/remainder'),
      ],
      links: [['load', 0, 'uss', 'audio'], ['uss', 0, 'target', 'audio'], ['uss', 1, 'remainder', 'audio']],
    }),
    api: stemWorkflow({ mode: 'uss', target: 'Walk, footsteps', threshold: 0.1, autoThreshold: true }),
  },
  'Stem-Studio_03_Describe-A-Sound-SAM-Audio': {
    title: 'Describe a sound (SAM Audio)',
    ui: build('Describe a sound (SAM Audio)', setup, {
      nodes: [
        note(`${setup}\n\nExperimental. Needs SAM Audio prepared once from the Stem Studio app (Hugging Face access and token). Describe the target in plain English. guidance_json is optional: time examples and visual boxes are easiest to author in the app.`),
        load,
        { key: 'sam', type: 'StemStudioSAM', pos: [400, 40], widgets: ['footsteps', 'small-tv', '{}', 0], hideOptional: true },
        save('target', [820, 0], 'StemStudio/sam-target'), save('remainder', [820, 160], 'StemStudio/sam-remainder'),
      ],
      links: [['load', 0, 'sam', 'audio'], ['sam', 0, 'target', 'audio'], ['sam', 1, 'remainder', 'audio']],
    }),
    api: stemWorkflow({ mode: 'sam', target: 'footsteps', samModel: 'small-tv' }),
  },
  'Stem-Studio_04_Guide-By-Reference-GuideSep': {
    title: 'Guide separation with a reference (GuideSep)',
    ui: build('Guide separation with a reference (GuideSep)', setup, {
      nodes: [
        note(`${setup}\n\nExperimental. Needs GuideSep prepared once from the Stem Studio app. Load the music on top and a reference below: hum, whistle or play the part you want. The reference start lines up with the mixture start; use reference_offset (seconds) to delay it or, if negative, skip its first seconds. Output is 16 kHz mono resampled to the source rate.`),
        { ...load, key: 'load', title: 'Music mixture' },
        { key: 'reference', type: 'LoadAudio', pos: [20, 260], widgets: ['your-reference-hum.wav', null, null], title: 'Reference sound' },
        { key: 'guide', type: 'StemStudioGuideSep', pos: [400, 120], widgets: [8, 0] },
        save('target', [800, 60], 'StemStudio/guidesep-target'), save('remainder', [800, 220], 'StemStudio/guidesep-remainder'),
      ],
      links: [['load', 0, 'guide', 'audio'], ['reference', 0, 'guide', 'reference'], ['guide', 0, 'target', 'audio'], ['guide', 1, 'remainder', 'audio']],
    }),
    api: stemWorkflow({ mode: 'guidesep', target: 'reference' }),
  },
  'Stem-Studio_05_Stems-Then-Footsteps': {
    title: 'Stems, then footsteps from the effects stem',
    ui: build('Stems, then footsteps from the effects stem', setup, {
      nodes: [
        note(`${setup}\n\nSeparates the soundtrack, then runs USS on the effects stem to pull footsteps. Change the USS target to any AudioSet class. This is the same chaining the Stem Studio timeline does.`),
        load,
        { key: 'sep', type: 'StemStudioSeparate', pos: [380, 40], widgets: [12, 'mrx'] },
        { key: 'uss', type: 'StemStudioExtract', pos: [780, 300], widgets: ['Walk, footsteps', 0.1, true] },
        save('dialogue', [1180, -40], 'StemStudio/dialogue'), save('music', [1180, 100], 'StemStudio/music'), save('effects', [1180, 240], 'StemStudio/effects'),
        save('target', [1180, 400], 'StemStudio/footsteps'), save('remainder', [1180, 540], 'StemStudio/effects-without-footsteps'),
      ],
      links: [['load', 0, 'sep', 'audio'], ['sep', 0, 'dialogue', 'audio'], ['sep', 1, 'music', 'audio'], ['sep', 2, 'effects', 'audio'], ['sep', 2, 'uss', 'audio'], ['uss', 0, 'target', 'audio'], ['uss', 1, 'remainder', 'audio']],
    }),
    api: (() => {
      const graph = stemWorkflow({ mode: 'stems', model: 'mrx' });
      graph['20'] = { class_type: 'StemStudioExtract', inputs: { audio: ['2', 2], target: 'Walk, footsteps', threshold: 0.1, auto_threshold: true } };
      graph['21'] = { class_type: 'SaveAudio', inputs: { audio: ['20', 0], filename_prefix: 'StemStudio/footsteps' } };
      graph['22'] = { class_type: 'SaveAudio', inputs: { audio: ['20', 1], filename_prefix: 'StemStudio/effects-without-footsteps' } };
      return graph;
    })(),
  },
};

workflows['Stem-Studio_06_Paint-A-Sound-Stable-Audio-3'] = {
  title: 'Paint a sound into a region (Stable Audio 3 Small-SFX)',
  ui: build('Paint a sound into a region (Stable Audio 3 Small-SFX)', setup, {
    nodes: [
      note(`${setup}\n\nThe brush of Stem Studio as plain ComfyUI nodes. Needs stable_audio_3_small_sfx.safetensors (checkpoints) and t5gemma_b_b_ul2.safetensors (text encoders) from huggingface.co/Comfy-Org/stable-audio-3, under the Stability AI Community License. Edit the prompt and the length in Empty Latent Audio (seconds). Restore Range places the painted clip at start_seconds on the full length of the loaded file and leaves the rest silent, so the result lines up with your timeline.`),
      { key: 'load', type: 'LoadAudio', pos: [20, 60], widgets: ['your-audio-or-video.wav', null, null], title: 'Source (sets the final length)' },
      { key: 'ckpt', type: 'CheckpointLoaderSimple', pos: [20, 260], widgets: ['stable_audio_3_small_sfx.safetensors'] },
      { key: 'clip', type: 'CLIPLoader', pos: [20, 400], widgets: ['t5gemma_b_b_ul2.safetensors', 'stable_audio', 'default'] },
      { key: 'prompt', type: 'CLIPTextEncode', pos: [400, 40], widgets: ['slow footsteps on wet gravel, close up'], title: 'Prompt' },
      { key: 'negative', type: 'CLIPTextEncode', pos: [400, 200], widgets: [''], title: 'Negative prompt' },
      { key: 'latent', type: 'EmptyLatentAudio', pos: [400, 360], widgets: [3, 1] },
      { key: 'sampler', type: 'KSampler', pos: [780, 60], widgets: [12345, 8, 1, 'lcm', 'simple', 1] },
      { key: 'decode', type: 'VAEDecodeAudio', pos: [1140, 60] },
      { key: 'place', type: 'StemStudioRestoreRange', pos: [1140, 200], widgets: [2] },
      save('out', [1520, 160], 'StemStudio/brush'),
    ],
    links: [['clip', 0, 'prompt', 'clip'], ['clip', 0, 'negative', 'clip'], ['ckpt', 0, 'sampler', 'model'], ['prompt', 0, 'sampler', 'positive'], ['negative', 0, 'sampler', 'negative'], ['latent', 0, 'sampler', 'latent_image'], ['sampler', 0, 'decode', 'samples'], ['ckpt', 2, 'decode', 'vae'], ['decode', 0, 'place', 'audio'], ['load', 0, 'place', 'reference'], ['place', 0, 'out', 'audio']],
  }),
  api: stemWorkflow({ mode: 'brush', target: 'footsteps', brush: { prompt: 'slow footsteps on wet gravel, close up', seconds: 3, start: 2, seed: 12345 } }),
};
await mkdir(join(root, 'api'), { recursive: true });
for (const [name, item] of Object.entries(workflows)) {
  const api = structuredClone(item.api);
  for (const node of Object.values(api)) if (node.class_type === 'LoadAudio') node.inputs.audio = node.inputs.audio || 'your-audio-or-video.wav';
  if (api['8']) api['8'].inputs.audio = 'your-reference-hum.wav';
  await writeFile(join(root, `${name}.json`), JSON.stringify(item.ui, null, 2) + '\n');
  await writeFile(join(root, 'api', `${name}.json`), JSON.stringify(api, null, 2) + '\n');
  console.log(name, `${item.ui.nodes.length} nodes`, `${item.ui.links.length} links`);
}
