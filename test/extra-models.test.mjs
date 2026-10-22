import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { extraModels } from '../scripts/make-extra-models.mjs';

test('setup/extra-models.json matches the desktop app constants (run: node scripts/make-extra-models.mjs)', async () => {
  const written = JSON.parse(await readFile(new URL('../setup/extra-models.json', import.meta.url), 'utf8'));
  assert.deepEqual(written, JSON.parse(JSON.stringify(await extraModels())));
});
