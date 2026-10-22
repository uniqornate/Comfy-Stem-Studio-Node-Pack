export const emptyHistory = () => ({ past: [], future: [] });
export function record(history, snapshot, limit = 100) {
  return { past: [...history.past, snapshot].slice(-limit), future: [] };
}
export function undo(history, current) {
  if (!history.past.length) return null;
  return { state: history.past.at(-1), history: { past: history.past.slice(0, -1), future: [current, ...history.future] } };
}
export function redo(history, current) {
  if (!history.future.length) return null;
  return { state: history.future[0], history: { past: [...history.past, current], future: history.future.slice(1) } };
}
