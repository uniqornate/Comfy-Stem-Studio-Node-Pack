import { useEffect, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import type { BrushState, Engine, Profile } from './types';

const running = (state: BrushState | null) => state?.phase === 'downloading';
// Options of the six-stem music model: what it returns, and a pinned one-file download when it is missing.
export function MusicPanel({ engine, profile, refreshEngine }: { engine: Engine | null; profile: Profile; refreshEngine: () => Promise<void> }) {
  const [state, setState] = useState<BrushState | null>(null), [consent, setConsent] = useState(false), [error, setError] = useState('');
  const active = running(state), ready = !!engine?.music && !!engine?.musicModel;
  useEffect(() => { void window.desktop?.musicStatus(profile).then(setState).catch(() => {}); }, []);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => { void window.desktop?.musicStatus(profile).then(next => { setState(next); if (next.phase === 'complete') void refreshEngine(); }).catch(() => {}); }, 1000);
    return () => clearInterval(timer);
  }, [active]);
  async function download() { try { setError(''); setState(await window.desktop!.prepareMusic(profile)); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } }
  return <>
    <p className="helper">Splits a music mix into six channels: vocals, drums, bass, guitar, piano and other. Stereo is kept. It works best on songs; for film sound use MRX or BandIt first and run this on the music channel.</p>
    {!engine?.music && <p className="helper">Update the Stem Studio integration with the latest installer and restart idle ComfyUI first.</p>}
    {engine?.music && !ready && <details className="sam-preparation" open><summary>Download the music model</summary>
      <p>HTDemucs 6-source (52 MiB) from Meta, MIT license. Saved in ComfyUI/models/audio_separation/htdemucs-6s and checked against a pinned SHA-256. No account needed.</p>
      <label className="sam-consent"><input type="checkbox" checked={consent} disabled={active} onChange={event => setConsent(event.target.checked)}/> I approve the download from dl.fbaipublicfiles.com.</label>
      <button className="secondary-button" disabled={!consent || active} onClick={() => void download()}>Download</button>
      {active && <button className="quiet-button" onClick={() => void window.desktop?.cancelMusic()}>Cancel</button>}
      {state?.phase === 'complete' && <button className="secondary-button" onClick={() => void refreshEngine()}>Check again</button>}
    </details>}
    {ready && <p className="helper">Model installed.</p>}
    {state?.message && state.phase !== 'idle' && <div className="sam-progress" role="status">{active && <LoaderCircle className="spin" size={13}/>} {state.message}{active && state.percent >= 0 && <progress max="100" value={state.percent}/>}{state.detail && <small>{state.detail}</small>}</div>}
    {error && <p className="error-banner" role="alert">{error}</p>}
  </>;
}
