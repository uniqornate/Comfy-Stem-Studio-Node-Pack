// What each model is, how big it is on disk and where it runs. Sizes are the exact pinned download sizes; how much
// VRAM, RAM and CPU a model really takes is measured on the user's own machine (see usage.mjs), not guessed here.
export const MODEL_INFO = [
  { key: 'mrx', name: 'MERL MRX', role: 'Dialogue, music, effects', disk: 122317657, runs: 'ComfyUI, GPU or CPU', work: '8 s windows, mono 44.1 kHz', license: 'MIT' },
  { key: 'bandit', name: 'BandIt v2', role: 'Dialogue, music, effects (multilingual)', disk: 446680129, runs: 'ComfyUI, GPU or CPU', work: '8 s windows, mono 48 kHz', license: 'CC BY-SA 4.0' },
  { key: 'sfc', name: 'SFC-Locoformer', role: 'Dialogue, music, effects', disk: 128207890, runs: 'ComfyUI, GPU recommended', work: '12 s windows, mono 44.1 kHz', license: 'CC BY-NC-SA 4.0, non-commercial' },
  { key: 'music6', name: 'HTDemucs 6-stem', role: 'Vocals, drums, bass, guitar, piano, other', disk: 54996327, runs: 'ComfyUI, GPU or CPU', work: '7.8 s windows, stereo 44.1 kHz', license: 'MIT' },
  { key: 'uss', name: 'USS + PANNs', role: 'One named sound, or all detected', disk: 1448453309, runs: 'ComfyUI, GPU recommended', work: 'Whole range, mono 32 kHz', license: 'Apache 2.0 / CC BY 4.0' },
  { key: 'sam', name: 'SAM Audio', role: 'Describe or box a sound', disk: null, diskNote: 'Downloaded from Hugging Face at preparation; size depends on Small or Large', runs: 'Private Python runtime, CUDA required', work: 'Whole range', license: 'SAM license, gated' },
  { key: 'guidesep', name: 'GuideSep', role: 'Instrument by reference sound', disk: null, diskNote: 'About 1 GB checkpoint', runs: 'Private Python runtime', work: '4 s windows, mono 16 kHz', license: 'MIT' },
  { key: 'brush-small', name: 'Stable Audio 3 Small-SFX', role: 'Brush: sound effects from a prompt', disk: 3457648943, runs: 'ComfyUI native nodes, GPU or CPU', work: 'Up to 60 s per region', license: 'Stability AI Community License' },
  { key: 'brush-medium', name: 'Stable Audio 3 Medium', role: 'Brush: longer and more musical sounds', disk: 10409380663, runs: 'ComfyUI native nodes, GPU', work: 'Up to 60 s per region', license: 'Stability AI Community License' },
  { key: 'brush-mmaudio', name: 'MMAudio', role: 'Brush: sound that follows the picture', disk: 5609697726, runs: 'ComfyUI node pack, GPU', work: 'Up to 12 s per region', license: 'CC BY-NC 4.0, non-commercial' },
];
export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  return bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.round(bytes / 1e6)} MB`;
}
