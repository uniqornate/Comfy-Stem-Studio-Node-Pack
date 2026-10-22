import { useEffect, useState } from 'react';
import { Check, FolderOpen, LoaderCircle, Minus, Play, Plus, X } from 'lucide-react';
import type { BatchFile, BatchOptions, BatchState, Profile } from './types';

const icon = (status: string) => status === 'done' ? <Check size={12}/> : status === 'running' ? <LoaderCircle size={12} className="spin"/> : status === 'failed' ? <X size={12}/> : status === 'skipped' ? <Minus size={12}/> : <span className="batch-dot"/>;
const running = (state: BatchState | null) => state?.phase === 'running';
// The batch tab of the Separator panel: the model chosen above is run on many files, one after another.
export function BatchPanel({ profile, options, label, blocked }: { profile: Profile; options: BatchOptions | null; label: string; blocked: string }) {
  const [files, setFiles] = useState<BatchFile[]>([]), [folder, setFolder] = useState(''), [state, setState] = useState<BatchState | null>(null), [error, setError] = useState('');
  const active = running(state), shown = state && state.items.length ? state.items : files.map(file => ({ name: file.name, status: 'queued', message: '', folder: '' }));
  useEffect(() => { void window.desktop?.batchStatus().then(value => { if (value.phase !== 'idle') { setState(value); setFolder(value.folder); } }).catch(() => {}); }, []);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => { void window.desktop?.batchStatus().then(setState).catch(() => {}); }, 1000);
    return () => clearInterval(timer);
  }, [active]);
  async function choose(kind: 'files' | 'folder') {
    try { setError(''); if (kind === 'files') { const picked = await window.desktop!.chooseBatchFiles(); if (picked.length) { setFiles(picked); setState(null); } } else { const picked = await window.desktop!.chooseBatchFolder(); if (picked) setFolder(picked); } }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }
  async function start() { try { setError(''); setState(await window.desktop!.startBatch(profile, files, options!)); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); } }
  const done = state ? state.items.filter(item => ['done', 'failed', 'skipped'].includes(item.status)).length : 0;
  const finished = state && !active && state.phase !== 'idle';
  const hint = blocked || (!files.length ? 'Add the files to process' : !folder ? 'Choose where to save the results' : '');
  return <div className="batch-panel">
    <p className="batch-model" data-tip="Pick the model with the tiles above.">{label}</p>
    <div className="batch-actions">
      <button className="secondary-button" disabled={active} onClick={() => void choose('files')}><Plus size={13}/> {files.length ? `${files.length} files` : 'Add files'}</button>
      <button className="secondary-button" disabled={active} onClick={() => void choose('folder')} data-tip={folder || 'Output folder'}><FolderOpen size={13}/><span>{folder ? folder.split(/[\\/]/).pop() : 'Output folder'}</span></button>
    </div>
    <ul className="batch-list" aria-label="Files">{shown.slice(0, 7).map((item, index) => <li key={index} className={`is-${item.status}`} data-tip={item.message || item.folder || item.name}>{icon(item.status)}<span>{item.name}</span></li>)}{shown.length > 7 && <li className="batch-more">+{shown.length - 7} more</li>}{!shown.length && <li className="batch-more">One folder per file, named after the file and model.</li>}</ul>
    {active && state && <div className="batch-progress" role="progressbar" aria-label="Batch progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(done / state.items.length * 100)} data-tip={`File ${Math.min(done + 1, state.items.length)} of ${state.items.length}`}><i style={{ transform: `scaleX(${Math.max(0.02, done / state.items.length)})` }}/></div>}
    {finished && <p className="helper" role="status">{state.items.filter(item => item.status === 'done').length} of {state.items.length} done{state.items.some(item => item.status === 'failed') ? '. Hover a failed file for the reason.' : ''}</p>}
    {error && <p className="error-banner" role="alert">{error}</p>}
    {active ? <button className="primary-button batch-start" onClick={() => void window.desktop?.cancelBatch().then(setState)}><X size={15}/> Cancel batch</button> : <button className="primary-button batch-start" disabled={!!hint || !options} onClick={() => void start()} data-tip={hint || undefined}><Play size={15}/> Start batch</button>}
  </div>;
}
