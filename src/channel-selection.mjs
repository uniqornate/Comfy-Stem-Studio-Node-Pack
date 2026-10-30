// Channel headers use Shift for a visible-row range; waveform lanes use Shift for a time range.
export function pickChannelSelection(order, selected, anchor, id, modifiers = {}) {
  if (!order.includes(id)) return { selected: new Set(selected), anchor };
  const visible = new Set(order);
  const previous = new Set([...selected].filter(item => visible.has(item)));
  const start = previous.has(anchor) && visible.has(anchor) ? anchor : order.find(item => previous.has(item)) || '';
  if (modifiers.shift && start) {
    const from = order.indexOf(start), to = order.indexOf(id);
    const range = order.slice(Math.min(from, to), Math.max(from, to) + 1);
    return { selected: new Set(modifiers.toggle ? [...previous, ...range] : range), anchor: start };
  }
  if (modifiers.toggle) {
    previous.has(id) ? previous.delete(id) : previous.add(id);
    return { selected: previous, anchor: previous.size ? id : '' };
  }
  return { selected: new Set([id]), anchor: id };
}
