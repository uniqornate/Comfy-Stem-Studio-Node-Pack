import test from 'node:test';
import assert from 'node:assert/strict';
import { createGroup, ungroup, recolorGroup, renameGroup, pruneGroups, arrangeRows, validGroups } from '../src/channel-groups.mjs';
const stems = [{ id: 'a' }, { id: 'b' }, { id: 'c', parentId: 'b' }, { id: 'd' }, { id: 'e' }];
test('a group puts a header over its members and their detail channels', () => {
  const groups = createGroup([], ['b', 'd'], ' Drums ', null, 'g1');
  const rows = arrangeRows(stems, groups);
  assert.deepEqual(rows.map(row => row.group ? `#${row.group.name}` : row.stem.id), ['a', '#Drums', 'b', 'c', 'd', 'e']);
  assert.deepEqual(rows.map(row => row.depth), [0, 0, 1, 2, 1, 0]);
});
test('uncoloured groups use the topmost member colour, coloured ones paint everything', () => {
  let groups = createGroup([], ['b', 'd'], 'G', null, 'g1');
  const plain = arrangeRows(stems, groups).filter(row => row.groupId || row.group);
  assert.ok(plain.every(row => row.color === plain[0].color && row.hex === undefined));
  groups = recolorGroup(groups, 'g1', '#80cbb7');
  assert.ok(arrangeRows(stems, groups).filter(row => row.groupId || row.group).every(row => row.hex === '#80cbb7'));
  assert.equal(arrangeRows(stems, recolorGroup(groups, 'g1', null)).find(row => row.group).hex, undefined);
});
test('collapsing a group hides members, a channel moves between groups, empty groups vanish', () => {
  let groups = createGroup([], ['a', 'b'], 'One', null, 'g1');
  assert.deepEqual(arrangeRows(stems, groups, new Set(['g1'])).map(row => row.group ? row.group.id : row.stem.id), ['g1', 'd', 'e']);
  groups = createGroup(groups, ['a'], 'Two', null, 'g2');
  assert.deepEqual(groups.map(group => [group.id, group.members]), [['g1', ['b']], ['g2', ['a']]]);
  groups = createGroup(groups, ['b'], 'Three', null, 'g3');
  assert.deepEqual(groups.map(group => group.id), ['g2', 'g3']);
  assert.deepEqual(ungroup(groups, 'g2').map(group => group.id), ['g3']);
  assert.equal(renameGroup(groups, 'g2', '  ').find(group => group.id === 'g2').name, 'Two');
});
test('deleted channels leave their groups; validation rejects bad shapes', () => {
  const groups = createGroup([], ['a', 'b'], 'G', '#e3ef68', 'g1');
  assert.equal(pruneGroups(groups, stems), groups);
  assert.deepEqual(pruneGroups(groups, [{ id: 'a' }])[0].members, ['a']);
  assert.deepEqual(pruneGroups(groups, [{ id: 'z' }]), []);
  assert.equal(validGroups(groups), true);
  assert.equal(validGroups([{ id: 'x', name: 'n', members: ['a'], color: 'red' }]), false);
  assert.equal(validGroups('no'), false);
});
