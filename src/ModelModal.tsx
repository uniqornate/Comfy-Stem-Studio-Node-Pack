import { useEffect } from 'react';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';

export function ModelModal({ icon, title, close, children, note, runLabel, runDisabled, run }: { icon: ReactNode; title: string; close: () => void; children: ReactNode; note: string; runLabel: string; runDisabled: boolean; run: () => void }) {
  useEffect(() => { const key = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); }; window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key); }, [close]);
  return <div className="modal-backdrop" onClick={event => { if (event.target === event.currentTarget) close(); }}>
    <section className="connection-modal mini-modal" role="dialog" aria-modal="true" aria-label={title}>
      <header><span className="mini-title">{icon}<strong>{title}</strong></span><button className="icon-button" onClick={close} aria-label="Close"><X size={15}/></button></header>
      <div className="mini-body">{children}</div>
      <footer><span className="subtle" data-tip={note}>{note}</span><button className="primary-button" disabled={runDisabled} onClick={run}>{runLabel}</button></footer>
    </section>
  </div>;
}
