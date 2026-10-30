const released = Object.freeze({ alt: false, ctrl: false });

// One capture listener set for all knobs. Focus loss releases both modes;
// pointer flags also repair a key-up lost to an OS menu or a different window.
export function createModifierStore(getTarget, getDocument) {
  let state = released;
  const listeners = new Set();
  let target, doc;
  const set = next => {
    if (state.alt === next.alt && state.ctrl === next.ctrl) return;
    state = Object.freeze(next);
    listeners.forEach(listener => listener());
  };
  const clear = () => set(released);
  const track = event => {
    const up = event.type === 'keyup';
    const alt = event.key === 'Alt' || event.code === 'AltLeft' || event.code === 'AltRight';
    const ctrl = event.key === 'Control' || event.code === 'ControlLeft' || event.code === 'ControlRight';
    set({ alt: alt ? !up : !!event.altKey, ctrl: ctrl ? !up : !!event.ctrlKey });
  };
  const visibility = () => { if (doc?.hidden) clear(); };
  const events = ['keydown', 'keyup', 'pointerdown', 'pointermove', 'pointerup', 'wheel'];
  return {
    getSnapshot: () => state,
    getServerSnapshot: () => released,
    subscribe(listener) {
      listeners.add(listener);
      if (listeners.size === 1) {
        target = getTarget(); doc = getDocument();
        events.forEach(name => target.addEventListener(name, track, true));
        target.addEventListener('blur', clear); target.addEventListener('pagehide', clear);
        doc.addEventListener('visibilitychange', visibility);
      }
      return () => {
        listeners.delete(listener);
        if (!listeners.size) {
          events.forEach(name => target.removeEventListener(name, track, true));
          target.removeEventListener('blur', clear); target.removeEventListener('pagehide', clear);
          doc.removeEventListener('visibilitychange', visibility);
          state = released;
        }
      };
    },
  };
}

export const knobModifiers = createModifierStore(() => window, () => document);
export const waveformMode = (held, hasVideo) => held.alt ? 'row' : held.ctrl && hasVideo ? 'video' : 'wave';
