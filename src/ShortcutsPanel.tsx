import { Fragment, useEffect, useState } from 'react';
import { CircleHelp, X } from 'lucide-react';
import { SHORTCUTS } from './shortcuts.mjs';
import { MODEL_INFO, formatBytes } from './model-info.mjs';
import type { Usage } from './usage.mjs';

const TONES = ['#f2ff59', '#b4a3de', '#80cbb7', '#e8b27f', '#87bce3', '#c2bfb9'];
const gib = (bytes: number | null) => bytes === null ? 'n/a' : `${(bytes / 1073741824).toFixed(1)} GB`;
const duration = (seconds: number) => seconds >= 60 ? `${Math.floor(seconds / 60)} min ${seconds % 60} s` : `${seconds} s`;

// Mouse words become a small mouse drawn in the group colour with the pressed button filled in (plain SVG, no icon package).
const MOUSE = /^(Right-click|Double-click|Middle-drag|Click|Drag|Wheel)(.*)$/;
const MOUSE_WORD: Record<string, { button: 'left' | 'right' | 'middle' | 'wheel'; word: string }> = { 'Right-click': { button: 'right', word: 'Click' }, 'Double-click': { button: 'left', word: 'Double-click' }, 'Middle-drag': { button: 'middle', word: 'Drag' }, Click: { button: 'left', word: 'Click' }, Drag: { button: 'left', word: 'Drag' }, Wheel: { button: 'wheel', word: 'Wheel' } };
function Mouse({ button }: { button: 'left' | 'right' | 'middle' | 'wheel' }) {
  return <svg className="mouse-icon" viewBox="0 0 14 18" width="10" height="13" aria-hidden="true">
    {button === 'left' && <path d="M7 1.5H6a4.5 4.5 0 0 0-4.5 4.5v1.5H7z" fill="currentColor"/>}
    {button === 'right' && <path d="M7 1.5h1A4.5 4.5 0 0 1 12.5 6v1.5H7z" fill="currentColor"/>}
    {(button === 'middle' || button === 'wheel') && <rect x="5.6" y="2.6" width="2.8" height="5" rx="1.4" fill="currentColor"/>}
    <rect x="1" y="1" width="12" height="16" rx="6" fill="none" stroke="currentColor" strokeWidth="1.2" opacity=".75"/><path d="M1.6 7.5h10.8M7 1.2v3" fill="none" stroke="currentColor" strokeWidth="1" opacity=".6"/>
    {button === 'wheel' && <path d="M7 .2l1.3 1.1H5.7zM7 8.9L5.7 7.8h2.6z" fill="currentColor" transform="translate(0 .5)"/>}
  </svg>;
}
function Key({ part }: { part: string }) {
  const found = MOUSE.exec(part);
  if (!found) return <kbd>{part}</kbd>;
  const { button, word } = MOUSE_WORD[found[1]];
  return <kbd className="is-mouse"><Mouse button={button}/>{word}{found[2]}</kbd>;
}
function Shortcuts() {
  return <div className="shortcut-groups">{SHORTCUTS.map(([group, rows], index) => <section key={group} className="shortcut-group" style={{ '--tone': TONES[index % TONES.length] } as React.CSSProperties}><h3>{group}</h3>{rows.map(([keys, text]) => <div className="shortcut-row" key={keys}>
    <span className="shortcut-keys">{keys.split(' / ').map((combo, i) => <Fragment key={i}>{i > 0 && <i>/</i>}<span className="shortcut-combo">{combo.split('+').map((part, j) => <Key key={j} part={part}/>)}</span></Fragment>)}</span>
    <span className="shortcut-text">{text}</span>
  </div>)}</section>)}</div>;
}
// Disk sizes are the exact pinned downloads. The measured line is what this PC actually used the last time the model ran
// in this app: the increase of VRAM and RAM over what was already in use when the job started, and the highest CPU load.
function Models({ usage }: { usage: Record<string, Usage> }) {
  return <div className="model-info">
    <p className="model-info-note">Memory use depends on your GPU, driver and the length of the source, so it is measured here instead of guessed. Run a model once and its peak appears under it. Other programs on the same PC add to these numbers.</p>
    <div className="model-cards">{MODEL_INFO.map((row, index) => {
      const seen = usage[row.key];
      return <article key={row.key} className="model-card" style={{ '--tone': TONES[index % TONES.length] } as React.CSSProperties}>
        <header><strong>{row.name}</strong><small>{row.role}</small></header>
        <dl>
          <div><dt>On disk</dt><dd data-tip={row.diskNote}>{row.disk ? formatBytes(row.disk) : 'See note'}</dd></div>
          <div><dt>Runs on</dt><dd>{row.runs}</dd></div>
          <div><dt>Works in</dt><dd>{row.work}</dd></div>
          <div><dt>License</dt><dd>{row.license}</dd></div>
        </dl>
        {row.diskNote && !row.disk && <p className="model-card-note">{row.diskNote}</p>}
        <div className={`model-measured ${seen ? '' : 'is-empty'}`}>{seen
          ? <><span><b>VRAM</b> +{gib(seen.vram)}</span><span><b>RAM</b> +{gib(seen.ram)}</span><span><b>CPU</b> {seen.cpu === null ? 'n/a' : `${Math.round(seen.cpu)}%`}</span><span><b>Time</b> {duration(seen.seconds)}</span></>
          : <span>Not run on this PC yet</span>}</div>
      </article>;
    })}</div>
  </div>;
}
export function ShortcutsPanel({ close, usage }: { close: () => void; usage: Record<string, Usage> }) {
  const [tab, setTab] = useState<'shortcuts' | 'models'>('shortcuts');
  useEffect(() => { const key = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); }; window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key); }, [close]);
  return <div className="modal-backdrop" onClick={event => { if (event.target === event.currentTarget) close(); }}>
    <section className={`connection-modal mini-modal shortcuts-modal ${tab === 'models' ? 'is-wide' : ''}`} role="dialog" aria-modal="true" aria-label="Shortcuts and models">
      <header><span className="mini-title"><CircleHelp size={15}/><strong>Help</strong></span>
        <div className="mode-tabs" role="tablist" aria-label="Help pages"><button role="tab" aria-selected={tab === 'shortcuts'} className={tab === 'shortcuts' ? 'is-selected' : ''} onClick={() => setTab('shortcuts')}>Shortcuts</button><button role="tab" aria-selected={tab === 'models'} className={tab === 'models' ? 'is-selected' : ''} onClick={() => setTab('models')}>Models</button></div>
        <button className="icon-button" onClick={close} aria-label="Close"><X size={15}/></button></header>
      {tab === 'shortcuts' ? <Shortcuts/> : <Models usage={usage}/>}
    </section>
  </div>;
}
