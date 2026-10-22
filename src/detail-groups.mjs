export function descendants(stems, parentId) {
  const found = new Set();
  const visit = id => { for (const item of stems) if (item.parentId === id && !found.has(item.id)) { found.add(item.id); visit(item.id); } };
  visit(parentId); return found;
}
export function groupedTracks(stems, collapsed = new Set()) {
  const result = []; const seen = new Set();
  const visit = (stem, depth, color) => {
    if (seen.has(stem.id)) return;
    seen.add(stem.id); result.push({ stem, depth, color });
    if (!collapsed.has(stem.id)) for (const child of stems) if (child.parentId === stem.id) visit(child, depth + 1, color);
  };
  stems.filter(item => !item.parentId).forEach((stem, index) => visit(stem, 0, index % 5));
  return result;
}
export function initialMix(stems, previous = {}, independent = false) {
  return Object.fromEntries(stems.map((stem, index) => [stem.id, previous[stem.id] || { mute: !!stem.parentId, solo: independent && index === 0, level: 1 }]));
}
