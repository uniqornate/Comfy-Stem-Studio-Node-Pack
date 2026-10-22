import { useEffect, useState } from 'react';
import { X, Crosshair } from 'lucide-react';
import type { Engine, Profile, Stem, SAMGuidance, ReferenceAudio } from './types';
import { GuideSepPanel, guidesepPreparing, useGuideSepStatus } from './GuideSepPanel';
import { SAMGuidanceEditor } from './SAMGuidanceEditor';
import { SAMPrepare, SAMVariantSwitch, samPreparing, useSAMStatus } from './SAMPrepare';
import { normalizeGuidance } from './sam-guidance.mjs';
import { TargetPicker } from './TargetPicker';
export type DetailRequest = { stem: Stem; start: number; end: number };
export function DetailPicker({ request, profile, engine, busy, close, extract, submitShortcut, sourceUrl, variant, setVariant, reference, setReference, referenceOffset, setReferenceOffset }: { reference: ReferenceAudio | null; setReference: (value: ReferenceAudio | null) => void; referenceOffset: number; setReferenceOffset: (value: number) => void; variant: 'small-tv' | 'large-tv'; setVariant: (variant:'small-tv'|'large-tv') => void; request: DetailRequest; profile: Profile; engine: Engine | null; busy: boolean; close: () => void; extract: (mode: 'uss' | 'sam' | 'guidesep', target: string, guidance?: SAMGuidance, reference?: ReferenceAudio) => void; sourceUrl: string; submitShortcut: { current: () => void } }) {
  const [mode, setMode] = useState<'uss' | 'sam' | 'guidesep'>('sam');
  const [guide, setGuide] = useGuideSepStatus(profile);
  const [target, setTarget] = useState('Walk, footsteps');
  const [guidance, setGuidance] = useState<SAMGuidance>({});
  const [sam, setSAM] = useSAMStatus(profile, variant);
  const preparing = samPreparing(sam) || guidesepPreparing(guide);
  useEffect(() => { const key = (event: KeyboardEvent) => { if (event.key === 'Escape' && !preparing) close(); }; window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key); }, [close, preparing]);
  let guidanceError = ''; try { if (mode === 'sam') normalizeGuidance(guidance, request); } catch (cause) { guidanceError = String(cause); }
  const chosen = mode === 'guidesep' ? (reference?.name.replace(/\.[^.]+$/, '') || 'Reference') : mode === 'sam' ? guidance.visualOnly ? 'Visual target' : guidance.description?.trim() || target : target;
  const submit = () => extract(mode, chosen, mode === 'sam' ? guidance : undefined, mode === 'guidesep' ? reference || undefined : undefined);
  const available = !guidanceError && !!engine?.detailRange && (mode === 'sam' ? !!engine?.sam && !!engine?.samPrompts && !!sam?.ready : mode === 'guidesep' ? !!engine?.guidesep && !!guide?.ready && !!reference : !!engine?.targets?.includes(target));
  useEffect(() => { submitShortcut.current = () => { if (available && !busy && !preparing) submit(); }; return () => { submitShortcut.current = () => {}; }; }, [available, busy, preparing, mode, target, guidance, reference, extract, submitShortcut]);
  return <div className="modal-backdrop"><section className="connection-modal detail-picker" role="dialog" aria-modal="true" aria-labelledby="detail-title">
    <div className="modal-top"><span className="eyebrow"><Crosshair size={14}/> CHANNEL EXTRACTION</span><button className="icon-button" onClick={close} disabled={preparing} aria-label="Close target picker"><X size={17}/></button></div>
    <h2 id="detail-title">Extract sound</h2><p className="detail-region">{request.stem.label} <span>{request.start.toFixed(2)}s → {request.end.toFixed(2)}s</span></p>
    <div className="detail-models" role="group" aria-label="Detail model"><button aria-pressed={mode === 'sam'} onClick={() => setMode('sam')}>SAM Audio <small>{variant} · experimental</small></button><button aria-pressed={mode === 'uss'} onClick={() => setMode('uss')}>USS <small>AudioSet classes</small></button><button aria-pressed={mode === 'guidesep'} onClick={() => setMode('guidesep')}>GuideSep <small>music · reference sound</small></button></div>
    {mode === 'sam' && <SAMVariantSwitch variant={variant} setVariant={setVariant} disabled={preparing || busy} largeAvailable={!!engine?.samModels} reset={() => setSAM(null)}/>}
    {mode !== 'guidesep' && <>
    <TargetPicker target={target} setTarget={setTarget}/>
    </>}
    {mode === 'sam' && <SAMGuidanceEditor range={request} sourceUrl={sourceUrl} value={guidance} change={setGuidance} supported={!!engine?.samPrompts} visualSupported={!!engine?.samVisual}/>}
    {mode === 'guidesep' && <GuideSepPanel profile={profile} engine={engine} state={guide} setState={setGuide} reference={reference} setReference={setReference} offset={referenceOffset} setOffset={setReferenceOffset} busy={busy}/>}
    {guidanceError && <p className="error-banner" role="alert">{guidanceError}</p>}
    {mode === 'sam' && <SAMPrepare sam={sam} setSAM={setSAM} profile={profile} variant={variant} busy={busy}/>}
    {!engine?.detailRange && <p className="helper">Update the integration with the latest installer and restart idle ComfyUI.</p>}
    <div className="modal-actions"><span className="subtle" title={chosen}>{chosen}</span><button className="primary-button" disabled={busy || preparing || !available} onClick={submit}><Crosshair size={15}/> Extract</button></div>
  </section></div>;
}
