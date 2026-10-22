import { MODEL_IDS } from './models.mjs';
export function preferences(raw) {
  let value; try { value = JSON.parse(raw || '{}'); } catch { value = {}; }
  value = value && typeof value === 'object' ? value : {};
  return {
    model: MODEL_IDS.includes(value.model) ? value.model : 'mrx',
    activeOperation: value.activeOperation === 'uss' ? 'uss' : 'stems',
    target: typeof value.target === 'string' && value.target.length < 200 ? value.target : 'All',
    autoThreshold: value.autoThreshold !== false,
    threshold: Number.isFinite(value.threshold) && value.threshold >= 0 && value.threshold <= 1 ? value.threshold : 0.1,
  };
}
