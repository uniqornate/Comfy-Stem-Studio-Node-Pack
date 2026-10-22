import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resources } from '../src/shared/resources.mjs';
import { preferences } from '../src/workspace-preferences.mjs';
test('resource monitor reads selected remote engine and preserves absent sensors', async () => {
  const urls = [];
  const result = await resources({ comfyUrl: 'http://example.test:8188' }, async url => {
    urls.push(url);
    return { ok: true, json: async () => url.endsWith('system_stats') ? { system: { ram_total: 100, ram_free: 40 }, devices: [{ type: 'cuda', vram_total: 80, vram_free: 20 }] } : { gpu: 62, cpu: null, cpuLoad: 37.5 } };
  });
  assert.deepEqual(result, { online: true, ram: { total: 100, used: 60 }, vram: { total: 80, used: 60 }, gpuTemperature: 62, cpuTemperature: null, cpuLoad: 37.5 });
  assert.ok(urls.every(url => url.startsWith('http://example.test:8188/')));
});
test('offline and legacy engines degrade without fabricated readings', async () => {
  assert.equal((await resources({ comfyUrl: 'http://example.test' }, async () => { throw Error('offline'); })).online, false);
  const result = await resources({ comfyUrl: 'http://example.test' }, async () => ({ ok: true, json: async () => ({ system: { ram_total: 100, ram_free: 200 }, gpu: 999 }) }));
  assert.equal(result.ram, null); assert.equal(result.gpuTemperature, null);
});
test('workspace defaults to SFC and All and restores selected action safely', () => {
  assert.equal(preferences(null).target, 'All'); assert.equal(preferences('invalid').model, 'mrx');
  const last = { model: 'bandit', activeOperation: 'uss', target: 'Rain', autoThreshold: false, threshold: 0.23 };
  assert.deepEqual(preferences(JSON.stringify(last)), last);
  assert.equal(preferences('{"threshold":-2,"model":"unknown"}').threshold, 0.1);
});
