export function pointerTime(clientX, left, width, duration) {
  if (![clientX, left, width, duration].every(Number.isFinite) || width <= 0 || duration <= 0) return 0;
  return Math.max(0, Math.min(1, (clientX - left) / width)) * duration;
}
export function workspaceTop(height, proposed) {
  const maximum = Math.max(0, height - 220), minimum = Math.min(252, maximum);
  return Math.max(minimum, Math.min(maximum, proposed));
}
