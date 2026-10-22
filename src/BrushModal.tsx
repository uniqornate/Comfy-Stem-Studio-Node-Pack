import { useEffect, useRef, useState } from 'react';
import { LoaderCircle, Paintbrush, X } from 'lucide-react';
import type { BrushState, Engine, MMAudioState, Profile } from './types';

export type BrushModel = 'small' | 'medium' | 'mmaudio';
const MIN = 0.5, MAX: Record<BrushModel, number> = { small: 60, medium: 60, mmaudio: 12 };
const NAMES: Record<BrushModel, { name: string; note: string }> = {
  small: { name: 'Small-SFX', note: 'Stable Audio 3 · fast' },
  medium: { name: 'Medium', note: 'Stable Audio 3 · 9 GB' },
  mmaudio: { name: 'MMAudio', note: 'Sound for picture · 12 s' },
};
const busyPhase = (state: BrushState | null) => state?.phase === 'downloading' || state?.phase === 'installing';
const remembered = (): BrushModel => { try { const value = localStorage.getItem('brushModel'); return value === 'medium' || value === 'mmaudio' ? value : 'small'; } catch { return 'small'; } };
export function BrushModal({ region, engine, profile, busy, hasVideo, close, refreshEngine, run }: { region: { start: number; end: number }; engine: Engine | null; profile: Profile; busy: boolean; hasVideo: boolean; close: () => void; refreshEngine: () => Promise<void>; run: (prompt: string, options: { model: BrushModel; video: boolean }) => void }) {
  const [prompt, setPrompt] = useState(''), [model, setModel] = useState<BrushModel>(remembered), [video, setVideo] = useState(true);
  const [states, setStates] = useState<Partial<Record<BrushModel, BrushState | MMAudioState>>>({}), [consent, setConsent] = useState(false), [error, setError] = useState('');
  const field = useRef<HTMLTextAreaElement>(null);
  const seconds = region.end - region.start, state = states[model] || null, active = busyPhase(state);
  const anyActive = Object.values(states).some(item => busyPhase(item || null));
  const ready = model === 'mmaudio' ? !!engine?.mmaudio && !!engine?.mmaudioModel : !!engine?.brush && !!engine?.brushModels?.[model];
  const problem = seconds < MIN ? `Paint at least ${MIN} seconds.` : seconds > MAX[model] ? `Paint at most ${MAX[model]} seconds at a time with this model.` : model !== 'mmaudio' && !engine?.brush ? 'Update the Stem Studio integration and ComfyUI first.' : model === 'mmaudio' && !engine?.mmaudio ? 'Prepare MMAudio first.' : !ready ? 'Download the model first.' : !prompt.trim() ? 'Describe the sound.' : '';
  const read = (which: BrushModel) => which === 'mmaudio' ? window.desktop!.mmaudioStatus(profile) : window.desktop!.brushStatus(profile, which);
  useEffect(() => { field.current?.focus(); }, []);
  useEffect(() => { try { localStorage.setItem('brushModel', model); } catch {} setConsent(false); setError(''); void read(model).then(next => setStates(previous => ({ ...previous, [model]: next }))).catch(() => {}); }, [model]);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => { void read(model).then(next => { setStates(previous => ({ ...previous, [model]: next })); if (next.phase === 'complete') void refreshEngine(); }).catch(() => {}); }, 1000);
    return () => clearInterval(timer);
  }, [active, model]);
  const submit = () => { if (!problem && !busy) run(prompt.trim(), { model, video: model === 'mmaudio' && video && hasVideo }); };
  useEffect(() => { const key = (event: KeyboardEvent) => { if (event.key === 'Escape' && !anyActive) close(); }; window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key); }, [close, anyActive]);
  async function download() { try { setError(''); const next = model === 'mmaudio' ? await window.desktop!.prepareMMAudio(profile) : await window.desktop!.prepareBrush(profile, model); setStates(previous => ({ ...previous, [model]: next })); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } }
  async function cancel() { if (model === 'mmaudio') await window.desktop?.cancelMMAudio(); else await window.desktop?.cancelBrush(model); }
  const parts = model === 'mmaudio' ? states.mmaudio as MMAudioState | undefined : undefined;
  const needsDownload = model === 'mmaudio' ? !!engine && (!engine.mmaudio || !engine.mmaudioModel) : !!engine?.brush && !ready;
  return <div className="modal-backdrop" onClick={event => { if (event.target === event.currentTarget && !anyActive) close(); }}>
    <section className="connection-modal mini-modal brush-modal" role="dialog" aria-modal="true" aria-label="Brush">
      <header><span className="mini-title"><Paintbrush size={15}/><strong>Brush</strong></span><button className="icon-button" disabled={anyActive} onClick={close} aria-label="Close"><X size={15}/></button></header>
      <div className="mini-body">
        <p className="brush-region">{region.start.toFixed(2)} s to {region.end.toFixed(2)} s <span>{seconds.toFixed(1)} s</span></p>
        <div className="brush-models" role="group" aria-label="Sound model">{(Object.keys(NAMES) as BrushModel[]).map(key => <button key={key} aria-pressed={model === key} disabled={anyActive} onClick={() => setModel(key)}><strong>{NAMES[key].name}</strong><small>{NAMES[key].note}</small></button>)}</div>
        <textarea ref={field} className="brush-prompt" rows={3} maxLength={300} value={prompt} placeholder="e.g. slow footsteps on wet gravel, close up" onChange={event => setPrompt(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); event.stopPropagation(); submit(); } }}/>
        {model === 'mmaudio' && <label className="sam-consent"><input type="checkbox" checked={video && hasVideo} disabled={!hasVideo} onChange={event => setVideo(event.target.checked)}/> {hasVideo ? 'Use the picture of this region to time the sound' : 'The source has no picture; the prompt alone is used'}</label>}
        <p className="helper">{model === 'small' ? 'Paints a new channel from Stable Audio 3 Small-SFX, placed at this time and silent elsewhere. Short, specific effects work best.' : model === 'medium' ? 'Stable Audio 3 Medium: larger and slower, built for longer and more musical sounds. Same prompt, same placement.' : 'MMAudio makes sound that follows the picture of this region (up to 12 s), guided by your prompt.'}</p>
        {needsDownload && <details className="sam-preparation" open><summary>{model === 'mmaudio' ? 'Prepare MMAudio' : `Download ${NAMES[model].name}`}</summary>
          {model === 'small' && <p>Stable Audio 3 Small-SFX (2.3 GB) and its T5Gemma text encoder (1.2 GB), under the Stability AI Community License. Saved in ComfyUI/models/audio_separation/stable-audio-3 and checked against pinned hashes. No account needed.</p>}
          {model === 'medium' && <p>Stable Audio 3 Medium (9.2 GB) plus the shared T5Gemma encoder (1.2 GB if not present yet), under the Stability AI Community License. Saved in ComfyUI/models/audio_separation/stable-audio-3 and checked against pinned hashes. It needs a capable GPU.</p>}
          {model === 'mmaudio' && <p>Installs the community ComfyUI-MMAudio node pack (kijai, MIT) from GitHub at a pinned version into ComfyUI/custom_nodes, installs its Python packages (librosa, torchdiffeq, timm, open_clip_torch, accelerate, ftfy, omegaconf, einops) into ComfyUI's own Python, and downloads 5.6 GB of hash-checked weights into ComfyUI/models/mmaudio. The MMAudio weights are CC BY-NC 4.0: non-commercial use only. Restart ComfyUI afterwards.</p>}
          {parts && <p className="brush-parts">Node pack {parts.node ? 'installed' : 'missing'} · Python packages {parts.deps ? 'present' : parts.python ? 'missing' : 'ComfyUI Python not found'} · Weights {parts.weights ? 'present' : 'missing'}</p>}
          <label className="sam-consent"><input type="checkbox" checked={consent} disabled={active} onChange={event => setConsent(event.target.checked)}/> {model === 'mmaudio' ? 'I approve these installs and downloads and accept the non-commercial weights license.' : <>I approve the download and accept the <a href="https://huggingface.co/stabilityai/stable-audio-open-1.0/blob/main/LICENSE.md" target="_blank" rel="noreferrer">license</a>.</>}</label>
          <button className="secondary-button" disabled={!consent || active} onClick={() => void download()}>{model === 'mmaudio' ? 'Install' : 'Download'}</button>
          {active && <button className="quiet-button" onClick={() => void cancel()}>Cancel</button>}
          {state?.phase === 'complete' && <button className="secondary-button" onClick={() => void refreshEngine()}>Check again</button>}
        </details>}
        {state?.message && state.phase !== 'idle' && <div className="sam-progress" role="status">{active && <LoaderCircle className="spin" size={13}/>} {state.message}{active && state.percent >= 0 && <progress max="100" value={state.percent}/>}{state.detail && <small>{state.detail.slice(-300)}</small>}</div>}
        {error && <p className="error-banner" role="alert">{error}</p>}
      </div>
      <footer><span className="subtle" data-tip={problem}>{problem}</span><button className="primary-button" disabled={!!problem || busy} onClick={submit}>Paint</button></footer>
    </section>
  </div>;
}
