import { useEffect, useState } from 'react';
import { FileAudio, LoaderCircle, X } from 'lucide-react';
import type { Profile, ReferenceAudio, SAMState } from './types';

const preparingPhase = (state: SAMState | null) => !!state && !['idle', 'complete', 'failed', 'cancelled'].includes(state.phase);
export const guidesepPreparing = preparingPhase;
export function useGuideSepStatus(profile: Profile) {
  const [state, setState] = useState<SAMState | null>(null);
  useEffect(() => {
    let active = true;
    const poll = () => window.desktop?.guidesepStatus(profile).then(value => { if (active) setState(previous => JSON.stringify(previous) === JSON.stringify(value) ? previous : value); }).catch(() => {});
    void poll(); const timer = setInterval(poll, preparingPhase(state) ? 1000 : 5000);
    return () => { active = false; clearInterval(timer); };
  }, [profile.installation, profile.comfyUrl, preparingPhase(state)]);
  return [state, setState] as const;
}
export function GuideSepPanel({ profile, engine, state, setState, reference, setReference, offset, setOffset, busy, mixture, setMixture, sourceName }: { mixture?: ReferenceAudio | null; setMixture?: (value: ReferenceAudio | null) => void; sourceName?: string; offset: number; setOffset: (value: number) => void; profile: Profile; engine: { guidesep?: boolean } | null; state: SAMState | null; setState: (value: SAMState) => void; reference: ReferenceAudio | null; setReference: (value: ReferenceAudio | null) => void; busy: boolean }) {
  const [consent, setConsent] = useState(false), [error, setError] = useState(''), [offsetText, setOffsetText] = useState(String(offset));
  const preparing = preparingPhase(state);
  async function chooseMixture() { try { setError(''); const picked = await window.desktop!.chooseReference(); if (picked) setMixture?.(picked); } catch (cause) { setError(String(cause)); } }
  async function choose() { try { setError(''); const picked = await window.desktop!.chooseReference(); if (picked) setReference(picked); } catch (cause) { setError(String(cause)); } }
  async function prepare() { try { setError(''); setState(await window.desktop!.prepareGuideSep(profile)); } catch (cause) { setError(String(cause)); } }
  return <div className="guidesep-panel">
    {setMixture && <><span className="field-label">Audio to process</span>
    <div className="reference-row">
      <button type="button" className="secondary-button reference-pick" disabled={busy || !window.desktop} onClick={() => void chooseMixture()} data-tip={'Audio to process\nBy default GuideSep works on the loaded source. Pick an audio file to process that instead.'}>
        <FileAudio size={15}/><span>{mixture ? mixture.name : `Loaded source${sourceName ? ` · ${sourceName}` : ''}`}</span>
      </button>
      {mixture && <button type="button" className="icon-button" aria-label="Use the loaded source again" disabled={busy} onClick={() => setMixture(null)}><X size={13}/></button>}
    </div></>}
    <span className="field-label">Reference sound</span>
    <div className="reference-row">
      <button type="button" className="secondary-button reference-pick" disabled={busy || !window.desktop} onClick={() => void choose()} data-tip={'Choose a reference\nHum, whistle or play the part you want to pull out. Its start lines up with the start of the processed region.'}>
        <FileAudio size={15}/><span>{reference ? reference.name : 'Choose audio file'}</span>
      </button>
      {reference && <button type="button" className="icon-button" aria-label="Clear reference" disabled={busy} onClick={() => setReference(null)}><X size={13}/></button>}
    </div>
    <label className="reference-offset" data-tip={'Reference start offset\nSeconds into the processed region where your reference begins. Negative skips the first seconds of the reference.'}><span>Reference starts at</span><input type="number" step="0.1" min="-600" max="600" value={offsetText} disabled={busy} onChange={event => { setOffsetText(event.target.value); const value = Number(event.target.value); if (event.target.value.trim() !== '' && Number.isFinite(value)) setOffset(Math.max(-600, Math.min(600, value))); }} onBlur={() => setOffsetText(String(offset))}/><em>s</em></label>
    <p className="helper">Pulls the instrument that matches your reference. 16 kHz mono, so output is band-limited.</p>
    {engine && !engine.guidesep && <p className="helper">Update the integration and restart idle ComfyUI to enable GuideSep.</p>}
    {!state?.ready && <details className="sam-preparation" open><summary>Prepare GuideSep</summary>
      <p>Private CUDA runtime plus the public GuideSep v1 checkpoint (about 1 GB, MIT). No account or token needed.</p>
      <label className="sam-consent"><input type="checkbox" checked={consent} disabled={preparing} onChange={event => setConsent(event.target.checked)}/> I approve these downloads. <a href="https://huggingface.co/YutongCooper/GuideSep-v1" target="_blank" rel="noreferrer">Model page</a></label>
      <button className="secondary-button" disabled={!consent || preparing || busy} onClick={() => void prepare()}>Prepare GuideSep</button>
      {preparing && <button className="quiet-button" onClick={() => void window.desktop?.cancelGuideSep()}>Cancel preparation</button>}
    </details>}
    {state?.message && <div className="sam-progress" role="status">{preparing && <LoaderCircle className="spin" size={13}/>} {state.message}{state.detail && <details><summary>Details</summary><pre>{state.detail}</pre></details>}</div>}
    {error && <p className="error-banner" role="alert">{error}</p>}
  </div>;
}
