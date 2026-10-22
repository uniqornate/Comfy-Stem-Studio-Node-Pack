import { useEffect, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import type { Profile, SAMState } from './types';

type Variant = 'small-tv' | 'large-tv';
export const samPreparing = (sam: SAMState | null) => !!sam && !['idle', 'complete', 'failed', 'cancelled'].includes(sam.phase);
export function useSAMStatus(profile: Profile, variant: Variant) {
  const [sam, setSAM] = useState<SAMState | null>(null);
  useEffect(() => {
    let active = true;
    const poll = () => window.desktop?.samStatus(profile, variant).then(value => { if (active) setSAM(previous => JSON.stringify(previous) === JSON.stringify(value) ? previous : value); }).catch(() => {});
    void poll(); const timer = setInterval(poll, samPreparing(sam) ? 1000 : 5000);
    return () => { active = false; clearInterval(timer); };
  }, [profile.installation, profile.comfyUrl, variant, samPreparing(sam)]);
  return [sam, setSAM] as const;
}
export function SAMVariantSwitch({ variant, setVariant, disabled, largeAvailable, reset }: { variant: Variant; setVariant: (value: Variant) => void; disabled: boolean; largeAvailable: boolean; reset?: () => void }) {
  const choose = (value: Variant) => { if (value !== variant) { setVariant(value); reset?.(); } };
  return <div className="segmented-field"><span>SAM model</span><div className="segmented" role="group" aria-label="SAM model size"><button type="button" aria-pressed={variant === 'small-tv'} disabled={disabled} onClick={() => choose('small-tv')}>Small TV</button><button type="button" aria-pressed={variant === 'large-tv'} disabled={disabled || !largeAvailable} data-tip={largeAvailable ? 'SAM Audio large-tv\nMore accurate, needs more VRAM.' : 'Update the integration to use Large TV.'} onClick={() => choose('large-tv')}>Large TV</button></div></div>;
}
export function SAMPrepare({ sam, setSAM, profile, variant, busy }: { sam: SAMState | null; setSAM: (value: SAMState) => void; profile: Profile; variant: Variant; busy: boolean }) {
  const [token, setToken] = useState(''), [consent, setConsent] = useState(false), [error, setError] = useState('');
  const preparing = samPreparing(sam);
  async function prepare() {
    try { setError(''); const secret = token; setToken(''); setSAM(await window.desktop!.prepareSAM(profile, secret, variant)); } catch (cause) { setError(String(cause)); }
  }
  return <>
    {!sam?.ready && <details className="sam-preparation" open><summary>Prepare SAM Audio</summary><p>Multi-GB private download; your ComfyUI Python stays unchanged. Approve access to <a href={`https://huggingface.co/facebook/sam-audio-${variant}`} target="_blank" rel="noreferrer">SAM Audio</a> and <a href="https://huggingface.co/facebook/pe-av-large" target="_blank" rel="noreferrer">PE-AV</a>, then paste an <a href="https://huggingface.co/settings/tokens" target="_blank" rel="noreferrer">hf_ read token</a> (not a verification code). It is used only for preparation.</p><input type="password" autoComplete="off" spellCheck={false} aria-label="Hugging Face read token" placeholder="hf_… read token" value={token} disabled={preparing} onChange={event => setToken(event.target.value)}/><label className="sam-consent"><input type="checkbox" checked={consent} disabled={preparing} onChange={event => setConsent(event.target.checked)}/> I accept the <a href="https://github.com/facebookresearch/sam-audio/blob/main/LICENSE" target="_blank" rel="noreferrer">SAM license</a> and approve these downloads.</label><button className="secondary-button" disabled={!consent || !token || preparing || busy} onClick={() => void prepare()}>Prepare SAM Audio</button>{preparing && <button className="quiet-button" onClick={() => void window.desktop?.cancelSAM()}>Cancel preparation</button>}</details>}
    {sam?.message && <div className="sam-progress" role="status">{preparing && <LoaderCircle className="spin" size={13}/>} {sam.message}{sam.detail && <details><summary>Details</summary><pre>{sam.detail}</pre></details>}</div>}
    {error && <p className="error-banner" role="alert">{error}</p>}
  </>;
}
