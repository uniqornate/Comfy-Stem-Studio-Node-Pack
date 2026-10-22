import { useEffect, useMemo, useRef, useState } from 'react';
import { Copy, X, RotateCcw } from 'lucide-react';
import { BLENDS, GRAIN_DEFAULTS, GRAIN_TILE, cleanGrain, noiseTile, type GrainParams } from './grain.mjs';

const KEY = 'grainSettings';
const load = (): GrainParams => { try { return cleanGrain(JSON.parse(localStorage.getItem(KEY) || 'null') ?? GRAIN_DEFAULTS); } catch { return GRAIN_DEFAULTS; } };
// A fixed layer over the whole window: it takes no pointer input and, unless animation is on, is never repainted.
export function Grain({ params }: { params: GrainParams }) {
  const [tile, setTile] = useState('');
  useEffect(() => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = GRAIN_TILE;
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    ctx.putImageData(new ImageData(noiseTile(params), GRAIN_TILE, GRAIN_TILE), 0, 0); setTile(canvas.toDataURL());
  }, [params.amount, params.mono, params.blend, params.seed]);
  if (!params.on || !tile) return null;
  const size = GRAIN_TILE * params.size;
  return <div className={`grain-layer ${params.animate ? 'is-animated' : ''}`} aria-hidden="true" style={{ backgroundImage: `url(${tile})`, backgroundSize: `${size}px ${size}px`, opacity: params.opacity, mixBlendMode: params.blend as React.CSSProperties['mixBlendMode'], imageRendering: params.size >= 1 ? 'pixelated' : 'auto', ['--grain-step' as string]: `${(10 / params.fps).toFixed(3)}s` }}/>;
}
// Temporary tuning panel: change every grain property live, then copy the numbers once and hand them over to be made permanent.
export function GrainTuner() {
  const [params, setParams] = useState<GrainParams>(load);
  const [open, setOpen] = useState(true), [copied, setCopied] = useState(false);
  const first = useRef(true);
  useEffect(() => { if (first.current) { first.current = false; return; } try { localStorage.setItem(KEY, JSON.stringify(params)); } catch {} }, [params]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.ctrlKey && event.altKey && event.code === 'KeyG') { event.preventDefault(); setOpen(value => !value); } };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, []);
  const set = <K extends keyof GrainParams>(name: K, value: GrainParams[K]) => setParams(previous => cleanGrain({ ...previous, [name]: value }));
  const json = useMemo(() => JSON.stringify({ grain: params }, null, 2), [params]);
  async function copy() {
    try { await navigator.clipboard.writeText(json); } catch { const area = document.createElement('textarea'); area.value = json; document.body.appendChild(area); area.select(); document.execCommand('copy'); area.remove(); }
    setCopied(true); setTimeout(() => setCopied(false), 1500);
  }
  const slider = (name: 'opacity' | 'size' | 'amount' | 'fps' | 'seed', label: string, min: number, max: number, step: number) => <label className="grain-row"><span>{label}</span><input type="range" min={min} max={max} step={step} value={params[name]} onChange={event => set(name, Number(event.target.value))} onPointerUp={event => event.currentTarget.blur()}/><output>{params[name]}</output></label>;
  return <>
    <Grain params={params}/>
    {open && <aside className="grain-tuner" role="group" aria-label="Grain tuner (temporary)">
      <header><strong>Grain tuner</strong><small>temporary · Ctrl+Alt+G</small><button className="icon-button" aria-label="Hide grain tuner" onClick={() => setOpen(false)}><X size={13}/></button></header>
      <label className="grain-row"><span>Grain</span><input type="checkbox" checked={params.on} onChange={event => set('on', event.target.checked)}/></label>
      {slider('opacity', 'Strength', 0, 0.3, 0.005)}
      {slider('amount', 'Contrast', 0, 1, 0.05)}
      {slider('size', 'Grain size', 0.5, 4, 0.25)}
      <label className="grain-row"><span>Blend</span><select value={params.blend} onChange={event => set('blend', event.target.value)}>{BLENDS.map(item => <option key={item} value={item}>{item}</option>)}</select></label>
      <label className="grain-row"><span>Monochrome</span><input type="checkbox" checked={params.mono} onChange={event => set('mono', event.target.checked)}/></label>
      <label className="grain-row"><span>Animate</span><input type="checkbox" checked={params.animate} onChange={event => set('animate', event.target.checked)}/></label>
      {params.animate && slider('fps', 'Frames/s', 1, 24, 1)}
      {slider('seed', 'Pattern', 1, 99, 1)}
      <footer><button className="secondary-button" onClick={() => setParams(GRAIN_DEFAULTS)}><RotateCcw size={12}/> Reset</button><button className="primary-button" onClick={() => void copy()}><Copy size={12}/> {copied ? 'Copied' : 'Copy settings'}</button></footer>
    </aside>}
  </>;
}
