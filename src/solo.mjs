// Solo is materialised into mute flags so the mixer always shows what is audible.
// `restoreMute` remembers each channel's own mute state while a solo session is active.
const anySolo = mix => Object.values(mix).some(entry => entry.solo);
const entries = (mix, fn) => Object.fromEntries(Object.entries(mix).map(([id, entry]) => [id, fn(id, entry)]));
function restore(mix) {
  return entries(mix, (_id, { restoreMute, ...entry }) => ({ ...entry, solo: false, mute: restoreMute ?? entry.mute }));
}
function apply(mix, solos) {
  return entries(mix, (id, entry) => ({ ...entry, restoreMute: entry.restoreMute ?? entry.mute, solo: solos.has(id), mute: !solos.has(id) }));
}
const soloSet = mix => new Set(Object.entries(mix).filter(([, entry]) => entry.solo).map(([id]) => id));
export function toggleSolo(mix, id, additive = false) {
  if (!mix[id]) return mix;
  const solos = soloSet(mix);
  if (mix[id].solo) {
    solos.delete(id);
    return solos.size ? apply(mix, solos) : restore(mix);
  }
  if (!additive) solos.clear();
  solos.add(id);
  return apply(mix, solos);
}
export function toggleMute(mix, id) {
  if (!mix[id]) return mix;
  if (!anySolo(mix)) return { ...mix, [id]: { ...mix[id], mute: !mix[id].mute } };
  // During a solo session unmuting adds the channel to the solo group and muting removes it.
  const solos = soloSet(mix);
  if (mix[id].mute) solos.add(id); else solos.delete(id);
  return solos.size ? apply(mix, solos) : restore(mix);
}
export function normalizeSolo(mix) {
  if (!anySolo(mix)) return entries(mix, (_id, { restoreMute, ...entry }) => entry);
  return apply(mix, soloSet(mix));
}
