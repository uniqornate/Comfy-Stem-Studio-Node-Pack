// Peak resource use of a model while a job runs, measured from the telemetry of the selected ComfyUI. VRAM and RAM are
// the increase over what was already in use when the job started; CPU is the highest shared load seen.
const used = item => (item && Number.isFinite(item.used) ? item.used : null);
export function startTracker(sample, now = Date.now()) {
  return { started: now, base: { vram: used(sample?.vram), ram: used(sample?.ram) }, peak: { vram: 0, ram: 0, cpu: null }, seen: { vram: false, ram: false } };
}
export function sampleTracker(tracker, sample) {
  const next = { ...tracker, peak: { ...tracker.peak }, seen: { ...tracker.seen } };
  for (const name of ['vram', 'ram']) {
    const value = used(sample?.[name]);
    if (value !== null && next.base[name] !== null) { next.seen[name] = true; next.peak[name] = Math.max(next.peak[name], value - next.base[name]); }
  }
  if (Number.isFinite(sample?.cpuLoad)) next.peak.cpu = Math.max(next.peak.cpu ?? 0, sample.cpuLoad);
  return next;
}
export function finishTracker(tracker, now = Date.now()) {
  return { vram: tracker.seen.vram ? tracker.peak.vram : null, ram: tracker.seen.ram ? tracker.peak.ram : null, cpu: tracker.peak.cpu, seconds: Math.max(0, Math.round((now - tracker.started) / 1000)), at: now };
}
const number = value => (value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0) ? value : null);
export function readUsage(raw) {
  let value; try { value = JSON.parse(raw || '{}'); } catch { value = {}; }
  const result = {};
  if (!value || typeof value !== 'object') return result;
  for (const [key, entry] of Object.entries(value)) {
    if (!/^[a-z0-9-]{1,40}$/.test(key) || !entry || typeof entry !== 'object' || !Number.isFinite(entry.at)) continue;
    result[key] = { vram: number(entry.vram), ram: number(entry.ram), cpu: number(entry.cpu), seconds: Number.isFinite(entry.seconds) && entry.seconds >= 0 ? entry.seconds : 0, at: entry.at };
  }
  return result;
}
export const remember = (usage, key, entry) => ({ ...usage, [key]: entry });
