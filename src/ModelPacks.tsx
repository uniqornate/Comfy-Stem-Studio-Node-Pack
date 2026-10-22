import { useEffect, useState } from 'react';
import { Download, LoaderCircle, Check } from 'lucide-react';
import type { ModelPackState } from './types';

const working = (state: ModelPackState | null) => !!state && !['idle', 'complete', 'failed', 'cancelled'].includes(state.phase);
const size = (bytes: number) => bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.round(bytes / 1e6)} MB`;

// Node pack mode only: downloads the open-weight model packs into ComfyUI's models/audio_separation folder.
export function ModelPacks({ onChange }: { onChange?: () => void }) {
  const [state, setState] = useState<ModelPackState | null>(null);
  const [error, setError] = useState('');
  const [consent, setConsent] = useState(false);
  const running = working(state);
  useEffect(() => {
    let active = true;
    const poll = () => window.desktop?.modelsStatus?.().then(value => { if (active) setState(value); }).catch(cause => { if (active) setError(String(cause)); });
    void poll(); const timer = setInterval(poll, running ? 1000 : 6000);
    return () => { active = false; clearInterval(timer); };
  }, [running]);
  useEffect(() => { if (state?.phase === 'complete') onChange?.(); }, [state?.phase]);
  async function download(id: string) {
    try { setError(''); setState(await window.desktop!.prepareModels!([id])); } catch (cause) { setError(String(cause)); }
  }
  if (!state && !error) return null;
  const missing = state?.packs.some(pack => !pack.ready);
  return <section className="pack-list" aria-label="Model packs">
    <header><strong>Model packs</strong><small>Open weights, saved in ComfyUI/models/audio_separation</small></header>
    <ul>{state?.packs.map(pack => <li key={pack.id} className={pack.ready ? 'is-ready' : ''}>
      <span className="pack-name"><b>{pack.name}</b>{pack.license && <small>{pack.license}</small>}</span>
      <span className="pack-size">{size(pack.size)}</span>
      <span className="pack-state">{pack.ready ? <em><Check size={12}/> Ready</em> : <button className="secondary-button" disabled={!consent || running} onClick={() => void download(pack.id)}><Download size={12}/> Download</button>}</span>
    </li>)}</ul>
    {missing && <label className="pack-consent"><input type="checkbox" checked={consent} disabled={running} onChange={event => setConsent(event.target.checked)}/> I accept each pack's license (see the README) and approve these downloads.</label>}
    {(running || state?.message) && <div className="pack-status" role="status">{running && <LoaderCircle size={12} className="spin"/>}<span>{state?.message}{state?.detail ? ` · ${state.detail}` : ''}</span>{running && <button className="quiet-button" onClick={() => void window.desktop?.cancelModels?.()}>Cancel</button>}</div>}
    {error && <p className="settings-note error-text" role="alert">{error}</p>}
  </section>;
}
