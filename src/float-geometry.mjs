// Geometry for the floating video preview: proportional resize and free (but never lost) positioning.
export const FLOAT_MIN_WIDTH = 180;
export const FLOAT_VISIBLE = 56;
export function clampFloat(box, viewport, visible = FLOAT_VISIBLE) {
  return {
    ...box,
    left: Math.round(Math.max(visible - box.width, Math.min(viewport.width - visible, box.left))),
    top: Math.round(Math.max(visible - box.height, Math.min(viewport.height - visible, box.top))),
  };
}
// start: { width, height, left, top } when the gesture began; dx, dy: pointer movement since then.
// Corners keep the opposite corner fixed; edges grow or shrink around the box centre on the other axis.
export function resizeFloat({ edge, start, dx, dy, ratio, viewport, minWidth = FLOAT_MIN_WIDTH }) {
  const signX = edge.includes('e') ? 1 : edge.includes('w') ? -1 : 0, signY = edge.includes('s') ? 1 : edge.includes('n') ? -1 : 0;
  const fromX = signX ? start.width + signX * dx : null, fromY = signY ? (start.height + signY * dy) * ratio : null;
  let width = fromX ?? fromY;
  if (fromX !== null && fromY !== null) width = Math.abs(fromX - start.width) >= Math.abs(fromY - start.width) ? fromX : fromY;
  const largest = Math.max(minWidth, Math.min(viewport.width, viewport.height * ratio));
  width = Math.max(minWidth, Math.min(largest, width));
  const height = width / ratio;
  const left = signX < 0 ? start.left + start.width - width : signX > 0 ? start.left : start.left + (start.width - width) / 2;
  const top = signY < 0 ? start.top + start.height - height : signY > 0 ? start.top : start.top + (start.height - height) / 2;
  return clampFloat({ width, height, left, top }, viewport);
}
