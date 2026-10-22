import { Fragment, useEffect } from 'react';
import { Keyboard, X } from 'lucide-react';
import { SHORTCUTS } from './shortcuts.mjs';

export function ShortcutsPanel({ close }: { close: () => void }) {
  useEffect(() => { const key = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); }; window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key); }, [close]);
  return <div className="modal-backdrop" onClick={event => { if (event.target === event.currentTarget) close(); }}>
    <section className="connection-modal mini-modal shortcuts-modal" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts">
      <header><span className="mini-title"><Keyboard size={15}/><strong>Shortcuts</strong></span><button className="icon-button" onClick={close} aria-label="Close"><X size={15}/></button></header>
      <div className="shortcut-groups">{SHORTCUTS.map(([group, rows]) => <section key={group}><h3>{group}</h3>{rows.map(([keys, text]) => <div className="shortcut-row" key={keys}>
        <span className="shortcut-keys">{keys.split(' / ').map((combo, index) => <Fragment key={index}>{index > 0 && <i>/</i>}<span className="shortcut-combo">{combo.split('+').map((part, i) => <kbd key={i}>{part}</kbd>)}</span></Fragment>)}</span>
        <span className="shortcut-text">{text}</span>
      </div>)}</section>)}</div>
    </section>
  </div>;
}
