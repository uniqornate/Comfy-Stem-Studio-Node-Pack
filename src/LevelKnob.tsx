import { useEffect, useRef, useState } from 'react';

const clamp = (value: number) => Math.max(0, Math.min(1, value));
const dbText = (value: number) => value <= 0.001 ? '-inf dB' : `${(20 * Math.log10(value)).toFixed(1)} dB`;
// A channel's level as a small rotary control. Dragging up or down turns it (Shift for fine steps), the wheel and arrow
// keys nudge it and a double-click returns to unity. While dragging, the sound follows through `onPreview` and the
// timeline is updated once on release, so turning a knob never re-renders the track rows.
export function LevelKnob({ value, label, onBegin, onPreview, onChange }: { value: number; label: string; onBegin: () => void; onPreview: (value: number) => void; onChange: (value: number) => void }) {
  const dial = useRef<HTMLSpanElement>(null), drag = useRef<{ y: number; value: number } | null>(null), current = useRef(value), frame = useRef<number | null>(null), timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [dragging, setDragging] = useState(false), [shown, setShown] = useState(value);
  const callbacks = useRef({ onBegin, onPreview, onChange }); callbacks.current = { onBegin, onPreview, onChange };
  const paint = (next: number) => { if (dial.current) dial.current.style.transform = `rotate(${-135 + next * 270}deg)`; };
  useEffect(() => { if (!drag.current) { current.current = value; setShown(value); paint(value); } }, [value]);
  useEffect(() => () => { if (frame.current !== null) cancelAnimationFrame(frame.current); if (timer.current) clearTimeout(timer.current); }, []);
  const turn = (next: number) => {
    current.current = clamp(next); paint(current.current); callbacks.current.onPreview(current.current);
    if (frame.current === null) frame.current = requestAnimationFrame(() => { frame.current = null; setShown(current.current); });
  };
  const commit = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } setShown(current.current); callbacks.current.onChange(current.current); };
  const finish = (event: React.PointerEvent<HTMLDivElement>) => { if (!drag.current) return; drag.current = null; setDragging(false); commit(); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); };
  return <div className={`level-knob ${dragging ? 'is-dragging' : ''}`} role="slider" tabIndex={0} aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(shown * 100)} aria-valuetext={dbText(shown)} data-tip={`Level ${dbText(shown)}\nDrag up or down, Shift for fine steps. Scroll or arrow keys nudge. Double-click for unity.`}
    onPointerDown={event => { if (event.button !== 0) return; event.stopPropagation(); callbacks.current.onBegin(); drag.current = { y: event.clientY, value: current.current }; setDragging(true); event.currentTarget.setPointerCapture(event.pointerId); }}
    onPointerMove={event => { if (drag.current) turn(drag.current.value + (drag.current.y - event.clientY) / (event.shiftKey ? 600 : 120)); }} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish}
    onWheel={event => { if (!timer.current) callbacks.current.onBegin(); turn(current.current + (event.deltaY < 0 ? .03 : -.03)); if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(commit, 140); }}
    onDoubleClick={event => { event.stopPropagation(); callbacks.current.onBegin(); turn(1); commit(); }}
    onKeyDown={event => { const next = event.key === 'Home' ? 0 : event.key === 'End' ? 1 : ['ArrowUp', 'ArrowRight'].includes(event.key) ? current.current + .02 : ['ArrowDown', 'ArrowLeft'].includes(event.key) ? current.current - .02 : null; if (next !== null) { event.preventDefault(); if (!event.repeat) callbacks.current.onBegin(); turn(next); commit(); } }}>
    <span ref={dial} className="level-dial" style={{ transform: `rotate(${-135 + value * 270}deg)` }}><i/></span>
    {dragging && <output className="knob-readout">{dbText(shown)}</output>}
  </div>;
}
