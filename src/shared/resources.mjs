import { normalizeEndpoint } from './connection.mjs';
const memory = (total, free) => Number.isFinite(total) && total > 0 && Number.isFinite(free) && free >= 0 && free <= total ? { total, used: total - free } : null;
const load = value => Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
const temperature = value => Number.isFinite(value) && value >= -20 && value <= 150 ? value : null;
export async function resources(profile, fetcher = fetch) {
  const base = normalizeEndpoint(profile.comfyUrl);
  const get = async path => { const response = await fetcher(base + path, { signal: AbortSignal.timeout(2000) }); if (!response.ok) throw Error('Unavailable'); return response.json(); };
  const [stats, thermal] = await Promise.allSettled([get('/system_stats'), get('/stemstudio/temperatures')]);
  const data = stats.status === 'fulfilled' ? stats.value : null;
  const device = data?.devices?.[0];
  const temps = thermal.status === 'fulfilled' ? thermal.value : {};
  return { online: !!data, ram: memory(data?.system?.ram_total, data?.system?.ram_free), vram: device?.type === 'cpu' ? null : memory(device?.vram_total, device?.vram_free), gpuTemperature: data ? temperature(temps.gpu) : null, cpuTemperature: data ? temperature(temps.cpu) : null, cpuLoad: data ? load(temps.cpuLoad) : null };
}
