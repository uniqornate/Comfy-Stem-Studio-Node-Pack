import { useEffect, useState } from 'react';
import { pageZoom } from './page-zoom.mjs';
import { GRAIN_DEFAULTS, GRAIN_TILE, noiseTile, type GrainParams } from './grain.mjs';

// Where the video picture is on screen (in page pixels), so the grain can leave it out: the grain is for the interface only.
type Hole = { x: number; y: number; w: number; h: number };
function videoHole(): Hole | null {
  const video = document.querySelector<HTMLVideoElement>('.preview-stage video');
  if (!video || !video.videoWidth || video.closest('.is-external') || video.closest('.is-backdrop')) return null;
  const zoom = pageZoom(), box = video.getBoundingClientRect();
  if (box.width < 2 || box.height < 2) return null;
  let x = box.left, y = box.top, w = box.width, h = box.height;
  if (getComputedStyle(video).objectFit !== 'cover') { const scale = Math.min(box.width / video.videoWidth, box.height / video.videoHeight); w = video.videoWidth * scale; h = video.videoHeight * scale; x = box.left + (box.width - w) / 2; y = box.top + (box.height - h) / 2; }
  return { x: Math.round(x / zoom), y: Math.round(y / zoom), w: Math.round(w / zoom), h: Math.round(h / zoom) };
}
const same = (a: Hole | null, b: Hole | null) => a === b || (!!a && !!b && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h);
// A fixed layer over the whole window: it takes no pointer input and, unless animation is on, is never repainted. The video
// picture is cut out of it with a clip path (checked ten times a second, and only applied when it moved).
export function Grain({ params = GRAIN_DEFAULTS }: { params?: GrainParams }) {
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
