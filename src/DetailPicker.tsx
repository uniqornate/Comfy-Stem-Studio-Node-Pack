import { useEffect, useState } from 'react';
import { X, Crosshair, Scissors } from 'lucide-react';
import type { Engine, Profile, Stem, SAMGuidance, ReferenceAudio } from './types';
import { GuideSepPanel, guidesepPreparing, useGuideSepStatus } from './GuideSepPanel';
import { SAMGuidanceEditor } from './SAMGuidanceEditor';
import { SAMPrepare, SAMVariantSwitch, samPreparing, useSAMStatus } from './SAMPrepare';
import { normalizeGuidance } from './sam-guidance.mjs';
import { TargetPicker } from './TargetPicker';
import { MODELS } from './models.mjs';
export type DetailRequest = { stem: Stem; start: number; end: number };
const SEPARATORS = MODELS.filter(model => model.kind === 'stems');
// Two ways to dig into a channel (or into the range chosen on it): "Yolo" runs one of the classic separators again, with nothing to
// type or pick; "Targeted" pulls one named, described or hummed sound. The dialog keeps one size on every page.
export function DetailPicker({ request, profile, engine, busy, close, extract, submitShortcut, sourceUrl, variant, setVariant, reference, setReference, referenceOffset, setReferenceOffset }: { reference: ReferenceAudio | null; setReference: (value: ReferenceAudio | null) => void; referenceOffset: number; setReferenceOffset: (value: number) => void; variant: 'small-tv' | 'large-tv'; setVariant: (variant:'small-tv'|'large-tv') => void; request: DetailRequest; profile: Profile; engine: Engine | null; busy: boolean; close: () => void; extract: (mode: 'uss' | 'sam' | 'guidesep' | 'stems', target: string, guidance?: SAMGuidance, reference?: ReferenceAudio, model?: string) => void; sourceUrl: string; submitShortcut: { current: () => void } }) {
  const [page, setPage] = useState<'yolo' | 'targeted'>('yolo');
  const [mode, setMode] = useState<'uss' | 'sam' | 'guidesep'>('sam');
  const [separator, setSeparator] = useState('mrx');
  const [guide, setGuide] = useGuideSepStatus(profile);
  const [target, setTarget] = useState('Walk, footsteps');
  const [guidance, setGuidance] = useState<SAMGuidance>({});
  const [sam, setSAM] = useSAMStatus(profile, variant);
  const preparing = samPreparing(sam) || guidesepPreparing(guide);
  useEffect(() => { const key = (event: KeyboardEvent) => { if (event.key === 'Escape' && !preparing) close(); }; window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key); }, [close, preparing]);
  let guidanceError = ''; try { if (page === 'targeted' && mode === 'sam') normalizeGuidance(guidance, request); } catch (cause) { guidanceError = String(cause); }
  const installed = (id: string) => !engine?.models || engine.models.includes(id);
  const separatorName = SEPARATORS.find(model => model.id === separator)?.name || separator;
  const chosen = page === 'yolo' ? separatorName : mode === 'guidesep' ? (reference?.name.replace(/\.[^.]+$/, '') || 'Reference') : mode === 'sam' ? guidance.visualOnly ? 'Visual target' : guidance.description?.trim() || target : target;
  const submit = () => page === 'yolo' ? extract('stems', separatorName, undefined, undefined, separator) : extract(mode, chosen, mode === 'sam' ? guidance : undefined, mode === 'guidesep' ? reference || undefined : undefined);
  const available = !!engine?.detailRange && (page === 'yolo' ? installed(separator) : !guidanceError && (mode === 'sam' ? !!engine?.sam && !!engine?.samPrompts && !!sam?.ready : mode === 'guidesep' ? !!engine?.guidesep && !!guide?.ready && !!reference : !!engine?.targets?.includes(target)));
  useEffect(() => { submitShortcut.current = () => { if (available && !busy && !preparing) submit(); }; return () => { submitShortcut.current = () => {}; }; }, [available, busy, preparing, page, mode, separator, target, guidance, reference, extract, submitShortcut]);
  return <div className="modal-backdrop"><section className="connection-modal detail-picker" role="dialog" aria-modal="true" aria-labelledby="detail-title">
    <div className="modal-top"><span className="eyebrow"><Crosshair size={14}/> CHANNEL EXTRACTION</span><button className="icon-button" onClick={close} disabled={preparing} aria-label="Close target picker"><X size={17}/></button></div>
    <h2 id="detail-title">Extract sound</h2><p className="detail-region">{request.stem.label} <span>{request.start.toFixed(2)}s → {request.end.toFixed(2)}s</span></p>
    <div className="detail-tabs" role="tablist" aria-label="Extraction kind"><button role="tab" aria-selected={page === 'yolo'} className={page === 'yolo' ? 'is-selected' : ''} disabled={preparing} onClick={() => setPage('yolo')}><Scissors size={13}/> Yolo <small>classic separators, no prompt</small></button><button role="tab" aria-selected={page === 'targeted'} className={page === 'targeted' ? 'is-selected' : ''} disabled={preparing} onClick={() => setPage('targeted')}><Crosshair size={13}/> Targeted <small>SAM · USS · GuideSep</small></button></div>
    <div className="detail-body">
      {page === 'yolo' ? <>
        <div className="detail-models" role="group" aria-label="Separator model">{SEPARATORS.map(model => <button key={model.id} aria-pressed={separator === model.id} disabled={busy} onClick={() => setSeparator(model.id)} data-tip={`${model.name}\n${installed(model.id) ? model.detail : 'Not installed yet. Select it in setup and restart ComfyUI.'}`}>{model.short} <small>{installed(model.id) ? model.name.split(' · ')[0] : 'not installed'}</small></button>)}</div>
        <p className="helper detail-note">Splits this channel (or the range above) into dialogue, music and effects again, with nothing to type or pick. If the first model leaves leaks behind, run another one on the same channel: the new channels nest under it in its color.</p>
        {!installed(separator) && <p className="error-banner" role="alert">This model is not installed. Select it in setup and restart ComfyUI.</p>}
      </> : <>
        <div className="detail-models" role="group" aria-label="Detail model"><button aria-pressed={mode === 'sam'} onClick={() => setMode('sam')}>SAM Audio <small>{variant} · experimental</small></button><button aria-pressed={mode === 'uss'} onClick={() => setMode('uss')}>USS <small>AudioSet classes</small></button><button aria-pressed={mode === 'guidesep'} onClick={() => setMode('guidesep')}>GuideSep <small>music · reference sound</small></button></div>
        {mode === 'sam' && <SAMVariantSwitch variant={variant} setVariant={setVariant} disabled={preparing || busy} largeAvailable={!!engine?.samModels} reset={() => setSAM(null)}/>}
        {mode !== 'guidesep' && <TargetPicker target={target} setTarget={setTarget}/>}
        {mode === 'sam' && <SAMGuidanceEditor range={request} sourceUrl={sourceUrl} value={guidance} change={setGuidance} supported={!!engine?.samPrompts} visualSupported={!!engine?.samVisual}/>}
        {mode === 'guidesep' && <GuideSepPanel profile={profile} engine={engine} state={guide} setState={setGuide} reference={reference} setReference={setReference} offset={referenceOffset} setOffset={setReferenceOffset} busy={busy}/>}
        {guidanceError && <p className="error-banner" role="alert">{guidanceError}</p>}
        {mode === 'sam' && <SAMPrepare sam={sam} setSAM={setSAM} profile={profile} variant={variant} busy={busy}/>}
      </>}
      {!engine?.detailRange && <p className="helper">Update the integration with the latest installer and restart idle ComfyUI.</p>}
    </div>
    <div className="modal-actions"><span className="subtle" title={chosen}>{chosen}</span><button className="primary-button" disabled={busy || preparing || !available} onClick={submit}><Crosshair size={15}/> Extract</button></div>
  </section></div>;
}
