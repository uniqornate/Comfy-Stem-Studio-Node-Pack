// The global object_info route scans every extension and starts an asset scan.
// Probe only our audio classes, so unrelated installed nodes cannot delay setup.
export async function audioNodes(endpoint, fetchImpl = fetch) {
  const required = ['LoadAudio', 'StemStudioSeparate', 'SaveAudio'];
  const names = [...required, 'StemStudioExtract', 'StemStudioExtractAll', 'StemStudioAudioRange', 'StemStudioRestoreRange', 'StemStudioSAM', 'StemStudioGuideSep', 'StemStudioEditAudio', 'StemStudioMusicSeparate', 'StemStudioVideoClip', 'MMAudioModelLoader', 'MMAudioFeatureUtilsLoader', 'MMAudioSampler', 'LoadVideo', 'CheckpointLoaderSimple', 'CLIPLoader', 'CLIPTextEncode', 'KSampler', 'EmptyLatentAudio', 'VAEDecodeAudio'];
  const results = [];
  let next = 0;
  // A busy ComfyUI (a running job holds the Python interpreter) answers slowly. Few requests at a time, a generous timeout and one
  // retry; a node that stays unreachable fails the whole probe instead of being reported as missing, so a slow answer is never
  // mistaken for "this node is not installed".
  async function probe(name) {
    for (let attempt = 0; ; attempt++) {
      try {
        const response = await fetchImpl(`${endpoint}/object_info/${name}`, { signal: AbortSignal.timeout(20000), redirect: 'error' });
        if (!response.ok) {
          if (response.status === 404) return [name, null];
          throw new Error(`${name}: ComfyUI HTTP ${response.status}`);
        }
        const body = await response.json();
        return [name, body[name] || null];
      } catch (error) {
        if (attempt >= 1 || /HTTP \d+/.test(error.message)) throw error;
      }
    }
  }
  async function worker() { while (next < names.length) { const index = next++; results[index] = await probe(names[index]); } }
  await Promise.all(Array.from({ length: 5 }, worker));
  return Object.fromEntries(results.filter(([, value]) => value));
}
