import { useEffect, useRef, useState } from 'react';
import { knobFromRow, ROW_DEFAULT } from './row-height.mjs';

type Mode = 'wave' | 'row';
const clamp = (value: number) => Math.max(.1, Math.min(1, value));
// One knob, two jobs: the waveform's drawn height, or with Alt held the height of the channel rows.
export function WaveformKnob({ value, onChange, onPreview, rowValue, onRowChange, onRowPreview, onSizing }: { value: number; onChange: (value: number) => void; onPreview?: (value: number) => void; rowValue: number; onRowChange: (value: number) => void; onRowPreview?: (value: number) => void; onSizing?: (active: boolean) => void }) {
  const drag = useRef<{ y: number; value: number; mode: Mode } | null>(null);
  const current = useRef({ wave: value, row: rowValue }), frame = useRef<number | null>(null), timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [display, setDisplay] = useState({ wave: value, row: rowValue }), [alt, setAlt] = useState(false);
  const callbacks = useRef({ onChange, onPreview, onRowChange, onRowPreview, onSizing }); callbacks.current = { onChange, onPreview, onRowChange, onRowPreview, onSizing };
  useEffect(() => { if (!drag.current) { current.current = { wave: value, row: rowValue }; setDisplay({ wave: value, row: rowValue }); } }, [value, rowValue]);
  useEffect(() => {
    const track = (event: KeyboardEvent) => setAlt(event.altKey), release = () => setAlt(false);
    window.addEventListener('keydown', track); window.addEventListener('keyup', track); window.addEventListener('blur', release);
    return () => { window.removeEventListener('keydown', track); window.removeEventListener('keyup', track); window.removeEventListener('blur', release); if (frame.current !== null) cancelAnimationFrame(frame.current); if (timer.current) clearTimeout(timer.current); };
  }, []);
  const update = (mode: Mode, next: number) => {
    current.current = { ...current.current, [mode]: clamp(next) };
    if (frame.current === null) frame.current = requestAnimationFrame(() => { frame.current = null; setDisplay({ ...current.current }); (mode === 'row' ? callbacks.current.onRowPreview : callbacks.current.onPreview)?.(current.current[mode]); });
  };
  const commit = (mode: Mode) => { if (timer.current) clearTimeout(timer.current); if (mode === 'row') callbacks.current.onSizing?.(false); (mode === 'row' ? callbacks.current.onRowChange : callbacks.current.onChange)(current.current[mode]); };
  const finish = (event: React.PointerEvent<HTMLDivElement>) => { if (!drag.current) return; const { mode } = drag.current; drag.current = null; commit(mode); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); };
  const shown = alt ? display.row : display.wave;
  return <div className={`waveform-knob ${alt ? 'is-row' : ''}`} role="slider" tabIndex={0} aria-label={alt ? 'Channel row height' : 'Waveform visual height'} aria-valuemin={10} aria-valuemax={100} aria-valuenow={Math.round(shown * 100)} aria-valuetext={alt ? 'Height of the channel rows' : `${Math.round(display.wave * 90)} percent of clip height. Visual only.`}
    data-tip={alt ? 'Channel height\nDrag, scroll or use arrow keys while Alt is held. Double-click to reset. Drag the bottom edge of one channel to size just that channel.' : 'Waveform height\nDrag, scroll or use arrow keys. Double-click to reset. Hold Alt to change the channel height instead.'}
    onPointerDown={event => { if (event.button !== 0) return; const mode: Mode = event.altKey ? 'row' : 'wave'; drag.current = { y: event.clientY, value: current.current[mode], mode }; if (mode === 'row') callbacks.current.onSizing?.(true); event.currentTarget.setPointerCapture(event.pointerId); }}
    onPointerMove={event => { if (drag.current) update(drag.current.mode, drag.current.value + (drag.current.y - event.clientY) / 100); }} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish}
    onWheel={event => { const mode: Mode = event.altKey ? 'row' : 'wave'; if (mode === 'row') callbacks.current.onSizing?.(true); update(mode, current.current[mode] + (event.deltaY < 0 ? .05 : -.05)); if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => commit(mode), 140); }}
    onDoubleClick={event => { const mode: Mode = event.altKey ? 'row' : 'wave'; update(mode, mode === 'row' ? knobFromRow(ROW_DEFAULT) : .7); commit(mode); }}
    onKeyDown={event => { const mode: Mode = event.altKey ? 'row' : 'wave', now = current.current[mode]; const next = event.key === 'Home' ? .1 : event.key === 'End' ? 1 : ['ArrowUp', 'ArrowRight'].includes(event.key) ? now + .05 : ['ArrowDown', 'ArrowLeft'].includes(event.key) ? now - .05 : null; if (next !== null) { event.preventDefault(); update(mode, next); commit(mode); } }}>
    <span className="knob-dial" style={{ transform: `rotate(${-135 + (shown - .1) / .9 * 270}deg)` }}><i/></span>
  </div>;
}
