// A fine film-grain layer over the whole window. One small noise tile is generated once and tiled by CSS; an optional shift
// animation moves the layer on the compositor, so it costs no repaint.
export const GRAIN_TILE = 256;
export const BLENDS = ['normal', 'overlay', 'soft-light', 'multiply', 'screen'];
export const GRAIN_DEFAULTS = { on: true, opacity: 0.05, size: 1, amount: 0.7, mono: true, blend: 'normal', animate: false, fps: 8, seed: 1 };
const clamp = (value, low, high, fallback) => Number.isFinite(value) ? Math.min(high, Math.max(low, value)) : fallback;
export function cleanGrain(value) {
  const v = value && typeof value === 'object' ? value : {};
  return {
    on: v.on !== false, opacity: clamp(v.opacity, 0, 0.3, GRAIN_DEFAULTS.opacity), size: clamp(v.size, 0.5, 4, GRAIN_DEFAULTS.size), amount: clamp(v.amount, 0, 1, GRAIN_DEFAULTS.amount),
    mono: v.mono !== false, blend: BLENDS.includes(v.blend) ? v.blend : GRAIN_DEFAULTS.blend, animate: v.animate === true, fps: Math.round(clamp(v.fps, 1, 24, GRAIN_DEFAULTS.fps)), seed: Math.round(clamp(v.seed, 1, 9999, 1)),
  };
}
// Small seeded generator, so the same seed always gives the same grain.
export function rng(seed) { let a = seed >>> 0 || 1; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
// RGBA pixels of one tile. Noise is roughly bell shaped (three uniforms). With normal blending the grain is white and black
// specks whose alpha follows the noise, so it neither lightens nor darkens the picture on average; every other blend mode
// gets opaque grey around mid-grey, which those modes treat as neutral.
export function noiseTile(params, size = GRAIN_TILE) {
  const { amount, mono, blend, seed } = cleanGrain(params), random = rng(seed), data = new Uint8ClampedArray(size * size * 4);
  const bell = () => (random() + random() + random() - 1.5) / 1.5;
  for (let i = 0; i < size * size; i++) {
    const shared = bell() * amount, at = i * 4;
    const n = [0, 1, 2].map(() => mono ? shared : bell() * amount);
    if (blend === 'normal') { data[at] = n[0] > 0 ? 255 : 0; data[at + 1] = n[1] > 0 ? 255 : 0; data[at + 2] = n[2] > 0 ? 255 : 0; data[at + 3] = Math.round(Math.max(Math.abs(n[0]), Math.abs(n[1]), Math.abs(n[2])) * 255); }
    else { data[at] = 128 + n[0] * 127; data[at + 1] = 128 + n[1] * 127; data[at + 2] = 128 + n[2] * 127; data[at + 3] = 255; }
  }
  return data;
}
