// Music stems: the pinned HTDemucs 6-source model (Meta, MIT) behind one Stem Studio node. The weights sit in
// <ComfyUI>/models/audio_separation/htdemucs-6s and are checked by size and SHA-256 both here and in the node.
import { normalizeEndpoint } from './connection.mjs';

export const MUSIC_MODEL = 'htdemucs_6s';
export const MUSIC_FOLDER = 'htdemucs-6s';
export const MUSIC_FILES = [{ path: 'htdemucs_6s.th', name: 'HTDemucs 6-stem', url: 'https://dl.fbaipublicfiles.com/demucs/hybrid_transformer/5c90dfd2-34c22ccb.th', size: 54996327, sha256: '34c22ccb381c6f9fdbf324f04e1e2fe21aaaf293f5ded163a162697ff9a02ddd' }];
// Node output order, with the channel names and the output node each one is saved by.
export const MUSIC_CHANNELS = [['vocals', 'Vocals'], ['drums', 'Drums'], ['bass', 'Bass'], ['guitar', 'Guitar'], ['piano', 'Piano'], ['other', 'Other']].map(([key, label], index) => ({ key, label, node: String(10 + index) }));
const join = (...parts) => parts.join('/');
export function musicFolder(profile) {
  const endpoint = new URL(normalizeEndpoint(profile.comfyUrl));
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname) || !profile.installation) throw Error('The music model needs the selected local ComfyUI folder.');
  return join(profile.installation, 'models', 'audio_separation', MUSIC_FOLDER);
}
export function musicGraph() {
  const graph = { '1': { class_type: 'LoadAudio', inputs: { audio: '' } }, '2': { class_type: 'StemStudioMusicSeparate', inputs: { audio: ['1', 0], model: MUSIC_MODEL } } };
  MUSIC_CHANNELS.forEach((channel, index) => { graph[channel.node] = { class_type: 'SaveAudio', inputs: { audio: ['2', index], filename_prefix: `StemStudio/${channel.key}` } }; });
  return graph;
}
// What the engine reports: the node is present and it lists the model file as installed.
export function musicCapability(nodes) {
  const choices = nodes.StemStudioMusicSeparate?.input?.required?.model?.[0];
  return { music: !!nodes.StemStudioMusicSeparate, musicModel: Array.isArray(choices) && choices.includes(MUSIC_MODEL) };
}
