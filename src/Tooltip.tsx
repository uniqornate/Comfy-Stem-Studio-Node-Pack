import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { pageZoom } from './page-zoom.mjs';

type Tip = { text: string; anchor: DOMRect };
const DELAY = 320;
// Replaces native title tooltips: any element with `title` or `data-tip` gets the themed tooltip instead.
export function TooltipLayer() {
  const [tip, setTip] = useState<Tip | null>(null);
  const [place, setPlace] = useState<{ left: number; top: number; below: boolean } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const current = useRef<Element | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => {
    const hide = () => { window.clearTimeout(timer.current); current.current = null; setTip(null); setPlace(null); };
    const target = (event: Event) => (event.target instanceof Element ? event.target.closest('[title],[data-tip]') : null);
    const arm = (element: Element) => {
      const native = element.getAttribute('title');
      if (native) {
        element.setAttribute('data-tip', native); element.removeAttribute('title');
        if (!element.hasAttribute('aria-label') && !element.textContent?.trim()) element.setAttribute('aria-label', native);
      }
      const text = element.getAttribute('data-tip');
      if (!text || element === current.current) return;
      window.clearTimeout(timer.current); current.current = element;
      timer.current = window.setTimeout(() => { if (current.current === element && element.isConnected) setTip({ text, anchor: element.getBoundingClientRect() }); }, DELAY);
    };
    const over = (event: Event) => { const element = target(event); if (!element) { if (current.current) hide(); return; } if (element !== current.current) { hide(); arm(element); } };
    const out = (event: PointerEvent) => { if (current.current && !current.current.contains(event.relatedTarget as Node | null)) hide(); };
    const focus = (event: FocusEvent) => { const element = target(event); if (element && (event.target as HTMLElement).matches?.(':focus-visible')) { hide(); arm(element); } };
    window.addEventListener('pointerover', over, true); window.addEventListener('pointerout', out, true);
    window.addEventListener('pointerdown', hide, true); window.addEventListener('keydown', hide, true);
    window.addEventListener('scroll', hide, true); window.addEventListener('blur', hide);
    window.addEventListener('focusin', focus, true); window.addEventListener('focusout', hide, true);
    return () => {
      hide();
      window.removeEventListener('pointerover', over, true); window.removeEventListener('pointerout', out, true);
      window.removeEventListener('pointerdown', hide, true); window.removeEventListener('keydown', hide, true);
      window.removeEventListener('scroll', hide, true); window.removeEventListener('blur', hide);
      window.removeEventListener('focusin', focus, true); window.removeEventListener('focusout', hide, true);
    };
  }, []);
  useLayoutEffect(() => {
    if (!tip || !box.current) return;
    const { width, height } = box.current.getBoundingClientRect();
    const margin = 8, center = tip.anchor.left + tip.anchor.width / 2;
    const below = tip.anchor.top - height - 10 < margin;
    // Everything above is in screen pixels; the tooltip's own left and top are scaled by the page zoom.
    const zoom = pageZoom();
    setPlace({ left: Math.max(margin, Math.min(window.innerWidth - width - margin, center - width / 2)) / zoom, top: (below ? Math.min(window.innerHeight - height - margin, tip.anchor.bottom + 10) : tip.anchor.top - height - 10) / zoom, below });
  }, [tip]);
  if (!tip) return null;
  const [heading, ...rest] = tip.text.split('\n');
  return <div ref={box} className={`app-tooltip ${place ? 'is-placed' : ''} ${place?.below ? 'is-below' : ''}`} role="tooltip" style={{ left: place?.left ?? 0, top: place?.top ?? 0 }}><strong>{heading}</strong>{rest.length > 0 && <span>{rest.join(' ')}</span>}</div>;
}
