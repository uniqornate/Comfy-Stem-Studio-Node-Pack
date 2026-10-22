import test from 'node:test';
import assert from 'node:assert/strict';
import { pointerTime, workspaceTop } from '../src/timeline-geometry.mjs';
test('pointer seek and selection use scrolled lane geometry at any rendered scale', () => {
  assert.equal(pointerTime(400, 200, 800, 20), 5);
  assert.equal(pointerTime(400, -400, 1600, 20), 10);
  assert.equal(pointerTime(600, 300, 1200, 20), 5);
  assert.equal(pointerTime(-10, 200, 800, 20), 0); assert.equal(pointerTime(2000, 200, 800, 20), 20);
  assert.equal(pointerTime(400, 0, 0, 20), 0);
});
test('workspace resizing reserves timeline space and safely handles small zoomed viewports', () => {
  assert.equal(workspaceTop(800, 500), 500); assert.equal(workspaceTop(800, 1000), 580);
  assert.equal(workspaceTop(800, -10), 252); assert.equal(workspaceTop(280, 200), 60);
  assert.equal(workspaceTop(120, 200), 0); assert.equal(workspaceTop(0, 200), 0);
});
