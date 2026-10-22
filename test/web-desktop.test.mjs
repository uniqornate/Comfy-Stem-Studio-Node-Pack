import test from 'node:test';
import assert from 'node:assert/strict';
import { createWebDesktop, annotate, viewUrl, parseView, validRef } from '../src/web-desktop.mjs';

const ORIGIN = 'http://comfy.test';
const NODES = ['LoadAudio', 'SaveAudio', 'StemStudioSeparate', 'StemStudioExtract', 'StemStudioExtractAll', 'StemStudioEditAudio', 'LoadVideo', 'SaveVideo', 'StemStudioVideoTrack', 'StemStudioVideo', 'StemStudioAudioRange', 'StemStudioRestoreRange'];

// A tiny in-memory ComfyUI: upload, prompt/history/queue, view and userdata routes.
function fakeComfy(options = {}) {
  const input = new Map(), output = new Map(), userdata = new Map(), history = new Map(), calls = [];
  const state = { prompts: [], interrupts: [], deletes: [], running: false, failWith: null, targets: ['Door', 'Speech', 'All'], base: options.base || '' };
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const files = type => (type === 'input' ? input : output);
  function execute(graph) {
    if (state.failWith) return { status: { status_str: 'error', completed: false, messages: [['execution_error', { exception_message: state.failWith }]] }, outputs: {} };
    const outputs = {};
    for (const [node, spec] of Object.entries(graph)) {
      if (spec.class_type === 'SaveAudio') {
        const parts = spec.inputs.filename_prefix.split('/'); const name = `${parts.pop()}_00001_.flac`; const subfolder = parts.join('/');
        output.set(`${subfolder}/${name}`, new Uint8Array([1, 2, 3, 4])); outputs[node] = { audio: [{ filename: name, subfolder: state.windows ? subfolder.replaceAll('/', '\\') : subfolder, type: 'output' }] };
      }
      if (spec.class_type === 'StemStudioExtractAll') {
        const subfolder = spec.inputs.filename_prefix.split('/').join('/');
        outputs[node] = { audio: [1, 0].map(i => { const filename = `class-${String(i).padStart(3, '0')}-x_00001_.flac`; output.set(`${subfolder}/${filename}`, new Uint8Array([9, 9])); return { filename, subfolder, type: 'output' }; }) };
      }
      if (spec.class_type === 'SaveVideo') {
        const subfolder = 'StemStudio/Exports'; const filename = `${spec.inputs.filename_prefix.split('/').pop()}_00001_.mkv`;
        output.set(`${subfolder}/${filename}`, new Uint8Array([7, 7, 7])); outputs[node] = { images: [{ filename, subfolder, type: 'output', animated: true }] };
      }
    }
    return { status: { status_str: 'success', completed: true, messages: [] }, outputs };
  }
  const fetch = async (url, init = {}) => {
    const href = String(url).replace(ORIGIN, ''); const u = new URL(href, 'http://x'); const path = u.pathname.slice(state.base.length); const method = init.method || 'GET';
    calls.push(`${method} ${path}`);
    if (path === '/system_stats') return json({ devices: [{ name: 'Test GPU', type: 'cuda', vram_total: 100, vram_free: 40 }], system: { ram_total: 100, ram_free: 50 } });
    if (path.startsWith('/object_info/')) {
      const name = path.split('/').pop(); if (!NODES.includes(name)) return json({}, 404);
      const input_ = name === 'StemStudioExtract' ? { required: { target: [state.targets] }, optional: { auto_threshold: [] } } : name === 'StemStudioSeparate' ? { required: { model: [['mrx', 'sfc']] } } : name === 'StemStudioExtractAll' ? { optional: { auto_threshold: [], filename_prefix: [] } } : {};
      return json({ [name]: { input: input_ } });
    }
    if (path === '/upload/image' && method === 'POST') {
      const form = init.body; const file = form.get('image'); const subfolder = form.get('subfolder') || ''; const key = `${subfolder}/${file.name}`;
      input.set(key, new Uint8Array(await file.arrayBuffer())); return json({ name: file.name, subfolder, type: 'input' });
    }
    if (path === '/prompt' && method === 'POST') {
      if (state.reject) return json({ error: { message: state.reject }, node_errors: {} }, 400);
      const body = JSON.parse(init.body); const id = `p${state.prompts.length + 1}`; state.prompts.push(body.prompt);
      history.set(id, state.hold ? null : execute(body.prompt)); state.running = !!state.hold; if (state.hold) state.heldId = id;
      return json({ prompt_id: id });
    }
    if (path.startsWith('/history/')) { const id = decodeURIComponent(path.split('/').pop()); const entry = history.get(id); return json(entry ? { [id]: entry } : {}); }
    if (path === '/queue' && method === 'GET') return json({ queue_running: state.running ? [[0, state.heldId]] : [], queue_pending: [] });
    if (path === '/queue' && method === 'POST') { state.deletes.push(JSON.parse(init.body)); return json({}); }
    if (path === '/interrupt') { state.interrupts.push(JSON.parse(init.body)); history.set(state.heldId, { status: { status_str: 'error', completed: false, messages: [['execution_interrupted', {}]] }, outputs: {} }); return json({}); }
    if (path === '/view') {
      const ref = Object.fromEntries(u.searchParams); const bytes = files(ref.type).get(`${ref.subfolder}/${ref.filename}`);
      if (!bytes) return new Response('no', { status: 404 });
      return method === 'HEAD' ? new Response(null, { status: 200, headers: { 'content-length': String(bytes.length) } }) : new Response(bytes, { status: 200 });
    }
    if (path === '/userdata' && method === 'GET') return json([...userdata.keys()].filter(k => k.startsWith('stemstudio/projects/')).map(k => ({ path: k.slice('stemstudio/projects/'.length), size: 1, modified: 1 })));
    if (path.startsWith('/userdata/')) {
      const key = decodeURIComponent(path.slice('/userdata/'.length));
      if (method === 'POST') { userdata.set(key, init.body); return json(key); }
      return userdata.has(key) ? new Response(userdata.get(key), { status: 200, headers: { 'content-type': 'application/json' } }) : new Response('no', { status: 404 });
    }
    if (path.startsWith('/stemstudio/')) return json({ phase: 'idle', message: path, detail: '', ready: false });
    return new Response('not found', { status: 404 });
  };
  return { fetch, input, output, userdata, history, calls, state };
}
function make(server, extra = {}) {
  const saved = [];
  const desktop = createWebDesktop({ origin: ORIGIN, base: server.state.base, fetch: server.fetch, sleep: () => new Promise(r => setTimeout(r, 1)), pickFile: async () => new File([new Uint8Array([5, 6, 7])], 'My clip!.mp4'), saveFile: async (blob, filename) => { saved.push({ blob, filename }); return filename; }, ...extra });
  return { desktop, saved };
}
async function waitFor(desktop, phases) {
  for (let i = 0; i < 100; i++) { const job = await desktop.stemStatus(); if (phases.includes(job.phase)) return job; await new Promise(r => setTimeout(r, 2)); }
  throw Error('timeout ' + JSON.stringify(await desktop.stemStatus()));
}
async function withSource(desktop) {
  const session = await desktop.getProject();
  const opened = await desktop.openVideo();
  const next = await desktop.projectAction('source', { projectId: session.info.id, runs: [], view: {} }, opened);
  return { session: next, opened };
}

test('file references are validated and annotated for ComfyUI', () => {
  assert.equal(annotate({ type: 'input', subfolder: 'StemStudio/inbox', filename: 'a-b.mp4' }), 'StemStudio/inbox/a-b.mp4');
  assert.equal(annotate({ type: 'output', subfolder: 'StemStudio/p/r', filename: 'x_00001_.flac' }), 'StemStudio/p/r/x_00001_.flac [output]');
  assert.equal(validRef({ type: 'input', subfolder: '../x', filename: 'a.mp4' }), false);
  assert.equal(validRef({ type: 'input', subfolder: '', filename: 'a [output].mp4' }), false);
  assert.throws(() => annotate({ type: 'temp', subfolder: '', filename: 'a.mp4' }), /Invalid/);
  const url = viewUrl('/comfy', { type: 'input', subfolder: 'StemStudio/inbox', filename: 'a.mp4' });
  assert.deepEqual(parseView(url, '/comfy'), { type: 'input', subfolder: 'StemStudio/inbox', filename: 'a.mp4' });
  assert.equal(parseView(url, ''), null);
  assert.equal(parseView('http://evil.test/view?filename=a.mp4&type=input', '', ORIGIN), null);
  assert.equal(parseView(`${ORIGIN}/view?filename=a.mp4&type=input&subfolder=`, '', ORIGIN)?.filename, 'a.mp4');
});

test('connection, engine and resources come from the page-serving ComfyUI, with no proxy', async () => {
  const server = fakeComfy(); const { desktop } = make(server);
  assert.equal(desktop.nodePack, true);
  const profile = await desktop.getProfile();
  assert.equal(profile.comfyUrl, ORIGIN); assert.equal(profile.setupComplete, true);
  const connection = await desktop.checkConnection(profile);
  assert.equal(connection.comfy, true); assert.equal(connection.proxy, true); assert.equal(connection.device, 'Test GPU');
  assert.equal((await desktop.proxyStatus()).phase, 'running');
  const engine = await desktop.checkEngine(profile);
  assert.equal(engine.ready, true); assert.deepEqual(engine.models, ['mrx', 'sfc']);
  const resources = await desktop.resources(profile);
  assert.equal(resources.online, true); assert.deepEqual(resources.ram, { total: 100, used: 50 });
  assert.equal(await desktop.chooseInstallation(), null);
});

test('source import uploads into ComfyUI input and the project survives a reload', async () => {
  const server = fakeComfy(); const first = make(server);
  const { session, opened } = await withSource(first.desktop);
  assert.match(opened.url, /^\/view\?/); assert.equal(opened.name, 'My clip!.mp4');
  const stored = [...server.input.keys()];
  assert.equal(stored.length, 1); assert.match(stored[0], /^StemStudio\/inbox\/[0-9a-f]{8}-My-clip\.mp4$/);
  assert.equal(session.source.name, 'My clip!.mp4'); assert.equal(session.source.missing, false);
  assert.equal(session.info.name, 'My clip!');
  const second = make(server);
  const restored = await second.desktop.getProject();
  assert.equal(restored.info.id, session.info.id); assert.equal(restored.source.url, session.source.url);
  assert.equal((await second.desktop.recentProjects()).length, 1);
  server.input.clear();
  const missing = await make(server).desktop.getProject();
  assert.equal(missing.source.missing, true); assert.match(missing.warnings.join(' '), /missing/i);
});

test('separation queues an annotated, project-scoped graph and returns real stem urls', async () => {
  const server = fakeComfy(); const { desktop } = make(server);
  const { session, opened } = await withSource(desktop);
  const profile = await desktop.getProfile();
  const started = await desktop.separateStems(profile, opened.url, { model: 'mrx', mode: 'stems' });
  assert.equal(started.phase, 'checking');
  const job = await waitFor(desktop, ['complete', 'failed']);
  assert.equal(job.phase, 'complete', job.message);
  const graph = server.state.prompts[0];
  assert.match(graph['1'].inputs.audio, /^StemStudio\/inbox\//);
  assert.match(graph['10'].inputs.filename_prefix, new RegExp(`^StemStudio/${session.info.id}/[0-9a-f-]{36}/dialogue$`));
  assert.deepEqual(job.stems.map(stem => stem.label), ['Dialogue', 'Music', 'Effects']);
  assert.ok(job.stems.every(stem => stem.size === 4 && stem.url.startsWith('/view?')));
  assert.equal(job.model, 'mrx');
  // Saving then reloading restores the take from ComfyUI's output folder.
  await desktop.saveProject({ projectId: session.info.id, runs: [], view: { selectedRun: job.runId } });
  const again = await make(server).desktop.getProject();
  assert.equal(again.runs.length, 1); assert.equal(again.runs[0].stems.length, 3); assert.ok(again.runs[0].stems.every(stem => !stem.missing));
  assert.equal(again.view.selectedRun, job.runId);
});

test('a child detail run reads its parent from the output folder and stays attached to it', async () => {
  const server = fakeComfy(); const { desktop } = make(server);
  const { opened } = await withSource(desktop); const profile = await desktop.getProfile();
  await desktop.separateStems(profile, opened.url, { model: 'mrx', mode: 'stems' });
  const parent = await waitFor(desktop, ['complete']);
  await assert.rejects(desktop.separateStems(profile, parent.stems[0].url, { mode: 'uss', target: 'Door', parentId: parent.stems[1].id }), /parent channel/);
  await desktop.separateStems(profile, parent.stems[0].url, { mode: 'uss', target: 'Door', threshold: 0.1, parentId: parent.stems[0].id, rootRunId: parent.runId, range: { start: 1, end: 3 } });
  const child = await waitFor(desktop, ['complete', 'failed']);
  assert.equal(child.phase, 'complete', child.message);
  const graph = server.state.prompts[1];
  assert.match(graph['1'].inputs.audio, /\/dialogue_00001_\.flac \[output\]$/);
  assert.equal(graph['3'].class_type, 'StemStudioAudioRange');
  assert.equal(child.parentId, parent.stems[0].id); assert.deepEqual(child.stems.map(s => s.label), ['Door', 'Remainder']);
});

test('Windows ComfyUI reports output subfolders with backslashes', async () => {
  const server = fakeComfy(); server.state.windows = true; const { desktop } = make(server);
  const { opened } = await withSource(desktop);
  await desktop.separateStems(await desktop.getProfile(), opened.url, { mode: 'stems' });
  const job = await waitFor(desktop, ['complete', 'failed']);
  assert.equal(job.phase, 'complete', job.message);
  assert.match(job.stems[0].url, /subfolder=StemStudio%2F/);
});

test('USS All maps class files to named channels', async () => {
  const server = fakeComfy(); server.state.targets = ['Speech', 'Door', 'All']; const { desktop } = make(server);
  const { opened } = await withSource(desktop);
  await desktop.separateStems(await desktop.getProfile(), opened.url, { mode: 'uss', target: 'All', threshold: 0.1 });
  const job = await waitFor(desktop, ['complete', 'failed']);
  assert.equal(job.phase, 'complete', job.message);
  assert.deepEqual(job.stems.map(stem => stem.label).sort(), ['Door', 'Speech']);
});

test('ComfyUI validation and execution errors surface and do not leave the job active', async () => {
  const server = fakeComfy(); const { desktop } = make(server);
  const { opened } = await withSource(desktop); const profile = await desktop.getProfile();
  server.state.reject = 'Prompt outputs failed validation';
  await desktop.separateStems(profile, opened.url, { mode: 'stems' });
  let job = await waitFor(desktop, ['failed']);
  assert.match(job.message, /HTTP 400.*Prompt outputs failed validation/);
  server.state.reject = null; server.state.failWith = 'CUDA out of memory';
  await desktop.separateStems(profile, opened.url, { mode: 'stems' });
  job = await waitFor(desktop, ['failed']);
  assert.match(job.message, /CUDA out of memory/);
  await assert.rejects(desktop.separateStems(profile, 'http://evil.test/view?filename=a.mp4&type=input', {}), /Choose a source/);
  await assert.rejects(desktop.separateStems(profile, opened.url, { model: 'nope' }), /Unknown model/);
});

test('cancel interrupts the running ComfyUI job', async () => {
  const server = fakeComfy(); server.state.hold = true; const { desktop } = make(server);
  const { opened } = await withSource(desktop);
  await desktop.separateStems(await desktop.getProfile(), opened.url, { mode: 'stems' });
  const running = await waitFor(desktop, ['running']);
  assert.equal(running.canCancel, true);
  await desktop.cancelSeparation();
  const job = await waitFor(desktop, ['cancelled']);
  assert.equal(job.phase, 'cancelled');
  assert.deepEqual(server.state.interrupts, [{ prompt_id: 'p1' }]); assert.deepEqual(server.state.deletes, [{ delete: ['p1'] }]);
});

test('saving a stem downloads it, rendering timeline edits through ComfyUI first', async () => {
  const server = fakeComfy(); const { desktop, saved } = make(server);
  const { opened } = await withSource(desktop);
  await desktop.separateStems(await desktop.getProfile(), opened.url, { mode: 'stems' });
  const job = await waitFor(desktop, ['complete']);
  assert.match(await desktop.saveStem(job.stems[0].id), /\.flac$/);
  assert.equal(saved.length, 1); assert.equal((await saved[0].blob.arrayBuffer()).byteLength, 4);
  const edits = { clips: [{ id: 'a', start: 0, end: 1 }], gains: [] };
  await desktop.saveStem(job.stems[1].id, edits);
  const edit = server.state.prompts.at(-1);
  assert.equal(edit['2'].class_type, 'StemStudioEditAudio'); assert.match(edit['1'].inputs.audio, / \[output\]$/);
  await assert.rejects(desktop.saveStem('missing'), /not available/);
  const names = await desktop.saveAllStems(job.stems.map(stem => stem.id));
  assert.equal(names, '3 downloaded files'); assert.equal(saved.length, 5);
});

test('video export stages stems as inputs, runs native SaveVideo and delivers the MKV', async () => {
  const server = fakeComfy(); const { desktop, saved } = make(server);
  const { opened } = await withSource(desktop);
  await desktop.separateStems(await desktop.getProfile(), opened.url, { mode: 'stems' });
  const job = await waitFor(desktop, ['complete']);
  const stems = job.stems.map(stem => ({ id: stem.id, label: stem.label, mute: false, solo: false, level: 1 }));
  const result = await desktop.exportVideo(await desktop.getProfile(), { sourceUrl: opened.url, stems, mode: 'mix', format: 'mkv', duration: 3, sourceName: 'clip.mp4' });
  assert.equal(result, 'clip-stems.mkv'); assert.equal(saved.at(-1).filename, 'clip-stems.mkv');
  const graph = server.state.prompts.at(-1);
  assert.match(graph['1'].inputs.file, /^StemStudio\/inbox\//);
  for (const id of ['10', '11', '12']) assert.match(graph[id].inputs.file, /^StemStudio\/export\/[0-9a-f-]{36}\/\d{3}-[0-9a-f]{8}\.flac$/);
  assert.equal((await desktop.exportStatus()).phase, 'complete');
  server.output.clear();
  await assert.rejects(desktop.exportVideo(await desktop.getProfile(), { sourceUrl: opened.url, stems, mode: 'mix', format: 'mkv', duration: 3 }), /could not be read/);
  assert.equal((await desktop.exportStatus()).phase, 'failed');
});

test('project actions: rename, new, copy, recent and relink', async () => {
  const server = fakeComfy(); const { desktop } = make(server);
  const { session } = await withSource(desktop);
  const payload = { projectId: session.info.id, runs: [], view: {} };
  assert.equal((await desktop.projectAction('rename', payload, 'Film cut')).info.name, 'Film cut');
  const copy = await desktop.projectAction('copy', payload);
  assert.notEqual(copy.info.id, session.info.id); assert.equal(copy.info.name, 'Film cut copy');
  const fresh = await desktop.projectAction('new', { ...payload, projectId: copy.info.id }, 'Blank');
  assert.equal(fresh.source, null);
  const recent = await desktop.recentProjects(); assert.equal(recent.length, 3);
  const back = await desktop.projectAction('recent', { ...payload, projectId: fresh.info.id }, recent.find(item => item.id === session.info.id).path);
  assert.equal(back.info.id, session.info.id); assert.equal(back.source.missing, false);
  const relinked = await desktop.projectAction('relink', { ...payload }, undefined);
  assert.equal(relinked.source.missing, false); assert.equal(server.input.size, 2);
  await assert.rejects(desktop.projectAction('nope', payload), /Unknown project action/);
  await assert.rejects(desktop.saveProject({ projectId: 'other', runs: [], view: {} }), /project changed/);
});

test('preparation requests are forwarded to the node pack routes', async () => {
  const server = fakeComfy(); const { desktop } = make(server);
  assert.equal((await desktop.samStatus({}, 'large-tv')).message, '/stemstudio/sam/status');
  await desktop.prepareSAM({}, 'hf_xxxxxxxxxxxxxxxxxxxx', 'small-tv'); await desktop.cancelSAM();
  await desktop.guidesepStatus({}); await desktop.prepareGuideSep({}); await desktop.cancelGuideSep();
  for (const call of ['POST /stemstudio/sam/prepare', 'POST /stemstudio/sam/cancel', 'GET /stemstudio/guidesep/status', 'POST /stemstudio/guidesep/prepare', 'POST /stemstudio/guidesep/cancel']) assert.ok(server.calls.includes(call), call);
});

test('a ComfyUI served under a path prefix keeps every request under that prefix', async () => {
  const server = fakeComfy({ base: '/comfy' }); const { desktop } = make(server);
  const { opened } = await withSource(desktop);
  assert.match(opened.url, /^\/comfy\/view\?/);
  await desktop.separateStems(await desktop.getProfile(), opened.url, { mode: 'stems' });
  assert.equal((await waitFor(desktop, ['complete', 'failed'])).phase, 'complete');
});

test('music stems run as one job with six named channels, and the model fields reach ComfyUI', async () => {
  const server = fakeComfy(); const inner = server.fetch;
  server.fetch = async (url, init) => String(url).includes('/object_info/StemStudioMusicSeparate') ? new Response(JSON.stringify({ StemStudioMusicSeparate: { input: { required: { model: [['htdemucs_6s']] } } } }), { status: 200 }) : inner(url, init);
  const { desktop } = make(server);
  const { opened } = await withSource(desktop);
  await desktop.separateStems(await desktop.getProfile(), opened.url, { mode: 'music' });
  const done = await waitFor(desktop, ['complete', 'failed']);
  assert.equal(done.phase, 'complete', done.message);
  assert.deepEqual(done.stems.map(stem => stem.label), ['Vocals', 'Drums', 'Bass', 'Guitar', 'Piano', 'Other']);
  assert.equal(done.model, 'Music · 6 stems');
  assert.equal(server.state.prompts.at(-1)['2'].class_type, 'StemStudioMusicSeparate');
});

test('sound model downloads and MMAudio preparation are Python routes of the node pack', async () => {
  const server = fakeComfy(); const { desktop } = make(server);
  const profile = await desktop.getProfile();
  await desktop.brushStatus(profile, 'medium'); await desktop.prepareBrush(profile, 'medium'); await desktop.cancelBrush('medium');
  await desktop.musicStatus(profile); await desktop.prepareMusic(profile); await desktop.cancelMusic();
  await desktop.mmaudioStatus(profile); await desktop.prepareMMAudio(profile); await desktop.cancelMMAudio();
  for (const call of ['GET /stemstudio/brush/status', 'POST /stemstudio/brush/prepare', 'POST /stemstudio/brush/cancel', 'GET /stemstudio/music/status', 'POST /stemstudio/music/prepare', 'GET /stemstudio/mmaudio/status', 'POST /stemstudio/mmaudio/prepare', 'POST /stemstudio/mmaudio/cancel']) assert.ok(server.calls.includes(call), call);
});

test('the preview window, mix export to WAV and the batch folder have browser answers', async () => {
  const server = fakeComfy(); const { desktop, saved } = make(server);
  await assert.rejects(desktop.openPreview('x', { position: 0, playing: false, rate: 1 }), /desktop app/);
  assert.deepEqual(await desktop.previewStatus(), { open: false, external: false });
  const path = await desktop.exportMix(await desktop.getProfile(), { format: 'wav', name: 'My song', bytes: new Uint8Array([1, 2, 3]) });
  assert.equal(path, 'My song-mix.wav'); assert.equal(saved.at(-1).blob.size, 3);
  await assert.rejects(desktop.exportMix(await desktop.getProfile(), { format: 'wav', name: 'x', bytes: new Uint8Array() }), /Nothing to export/);
  await assert.rejects(desktop.chooseBatchFolder(), /Chromium/);
});

test('batch runs files one after another and writes each result set into the chosen folder', async () => {
  const server = fakeComfy(); const written = [];
  const folder = { name: 'Results' };
  const { desktop } = make(server, { pickFiles: async () => [new File([new Uint8Array([1])], 'one.mp4'), new File([new Uint8Array([2])], 'two.mp4')], pickFolder: async () => folder, writeInFolder: async (root, name, files) => { written.push({ root, name, files: files.map(file => file.filename) }); } });
  const files = await desktop.chooseBatchFiles(); assert.equal(files.length, 2);
  assert.equal(await desktop.chooseBatchFolder(), 'Results');
  await desktop.startBatch(await desktop.getProfile(), files, { mode: 'stems', model: 'mrx' });
  for (let i = 0; i < 200; i++) { const state = await desktop.batchStatus(); if (state.phase !== 'running') break; await new Promise(resolve => setTimeout(resolve, 5)); }
  const state = await desktop.batchStatus();
  assert.equal(state.phase, 'complete', JSON.stringify(state)); assert.deepEqual(state.items.map(item => item.status), ['done', 'done']);
  assert.equal(written.length, 2); assert.deepEqual(written[0].files, ['Dialogue.flac', 'Music.flac', 'Effects.flac']); assert.match(written[0].name, /^one \(mrx\)$/);
});

test('live progress comes from the ComfyUI websocket: finished nodes plus the running node steps', async () => {
  const server = fakeComfy(); server.state.hold = true;
  const sockets = [];
  const { desktop } = make(server, { socket: () => { const socket = { close() {}, onmessage: null }; sockets.push(socket); return socket; } });
  const { opened } = await withSource(desktop);
  await desktop.separateStems(await desktop.getProfile(), opened.url, { mode: 'stems', model: 'mrx' });
  for (let i = 0; i < 100 && !(await desktop.stemStatus()).canCancel; i++) await new Promise(resolve => setTimeout(resolve, 2));
  const send = (type, data) => sockets.at(-1).onmessage({ data: JSON.stringify({ type, data }) });
  send('executing', { node: '1' }); send('executing', { node: '2' }); send('progress', { value: 5, max: 10, node: '2' });
  const status = await desktop.stemStatus();
  assert.ok(Math.abs(status.progress - (0.05 + 0.9 * (1 + 0.5) / 5)) < 1e-9, String(status.progress));
  await desktop.cancelSeparation();
});

test('a renamed channel keeps its ComfyUI file and its brush kind in the saved project', async () => {
  const server = fakeComfy(); const { desktop } = make(server);
  const { session, opened } = await withSource(desktop);
  await desktop.separateStems(await desktop.getProfile(), opened.url, { mode: 'stems', model: 'mrx' });
  const done = await waitFor(desktop, ['complete']);
  const run = { ...done, stems: done.stems.map((stem, index) => index === 0 ? { ...stem, label: 'Voice over', kind: 'brush' } : stem) };
  await desktop.saveProject({ projectId: session.info.id, runs: [run], view: {} });
  const { desktop: again } = make(server);
  const restored = await again.getProject();
  assert.equal(restored.runs[0].stems[0].label, 'Voice over');
  assert.equal(restored.runs[0].stems[0].missing, false);
});

test('reload reopens the last project from the server note, and an unreadable project is reported instead of being replaced by an empty one', async () => {
  const server = fakeComfy(); const first = make(server);
  const a = await first.desktop.getProject();
  const b = await first.desktop.projectAction('new', { projectId: a.info.id, runs: [], view: {} }, 'Second');
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.ok(server.userdata.has('stemstudio/last.json'), 'the last project is also written on the server');
  const fresh = make(server); // a browser with no local memory
  assert.equal((await fresh.desktop.getProject()).info.id, b.info.id);
  server.userdata.set(`stemstudio/projects/${b.info.id}.json`, '{broken');
  const next = await make(server).desktop.getProject();
  assert.equal(next.info.id, a.info.id);
  assert.match(next.warnings.join(' '), /last project could not be opened/); assert.match(next.warnings.join(' '), /Opened ".*" instead/);
  server.userdata.set(`stemstudio/projects/${a.info.id}.json`, '{broken');
  const empty = await make(server).desktop.getProject();
  assert.notEqual(empty.info.id, a.info.id); assert.match(empty.warnings.join(' '), /could not be opened/);
});

test('a finished job that the interface never saw is handed over once with the next answer', async () => {
  const server = fakeComfy(); const { desktop } = make(server);
  const { opened } = await withSource(desktop);
  const profile = await desktop.getProfile();
  await desktop.separateStems(profile, opened.url, { mode: 'stems', model: 'mrx' });
  await new Promise(resolve => setTimeout(resolve, 60)); // the first job finishes while nothing polls
  await desktop.separateStems(profile, opened.url, { mode: 'stems', model: 'mrx' });
  const status = await desktop.stemStatus();
  assert.equal(status.earlier?.length, 1); assert.equal(status.earlier[0].phase, 'complete'); assert.equal(status.earlier[0].stems.length, 3);
  const done = await waitFor(desktop, ['complete', 'failed']);
  assert.equal(done.phase, 'complete'); assert.equal(done.earlier, undefined, 'handed over only once');
  await desktop.separateStems(profile, opened.url, { mode: 'stems', model: 'mrx' });
  assert.equal((await desktop.stemStatus()).earlier, undefined, 'a result that was read is not handed over again');
});
