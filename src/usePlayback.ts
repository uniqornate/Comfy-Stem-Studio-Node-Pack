import { useEffect, useState } from 'react';
import type { MediaTransport, TransportState } from './media-transport.mjs';

const same = (a: TransportState, b: TransportState) => a.duration === b.duration && a.playing === b.playing && a.buffering === b.buffering && a.mode === b.mode && a.error === b.error && a.loopLocked === b.loopLocked && a.selection?.start === b.selection?.start && a.selection?.end === b.selection?.end;
// Everything except the playhead position: re-renders only when something other than time changed.
export function useCoarsePlayback(transport: MediaTransport) {
  const [state, setState] = useState(() => transport.snapshot());
  useEffect(() => transport.subscribe(next => setState(previous => same(previous, next) ? previous : next)), [transport]);
  return state;
}
// Playhead position for small leaf components. Ticks are capped to about 30 updates per second.
export function usePosition(transport: MediaTransport, interval = 33) {
  const [position, setPosition] = useState(() => transport.snapshot().position);
  useEffect(() => {
    let last = 0;
    return transport.subscribe(next => {
      const now = performance.now();
      if (next.playing && now - last < interval) return;
      last = now; setPosition(next.position);
    });
  }, [transport, interval]);
  return position;
}
