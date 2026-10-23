import { useEffect, useMemo, useState } from 'react';
import { Layers, LoaderCircle, X } from 'lucide-react';
import { encodeWav, mixPlan } from './mixdown.mjs';
import type { ChannelEdit } from './clip-edits.mjs';
import type { MixExportOptions } from './types';

type Item = { id: string; label: string; buffer: AudioBuffer };
type Format = 'wav24' | 'wav16' | 'wav32' | 'flac';
const formats: { id: Format; label: string }[] = [{ id: 'wav24', label: 'WAV 24-bit' }, { id: 'wav16', label: 'WAV 16-bit' }, { id: 'wav32', label: 'WAV float' }, { id: 'flac', label: 'FLAC' }];

export async function renderMix(items: Item[], mix: Record<string, { mute: boolean; level: number; pan?: number }>, edits: Record<string, ChannelEdit>, duration: number, selected: string[], preventClipping: boolean) {
  const rate = Math.max(...items.filter(item => selected.includes(item.id)).map(item => item.buffer.sampleRate), 8000);
  const plan = mixPlan({ tracks: items.map(item => ({ id: item.id, duration: item.buffer.duration })), mix, edits, duration, selected });
  if (!plan.length) throw Error('Every chosen channel is muted or empty.');
  // Stereo only when some channel is panned; otherwise the mix stays mono as before.
  const stereo = plan.some(entry => entry.pan), length = Math.max(1, Math.ceil(duration * rate)), ctx = new OfflineAudioContext(stereo ? 2 : 1, length, rate);
  for (const entry of plan) {
    const buffer = items.find(item => item.id === entry.id)!.buffer, level = ctx.createGain(); level.gain.value = entry.level;
    if (entry.pan) {
      // Same balance law as playback: the side away from the pan direction is turned down.
      const double = ctx.createGain(); double.channelCount = 2; double.channelCountMode = 'explicit'; double.channelInterpretation = 'speakers'; // mono doubled, as in playback
      const splitter = ctx.createChannelSplitter(2), merger = ctx.createChannelMerger(2), left = ctx.createGain(), right = ctx.createGain();
      left.gain.value = entry.pan > 0 ? 1 - entry.pan : 1; right.gain.value = entry.pan < 0 ? 1 + entry.pan : 1;
      level.connect(double); double.connect(splitter); splitter.connect(left, 0); splitter.connect(right, 1); left.connect(merger, 0, 0); right.connect(merger, 0, 1); merger.connect(ctx.destination);
    } else level.connect(ctx.destination);
    for (const segment of entry.segments) {
      const source = ctx.createBufferSource(), envelope = ctx.createGain();
      source.buffer = buffer; envelope.gain.value = segment.gain; source.connect(envelope); envelope.connect(level);
      source.start(segment.start, segment.source ?? segment.start, segment.end - segment.start);
    }
  }
  const buffer = await ctx.startRendering(), rendered = Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index).slice());
  let peak = 0; for (const channel of rendered) for (let i = 0; i < channel.length; i++) peak = Math.max(peak, Math.abs(channel[i]));
  if (preventClipping && peak > 1) for (const channel of rendered) for (let i = 0; i < channel.length; i++) channel[i] /= peak;
  return { samples: rendered, rate, peak };
}

export function MixExportModal({ items, mix, edits, duration, name, close, exportFile }: { items: Item[]; mix: Record<string, { mute: boolean; level: number; pan?: number }>; edits: Record<string, ChannelEdit>; duration: number; name: string; close: () => void; exportFile: (options: MixExportOptions) => Promise<string | null> }) {
  const [selected, setSelected] = useState(() => items.filter(item => !mix[item.id]?.mute).map(item => item.id));
  const [format, setFormat] = useState<Format>('wav24'), [safe, setSafe] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(''), [done, setDone] = useState('');
  useEffect(() => { const key = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) close(); }; window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key); }, [close, busy]);
  const audible = useMemo(() => new Set(selected.filter(id => !mix[id]?.mute)), [selected, mix]);
  async function run() {
    setBusy(true); setError(''); setDone('');
    try {
      const { samples, rate, peak } = await renderMix(items, mix, edits, duration, selected, safe);
      const bytes = encodeWav(samples, rate, format === 'wav16' ? 16 : format === 'wav32' ? 32 : 24);
      const path = await exportFile({ format: format === 'flac' ? 'flac' : 'wav', bytes, name });
      if (path) setDone(`Saved ${path}${peak > 1 && !safe ? ' (peaks above 0 dBFS were kept)' : ''}`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }
  return <div className="modal-backdrop" onClick={event => { if (event.target === event.currentTarget && !busy) close(); }}>
    <section className="connection-modal mini-modal" role="dialog" aria-modal="true" aria-label="Export mix">
      <header><span className="mini-title"><Layers size={15}/><strong>Export mix</strong></span><button className="icon-button" disabled={busy} onClick={close} aria-label="Close"><X size={15}/></button></header>
      <div className="mini-body">
        <div className="mix-channels" role="group" aria-label="Channels in the mix">
          {items.map(item => <label key={item.id} className={mix[item.id]?.mute ? 'is-muted' : ''} data-tip={mix[item.id]?.mute ? 'This channel is muted in the mixer, so it stays silent in the export.' : item.label}><input type="checkbox" checked={selected.includes(item.id)} disabled={busy} onChange={event => setSelected(current => event.target.checked ? [...current, item.id] : current.filter(id => id !== item.id))}/><span>{item.label}</span></label>)}
        </div>
        <div className="segmented" role="group" aria-label="Format">{formats.map(option => <button key={option.id} type="button" aria-pressed={format === option.id} disabled={busy} onClick={() => setFormat(option.id)}>{option.label}</button>)}</div>
        <label className="sam-option"><input type="checkbox" checked={safe} disabled={busy} onChange={event => setSafe(event.target.checked)}/> Prevent clipping <small>only lowers, never boosts</small></label>
        <p className="helper">Uses the mixer levels, pan, mute and solo, clip edits and gain changes you hear. Mono mix, or stereo when a channel is panned. {format === 'flac' ? 'FLAC is written by ComfyUI from a 24-bit render.' : ''}</p>
        {error && <p className="error-banner" role="alert">{error}</p>}{done && <p className="save-notice" role="status">{done}</p>}
      </div>
      <footer><span className="subtle">{audible.size} of {items.length} channels audible</span><button className="primary-button" disabled={busy || !audible.size} onClick={() => void run()}>{busy ? <LoaderCircle size={14} className="spin"/> : null} Export</button></footer>
    </section>
  </div>;
}
