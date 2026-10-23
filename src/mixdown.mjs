import { audibleSegments } from './clip-edits.mjs';

// Which channels play, where, and how loud, for an offline mixdown. Solo is already materialised into mute flags.
export function mixPlan({ tracks, mix, edits = {}, duration, selected }) {
  const chosen = selected ? new Set(selected) : null;
  return tracks.filter(track => (!chosen || chosen.has(track.id)) && !mix[track.id]?.mute).map(track => ({
    id: track.id, level: mix[track.id]?.level ?? 1, pan: mix[track.id]?.pan ?? 0,
    segments: audibleSegments(edits[track.id], track.duration, 0, Math.min(track.duration, duration)).map(({ start, end, gain, source }) => ({ start, end, gain, ...(source !== undefined ? { source } : {}) })),
  })).filter(item => item.segments.length);
}
// `samples` is one channel (Float32Array) or an array of channels of equal length (interleaved in the file).
export function encodeWav(samples, rate, bits = 24) {
  if (![16, 24, 32].includes(bits)) throw Error('Use 16, 24 or 32-bit float WAV.');
  const channels = Array.isArray(samples) ? samples : [samples], count = channels.length, frames = channels[0].length;
  if (!count || count > 2 || channels.some(channel => channel.length !== frames)) throw Error('Use one or two channels of equal length.');
  const bytes = bits / 8, data = frames * count * bytes, buffer = new ArrayBuffer(44 + data), view = new DataView(buffer);
  const text = (offset, value) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); };
  text(0, 'RIFF'); view.setUint32(4, 36 + data, true); text(8, 'WAVE'); text(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, bits === 32 ? 3 : 1, true); view.setUint16(22, count, true); view.setUint32(24, rate, true);
  view.setUint32(28, rate * bytes * count, true); view.setUint16(32, bytes * count, true); view.setUint16(34, bits, true); text(36, 'data'); view.setUint32(40, data, true);
  let offset = 44;
  for (let i = 0; i < frames * count; i++, offset += bytes) {
    const sample = channels[i % count][Math.floor(i / count)], value = Math.max(-1, Math.min(1, Number.isFinite(sample) ? sample : 0));
    if (bits === 32) view.setFloat32(offset, value, true);
    else if (bits === 16) view.setInt16(offset, Math.round(value < 0 ? value * 32768 : value * 32767), true);
    else { const integer = Math.round(value < 0 ? value * 8388608 : value * 8388607); view.setUint8(offset, integer & 255); view.setUint8(offset + 1, (integer >> 8) & 255); view.setUint8(offset + 2, (integer >> 16) & 255); }
  }
  return new Uint8Array(buffer);
}
