import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { knobModifiers, waveformMode } from './modifier-keys.mjs';
import { knobFromRow, ROW_DEFAULT } from './row-height.mjs';

type Mode = 'wave' | 'row' | 'video';
const MIN: Record<Mode, number> = { wave: .1, row: .1, video: 0 };
const clampTo = (mode: Mode, value: number) => Math.max(MIN[mode], Math.min(1, value));
type Video = { value: number; onChange: (value: number) => void; onPreview?: (value: number) => void };
// One knob, three jobs: the waveform's drawn height; with Alt held the height of the channel rows (yellow ring); and, while the
// preview sits behind the timeline, with Ctrl held the opacity of that video (green ring).
export function WaveformKnob({ value, onChange, onPreview, rowValue, onRowChange, onRowPreview, onSizing, video }: { value: number; onChange: (value: number) => void; onPreview?: (value: number) => void; rowValue: number; onRowChange: (value: number) => void; onRowPreview?: (value: number) => void; onSizing?: (active: boolean) => void; video?: Video }) {
  const drag = useRef<{ y: number; value: number; mode: Mode; pointerId: number } | null>(null);
  const videoValue = video?.value ?? 0.25;
  const current = useRef({ wave: value, row: rowValue, video: videoValue }), frame = useRef<number | null>(null), timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [display, setDisplay] = useState({ wave: value, row: rowValue, video: videoValue });
  const held = useSyncExternalStore(knobModifiers.subscribe, knobModifiers.getSnapshot, knobModifiers.getServerSnapshot);
  const callbacks = useRef({ onChange, onPreview, onRowChange, onRowPreview, onSizing, video }); callbacks.current = { onChange, onPreview, onRowChange, onRowPreview, onSizing, video };
  useEffect(() => { if (!drag.current) { current.current = { wave: value, row: rowValue, video: videoValue }; setDisplay({ wave: value, row: rowValue, video: videoValue }); } }, [value, rowValue, videoValue]);
  const frameMode = useRef<Mode>('wave'), timerMode = useRef<Mode>('wave');
  const endInteraction = useRef(() => {});
  useEffect(() => {
    const release = () => endInteraction.current();
    const hidden = () => { if (document.hidden) release(); };
    window.addEventListener('blur',release); window.addEventListener('pagehide',release); document.addEventListener('visibilitychange',hidden);
    return () => { window.removeEventListener('blur',release); window.removeEventListener('pagehide',release); document.removeEventListener('visibilitychange',hidden); if (frame.current !== null) cancelAnimationFrame(frame.current); if (timer.current) clearTimeout(timer.current); };
  }, []);
  // Ctrl+wheel would zoom the page; over the knob it fades the video instead, which needs a non-passive listener.
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => { const element = root.current; if (!element) return; const stop = (event: WheelEvent) => { if (event.ctrlKey && callbacks.current.video) event.preventDefault(); }; element.addEventListener('wheel', stop, { passive: false }); return () => element.removeEventListener('wheel', stop); }, []);
  // Alt wins over Ctrl; Ctrl only does anything while there is a background video to fade.
  const modeOf = (event: { altKey: boolean; ctrlKey: boolean }): Mode => event.altKey ? 'row' : event.ctrlKey && callbacks.current.video ? 'video' : 'wave';
  const preview = (mode: Mode, next: number) => (mode === 'row' ? callbacks.current.onRowPreview : mode === 'video' ? callbacks.current.video?.onPreview : callbacks.current.onPreview)?.(next);
  const update = (mode: Mode, next: number) => {
    current.current = { ...current.current, [mode]: clampTo(mode, next) };
    frameMode.current = mode;
    if (frame.current === null) frame.current = requestAnimationFrame(() => { frame.current = null; const next = frameMode.current; setDisplay({ ...current.current }); preview(next, current.current[next]); });
  };
  const commit = (mode: Mode) => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } if (frame.current !== null) { cancelAnimationFrame(frame.current); frame.current = null; const next = frameMode.current; setDisplay({ ...current.current }); preview(next, current.current[next]); } if (mode === 'row') callbacks.current.onSizing?.(false); (mode === 'row' ? callbacks.current.onRowChange : mode === 'video' ? callbacks.current.video?.onChange : callbacks.current.onChange)?.(current.current[mode]); };
  const finish = (event: React.PointerEvent<HTMLDivElement>) => { if (!drag.current) return; const { mode } = drag.current; drag.current = null; commit(mode); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); };
  const mode = waveformMode(held, !!video);
  endInteraction.current = () => { const active = drag.current; drag.current = null; if (active) { commit(active.mode); if (root.current?.hasPointerCapture(active.pointerId)) root.current.releasePointerCapture(active.pointerId); } else if (timer.current) commit(timerMode.current); };
  useEffect(() => { if (drag.current && drag.current.mode !== mode || timer.current && timerMode.current !== mode) endInteraction.current(); }, [mode]);
  const shown = display[mode === 'wave' ? 'wave' : mode];
  const fraction = (shown - MIN[mode]) / (1 - MIN[mode]);
  return <div ref={root} className={`waveform-knob ${mode === 'row' ? 'is-row' : mode === 'video' ? 'is-video' : ''}`} role="slider" tabIndex={0} aria-label={mode === 'row' ? 'Channel row height' : mode === 'video' ? 'Background video opacity' : 'Waveform visual height'} aria-valuemin={Math.round(MIN[mode] * 100)} aria-valuemax={100} aria-valuenow={Math.round(shown * 100)} aria-valuetext={mode === 'row' ? 'Height of the channel rows' : mode === 'video' ? `${Math.round(display.video * 100)} percent video opacity` : `${Math.round(display.wave * 90)} percent of clip height. Visual only.`}
    data-tip-live="modifier" data-tip={mode === 'row' ? 'Channel height\nDrag, scroll or use arrow keys while Alt is held. Double-click to reset. Drag the bottom edge of one channel to size just that channel.' : mode === 'video' ? 'Background video opacity\nDrag, scroll or use arrow keys while Ctrl is held. Double-click to reset.' : `Waveform height\nDrag, scroll or use arrow keys. Double-click to reset. Hold Alt to change the channel height instead.${video ? ' Hold Ctrl to fade the background video.' : ''}`}
    onPointerDown={event => { if (event.button !== 0) return; const next = modeOf(event); drag.current = { y: event.clientY, value: current.current[next], mode: next, pointerId: event.pointerId }; if (next === 'row') callbacks.current.onSizing?.(true); event.currentTarget.setPointerCapture(event.pointerId); }}
    onPointerMove={event => { if (drag.current) update(drag.current.mode, drag.current.value + (drag.current.y - event.clientY) / 100); }} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish}
    onWheel={event => { const next = modeOf(event); if (next === 'row') callbacks.current.onSizing?.(true); update(next, current.current[next] + (event.deltaY < 0 ? .05 : -.05)); if (timer.current) clearTimeout(timer.current); timerMode.current = next; timer.current = setTimeout(() => commit(next), 140); }}
    onDoubleClick={event => { const next = modeOf(event); update(next, next === 'row' ? knobFromRow(ROW_DEFAULT) : next === 'video' ? .25 : .7); commit(next); }}
    onKeyDown={event => { const next = modeOf(event), now = current.current[next]; const target = event.key === 'Home' ? MIN[next] : event.key === 'End' ? 1 : ['ArrowUp', 'ArrowRight'].includes(event.key) ? now + .05 : ['ArrowDown', 'ArrowLeft'].includes(event.key) ? now - .05 : null; if (target !== null) { event.preventDefault(); update(next, target); commit(next); } }}>
    <span className="knob-dial" style={{ transform: `rotate(${-135 + fraction * 270}deg)` }}><i/></span>
  </div>;
}
