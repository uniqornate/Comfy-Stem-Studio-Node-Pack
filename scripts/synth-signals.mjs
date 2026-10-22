// Synthetic soundtrack-like signals used to exercise the source profiler without audio assets.
export function rng(seed = 1) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
export function speechLike(seconds = 20, rate = 44100, seed = 3) {
  const random = rng(seed), out = new Float32Array(seconds * rate);
  let t = 0;
  while (t < seconds) {
    const length = 0.12 + random() * 0.25, pause = 0.08 + random() * 0.4, f0 = 100 + random() * 120;
    for (let i = Math.floor(t * rate); i < Math.min(out.length, Math.floor((t + length) * rate)); i++) {
      const time = i / rate, local = Math.max(0, Math.min(1, (time - t) / length)), envelope = Math.sin(Math.PI * local) ** 1.5;
      let value = 0;
      for (let h = 1; h * f0 < 3200; h++) value += Math.sin(2 * Math.PI * h * f0 * time) / h ** 0.7 * (h * f0 > 250 ? 1.4 : 1);
      out[i] = 0.3 * envelope * value / 4;
    }
    t += length + pause;
  }
  return out;
}
export function musicLike(seconds = 20, rate = 44100, seed = 5) {
  const random = rng(seed), out = new Float32Array(seconds * rate), notes = [220, 277.18, 329.63, 440];
  for (let i = 0; i < out.length; i++) {
    const time = i / rate; let value = 0;
    for (const f of notes) for (let h = 1; h * f < 12000; h++) value += Math.sin(2 * Math.PI * h * f * time) / h ** 0.55;
    const beat = (time * 2) % 1, hat = (random() * 2 - 1) * Math.exp(-beat * 18) * 0.5;
    out[i] = 0.05 * value * (0.9 + 0.1 * Math.sin(2 * Math.PI * 0.3 * time)) + 0.05 * hat;
  }
  return out;
}
export function effectsLike(seconds = 20, rate = 44100, seed = 7) {
  const random = rng(seed), out = new Float32Array(seconds * rate);
  for (let i = 0; i < out.length; i++) { const time = i / rate, gate = (time % 1.7) < 0.5 ? Math.exp(-((time % 1.7)) * 4) : 0; out[i] = (random() * 2 - 1) * gate * 0.4; }
  return out;
}
