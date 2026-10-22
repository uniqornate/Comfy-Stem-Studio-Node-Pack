import { useEffect, useState } from 'react';
import { Download, LoaderCircle, Check } from 'lucide-react';
import type { ModelPackState } from './types';

const working = (state: ModelPackState | null) => !!state && !['idle', 'complete', 'failed', 'cancelled'].includes(state.phase);
const size = (bytes: number) => bytes >= 1 << 30 ? `${(bytes / (1 << 30)).toFixed(1)} GB` : `${Math.round(bytes / (1 << 20))} MB`;

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
  return <div className="settings-proxy model-packs">
    <span className="field-label">Model packs · open weights</span>
    {state?.packs.map(pack => <div key={pack.id} className="settings-proxy-row">
      <span style={{ flex: 1 }}>{pack.name} <small className="subtle">{size(pack.size)}</small></span>
      {pack.ready ? <span className="subtle"><Check size={12}/> Ready</span> : <button className="secondary-button" disabled={!consent || running} onClick={() => void download(pack.id)}><Download size={13}/> Download</button>}
    </div>)}
    <label className="proxy-auto"><input type="checkbox" checked={consent} disabled={running} onChange={event => setConsent(event.target.checked)}/> I accept each pack's license (see the README) and approve these downloads.</label>
    {state?.message && <p className="settings-note" role="status">{running && <LoaderCircle size={11} className="spin"/>} {state.message}{state.detail ? ` · ${state.detail}` : ''}</p>}
    {running && <button className="quiet-button" onClick={() => void window.desktop?.cancelModels?.()}>Cancel</button>}
    {error && <p className="settings-note error-text" role="alert">{error}</p>}
  </div>;
}
