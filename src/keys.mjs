// Which keystrokes belong to the page and which to the control that has focus.
const TEXT_INPUTS = new Set(['text', 'search', 'number', 'password', 'email', 'url', 'tel', '']);
export function isTypingTarget(target) {
  if (!target) return false;
  const tag = String(target.tagName || '').toUpperCase();
  if (tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable) return true;
  return tag === 'INPUT' && TEXT_INPUTS.has(String(target.type || '').toLowerCase());
}
// Space toggles playback only on the workspace itself: never while typing, and never while a dialog is open.
export function playbackKeyApplies({ target, modalOpen }) { return !modalOpen && !isTypingTarget(target); }
// The shortcut list opens with ? unless something is being typed; with a dialog open it only closes itself.
export function helpKeyApplies({ target, modalOpen, helpOpen }) { return !isTypingTarget(target) && (!modalOpen || helpOpen); }
