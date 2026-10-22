import test from 'node:test';
import assert from 'node:assert/strict';
import { resizeFloat, clampFloat } from '../src/float-geometry.mjs';

const viewport = { width: 1600, height: 900 }, ratio = 16 / 9;
const start = { width: 320, height: 180, left: 600, top: 300 };
const ratioOf = box => box.width / box.height;

test('every edge and corner keeps the video proportions', () => {
  for (const edge of ['n', 's', 'e', 'w', 'nw', 'ne', 'sw', 'se']) for (const [dx, dy] of [[80, 10], [-60, -40], [0, 70], [30, -90]]) {
    const box = resizeFloat({ edge, start, dx, dy, ratio, viewport });
    assert.ok(Math.abs(ratioOf(box) - ratio) < 1e-9, `${edge} ${dx},${dy}`);
  }
});
test('corners keep the opposite corner fixed and edges keep the other axis centred', () => {
  const se = resizeFloat({ edge: 'se', start, dx: 160, dy: 0, ratio, viewport });
  assert.deepEqual([se.left, se.top, se.width], [600, 300, 480]);
  const nw = resizeFloat({ edge: 'nw', start, dx: -160, dy: 0, ratio, viewport });
  assert.equal(nw.left + nw.width, 920); assert.equal(Math.round(nw.top + nw.height), 480);
  const east = resizeFloat({ edge: 'e', start, dx: 160, dy: 0, ratio, viewport });
  assert.equal(east.left, 600); assert.equal(Math.round(east.top + east.height / 2), 390);
  const north = resizeFloat({ edge: 'n', start, dx: 0, dy: -90, ratio, viewport });
  assert.equal(Math.round(north.top + north.height), 480); assert.equal(Math.round(north.left + north.width / 2), 760);
});
test('dragging an edge outwards grows and inwards shrinks, within sane limits', () => {
  assert.ok(resizeFloat({ edge: 'e', start, dx: 100, dy: 0, ratio, viewport }).width > 320);
  assert.ok(resizeFloat({ edge: 'w', start, dx: 100, dy: 0, ratio, viewport }).width < 320);
  assert.equal(resizeFloat({ edge: 'e', start, dx: -1000, dy: 0, ratio, viewport }).width, 180);
  const huge = resizeFloat({ edge: 'se', start, dx: 5000, dy: 5000, ratio, viewport });
  assert.ok(huge.width <= 1600 && huge.height <= 900);
  const portrait = resizeFloat({ edge: 'e', start: { width: 200, height: 355.5, left: 10, top: 10 }, dx: 50, dy: 0, ratio: 9 / 16, viewport });
  assert.ok(Math.abs(ratioOf(portrait) - 9 / 16) < 1e-9);
});
test('the box can go partly off screen but never out of reach', () => {
  const box = { width: 320, height: 180, left: 0, top: 0 };
  assert.equal(clampFloat({ ...box, left: -1000 }, viewport).left, 56 - 320);
  assert.equal(clampFloat({ ...box, left: 5000 }, viewport).left, 1600 - 56);
  assert.equal(clampFloat({ ...box, top: -1000 }, viewport).top, 56 - 180);
  assert.equal(clampFloat({ ...box, top: 5000 }, viewport).top, 900 - 56);
  assert.equal(clampFloat({ ...box, left: 400, top: 300 }, viewport).left, 400);
});
