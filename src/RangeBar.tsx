import { useRef } from 'react';

type Anchor = { kind: '+' | '-'; start: number; end: number };
const MIN_SPAN = 0.05;
const round = (value: number) => Math.round(value * 100) / 100;
// A draggable span on a time bar: drag empty space to draw a new span, drag an edge to resize, drag the body to move.
export function RangeBar({ min, max, from, to, anchors = [], onChange }: { min: number; max: number; from: number; to: number; anchors?: Anchor[]; onChange: (from: number, to: number) => void }) {
  const track = useRef<HTMLDivElement>(null);
  const drag = useRef<{ mode: 'new' | 'from' | 'to' | 'move'; anchor: number; from: number; to: number } | null>(null);
  const span = Math.max(max - min, MIN_SPAN), percent = (value: number) => `${Math.max(0, Math.min(100, (value - min) / span * 100))}%`;
  const timeAt = (event: React.PointerEvent) => { const rect = track.current!.getBoundingClientRect(); return min + Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) * span; };
  const set = (a: number, b: number) => { let low = Math.max(min, Math.min(a, b)), high = Math.min(max, Math.max(a, b)); if (high - low < MIN_SPAN) { if (high >= max) low = Math.max(min, high - MIN_SPAN); else high = Math.min(max, low + MIN_SPAN); } onChange(round(low), round(high)); };
  const down = (event: React.PointerEvent, mode: 'new' | 'from' | 'to' | 'move') => {
    if (event.button !== 0) return;
    event.preventDefault(); event.stopPropagation(); track.current!.setPointerCapture(event.pointerId);
    const at = timeAt(event); drag.current = { mode, anchor: at, from, to };
    if (mode === 'new') set(at, at + MIN_SPAN);
  };
  const move = (event: React.PointerEvent) => {
    const state = drag.current; if (!state) return;
    const at = timeAt(event);
    if (state.mode === 'new') set(state.anchor, at);
    else if (state.mode === 'from') set(Math.min(at, state.to - MIN_SPAN), state.to);
    else if (state.mode === 'to') set(state.from, Math.max(at, state.from + MIN_SPAN));
    else { const width = state.to - state.from, low = Math.max(min, Math.min(max - width, state.from + at - state.anchor)); set(low, low + width); }
  };
  const up = (event: React.PointerEvent) => { drag.current = null; if (track.current?.hasPointerCapture(event.pointerId)) track.current.releasePointerCapture(event.pointerId); };
  const nudge = (event: React.KeyboardEvent, edge: 'from' | 'to') => {
    const step = (event.shiftKey ? 0.5 : 0.05) * (event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0);
    if (!step) return; event.preventDefault();
    if (edge === 'from') set(Math.min(from + step, to - MIN_SPAN), to); else set(from, Math.max(to + step, from + MIN_SPAN));
  };
  return <div className="range-bar" ref={track} onPointerDown={event => down(event, 'new')} onPointerMove={move} onPointerUp={up} onPointerCancel={up} role="group" aria-label="Time span">
    {anchors.map((anchor, index) => <i key={index} className={`range-anchor ${anchor.kind === '+' ? 'positive' : 'negative'}`} style={{ left: percent(anchor.start), width: `calc(${percent(anchor.end)} - ${percent(anchor.start)})` }} data-tip={`${anchor.kind === '+' ? 'Sound here' : 'Not here'}\n${anchor.start.toFixed(2)} to ${anchor.end.toFixed(2)} s`}/>)}
    <div className="range-span" style={{ left: percent(from), width: `calc(${percent(to)} - ${percent(from)})` }} onPointerDown={event => down(event, 'move')}>
      <button type="button" className="range-handle range-handle-from" role="slider" aria-label="Span start" aria-valuemin={min} aria-valuemax={to} aria-valuenow={from} onPointerDown={event => down(event, 'from')} onKeyDown={event => nudge(event, 'from')}/>
      <button type="button" className="range-handle range-handle-to" role="slider" aria-label="Span end" aria-valuemin={from} aria-valuemax={max} aria-valuenow={to} onPointerDown={event => down(event, 'to')} onKeyDown={event => nudge(event, 'to')}/>
    </div>
  </div>;
}
