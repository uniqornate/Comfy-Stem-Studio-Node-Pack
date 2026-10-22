// In a browser the layout scale is CSS `zoom` on the root element (Electron scales the page itself and leaves this at 1).
// Pointer and bounding-box coordinates are in screen pixels, while `left` and `top` of a fixed element are multiplied by the
// zoom, so popups placed from the pointer land far from it unless the coordinates are divided by the zoom first.
export function pageZoom(root = globalThis.document?.documentElement) {
  const value = parseFloat(root?.style?.zoom);
  return Number.isFinite(value) && value > 0 ? value : 1;
}
// Screen pixels to the units a fixed element's left/top use.
export const toCss = (value, zoom = pageZoom()) => value / zoom;
