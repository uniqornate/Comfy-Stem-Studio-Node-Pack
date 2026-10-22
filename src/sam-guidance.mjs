const finite = value => typeof value === 'number' && Number.isFinite(value);
export function normalizeGuidance(value = {}, range) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid SAM guidance.');
  if (!range || !finite(range.start) || !finite(range.end) || range.start < 0 || range.end <= range.start) throw Error('SAM guidance needs a selected range.');
  const duration = range.end - range.start;
  const anchors = value.anchors ?? [];
  if (!Array.isArray(anchors) || anchors.length > 16) throw Error('Use at most 16 sound examples.');
  const converted = anchors.map(anchor => {
    if (!anchor || !['+', '-'].includes(anchor.kind) || !finite(anchor.start) || !finite(anchor.end) || anchor.start < range.start || anchor.end > range.end || anchor.end - anchor.start < 0.02) throw Error('Each sound example must be inside the processing range and at least 0.02 seconds long.');
    return [anchor.kind, anchor.start - range.start, anchor.end - range.start];
  });
  for (const a of converted) for (const b of converted) if (a[0] !== b[0] && Math.max(a[1], b[1]) < Math.min(a[2], b[2])) throw Error('Positive and negative sound examples must not overlap.');
  const frames = value.visual?.keyframes ?? [];
  if (!Array.isArray(frames) || frames.length > 12 || value.visual && !frames.length) throw Error('Draw 1 to 12 visual target boxes.');
  if (frames.length && duration > 30) throw Error('Visual guidance currently supports selections up to 30 seconds.');
  const seen = new Set();
  const keyframes = frames.map(frame => {
    const box = frame?.box;
    if (!finite(frame?.time) || frame.time < range.start || frame.time > range.end || seen.has(frame.time) || !box || ![box.x, box.y, box.width, box.height].every(finite) || box.x < 0 || box.y < 0 || box.width < 0.005 || box.height < 0.005 || box.x + box.width > 1.000001 || box.y + box.height > 1.000001) throw Error('Visual boxes must stay inside the picture and selected time range.');
    seen.add(frame.time); return { time: frame.time - range.start, box: { ...box } };
  }).sort((a, b) => a.time - b.time);
  const visualOnly = value.visualOnly === true;
  if (visualOnly && !keyframes.length) throw Error('Visual-only extraction needs a target box.');
  if (!visualOnly && value.description !== undefined && (typeof value.description !== 'string' || !value.description.trim() || value.description.length > 200)) throw Error('Use a target description of 1 to 200 characters.');
  return { ...(!visualOnly && value.description ? { description: value.description.trim().toLowerCase() } : {}), visualOnly, anchors: converted, keyframes, predictSpans: value.predictSpans === true && !converted.length && !visualOnly };
}
export function interpolatedBox(keyframes, time) {
  if (!keyframes.length) return null;
  // One mark describes a still source and holds. With two or more, the target exists only between the first and last mark.
  if (keyframes.length === 1) return keyframes[0].box;
  if (time < keyframes[0].time - 1e-6 || time > keyframes.at(-1).time + 1e-6) return null;
  if (time <= keyframes[0].time) return keyframes[0].box;
  for (let i = 1; i < keyframes.length; i++) if (time <= keyframes[i].time) {
    const a = keyframes[i - 1], b = keyframes[i], t = (time - a.time) / (b.time - a.time);
    return Object.fromEntries(['x', 'y', 'width', 'height'].map(key => [key, a.box[key] + (b.box[key] - a.box[key]) * t]));
  }
  return keyframes.at(-1).box;
}
