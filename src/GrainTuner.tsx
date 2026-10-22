import { useEffect, useMemo, useRef, useState } from 'react';
import { Copy, X, RotateCcw } from 'lucide-react';
import { pageZoom } from './page-zoom.mjs';
import { BLENDS, GRAIN_DEFAULTS, GRAIN_TILE, cleanGrain, noiseTile, type GrainParams } from './grain.mjs';

const KEY = 'grainSettings';
const load = (): GrainParams => { try { return cleanGrain(JSON.parse(localStorage.getItem(KEY) || 'null') ?? GRAIN_DEFAULTS); } catch { return GRAIN_DEFAULTS; } };
// Where the video picture is on screen (in page pixels), so the grain can leave it out: the grain is for the interface only.
type Hole = { x: number; y: number; w: number; h: number };
function videoHole(): Hole | null {
  const video = document.querySelector<HTMLVideoElement>('.preview-stage video');
  if (!video || !video.videoWidth || video.closest('.is-external')) return null;
  const zoom = pageZoom(), box = video.getBoundingClientRect();
  if (box.width < 2 || box.height < 2) return null;
  let x = box.left, y = box.top, w = box.width, h = box.height;
  if (getComputedStyle(video).objectFit !== 'cover') { const scale = Math.min(box.width / video.videoWidth, box.height / video.videoHeight); w = video.videoWidth * scale; h = video.videoHeight * scale; x = box.left + (box.width - w) / 2; y = box.top + (box.height - h) / 2; }
  return { x: Math.round(x / zoom), y: Math.round(y / zoom), w: Math.round(w / zoom), h: Math.round(h / zoom) };
}
const same = (a: Hole | null, b: Hole | null) => a === b || (!!a && !!b && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h);
// A fixed layer over the whole window: it takes no pointer input and, unless animation is on, is never repainted. The video
// picture is cut out of it with a clip path (checked ten times a second, and only applied when it moved).
export function Grain({ params }: { params: GrainParams }) {
  const [tile, setTile] = useState('');
  const [hole, setHole] = useState<Hole | null>(null);
  useEffect(() => {
    const measure = () => setHole(previous => { const next = videoHole(); return same(previous, next) ? previous : next; });
    measure(); const timer = setInterval(measure, 100); return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = GRAIN_TILE;
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    ctx.putImageData(new ImageData(noiseTile(params), GRAIN_TILE, GRAIN_TILE), 0, 0); setTile(canvas.toDataURL());
  }, [params.amount, params.mono, params.blend, params.seed]);
  if (!params.on || !tile) return null;
  const size = GRAIN_TILE * params.size;
  const cut = hole ? `polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${hole.x}px ${hole.y}px, ${hole.x + hole.w}px ${hole.y}px, ${hole.x + hole.w}px ${hole.y + hole.h}px, ${hole.x}px ${hole.y + hole.h}px, ${hole.x}px ${hole.y}px)` : 'none';
  return <div className={`grain-layer ${params.animate ? 'is-animated' : ''}`} aria-hidden="true" style={{ opacity: params.opacity, mixBlendMode: params.blend as React.CSSProperties['mixBlendMode'], clipPath: cut, ['--grain-step' as string]: `${(10 / params.fps).toFixed(3)}s` }}><div className="grain-tiles" style={{ backgroundImage: `url(${tile})`, backgroundSize: `${size}px ${size}px`, imageRendering: params.size >= 1 ? 'pixelated' : 'auto' }}/></div>;
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
