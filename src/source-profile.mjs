// A rough, dependency-free look at a soundtrack to suggest a starting model. It is a heuristic on spectral
// balance and loudness behaviour, not a benchmark, and it never replaces listening to the result.
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const angle = -2 * Math.PI / size, wr = Math.cos(angle), wi = Math.sin(angle);
    for (let start = 0; start < n; start += size) {
      let cr = 1, ci = 0;
      for (let k = 0; k < size / 2; k++) {
        const a = start + k, b = a + size / 2, tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        const next = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = next;
      }
    }
  }
}
export function analyzeSource(samples, rate, seconds = 90) {
  if (!samples?.length || !(rate > 0)) return null;
  const span = Math.min(samples.length, Math.round(seconds * rate)), from = Math.floor((samples.length - span) / 2);
  const factor = Math.max(1, Math.floor(rate / 16000)), sr = rate / factor, count = Math.floor(span / factor);
  const mono = new Float64Array(count);
  for (let i = 0; i < count; i++) { let sum = 0; for (let k = 0; k < factor; k++) { const value = samples[from + i * factor + k]; if (Number.isFinite(value)) sum += value; } mono[i] = sum / factor; }
  const size = 512, hop = 256, window = Float64Array.from({ length: size }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (size - 1)));
  const rms = [], speech = [], upper = [], flat = [];
  const re = new Float64Array(size), im = new Float64Array(size);
  for (let start = 0; start + size <= count; start += hop) {
    let energy = 0;
    for (let i = 0; i < size; i++) { re[i] = mono[start + i] * window[i]; im[i] = 0; energy += mono[start + i] ** 2; }
    fft(re, im);
    let total = 0, band = 0, high = 0, logSum = 0, logCount = 0, linear = 0;
    for (let k = 1; k < size / 2; k++) {
      const hz = k * sr / size, power = re[k] * re[k] + im[k] * im[k];
      total += power;
      if (hz >= 250 && hz < 3400) band += power; else if (hz >= 3400) high += power;
      if (hz >= 100 && hz < 8000) { logSum += Math.log(power + 1e-12); logCount++; linear += power; }
    }
    rms.push(Math.sqrt(energy / size));
    speech.push(total > 0 ? band / total : 0); upper.push(total > 0 ? high / total : 0);
    flat.push(linear > 0 && logCount ? Math.exp(logSum / logCount) / (linear / logCount) : 0);
  }
  if (rms.length < 8) return null;
  const sorted = [...rms].sort((a, b) => a - b), p90 = sorted[Math.floor(sorted.length * 0.9)];
  if (p90 < 1e-5) return { kind: 'silent', confidence: 1, features: { silenceRatio: 1 } };
  const loud = rms.map((value, index) => value >= 0.1 * p90 ? index : -1).filter(index => index >= 0);
  const mean = values => values.reduce((a, b) => a + b, 0) / Math.max(1, values.length);
  const average = mean(rms), deviation = Math.sqrt(mean(rms.map(value => (value - average) ** 2)));
  const features = {
    speechShare: mean(loud.map(index => speech[index])), upperShare: mean(loud.map(index => upper[index])), flatness: mean(loud.map(index => flat[index])),
    silenceRatio: 1 - loud.length / rms.length, variation: deviation / average,
  };
  let kind = 'mixed', confidence = 0.5;
  if (features.speechShare >= 0.62 && features.silenceRatio >= 0.1 && features.variation >= 0.55) { kind = 'dialogue'; confidence = Math.min(1, 0.5 + (features.speechShare - 0.62) * 2 + features.silenceRatio); }
  else if (features.silenceRatio < 0.08 && features.variation < 0.6 && features.flatness < 0.2) { kind = 'music'; confidence = Math.min(1, 0.55 + (0.6 - features.variation) * 0.5); }
  if (kind === 'mixed' && features.speechShare < 0.45 && features.flatness > 0.35) { kind = 'effects'; confidence = 0.6; }
  return { kind, confidence: Math.round(confidence * 100) / 100, features };
}
export function suggestModel(profile) {
  if (!profile || profile.kind === 'silent') return null;
  if (profile.kind === 'dialogue') return { model: 'mrx', text: 'Mostly speech', detail: 'MRX is tuned for film dialogue. BandIt v2 is the multilingual alternative.' };
  if (profile.kind === 'music') return { model: 'music6', text: 'Mostly music', detail: 'MRX and BandIt return music as one stem. The 6-stem model splits it into vocals, drums, bass, guitar, piano and other.' };
  if (profile.kind === 'effects') return { model: 'mrx', text: 'Mostly effects or noise', detail: 'MRX returns an effects stem. For one named sound, extract it from that stem with USS.' };
  return { model: 'mrx', text: 'Mixed soundtrack', detail: 'A film-style mix of speech, music and effects. MRX is a good first try.' };
}
