const finite = value => typeof value === 'number' && Number.isFinite(value);
const offsetOf = clip => clip.offset || 0;
export const placedStart = clip => clip.start + offsetOf(clip);
export const placedEnd = clip => clip.end + offsetOf(clip);
// A clip plays the source range [start, end] and sits on the timeline at [start + offset, end + offset].
// Clips never overlap on the timeline and stay inside it; gain regions are always in timeline time.
export function channelEdit(value, duration) {
  if (!finite(duration) || duration < 0) throw Error('Invalid channel duration.');
  if (!value) return { clips: duration ? [{ id: 'full', start: 0, end: duration }] : [], gains: [] };
  if (!Array.isArray(value.clips) || !Array.isArray(value.gains) || value.clips.length > 256 || value.gains.length > 512) throw Error('Too many clip edits.');
  function ranges(items, gains) {
    let end = -1;
    return items.map((item, index) => {
      if (!item || !finite(item.start) || !finite(item.end) || item.start < 0 || item.end <= item.start || item.end > duration + .001) throw Error('Invalid or overlapping clip ranges.');
      const offset = !gains && item.offset !== undefined ? item.offset : 0;
      if (!finite(offset) || Math.abs(offset) > 864000) throw Error('Invalid clip position.');
      const start = item.start + offset, finish = item.end + offset;
      if (start < -.000001 || finish > duration + .001 || start < end - .000001) throw Error('Invalid or overlapping clip ranges.');
      end = finish;
      if (gains && (!finite(item.db) || item.db < -60 || item.db > 24)) throw Error('Gain must be between -60 and +24 dB.');
      return gains ? { start: item.start, end: item.end, db: item.db } : { id: String(item.id || index).slice(0, 100), start: item.start, end: item.end, ...(Math.abs(offset) > 1e-6 ? { offset } : {}) };
    });
  }
  return { clips: ranges(value.clips, false), gains: ranges(value.gains, true) };
}
export function splitEdit(value, at, duration) {
  const edit = fitEdit(value, duration);
  if (edit.clips.length >= 256) return edit;
  return { ...edit, clips: edit.clips.flatMap(clip => {
    if (at <= placedStart(clip) + .02 || at >= placedEnd(clip) - .02) return [clip];
    const point = at - offsetOf(clip);
    return [{ ...clip, id: clip.id.slice(0, 60) + '-L-' + at.toFixed(6), end: point }, { ...clip, id: clip.id.slice(0, 60) + '-R-' + at.toFixed(6), start: point }];
  }) };
}
// `at` is a timeline time. The edge moves on the timeline; the source range follows.
export function trimEdit(value, id, edge, at, duration) {
  const edit = fitEdit(value, duration), index = edit.clips.findIndex(clip => clip.id === id);
  if (index < 0) return edit;
  const clip = { ...edit.clips[index] }, offset = offsetOf(clip), before = edit.clips[index - 1], after = edit.clips[index + 1];
  if (edge === 'start') clip.start = Math.max(before ? placedEnd(before) : 0, offset, Math.min(placedEnd(clip) - .02, at)) - offset;
  else clip.end = Math.min(after ? placedStart(after) : duration, duration + offset, Math.max(placedStart(clip) + .02, at)) - offset;
  edit.clips[index] = clip;
  return channelEdit(edit, duration);
}
// Slides a clip along the timeline so that it starts at `target`, stopping at its neighbours and at the ends.
export function moveEdit(value, id, target, duration) {
  const edit = fitEdit(value, duration), index = edit.clips.findIndex(clip => clip.id === id);
  if (index < 0) return edit;
  const clip = { ...edit.clips[index] }, before = edit.clips[index - 1], after = edit.clips[index + 1], width = clip.end - clip.start;
  const low = before ? placedEnd(before) : 0, high = Math.max(low, (after ? placedStart(after) : duration) - width);
  const start = Math.max(low, Math.min(high, target)), offset = Math.round((start - clip.start) * 1000) / 1000;
  if (Math.abs(offset) > 1e-6) clip.offset = offset; else delete clip.offset;
  edit.clips[index] = clip;
  return channelEdit(edit, duration);
}
export function gainEdit(value, start, end, db, duration) {
  const edit = fitEdit(value, duration);
  const gains = edit.gains.flatMap(region => region.end <= start || region.start >= end ? [region] : [region.start < start ? { ...region, end: start } : null, region.end > end ? { ...region, start: end } : null].filter(Boolean));
  gains.push({ start, end, db: Math.round(Math.max(-60, Math.min(24, db)) * 10) / 10 });
  return channelEdit({ ...edit, gains: gains.sort((a, b) => a.start - b.start) }, duration);
}
export function gainAt(value, at) { return value?.gains?.find(region => at >= region.start && at < region.end)?.db || 0; }
export function fitEdit(value, duration) {
  if (!value) return channelEdit(undefined, duration);
  const edit = channelEdit(value, 864000);
  const clips = edit.clips.map(clip => ({ ...clip, end: Math.min(clip.end, duration - offsetOf(clip)) })).filter(clip => clip.end > clip.start && placedStart(clip) < duration);
  const gains = edit.gains.map(range => ({ ...range, end: Math.min(range.end, duration) })).filter(range => range.end > range.start);
  return channelEdit({ clips, gains }, duration);
}
// Playable pieces between two timeline times. `source` is where in the audio the piece starts (omitted when it equals `start`).
export function audibleSegments(value, duration, offset = 0, until = duration) {
  const edit = channelEdit(value, Math.max(duration, ...(value?.clips || []).map(clip => clip.end + offsetOf(clip)), ...(value?.gains || []).map(gain => gain.end))), result = [];
  for (const clip of edit.clips) {
    const shift = offsetOf(clip), start = Math.max(placedStart(clip), offset), end = Math.min(placedEnd(clip), until);
    if (end <= start) continue;
    const points = [...new Set([start, end, ...edit.gains.flatMap(gain => [gain.start, gain.end]).filter(at => at > start && at < end)])].sort((a, b) => a - b);
    for (let i = 0; i < points.length - 1; i++) result.push({ start: points[i], end: points[i + 1], gain: 10 ** (gainAt(edit, (points[i] + points[i + 1]) / 2) / 20), ...(shift ? { source: points[i] - shift } : {}) });
  }
  return result;
}
// Puts a copy of a clip's audio (source range `clip.start` to `clip.end`) on the timeline as close to `desired` as free
// space allows. Existing clips, including the one being copied, are never moved or overlapped. Returns null when no gap is
// wide enough. `tag` keeps the new id unique.
export function placeCopy(value, clip, desired, duration, tag = Date.now().toString(36)) {
  const edit = fitEdit(value, duration), width = clip.end - clip.start;
  if (!(width > 0) || edit.clips.length >= 256) return null;
  const spans = edit.clips.map(item => [placedStart(item), placedEnd(item)]).sort((a, b) => a[0] - b[0]);
  const gaps = []; let cursor = 0;
  for (const [from, to] of spans) { if (from - cursor >= width - 1e-6) gaps.push([cursor, from]); cursor = Math.max(cursor, to); }
  if (duration - cursor >= width - 1e-6) gaps.push([cursor, duration]);
  let best = null;
  for (const [low, high] of gaps) { const start = Math.max(low, Math.min(high - width, desired)), cost = Math.abs(start - desired); if (!best || cost < best.cost) best = { start, cost }; }
  if (!best) return null;
  const offset = Math.round((best.start - clip.start) * 1000) / 1000;
  const copy = { id: `${clip.id.slice(0, 50)}-c-${tag}`, start: clip.start, end: clip.end, ...(Math.abs(offset) > 1e-6 ? { offset } : {}) };
  const clips = [...edit.clips, copy].sort((a, b) => placedStart(a) - placedStart(b));
  return { edit: channelEdit({ ...edit, clips }, duration), id: copy.id, start: best.start };
}
// The clip playing at `at`, if any.
export function clipAt(value, at, duration) { return fitEdit(value, duration).clips.find(clip => at >= placedStart(clip) && at < placedEnd(clip)) || null; }
// Removes one clip; the time it covered becomes silence. Gain regions are kept.
export function removeClip(value, id, duration) {
  const edit = fitEdit(value, duration);
  return { ...edit, clips: edit.clips.filter(clip => clip.id !== id) };
}
