// The global object_info route scans every extension and starts an asset scan.
// Probe only our audio classes, so unrelated installed nodes cannot delay setup.
export async function audioNodes(endpoint, fetchImpl = fetch) {
  const required = ['LoadAudio', 'StemStudioSeparate', 'SaveAudio'];
  const names = [...required, 'StemStudioExtract', 'StemStudioExtractAll', 'StemStudioAudioRange', 'StemStudioRestoreRange', 'StemStudioSAM', 'StemStudioGuideSep', 'StemStudioEditAudio', 'StemStudioMusicSeparate', 'StemStudioVideoClip', 'MMAudioModelLoader', 'MMAudioFeatureUtilsLoader', 'MMAudioSampler', 'LoadVideo', 'CheckpointLoaderSimple', 'CLIPLoader', 'CLIPTextEncode', 'KSampler', 'EmptyLatentAudio', 'VAEDecodeAudio'];
  const results = await Promise.all(names.map(async name => {
    const response = await fetchImpl(`${endpoint}/object_info/${name}`, { signal: AbortSignal.timeout(5000), redirect: 'error' });
    if (!response.ok) {
      if (response.status === 404) return [name, null];
      throw new Error(`${name}: ComfyUI HTTP ${response.status}`);
    }
    const body = await response.json();
    return [name, body[name] || null];
  }).map((promise, index) => promise.catch(error => {
    if (!required.includes(names[index])) return [names[index], null];
    throw error;
  })));
  return Object.fromEntries(results.filter(([, value]) => value));
}
