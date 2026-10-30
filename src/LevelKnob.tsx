import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { knobModifiers } from './modifier-keys.mjs';
import { pageZoom } from './page-zoom.mjs';

const clamp = (value: number) => Math.max(0, Math.min(1, value));
const clampPan = (value: number) => Math.max(-1, Math.min(1, Math.abs(value) < 0.02 ? 0 : value));
const dbText = (value: number) => value <= 0.001 ? '-inf dB' : `${(20 * Math.log10(value)).toFixed(1)} dB`;
const panText = (value: number) => value === 0 ? 'Center' : `${value < 0 ? 'L' : 'R'} ${Math.round(Math.abs(value) * 100)}`;
type Pan = { value: number; onPreview: (value: number) => void; onChange: (value: number) => void };
// A channel's level as a small rotary control. Dragging up or down turns it (Shift for fine steps), the wheel and arrow
// keys nudge it and a double-click returns to unity. While dragging, the sound follows through `onPreview` and the
// timeline is updated once on release, so turning a knob never re-renders the track rows. With Ctrl held the same knob is the
// channel's left/right balance: white ring, a centre mark and L / R letters.
export function LevelKnob({ value, label, onBegin, onPreview, onChange, pan }: { value: number; label: string; onBegin: () => void; onPreview: (value: number) => void; onChange: (value: number) => void; pan?: Pan }) {
  const dial = useRef<HTMLSpanElement>(null), root = useRef<HTMLDivElement>(null), drag = useRef<{ y: number; value: number; pan: boolean; pointerId: number } | null>(null), current = useRef(value), currentPan = useRef(pan?.value ?? 0), frame = useRef<number | null>(null), timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false), [shown, setShown] = useState(value), [shownPan, setShownPan] = useState(pan?.value ?? 0);
  const ctrl = useSyncExternalStore(knobModifiers.subscribe, knobModifiers.getSnapshot, knobModifiers.getServerSnapshot).ctrl, panMode = ctrl && !!pan;
  const callbacks = useRef({ onBegin, onPreview, onChange, pan }); callbacks.current = { onBegin, onPreview, onChange, pan };
  const paint = (mode: boolean) => { if (dial.current) dial.current.style.transform = mode ? `rotate(${currentPan.current * 135}deg)` : `rotate(${-135 + current.current * 270}deg)`; };
  const panValue = pan?.value ?? 0;
  useEffect(() => { if (!drag.current) { current.current = value; currentPan.current = panValue; setShown(value); setShownPan(panValue); paint(panMode); } }, [value, panValue, panMode]);
  const endInteraction = useRef(() => {}), timerPan = useRef(false);
  useEffect(() => {
    const release = () => endInteraction.current(), hidden = () => { if (document.hidden) release(); };
    window.addEventListener('blur',release); document.addEventListener('visibilitychange',hidden);
    return () => { window.removeEventListener('blur',release); document.removeEventListener('visibilitychange',hidden); if (frame.current !== null) cancelAnimationFrame(frame.current); if (timer.current) clearTimeout(timer.current); };
  }, []);
  // Ctrl+wheel would zoom the page; over a knob it sets the balance, which needs a non-passive listener.
  useEffect(() => { const element = root.current; if (!element) return; const stop = (event: WheelEvent) => { if (event.ctrlKey && callbacks.current.pan) event.preventDefault(); }; element.addEventListener('wheel', stop, { passive: false }); return () => element.removeEventListener('wheel', stop); }, []);
  const turn = (next: number, asPan: boolean) => {
    if (asPan) { currentPan.current = clampPan(next); callbacks.current.pan?.onPreview(currentPan.current); } else { current.current = clamp(next); callbacks.current.onPreview(current.current); }
    paint(asPan);
    if (frame.current === null) frame.current = requestAnimationFrame(() => { frame.current = null; setShown(current.current); setShownPan(currentPan.current); });
  };
  const commit = (asPan: boolean) => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } setShown(current.current); setShownPan(currentPan.current); if (asPan) callbacks.current.pan?.onChange(currentPan.current); else callbacks.current.onChange(current.current); };
  const finish = (event: React.PointerEvent<HTMLDivElement>) => { if (!drag.current) return; const asPan = drag.current.pan; drag.current = null; setDragging(false); commit(asPan); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); };
  endInteraction.current = () => {
    const active = drag.current; drag.current = null;
    if (active) { setDragging(false); commit(active.pan); if (root.current?.hasPointerCapture(active.pointerId)) root.current.releasePointerCapture(active.pointerId); }
    else if (timer.current) commit(timerPan.current);
    paint(panMode);
  };
  useEffect(() => { if (drag.current && drag.current.pan !== panMode || timer.current && timerPan.current !== panMode) endInteraction.current(); }, [panMode]);
  const wantsPan = (event: { ctrlKey: boolean }) => event.ctrlKey && !!callbacks.current.pan;
  return <div ref={root} className={`level-knob ${dragging ? 'is-dragging' : ''} ${panMode ? 'is-pan' : ''}`} role="slider" tabIndex={0} aria-label={panMode ? `${label.replace(/ level$/, '')} pan` : label} aria-valuemin={panMode ? -100 : 0} aria-valuemax={100} aria-valuenow={panMode ? Math.round(shownPan * 100) : Math.round(shown * 100)} aria-valuetext={panMode ? panText(shownPan) : dbText(shown)}
    data-tip-live="modifier" data-tip={panMode ? `Pan ${panText(shownPan)}\nDrag up (right) or down (left). Scroll or arrow keys nudge. Double-click to center. Release Ctrl for the level.` : `Level ${dbText(shown)}\nDrag up or down, Shift for fine steps. Scroll or arrow keys nudge. Double-click for unity.${pan ? ' Hold Ctrl to pan left or right.' : ''}`}
    onPointerDown={event => { if (event.button !== 0) return; event.stopPropagation(); const asPan = wantsPan(event); callbacks.current.onBegin(); drag.current = { y: event.clientY, value: asPan ? currentPan.current : current.current, pan: asPan, pointerId: event.pointerId }; setDragging(true); { const box = event.currentTarget.getBoundingClientRect(), zoom = pageZoom(); setAnchor({ x: (box.right + 8) / zoom, y: (box.top + box.height / 2) / zoom }); } event.currentTarget.setPointerCapture(event.pointerId); }}
    onPointerMove={event => { const state = drag.current; if (!state) return; const delta = (state.y - event.clientY) / (event.shiftKey ? 600 : state.pan ? 60 : 120); turn(state.value + delta, state.pan); }} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish}
    onWheel={event => { const asPan = wantsPan(event); if (!timer.current) callbacks.current.onBegin(); turn((asPan ? currentPan.current : current.current) + (event.deltaY < 0 ? (asPan ? .06 : .03) : (asPan ? -.06 : -.03)), asPan); if (timer.current) clearTimeout(timer.current); timerPan.current = asPan; timer.current = setTimeout(() => commit(asPan), 140); }}
    onDoubleClick={event => { event.stopPropagation(); const asPan = wantsPan(event); callbacks.current.onBegin(); turn(asPan ? 0 : 1, asPan); commit(asPan); }}
    onKeyDown={event => { const asPan = wantsPan(event), now = asPan ? currentPan.current : current.current, step = asPan ? .05 : .02; const next = event.key === 'Home' ? (asPan ? -1 : 0) : event.key === 'End' ? 1 : ['ArrowUp', 'ArrowRight'].includes(event.key) ? now + step : ['ArrowDown', 'ArrowLeft'].includes(event.key) ? now - step : null; if (next !== null) { event.preventDefault(); if (!event.repeat) callbacks.current.onBegin(); turn(next, asPan); commit(asPan); } }}>
    <span ref={dial} className="level-dial" style={{ transform: `rotate(${-135 + value * 270}deg)` }}><i/></span>
    {panMode && <><b className="pan-center"/><em className="pan-letter pan-l">L</em><em className="pan-letter pan-r">R</em></>}
    {/* The value card is drawn on the page itself, not inside the row: the row clips what sticks out of it. */}
    {dragging && anchor && createPortal(<output className="knob-readout-float" style={{ left: anchor.x, top: anchor.y }}>{drag.current?.pan || panMode ? panText(shownPan) : dbText(shown)}</output>, document.body)}
  </div>;
}
