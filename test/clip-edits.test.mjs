import test from 'node:test';
import assert from 'node:assert/strict';
import { channelEdit, fitEdit, splitEdit, trimEdit, moveEdit, gainEdit, audibleSegments, placeCopy, clipAt, removeClip } from '../src/clip-edits.mjs';
import { stemWorkflow, editWorkflow } from '../src/graphs.mjs';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
test('split preserves complete timeline coverage and is idempotent at boundaries', () => {
  const split = splitEdit(undefined, 3.25, 10);
  assert.deepEqual(split.clips.map(clip => [clip.start,clip.end]),[[0,3.25],[3.25,10]]);
  assert.deepEqual(splitEdit(split,3.25,10),split);
  assert.deepEqual(splitEdit(split,10,10),split);
});
test('clip edges trim and restore without crossing neighboring clips or changing source offset', () => {
  const split = splitEdit(undefined,4,10), id=split.clips[1].id;
  const trimmed=trimEdit(split,id,'start',6,10);
  assert.deepEqual(trimmed.clips.map(clip=>[clip.start,clip.end]),[[0,4],[6,10]]);
  assert.equal(trimEdit(trimmed,id,'start',1,10).clips[1].start,4);
  assert.equal(trimEdit(trimmed,id,'end',100,10).clips[1].end,10);
});
test('new range gain replaces overlapping automation and retains both outside pieces', () => {
  const base=gainEdit(undefined,1,9,-6,10), next=gainEdit(base,3,5,6,10);
  assert.deepEqual(next.gains,[{start:1,end:3,db:-6},{start:3,end:5,db:6},{start:5,end:9,db:-6}]);
  assert.equal(gainEdit(next,3,5,50,10).gains[1].db,24);
});
test('audible schedule intersects trims, gain boundaries, transport offset and loop end', () => {
  const edit={clips:[{id:'a',start:0,end:2},{id:'b',start:4,end:8}],gains:[{start:1,end:5,db:20}]};
  assert.deepEqual(audibleSegments(edit,10,.5,6),[{start:.5,end:1,gain:1},{start:1,end:2,gain:10},{start:4,end:5,gain:10},{start:5,end:6,gain:1}]);
});
test('invalid overlapping ranges, non-finite gains and unbounded clip counts are rejected', () => {
  assert.throws(()=>channelEdit({clips:[{start:0,end:4},{start:2,end:5}],gains:[]},10),/overlapping/);
  assert.throws(()=>channelEdit({clips:[],gains:[{start:0,end:1,db:NaN}]},10),/Gain/);
  assert.throws(()=>channelEdit({clips:new Array(257).fill({start:0,end:1}),gains:[]},10),/Too many/);
});
test('pending metadata and a shorter relinked video cannot crash stored clip rendering', () => {
  const edit={clips:[{id:'a',start:0,end:4},{id:'b',start:6,end:10}],gains:[{start:2,end:9,db:-6}]};
  assert.deepEqual(fitEdit(edit,0),{clips:[],gains:[]});
  assert.deepEqual(fitEdit(edit,7).clips,[{id:'a',start:0,end:4},{id:'b',start:6,end:7}]);
  assert.equal(edit.clips[1].end,10); assert.equal(splitEdit(edit,2,7).clips.at(-1).end,7);
});
test('native edit node precedes processing crop and full-timeline padding reference', () => {
  const edits=gainEdit(undefined,2,3,-6,10);
  const graph=stemWorkflow({mode:'uss',target:'Door',range:{start:1,end:4},edits});
  assert.equal(graph['7'].class_type,'StemStudioEditAudio');
  assert.deepEqual(graph['3'].inputs.audio,['7',0]); assert.deepEqual(graph['4'].inputs.reference,['7',0]);
  assert.deepEqual(editWorkflow(edits,'StemStudio/Edits/test/audio')['3'].inputs.audio,['2',0]);
});
test('a clip can slide along the timeline, stopping at neighbours and the ends, and keeps its source range', () => {
  const split = splitEdit(undefined, 5, 10), left = 'full-L-5.000000';
  const gap = trimEdit(trimEdit(split, left, 'end', 2, 10), 'full-R-5.000000', 'start', 6, 10);
  assert.deepEqual(gap.clips.map(clip => [clip.start, clip.end]), [[0, 2], [6, 10]]);
  assert.deepEqual(moveEdit(gap, left, 3, 10).clips[0], { id: left, start: 0, end: 2, offset: 3 });
  assert.equal(moveEdit(gap, left, 99, 10).clips[0].offset, 4);
  assert.equal(moveEdit(gap, left, -5, 10).clips[0].offset, undefined);
  assert.equal(moveEdit(moveEdit(gap, left, 3, 10), left, 0, 10).clips[0].offset, undefined);
  const wedged = splitEdit(splitEdit(undefined, 3, 10), 6, 10);
  assert.equal(moveEdit(wedged, wedged.clips[1].id, 3.5, 10).clips[1].offset, undefined);
  assert.equal(moveEdit(gap, 'missing', 1, 10).clips.length, 2);
});
test('moved clips split, trim and play at their new place while reading the right part of the audio', () => {
  const base = trimEdit(trimEdit(splitEdit(undefined, 5, 10), 'full-R-5.000000', 'start', 8, 10), 'full-L-5.000000', 'end', 2, 10);
  assert.deepEqual(base.clips.map(clip => [clip.start, clip.end]), [[0, 2], [8, 10]]);
  const moved = moveEdit(base, base.clips[0].id, 3, 10);
  assert.deepEqual(moved.clips[0], { id: base.clips[0].id, start: 0, end: 2, offset: 3 });
  const split = splitEdit(moved, 4, 10);
  assert.deepEqual(split.clips.slice(0, 2).map(clip => [clip.start, clip.end, clip.offset]), [[0, 1, 3], [1, 2, 3]]);
  const trimmed = trimEdit(moved, base.clips[0].id, 'start', 4, 10);
  assert.deepEqual([trimmed.clips[0].start, trimmed.clips[0].offset], [1, 3]);
  assert.equal(trimEdit(moved, base.clips[0].id, 'end', 99, 10).clips[0].end, 5); // timeline end of the next clip, minus the shift
  assert.deepEqual(audibleSegments(moved, 10, 0, 10).slice(0, 1), [{ start: 3, end: 5, gain: 1, source: 0 }]);
  assert.deepEqual(audibleSegments(moved, 10, 4, 10).slice(0, 1), [{ start: 4, end: 5, gain: 1, source: 1 }]);
  const gained = gainEdit(moved, 4, 5, 6, 10);
  assert.deepEqual(audibleSegments(gained, 10, 0, 6).map(segment => [segment.start, segment.end, Math.round(segment.gain * 100) / 100, segment.source]), [[3, 4, 1, 0], [4, 5, 2, 1]]);
});
test('offsets are validated and fitted to a shorter timeline', () => {
  assert.throws(() => channelEdit({ clips: [{ id: 'a', start: 0, end: 4, offset: 8 }], gains: [] }, 10), /overlapping/);
  assert.throws(() => channelEdit({ clips: [{ id: 'a', start: 0, end: 4, offset: -1 }], gains: [] }, 10), /overlapping/);
  assert.throws(() => channelEdit({ clips: [{ id: 'a', start: 0, end: 4, offset: NaN }], gains: [] }, 10), /position/);
  assert.throws(() => channelEdit({ clips: [{ id: 'a', start: 0, end: 4, offset: 2 }, { id: 'b', start: 3, end: 5 }], gains: [] }, 10), /overlapping/);
  const edit = { clips: [{ id: 'a', start: 0, end: 4, offset: 4 }], gains: [] };
  assert.deepEqual(fitEdit(edit, 6).clips, [{ id: 'a', start: 0, end: 2, offset: 4 }]);
  assert.deepEqual(fitEdit(edit, 3).clips, []);
  assert.deepEqual(channelEdit({ clips: [{ id: 'a', start: 0, end: 4, offset: 0 }], gains: [] }, 10).clips, [{ id: 'a', start: 0, end: 4 }]);
});
test('a copy lands at the wanted time, in the nearest free gap, without touching other clips', () => {
  const edit = { clips: [{ id: 'a', start: 0, end: 2 }, { id: 'b', start: 6, end: 8 }], gains: [] };
  const clip = edit.clips[0];
  const inGap = placeCopy(edit, clip, 3, 10, 't');
  assert.equal(inGap.start, 3); assert.deepEqual(inGap.edit.clips.map(item => item.id), ['a', 'a-c-t', 'b']); assert.equal(inGap.edit.clips[1].offset, 3); assert.equal(inGap.edit.clips[1].start, 0);
  assert.equal(placeCopy(edit, clip, 0.5, 10, 't').start, 2, 'pushed to the nearest side of the original');
  assert.equal(placeCopy(edit, clip, 7, 10, 't').start, 8, 'pushed past the clip it would overlap');
  assert.equal(placeCopy(edit, clip, 9.5, 10, 't').start, 8, 'kept inside the timeline');
  const full = { clips: [{ id: 'a', start: 0, end: 5 }, { id: 'b', start: 5, end: 10 }], gains: [] };
  assert.equal(placeCopy(full, full.clips[0], 4, 10, 't'), null);
  assert.deepEqual(clipAt(edit, 6.5, 10)?.id, 'b'); assert.equal(clipAt(edit, 4, 10), null);
  assert.equal(placeCopy(undefined, { id: 'full', start: 0, end: 4 }, 0, 10, 't'), null, 'an untouched channel fills the timeline');
  const short = placeCopy({ clips: [{ id: 'full', start: 0, end: 4 }], gains: [] }, { id: 'full', start: 0, end: 4 }, 0, 10, 't');
  assert.equal(short.start, 4); assert.equal(channelEdit(short.edit, 10).clips.length, 2);
});
test('removing a clip leaves silence, keeps the other clips and gains, and stays valid', () => {
  const edit = { clips: [{ id: 'a', start: 0, end: 2 }, { id: 'b', start: 6, end: 8, offset: 1 }], gains: [{ start: 0, end: 3, db: -6 }] };
  const left = removeClip(edit, 'a', 10);
  assert.deepEqual(left.clips.map(clip => clip.id), ['b']); assert.equal(left.gains.length, 1); assert.doesNotThrow(() => channelEdit(left, 10));
  assert.deepEqual(audibleSegments(left, 10).map(segment => [segment.start, segment.end]), [[7, 9]]);
  const all = removeClip(left, 'b', 10); assert.equal(all.clips.length, 0); assert.doesNotThrow(() => channelEdit(all, 10)); assert.deepEqual(audibleSegments(all, 10), []);
  assert.deepEqual(removeClip(edit, 'nope', 10).clips.length, 2);
  assert.equal(removeClip(undefined, 'full', 10).clips.length, 0);
});
