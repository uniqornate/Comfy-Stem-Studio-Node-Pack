import { groupedTracks, descendants } from './detail-groups.mjs';

// User groups: a named header row with member channels under it. A member belongs to one group at most. A group with a
// colour paints its header and every member (detail channels included) in that colour; otherwise they all take the
// colour of the topmost member.
export const GROUP_COLORS = ['#e3ef68', '#b4a3de', '#80cbb7', '#e8b27f', '#87bce3', '#f08fa8', '#9fd36b', '#c9c5cc'];
const HEX = /^#[0-9a-f]{6}$/i;
export function validGroups(groups) {
  return Array.isArray(groups) && groups.length <= 500 && groups.every(group => group && typeof group.id === 'string' && typeof group.name === 'string' && group.name.length <= 160 && Array.isArray(group.members) && group.members.length <= 5000 && group.members.every(id => typeof id === 'string') && (group.color === undefined || group.color === null || (typeof group.color === 'string' && HEX.test(group.color))));
}
export function createGroup(groups, ids, name, color, id) {
  const taken = new Set(ids), kept = groups.map(group => ({ ...group, members: group.members.filter(member => !taken.has(member)) })).filter(group => group.members.length);
  return [...kept, { id, name: name.trim().slice(0, 160) || 'Group', ...(color ? { color } : {}), members: [...taken] }];
}
export const leaveGroups = (groups, ids) => groups.map(group => ({ ...group, members: group.members.filter(id => !ids.includes(id)) })).filter(group => group.members.length);
export const ungroup = (groups, id) => groups.filter(group => group.id !== id);
export const recolorGroup = (groups, id, color) => groups.map(group => { if (group.id !== id) return group; const { color: _drop, ...rest } = group; return color ? { ...rest, color } : rest; });
export const renameGroup = (groups, id, name) => groups.map(group => group.id === id ? { ...group, name: name.trim().slice(0, 160) || group.name } : group);
// Drops members that no longer exist; a group left empty disappears. Returns the same array when nothing changed.
export function pruneGroups(groups, stems) {
  const live = new Set(stems.map(stem => stem.id));
  const next = groups.map(group => group.members.every(id => live.has(id)) ? group : { ...group, members: group.members.filter(id => live.has(id)) }).filter(group => group.members.length);
  return next.length === groups.length && next.every((group, index) => group === groups[index]) ? groups : next;
}
// Rows in display order. A group row is { group, depth: 0, color, hex, count } (no stem); its members follow one level
// deeper unless the group is collapsed. Channel rows carry `groupId` and, when the group has a colour, `hex`.
export function arrangeRows(stems, groups = [], collapsed = new Set()) {
  const base = groupedTracks(stems, new Set());
  const owner = new Map();
  for (const group of groups) for (const id of group.members) if (!owner.has(id)) owner.set(id, group.id);
  const block = new Map();
  for (const group of groups) {
    const ids = new Set(group.members.filter(id => owner.get(id) === group.id));
    for (const id of [...ids]) for (const child of descendants(stems, id)) if (!owner.has(child)) ids.add(child);
    block.set(group.id, ids);
  }
  const rows = [], placed = new Set(), byId = new Map(groups.map(group => [group.id, group]));
  for (const row of base) {
    const groupId = [...block].find(([, ids]) => ids.has(row.stem.id))?.[0];
    if (!groupId) { rows.push(row); continue; }
    if (placed.has(groupId)) continue;
    placed.add(groupId);
    const group = byId.get(groupId), members = base.filter(item => block.get(groupId).has(item.stem.id));
    const top = members[0].color, hex = group.color || undefined;
    rows.push({ group, depth: 0, color: top, hex, count: members.length });
    if (!collapsed.has(group.id)) for (const member of members) rows.push({ ...member, depth: member.depth + 1, color: top, groupId, hex });
  }
  // A collapsed detail parent hides its children; groups do not change that.
  const hidden = new Set(); for (const id of collapsed) for (const child of descendants(stems, id)) hidden.add(child);
  return rows.filter(row => row.group || !hidden.has(row.stem.id));
}
