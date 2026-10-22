import test from 'node:test';
import assert from 'node:assert/strict';
import { pageZoom, toCss } from '../src/page-zoom.mjs';

test('page zoom comes from the root element and falls back to 1', () => {
  assert.equal(pageZoom({ style: { zoom: '1.2' } }), 1.2);
  assert.equal(pageZoom({ style: { zoom: '' } }), 1);
  assert.equal(pageZoom({ style: { zoom: 'nonsense' } }), 1);
  assert.equal(pageZoom({ style: { zoom: '0' } }), 1);
  assert.equal(pageZoom(null), 1);
});
test('a screen position becomes the css position that lands on it', () => {
  assert.equal(toCss(600, 1.5), 400);
  assert.equal(toCss(300, 0.6), 500);
  assert.equal(toCss(300, 1), 300);
});
