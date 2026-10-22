import test from 'node:test';
import assert from 'node:assert/strict';
import { engineStatus } from '../src/engine-status.mjs';
import { audioNodes } from '../src/shared/node-capabilities.mjs';

const nodesOk = async url => { const name = url.split('/').pop(); return new Response(JSON.stringify({ [name]: { input: {} } })); };
const profile = { comfyUrl: 'http://127.0.0.1:18188' };

test('a slow ComfyUI does not cancel work that was possible a moment ago', async () => {
  const good = await engineStatus(profile, nodesOk);
  assert.equal(good.ready, true); assert.equal(good.stale, undefined);
  const slow = await engineStatus(profile, async () => { throw new Error('The operation was aborted due to timeout'); });
  assert.equal(slow.ready, true); assert.equal(slow.stale, true);
  const refused = await engineStatus({ comfyUrl: 'http://127.0.0.1:18189' }, async () => { throw new Error('signal timed out'); });
  assert.equal(refused.ready, false, 'with no earlier good answer the failure is reported');
  assert.match(refused.message, /timed out/);
});
test('a node that cannot be reached is never reported as missing', async () => {
  let tries = 0;
  const flaky = async url => { if (url.endsWith('/StemStudioMusicSeparate')) { tries++; throw new Error('signal timed out'); } return nodesOk(url); };
  await assert.rejects(audioNodes('http://x.invalid', flaky), /timed out/);
  assert.equal(tries, 2, 'the unreachable node was retried once');
  const absent = await audioNodes('http://x.invalid', async url => url.endsWith('/StemStudioMusicSeparate') ? new Response('{}', { status: 404 }) : nodesOk(url));
  assert.equal(absent.StemStudioMusicSeparate, undefined);
});
