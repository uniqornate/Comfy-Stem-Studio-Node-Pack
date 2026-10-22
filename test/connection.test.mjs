import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { normalizeEndpoint, checkConnection } from '../src/shared/connection.mjs';
test('rejects non-HTTP endpoints and credential-bearing addresses', () => {
  for (const value of ['file:///C:/Windows', 'http://user:secret@localhost:8188', 'http://localhost:8188?key=secret']) assert.throws(() => normalizeEndpoint(value));
});
test('distinguishes a working ComfyUI from a missing API proxy', async () => {
  const server = createServer((req, res) => { res.setHeader('Content-Type', 'application/json'); if (req.url === '/system_stats') res.end(JSON.stringify({ devices: [{ name: 'Test GPU' }] })); else if (req.url === '/object_info') res.end(JSON.stringify({ TestNode: {} })); else { res.statusCode = 404; res.end('{}'); } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { const address = `http://127.0.0.1:${server.address().port}`; const result = await checkConnection({ comfyUrl: address, proxyUrl: address }); assert.equal(result.comfy, true); assert.equal(result.proxy, false); assert.equal(result.nodeCount, 0); assert.match(result.message, /API Proxy is unavailable/); } finally { await new Promise(resolve => server.close(resolve)); }
});
