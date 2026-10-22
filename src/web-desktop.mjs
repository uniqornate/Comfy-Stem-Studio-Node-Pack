// Node pack mode: a browser implementation of the Desktop interface (src/types.ts) that talks only to the
// ComfyUI that serves the page (same origin). No Electron, SDK, API proxy or native file dialogs are used.
// Everything below is injectable (fetch, storage, file picking, saving) so it can be tested without a browser.
import { engineStatus, checkRequest } from './engine-status.mjs';
import { stemWorkflow, editWorkflow, videoWorkflow, CHANNELS } from './graphs.mjs';
import { resources } from './shared/resources.mjs';
import { MUSIC_CHANNELS } from './shared/music.mjs';

export const SOURCE_EXTENSIONS = ['mp4', 'mov', 'm4v', 'webm', 'mkv', 'mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg', 'opus'];
const AUDIO_EXTENSIONS = ['mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg', 'opus'];
const extensionOf = name => /\.([a-z0-9]{1,5})$/i.exec(name || '')?.[1]?.toLowerCase() || '';
const SAFE_NAME = /^[A-Za-z0-9._-]{1,200}$/;
const SAFE_FOLDER = /^StemStudio(\/[A-Za-z0-9_-]+)*$/;
const ID = /^[a-zA-Z0-9_-]{1,160}$/;
const idle = () => ({ phase: 'idle', message: '', stems: [], canCancel: false });
const uuid = () => globalThis.crypto.randomUUID();
const slug = value => String(value || 'target').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 70) || 'target';
const nameOf = value => String(value || 'Untitled project').replace(/[\x00-\x1f]/g, '').trim().slice(0, 100) || 'Untitled project';
const TERMINAL = ['idle', 'complete', 'failed', 'cancelled'];

// A reference is how ComfyUI names a file: {type: 'input' | 'output', subfolder, filename}.
export function validRef(ref) {
  return !!ref && ['input', 'output'].includes(ref.type) && typeof ref.filename === 'string' && SAFE_NAME.test(ref.filename) && typeof ref.subfolder === 'string' && (ref.subfolder === '' || SAFE_FOLDER.test(ref.subfolder));
}
// "LoadAudio" style annotated name: subfolder/name, with " [output]" for files in the output directory.
export function annotate(ref) {
  if (!validRef(ref)) throw Error('Invalid ComfyUI file reference.');
  return `${ref.subfolder ? ref.subfolder + '/' : ''}${ref.filename}${ref.type === 'output' ? ' [output]' : ''}`;
}
export function viewUrl(base, ref) {
  if (!validRef(ref)) throw Error('Invalid ComfyUI file reference.');
  return `${base}/view?${new URLSearchParams({ filename: ref.filename, type: ref.type, subfolder: ref.subfolder })}`;
}
export function parseView(url, base, origin = '') {
  const home = origin || 'http://stemstudio.invalid';
  let parsed; try { parsed = new URL(url, home); } catch { return null; }
  if (parsed.origin !== new URL(home).origin || parsed.pathname !== `${base}/view`) return null;
  const ref = { type: parsed.searchParams.get('type') || 'output', subfolder: parsed.searchParams.get('subfolder') || '', filename: parsed.searchParams.get('filename') || '' };
  return validRef(ref) ? ref : null;
}
function historyFiles(entry, nodeId) {
  const output = entry?.outputs?.[nodeId]; if (!output || typeof output !== 'object') return [];
  return Object.values(output).filter(Array.isArray).flat().filter(item => item && typeof item.filename === 'string' && item.type !== 'temp')
    .map(item => { const subfolder = String(item.subfolder || '').replaceAll('\\', '/'); return { type: item.type || 'output', subfolder, filename: item.filename, name: `${subfolder ? subfolder + '/' : ''}${item.filename}` }; });
}
function failureText(entry) {
  for (const [kind, data] of entry?.status?.messages || []) if (kind === 'execution_error') return data?.exception_message || 'ComfyUI reported an execution error.';
  return 'See the ComfyUI log.';
}
const interrupted = entry => (entry?.status?.messages || []).some(([kind]) => kind === 'execution_interrupted');

export function createWebDesktop(env = {}) {
  const base = (env.base || '').replace(/\/+$/, '');
  const origin = (env.origin || '').replace(/\/+$/, '');
  const fetchImpl = env.fetch || ((...args) => globalThis.fetch(...args));
  const sleep = env.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const memory = new Map();
  const storage = env.storage || { getItem: key => memory.get(key) ?? null, setItem: (key, value) => { memory.set(key, value); } };
  const remember = (key, value) => { try { storage.setItem(key, value); } catch { /* storage can be blocked */ } };
  const recall = key => { try { return storage.getItem(key); } catch { return null; } };
  const clientId = uuid();
  const api = path => `${base}${path}`;
  const profile = { comfyUrl: origin + base, proxyUrl: origin + base, installation: '', managedProxy: true, setupComplete: true };

  async function request(path, init, what = 'ComfyUI') {
    const response = await fetchImpl(api(path), init);
    if (!response.ok) {
      let detail = ''; try { const body = await response.json(); detail = body?.error?.message || body?.error || body?.message || ''; if (body?.node_errors && Object.keys(body.node_errors).length) detail += ' ' + JSON.stringify(body.node_errors).slice(0, 600); } catch { /* not JSON */ }
      throw Error(`${what} HTTP ${response.status}${detail ? `: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
    }
    return response;
  }
  const json = async (path, init, what) => (await request(path, init, what)).json();
  const post = (path, body, what) => json(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }, what);

  async function upload(file, subfolder, filename) {
    const form = new FormData();
    form.append('image', file, filename); form.append('subfolder', subfolder); form.append('type', 'input'); form.append('overwrite', 'true');
    const result = await json('/upload/image', { method: 'POST', body: form }, 'ComfyUI upload');
    const ref = { type: 'input', subfolder: result.subfolder || '', filename: result.name };
    if (!validRef(ref)) throw Error('ComfyUI stored the upload under an unexpected name.');
    return ref;
  }
  async function pick(accept, extensions) {
    if (!env.pickFile) throw Error('File selection is not available in this browser.');
    const file = await env.pickFile(accept);
    if (!file) return null;
    if (!extensions.includes(extensionOf(file.name))) throw Error('Choose a supported file type.');
    return file;
  }
  async function stage(file, folder) {
    const safe = (file.name || 'media').replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'media';
    return upload(file, `StemStudio/${folder}`, `${uuid().slice(0, 8)}-${safe}.${extensionOf(file.name)}`);
  }
  async function exists(ref) { try { return (await fetchImpl(viewUrl(base, ref), { method: 'HEAD' })).ok; } catch { return false; } }
  async function fileSize(ref) {
    const response = await fetchImpl(viewUrl(base, ref), { method: 'HEAD' });
    if (!response.ok) return 0;
    const length = Number(response.headers.get('content-length'));
    return Number.isFinite(length) && length > 0 ? length : (await (await fetchImpl(viewUrl(base, ref))).arrayBuffer()).byteLength;
  }

  // ---- ComfyUI job handling -------------------------------------------------------------------------
  // ComfyUI reports step progress of the running node and which node is running over its websocket. The overall figure is
  // finished nodes plus the running node's steps, over the nodes of the graph. Without a socket the bar only moves.
  function watchProgress(total, onProgress) {
    if (!env.socket || !onProgress) return { setPrompt() {}, stop() {} };
    let promptId = '', done = 0, node = '', inner = 0, socket = null;
    const report = () => onProgress(Math.min(1, (done + inner) / Math.max(1, total)));
    try {
      socket = env.socket(clientId);
      socket.onmessage = event => {
        if (typeof event.data !== 'string') return;
        let message; try { message = JSON.parse(event.data); } catch { return; }
        const data = message?.data || {};
        if (promptId && data.prompt_id && data.prompt_id !== promptId) return;
        if (message.type === 'executing' && data.node) { if (node && data.node !== node) done++; node = data.node; inner = 0; report(); }
        else if (message.type === 'progress' && data.max > 0) { inner = Math.min(1, data.value / data.max); report(); }
      };
    } catch { socket = null; }
    return { setPrompt(id) { promptId = id; }, stop() { try { socket?.close(); } catch { /* already closed */ } } };
  }
  async function runPrompt(graph, { onState, isCancelled, onProgress } = {}) {
    const watcher = watchProgress(Object.keys(graph).length, onProgress);
    try { return await submitPrompt(graph, { onState, isCancelled, watcher }); } finally { watcher.stop(); }
  }
  async function submitPrompt(graph, { onState, isCancelled, watcher }) {
    const submitted = await post('/prompt', { prompt: graph, client_id: clientId }, 'ComfyUI');
    const promptId = submitted.prompt_id; if (!promptId) throw Error('ComfyUI did not return a job id.');
    watcher.setPrompt(promptId);
    onState?.({ promptId });
    while (true) {
      if (isCancelled?.()) return { cancelled: true, promptId };
      const history = await json(`/history/${encodeURIComponent(promptId)}`, undefined, 'ComfyUI history');
      const entry = history[promptId];
      if (entry?.status?.completed || entry?.status?.status_str === 'success' || entry?.status?.status_str === 'error') {
        if (entry.status.status_str === 'error') { if (interrupted(entry)) return { cancelled: true, promptId }; throw Error(`Job failed: ${failureText(entry)}`); }
        return { entry, promptId };
      }
      let phase = 'queued';
      try { const queue = await json('/queue', undefined, 'ComfyUI queue'); if ((queue.queue_running || []).some(item => item[1] === promptId)) phase = 'running'; } catch { /* keep queued */ }
      onState?.({ phase });
      await sleep(1000);
    }
  }
  async function interrupt(promptId) {
    if (!promptId) return;
    await post('/queue', { delete: [promptId] }, 'ComfyUI queue').catch(() => {});
    await post('/interrupt', { prompt_id: promptId }, 'ComfyUI interrupt').catch(() => {});
  }
  const probe = async names => {
    const found = await Promise.all(names.map(async name => { const response = await fetchImpl(api(`/object_info/${name}`)); return response.ok && !!(await response.json())[name]; }));
    return names.filter((_, i) => !found[i]);
  };

  // ---- projects (kept in ComfyUI's per-user data directory) -----------------------------------------
  const projectKey = id => encodeURIComponent(`stemstudio/projects/${id}.json`);
  const projectPath = id => `stemstudio/projects/${id}.json`;
  let current = null, lastInput = '';
  const outputs = new Map(); // stem id -> {ref, name}
  let state = idle();
  let active = false, activeJob = null, cancelled = false;
  const exportState = { phase: 'idle', progress: 0, message: '' };
  let exportActive = false, exportJob = null, exportCancelled = false;
  let audioActive = false;
  let delivered = '', missed = [];
  let mixActive = false, mixCancelled = false, mixJob = null;
  let batch = { phase: 'idle', items: [], current: -1, folder: '' }, batchActive = false, batchCancelled = false, batchFolder = null;

  function validateProject(doc) {
    if (!doc || doc.format !== 'stem-studio-project' || doc.version !== 1 || !ID.test(doc.id) || typeof doc.name !== 'string' || !Array.isArray(doc.runs) || doc.runs.length > 12) throw Error('Unsupported Stem Studio project.');
    let count = 0;
    for (const run of doc.runs) {
      if (!ID.test(run.runId) || typeof run.model !== 'string' || !Array.isArray(run.stems)) throw Error('Invalid project take.');
      for (const stem of run.stems) if (++count > 8192 || typeof stem.label !== 'string' || !Number.isFinite(stem.size) || !ID.test(stem.id) || !validRef(stem.native)) throw Error('Invalid project channel.');
    }
    if (doc.source && (typeof doc.source.name !== 'string' || !validRef(doc.source.native))) throw Error('Invalid source reference.');
    return doc;
  }
  function cleanView(value = {}) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid project workspace.');
    const result = {};
    for (const key of ['selectedRun', 'model', 'activeOperation', 'target', 'detailMode', 'samVariant', 'lastGuidance', 'detailRequest', 'layoutZoom', 'workspaceShare', 'timelineExpanded', 'floatPosition', 'floatSize', 'exportMode', 'transport', 'timelines']) if (value[key] !== undefined) result[key] = value[key];
    if (JSON.stringify(result).length > 2 * 1024 * 1024) throw Error('Workspace settings are too large.');
    if (result.detailRequest) result.detailRequest = { stem: { id: result.detailRequest.stem.id }, start: result.detailRequest.start, end: result.detailRequest.end };
    return JSON.parse(JSON.stringify(result));
  }
  // A write started while the page closes still completes (keepalive allows bodies up to 64 KB).
  async function writeProject(doc) {
    const body = JSON.stringify(doc);
    await request(`/userdata/${projectKey(doc.id)}?overwrite=true&full_info=false`, { method: 'POST', headers: { 'content-type': 'application/json' }, body, keepalive: body.length < 60000 }, 'ComfyUI user data');
    remember('stemstudio.lastProject', doc.id);
    // Also on the server, so another address (127.0.0.1 or localhost), tab or browser reopens the same project.
    if (serverLast !== doc.id) { serverLast = doc.id; void request(`/userdata/${encodeURIComponent('stemstudio/last.json')}?overwrite=true&full_info=false`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: doc.id }) }, 'ComfyUI user data').catch(() => {}); }
  }
  let serverLast = '';
  async function readServerLast() { try { const value = await json(`/userdata/${encodeURIComponent('stemstudio/last.json')}`, undefined, 'ComfyUI user data'); return ID.test(value?.id || '') ? value.id : ''; } catch { return ''; } }
  async function readProject(id) {
    if (!ID.test(id)) throw Error('Invalid project id.');
    return validateProject(await json(`/userdata/${projectKey(id)}`, undefined, 'ComfyUI user data'));
  }
  async function listProjects() {
    let items; try { items = await json(`/userdata?dir=${encodeURIComponent('stemstudio/projects')}&full_info=true`, undefined, 'ComfyUI user data'); } catch { return []; }
    const entries = (Array.isArray(items) ? items : []).map(item => typeof item === 'string' ? { path: item, modified: 0 } : item).filter(item => /^[a-zA-Z0-9_-]{1,160}\.json$/.test(String(item.path).split('/').pop()));
    const docs = await Promise.all(entries.map(async item => { try { const doc = await readProject(String(item.path).split('/').pop().replace(/\.json$/, '')); return { id: doc.id, name: doc.name, path: projectPath(doc.id), updatedAt: doc.updatedAt || '' }; } catch { return null; } }));
    return docs.filter(Boolean).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, 20);
  }
  const info = () => ({ id: current.id, name: current.name, path: projectPath(current.id), updatedAt: current.updatedAt });
  async function create(name, extra = []) {
    const now = new Date().toISOString();
    current = { format: 'stem-studio-project', version: 1, id: uuid(), name: nameOf(name), createdAt: now, updatedAt: now, source: null, runs: [], view: {} };
    lastInput = ''; await writeProject(current); return hydrate(extra);
  }
  async function hydrate(extra = []) {
    outputs.clear(); state = idle(); const warnings = [...extra];
    const doc = current; let source = null;
    if (doc.source) {
      const ok = await exists(doc.source.native);
      source = { name: doc.source.name, size: doc.source.size || 0, url: ok ? viewUrl(base, doc.source.native) : '', missing: !ok };
      if (!ok) warnings.push('Source file is missing from the ComfyUI input folder. Relink it from Projects.');
    }
    const runs = [];
    for (const run of doc.runs) {
      const stems = [];
      for (const stem of run.stems) {
        const ok = await exists(stem.native);
        if (ok) outputs.set(stem.id, { ref: stem.native, name: `${stem.label.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100)}-${stem.id.slice(0, 8)}.flac` });
        stems.push({ id: stem.id, label: stem.label, size: stem.size, ...(stem.parentId ? { parentId: stem.parentId } : {}), ...(stem.kind === 'brush' ? { kind: 'brush' } : {}), url: ok ? viewUrl(base, stem.native) : '', missing: !ok });
        if (!ok) warnings.push(`Missing channel: ${stem.label}`);
      }
      runs.push({ ...run, stems });
    }
    return { info: info(), source, runs, view: doc.view || {}, job: state, warnings };
  }
  // Opens the project that was open last. A project that cannot be opened is reported and the next newest is tried; a new
  // empty project is made only when there is nothing to open at all, never silently on top of existing work.
  async function boot() {
    const warnings = [];
    const last = recall('stemstudio.lastProject') || await readServerLast();
    if (last && ID.test(last)) {
      try { current = await readProject(last); lastInput = ''; return await hydrate(); }
      catch (error) { warnings.push(`The last project could not be opened (${error.message}).`); console.error('Stem Studio project', last, error); }
    }
    for (const item of await listProjects()) {
      if (item.id === last) continue;
      try { current = await readProject(item.id); lastInput = ''; return await hydrate([...warnings, `Opened "${item.name}" instead. Other projects are under Projects.`]); }
      catch (error) { warnings.push(`"${item.name}" could not be opened (${error.message}).`); console.error('Stem Studio project', item.id, error); }
    }
    return create('Untitled project', warnings);
  }
  let queue = Promise.resolve();
  const serial = fn => { const next = queue.then(fn); queue = next.catch(() => {}); return next; };
  let booted;
  const ensure = () => booted ||= serial(boot);

  async function save(payload = {}) {
    if (!current || payload.projectId !== current.id) throw Error('The active project changed.');
    const runs = (Array.isArray(payload.runs) ? payload.runs : []).map(run => ({ ...run, stems: [...run.stems] }));
    if (state.phase === 'complete' && state.runId) {
      if (state.rootRunId) { const root = runs.find(run => run.runId === state.rootRunId); if (root) root.stems.push(...state.stems.filter(stem => !root.stems.some(other => other.id === stem.id))); }
      else if (!runs.some(run => run.runId === state.runId)) runs.push(state);
    }
    const view = cleanView(payload.view);
    const input = JSON.stringify({ runs, view, phase: state.phase });
    if (input === lastInput) return info();
    const known = new Map(current.runs.flatMap(run => run.stems).map(stem => [stem.id, stem]));
    const durable = runs.slice(-12).map(run => ({ runId: run.runId, model: String(run.model || ''), phase: 'complete', message: '', canCancel: false, stems: run.stems.map(stem => {
      if (!ID.test(stem.id)) throw Error('Invalid channel id.');
      const existing = known.get(stem.id); const output = outputs.get(stem.id);
      if (!existing && !output) throw Error(`Channel is unavailable: ${stem.label}`);
      const label = String(stem.label).slice(0, 160) || 'Channel';
      return existing ? { ...existing, label } : { id: stem.id, label, size: stem.size, native: output.ref, ...(stem.parentId ? { parentId: stem.parentId } : {}), ...(stem.kind === 'brush' ? { kind: 'brush' } : {}) };
    }) }));
    const next = validateProject({ ...current, updatedAt: new Date().toISOString(), runs: durable, view });
    await writeProject(next); current = next; lastInput = input; return info();
  }
  const idleCheck = () => { if (active || exportActive || audioActive) throw Error('Finish or cancel the active processing/export before switching projects.'); };

  // ---- delivery of results to the user's disk -------------------------------------------------------
  async function fetchBlob(ref) {
    const response = await fetchImpl(viewUrl(base, ref)); if (!response.ok) throw Error('The file could not be read from ComfyUI.');
    return response.blob();
  }
  async function deliverBlob(blob, filename) {
    if (env.saveFile) return env.saveFile(blob, filename);
    throw Error('Saving files is not available in this browser.');
  }
  async function deliver(ref, filename) {
    if (env.saveFile) return env.saveFile(await fetchBlob(ref), filename);
    throw Error('Saving files is not available in this browser.');
  }
  async function renderEdits(ref, edits) {
    if (!edits) return ref;
    if (audioActive) throw Error('An audio edit export is already running.');
    audioActive = true;
    try {
      if (await probe(['StemStudioEditAudio']).then(missing => missing.length)) throw Error('Update the integration and restart idle ComfyUI to export edited audio.');
      const prefix = `StemStudio/Edits/${uuid()}/audio`;
      const graph = editWorkflow(edits, prefix); graph['1'].inputs.audio = annotate(ref);
      const result = await runPrompt(graph);
      const files = historyFiles(result.entry, '3');
      if (result.cancelled || files.length !== 1) throw Error('Edited audio output was not returned.');
      return { type: files[0].type, subfolder: files[0].subfolder, filename: files[0].filename };
    } finally { audioActive = false; }
  }

  const desktop = {
    nodePack: true,
    getProfile: async () => ({ ...profile }),
    saveProfile: async () => ({ ...profile }),
    chooseInstallation: async () => null,
    startProxy: async () => ({ phase: 'running', message: 'Node pack mode talks to ComfyUI directly. No API proxy is needed.', detail: '', owned: false }),
    stopProxy: async () => ({ phase: 'running', message: 'Node pack mode talks to ComfyUI directly. No API proxy is needed.', detail: '', owned: false }),
    proxyStatus: async () => ({ phase: 'running', message: 'Node pack mode talks to ComfyUI directly. No API proxy is needed.', detail: '', owned: false }),
    async checkConnection() {
      try {
        const stats = await json('/system_stats', undefined, 'ComfyUI');
        return { comfy: true, proxy: true, device: stats.devices?.[0]?.name || 'No GPU reported', message: 'Connected to the ComfyUI serving this page.', nodeCount: 0, comfyDetail: 'ComfyUI system API responded.', proxyDetail: 'Not needed in node pack mode.' };
      } catch (error) { return { comfy: false, proxy: true, device: '', message: error.message, nodeCount: 0, comfyDetail: error.message, proxyDetail: 'Not needed in node pack mode.' }; }
    },
    checkEngine: () => engineStatus(profile, fetchImpl),
    resources: () => resources(profile, fetchImpl),
    async setLayoutZoom(factor) {
      if (!Number.isFinite(factor) || factor < 0.6 || factor > 1.5) throw Error('Invalid layout scale.');
      env.zoom?.(factor); return factor;
    },

    getProject: () => ensure(),
    async recentProjects() { await ensure(); return listProjects(); },
    async saveProject(payload) { await ensure(); return serial(() => save(payload)); },
    async closeProject(payload) { if (payload) { await ensure(); await serial(() => save(payload)); } else await queue; },
    onProjectClose(callback) {
      if (!env.onPageHide) return () => {};
      return env.onPageHide(callback);
    },
    async projectAction(action, payload, argument) {
      await ensure();
      return serial(async () => {
        idleCheck(); await save(payload);
        if (action === 'rename') { current = { ...current, name: nameOf(argument), updatedAt: new Date().toISOString() }; await writeProject(current); return { info: info() }; }
        if (action === 'new') return create(argument);
        if (action === 'source') {
          const ref = parseView(argument?.url, base, origin); if (!ref || ref.type !== 'input') throw Error('Choose a source video first.');
          if (current.source) await create(String(argument.name || '').replace(/\.[^.]+$/, ''));
          current = { ...current, source: { name: String(argument.name || ref.filename), size: Number(argument.size) || 0, native: ref } };
          if (current.name === 'Untitled project') current.name = nameOf(String(argument.name || '').replace(/\.[^.]+$/, ''));
          current.updatedAt = new Date().toISOString(); await writeProject(current); lastInput = ''; return hydrate();
        }
        if (action === 'recent') {
          const id = String(argument || '').replace(/^stemstudio\/projects\//, '').replace(/\.json$/, '');
          current = await readProject(id); lastInput = ''; remember('stemstudio.lastProject', id); return hydrate();
        }
        if (action === 'open') {
          const file = await pick('.json', ['json']); if (!file) return null;
          if (file.size > 8 * 1024 * 1024) throw Error('Project file is too large.');
          const doc = validateProject(JSON.parse(await file.text()));
          current = { ...doc, view: cleanView(doc.view), updatedAt: new Date().toISOString() }; lastInput = ''; await writeProject(current); return hydrate();
        }
        if (action === 'copy') {
          const now = new Date().toISOString();
          current = { ...structuredClone(current), id: uuid(), name: nameOf(`${current.name} copy`), createdAt: now, updatedAt: now }; lastInput = ''; await writeProject(current); return hydrate();
        }
        if (action === 'relink') {
          if (!current.source) throw Error('This project has no source to relink.');
          const file = await pick(SOURCE_EXTENSIONS.map(e => '.' + e).join(','), SOURCE_EXTENSIONS); if (!file) return null;
          const ref = await stage(file, 'inbox');
          current = { ...current, source: { name: file.name, size: file.size, native: ref }, updatedAt: new Date().toISOString() }; await writeProject(current); return hydrate();
        }
        if (action === 'folder') return null;
        throw Error('Unknown project action.');
      });
    },

    async openVideo() {
      if (active || exportActive || audioActive) throw Error('Wait for separation/export to finish or cancel it before changing the source.');
      const file = await pick(SOURCE_EXTENSIONS.map(e => '.' + e).join(','), SOURCE_EXTENSIONS); if (!file) return null;
      const ref = await stage(file, 'inbox');
      return { name: file.name, size: file.size, url: viewUrl(base, ref) };
    },
    async chooseReference() {
      const file = await pick(AUDIO_EXTENSIONS.map(e => '.' + e).join(','), AUDIO_EXTENSIONS); if (!file) return null;
      const ref = await stage(file, 'inbox');
      return { name: file.name, size: file.size, url: viewUrl(base, ref) };
    },

    // The answer to a poll can be overwritten by the next job before it is read. Finished jobs that were never delivered are
    // handed over once with the next answer, so a result in ComfyUI's output folder always reaches the project.
    stemStatus: async () => {
      const snapshot = structuredClone(state);
      if (state.phase === 'complete' && state.runId) delivered = state.runId;
      const earlier = missed; missed = [];
      return earlier.length ? { ...snapshot, earlier } : snapshot;
    },
    async separateStems(_profile, sourceUrl, options = {}) {
      await ensure();
      if (active) throw Error('A separation job is already active.');
      if (!options || typeof options !== 'object' || Array.isArray(options)) throw Error('Invalid separation options.');
      if (!['sfc', 'bandit', 'mrx'].includes(options.model || 'mrx')) throw Error('Unknown model.');
      if (options.mode && !['stems', 'uss', 'sam', 'guidesep', 'brush', 'music'].includes(options.mode)) throw Error('Unknown operation.');
      const source = parseView(sourceUrl, base, origin); if (!source) throw Error('Choose a source first.');
      const reference = options.mode === 'guidesep' ? parseView(options.referenceUrl, base, origin) : null;
      const video = (options.mode === 'sam' && options.sam?.visual) || (options.mode === 'brush' && options.brush?.video) ? parseView(options.videoUrl, base, origin) : null;
      if (options.parentId) { const parent = outputs.get(options.parentId); if (!parent || annotate(parent.ref) !== annotate(source)) throw Error('The selected parent channel does not match its audio.'); }
      const prefix = `StemStudio/${current.id}/${uuid()}`;
      const request_ = { ...options, outputPrefix: prefix };
      delete request_.referenceUrl; delete request_.videoUrl;
      const graph = stemWorkflow(request_);
      if (!batchActive && state.phase === 'complete' && state.runId && state.runId !== delivered && !missed.some(item => item.runId === state.runId)) missed = [...missed, structuredClone(state)].slice(-12);
      active = true; cancelled = false; activeJob = null;
      state = { phase: 'checking', message: 'Checking audio workflow…', stems: [], canCancel: false };
      const startedAt = Date.now();
      const run = async () => {
        const status = await engineStatus(profile, fetchImpl);
        if (!status.ready) throw Error(status.message);
        checkRequest(status, request_, { reference: !!reference, video: !!video, nodePack: true });
        graph['1'].inputs.audio = annotate(source);
        if (reference) graph['8'].inputs.audio = annotate(reference);
        if (video) graph['6'].inputs.file = annotate(video);
        state.phase = 'uploading'; state.progress = 0.03; state.message = 'Queueing the job in this ComfyUI…';
        const result = await runPrompt(graph, {
          isCancelled: () => cancelled,
          onProgress: value => { state.progress = 0.05 + 0.9 * value; state.eta = value > 0.12 ? Math.round((Date.now() - startedAt) / 1000 * (1 - value) / value) : null; },
          onState: patch => { if (patch.promptId) { activeJob = patch.promptId; state.canCancel = true; } if (patch.phase) { state.phase = patch.phase; state.message = `ComfyUI job: ${patch.phase}.`; } },
        });
        state.canCancel = false;
        if (result.cancelled) { state.phase = 'cancelled'; state.message = 'Separation cancelled.'; return; }
        const label = options.target;
        const channels = options.mode === 'music' ? MUSIC_CHANNELS : options.mode === 'brush' ? [{ key: slug(label), label: String(label).slice(0, 60), node: '10' }] : ['uss', 'sam', 'guidesep'].includes(options.mode) ? [{ key: slug(label), label, node: '10' }, { key: 'remainder', label: 'Remainder', node: '11' }] : CHANNELS;
        let selected = channels.map(channel => ({ ...channel, file: historyFiles(result.entry, channel.node).find(file => file.type === 'output') }));
        if (options.mode === 'uss' && options.target === 'All') {
          const names = status.targets.filter(name => name !== 'All'); const seen = new Set();
          selected = historyFiles(result.entry, '2').filter(file => file.type === 'output').map(file => {
            const match = /(?:^|\/)class-(\d{3})-/.exec(file.name); const index = match ? Number(match[1]) : -1;
            if (!names[index] || seen.has(index)) throw Error('USS All returned an unrecognized or duplicate sound channel.');
            seen.add(index);
            return { key: `${String(index).padStart(3, '0')}-${slug(names[index])}`, label: names[index], node: '2', file };
          });
          if (!selected.length) throw Error('USS All returned no detected channels. Lower the threshold or choose a specific target.');
        }
        if (selected.some(channel => !channel.file)) throw Error('ComfyUI finished without the complete audio output set. No incomplete set was presented as successful.');
        state.phase = 'downloading'; state.progress = 0.97; state.eta = null; state.message = `Reading ${selected.length} ComfyUI outputs…`;
        const stems = [];
        for (const channel of selected) {
          const ref = { type: 'output', subfolder: channel.file.subfolder, filename: channel.file.filename };
          if (!validRef(ref)) throw Error(`ComfyUI returned an unexpected output name for ${channel.label}.`);
          const size = await fileSize(ref); if (!size) throw Error(`${channel.label} output was empty or missing.`);
          const id = uuid();
          outputs.set(id, { ref, name: options.parentId ? `${options.parentId.slice(0, 8)}-${channel.key}-${id.slice(0, 6)}.flac` : `${channel.key}.flac` });
          stems.push({ id, label: channel.label, size, url: viewUrl(base, ref), ...(options.parentId ? { parentId: options.parentId } : {}), ...(options.mode === 'brush' ? { kind: 'brush' } : {}) });
        }
        state = { phase: 'complete', message: `${selected.length} channels ready. Preview or save each channel, or download all.`, stems, canCancel: false, runId: uuid(), parentId: options.parentId, rootRunId: options.rootRunId, model: ['uss', 'sam'].includes(options.mode) ? `${options.mode.toUpperCase()} · ${options.target}` : options.mode === 'guidesep' ? `GuideSep · ${options.target}` : options.mode === 'brush' ? `Brush · ${String(options.target).slice(0, 40)}` : options.mode === 'music' ? 'Music · 6 stems' : options.model || 'mrx' };
      };
      void run().catch(error => { state = { ...state, phase: 'failed', message: error.message, canCancel: false }; }).finally(() => { active = false; activeJob = null; state.canCancel = false; });
      return structuredClone(state);
    },
    async cancelSeparation() {
      if (active && state.canCancel) { cancelled = true; await interrupt(activeJob); state.message = 'Cancellation requested. Waiting for ComfyUI to confirm.'; }
      return structuredClone(state);
    },

    async saveStem(id, edits) {
      const item = outputs.get(id); if (!item) throw Error('This stem is not available. Run separation first.');
      const ref = await renderEdits(item.ref, edits);
      return deliver(ref, item.name);
    },
    async saveAllStems(ids = [...outputs.keys()], edits = {}) {
      if (!Array.isArray(ids) || !ids.length || ids.length > 8192) throw Error('Run separation before exporting stems.');
      const items = ids.map(id => { const item = outputs.get(id); if (!item) throw Error('This stem is not available. Run separation first.'); return { id, ...item }; });
      const files = [];
      for (const item of items) files.push({ name: item.name, ref: await renderEdits(item.ref, edits[item.id]) });
      if (env.saveFolder) return env.saveFolder(files.map(file => ({ filename: file.name, load: () => fetchBlob(file.ref) })));
      let saved = 0;
      for (const file of files) { await deliver(file.ref, file.name); saved++; }
      return `${saved} downloaded files`;
    },

    exportStatus: async () => ({ ...exportState }),
    async cancelExport() { exportCancelled = true; if (exportJob) await interrupt(exportJob); },
    async exportVideo(_profile, options) {
      if (exportActive || audioActive) throw Error('A video export is already running.');
      if (!options || !Array.isArray(options.stems)) throw Error('Choose stem channels first.');
      const source = parseView(options.sourceUrl, base, origin); if (!source || source.type !== 'input') throw Error('Choose the original video first.');
      exportActive = true; exportCancelled = false; exportJob = null;
      Object.assign(exportState, { phase: 'running', progress: 0, message: 'Checking native ComfyUI video export…' });
      try {
        const stems = options.stems.map(stem => { const item = outputs.get(stem.id); if (!item) throw Error('Choose available stem channels.'); return { ...stem, item }; });
        const graph = videoWorkflow(stems, options);
        const missing = await probe(['LoadVideo', 'SaveVideo', 'StemStudioVideoTrack', 'StemStudioVideo']);
        if (missing.length) throw Error(`Native video export nodes missing: ${missing.join(', ')}. Update the Stem Studio node pack and restart ComfyUI.`);
        const folder = `export/${uuid()}`;
        exportState.message = 'Preparing stem files as ComfyUI inputs…';
        for (let index = 0; index < stems.length; index++) {
          if (exportCancelled) throw Error('Video export cancelled.');
          const stem = stems[index];
          const ref = await renderEdits(stem.item.ref, stem.edits);
          const blob = await fetchBlob(ref);
          const staged = await upload(blob, `StemStudio/${folder}`, `${String(index).padStart(3, '0')}-${uuid().slice(0, 8)}.flac`);
          graph[String(10 + index)].inputs.file = annotate(staged);
        }
        graph['1'].inputs.file = annotate(source);
        exportState.message = 'Queueing SaveVideo in ComfyUI…';
        const result = await runPrompt(graph, { isCancelled: () => exportCancelled, onState: patch => { if (patch.promptId) exportJob = patch.promptId; if (patch.phase) exportState.message = `ComfyUI SaveVideo: ${patch.phase}.`; } });
        if (result.cancelled) throw Error('Video export cancelled.');
        const files = historyFiles(result.entry, '3').filter(file => /\.mkv$/i.test(file.filename));
        if (files.length !== 1) throw Error('SaveVideo did not return exactly one MKV video. No export was published.');
        exportState.progress = 0.98; exportState.message = 'Receiving the saved video from ComfyUI…';
        const ref = { type: files[0].type, subfolder: files[0].subfolder, filename: files[0].filename };
        const target = await deliver(ref, `${String(options.sourceName || 'video').replace(/\.[^.]+$/, '')}-stems.mkv`);
        Object.assign(exportState, { phase: 'complete', progress: 1, message: 'Video exported through native ComfyUI SaveVideo.' });
        return target;
      } catch (error) { Object.assign(exportState, { phase: exportCancelled ? 'cancelled' : 'failed', progress: 0, message: error.message }); throw error; }
      finally { exportActive = false; exportJob = null; }
    },

    samStatus: (_profile, variant = 'small-tv') => json(`/stemstudio/sam/status?variant=${encodeURIComponent(variant)}`, undefined, 'Stem Studio'),
    prepareSAM: (_profile, token, variant = 'small-tv') => post('/stemstudio/sam/prepare', { token, variant }, 'Stem Studio'),
    cancelSAM: async () => { await post('/stemstudio/sam/cancel', {}, 'Stem Studio'); },
    guidesepStatus: () => json('/stemstudio/guidesep/status', undefined, 'Stem Studio'),
    prepareGuideSep: () => post('/stemstudio/guidesep/prepare', {}, 'Stem Studio'),
    cancelGuideSep: async () => { await post('/stemstudio/guidesep/cancel', {}, 'Stem Studio'); },
    // Sound models for the brush, the six-stem music model and MMAudio are downloaded by the node pack's Python routes into
    // this ComfyUI's models folders; the browser only starts, watches and cancels that work.
    brushStatus: (_profile, model = 'small') => json(`/stemstudio/brush/status?model=${encodeURIComponent(model)}`, undefined, 'Stem Studio'),
    prepareBrush: (_profile, model = 'small') => post('/stemstudio/brush/prepare', { model }, 'Stem Studio'),
    cancelBrush: async (model = 'small') => { await post('/stemstudio/brush/cancel', { model }, 'Stem Studio'); },
    musicStatus: () => json('/stemstudio/music/status', undefined, 'Stem Studio'),
    prepareMusic: () => post('/stemstudio/music/prepare', {}, 'Stem Studio'),
    cancelMusic: async () => { await post('/stemstudio/music/cancel', {}, 'Stem Studio'); },
    mmaudioStatus: () => json('/stemstudio/mmaudio/status', undefined, 'Stem Studio'),
    prepareMMAudio: () => post('/stemstudio/mmaudio/prepare', {}, 'Stem Studio'),
    cancelMMAudio: async () => { await post('/stemstudio/mmaudio/cancel', {}, 'Stem Studio'); },

    // The preview can move to a second browser window (ideally on another display) that follows this page's transport.
    openPreview: async (url, state) => { if (!env.preview) throw Error('Sending the preview to another window is not available in this browser.'); return env.preview.open(url, state); },
    syncPreview: async state => { env.preview?.sync(state); },
    closePreview: async () => { env.preview?.close(); },
    previewStatus: async () => ({ open: env.preview ? await env.preview.status() : false, external: false }),
    onPreviewClosed: callback => env.preview?.onClosed(callback) || (() => {}),

    // ---- mix export ----
    async exportMix(_profile, options) {
      if (!options || !['wav', 'flac'].includes(options.format) || !options.bytes?.byteLength) throw Error('Nothing to export.');
      if (exportActive || audioActive || mixActive) throw Error('Another export is already running.');
      const name = String(options.name || 'mix').replace(/[^A-Za-z0-9._ -]+/g, '-').slice(0, 80) || 'mix';
      const wav = new Blob([options.bytes], { type: 'audio/wav' });
      if (options.format === 'wav') return deliverBlob(wav, `${name}-mix.wav`);
      mixActive = true; mixCancelled = false; mixJob = null;
      try {
        if (await probe(['SaveAudio', 'LoadAudio']).then(missing => missing.length)) throw Error('ComfyUI is missing LoadAudio or SaveAudio.');
        const staged = await upload(wav, `StemStudio/Mixes/${uuid()}`, 'mix-source.wav');
        const graph = { '1': { class_type: 'LoadAudio', inputs: { audio: annotate(staged) } }, '3': { class_type: 'SaveAudio', inputs: { audio: ['1', 0], filename_prefix: `StemStudio/Mixes/${uuid()}/mix` } } };
        const result = await runPrompt(graph, { isCancelled: () => mixCancelled, onState: patch => { if (patch.promptId) mixJob = patch.promptId; } });
        if (result.cancelled) throw Error('Mix export cancelled.');
        const files = historyFiles(result.entry, '3').filter(file => file.type === 'output');
        if (files.length !== 1) throw Error('ComfyUI did not return the mixed audio.');
        return await deliver({ type: 'output', subfolder: files[0].subfolder, filename: files[0].filename }, `${name}-mix.flac`);
      } finally { mixActive = false; mixJob = null; }
    },
    async cancelMix() { mixCancelled = true; if (mixJob) await interrupt(mixJob); },

    // ---- batch: files are staged into ComfyUI's input folder, results go to a folder chosen in the browser ----
    async chooseBatchFiles() {
      if (!env.pickFiles) throw Error('Choosing several files is not available in this browser.');
      const files = await env.pickFiles(SOURCE_EXTENSIONS.map(e => '.' + e).join(','));
      const picked = [];
      for (const file of files.slice(0, 200)) {
        if (!SOURCE_EXTENSIONS.includes(extensionOf(file.name))) continue;
        const ref = await stage(file, 'batch');
        picked.push({ name: file.name, size: file.size, url: viewUrl(base, ref) });
      }
      return picked;
    },
    async chooseBatchFolder() {
      if (!env.pickFolder) throw Error('Choosing a folder needs a Chromium-based browser (Chrome, Edge). Without it, results are downloaded as files.');
      const folder = await env.pickFolder();
      if (!folder) return null;
      batchFolder = folder; return folder.name;
    },
    batchStatus: async () => structuredClone(batch),
    async cancelBatch() { batchCancelled = true; if (active && state.canCancel) await desktop.cancelSeparation(); return structuredClone(batch); },
    async startBatch(_profile, files, options) {
      if (batchActive) throw Error('A batch is already running.');
      if (active || exportActive || audioActive || mixActive) throw Error('Finish the current job before starting a batch.');
      if (!Array.isArray(files) || !files.length || files.length > 200) throw Error('Choose between 1 and 200 files.');
      if (!options || !['stems', 'sam', 'guidesep', 'music', 'uss'].includes(options.mode)) throw Error('Choose a model for the batch.');
      batchActive = true; batchCancelled = false;
      batch = { phase: 'running', items: files.map(file => ({ name: file.name, status: 'queued', message: '', folder: '' })), current: 0, folder: batchFolder?.name || 'Downloads' };
      void (async () => {
        try {
          for (let index = 0; index < files.length; index++) {
            const item = batch.items[index];
            if (batchCancelled) { item.status = 'skipped'; continue; }
            batch.current = index; item.status = 'running';
            try {
              const request_ = { mode: options.mode, ...(options.mode === 'stems' ? { model: options.model } : {}), ...(options.mode === 'uss' ? { target: options.target, threshold: 0.1, autoThreshold: !!options.autoThreshold } : {}), ...(options.mode === 'sam' ? { samModel: options.samModel, target: options.target } : {}) };
              await desktop.separateStems(profile, files[index].url, request_);
              let result; do { await sleep(800); result = state; } while (!TERMINAL.includes(result.phase));
              if (batchCancelled || result.phase === 'cancelled') { item.status = 'skipped'; continue; }
              if (result.phase !== 'complete') throw Error(result.message || 'The job failed.');
              const folder = `${String(files[index].name).replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9._ -]+/g, '-').slice(0, 60)} (${String(result.model).replace(/[^A-Za-z0-9._ -]+/g, '-').slice(0, 30)})`;
              item.folder = folder;
              const delivered = result.stems.map(stem => ({ filename: `${stem.label.replace(/[^A-Za-z0-9._ -]+/g, '-').slice(0, 60)}.flac`, load: () => fetchBlob(outputs.get(stem.id).ref) }));
              if (batchFolder && env.writeInFolder) await env.writeInFolder(batchFolder, folder, delivered);
              else for (const file of delivered) await env.saveFile?.(await file.load(), `${folder}-${file.filename}`);
              item.status = 'done';
            } catch (error) { item.status = 'failed'; item.message = error.message; }
          }
          batch.phase = batchCancelled ? 'cancelled' : 'complete';
        } finally { batchActive = false; }
      })();
      return structuredClone(batch);
    },

    modelsStatus: () => json('/stemstudio/models/status', undefined, 'Stem Studio'),
    prepareModels: packs => post('/stemstudio/models/prepare', { packs }, 'Stem Studio'),
    cancelModels: async () => { await post('/stemstudio/models/cancel', {}, 'Stem Studio'); },
  };
  return Object.freeze(desktop);
}

// ---- real browser plumbing (not unit-tested; thin wrappers over DOM APIs) ------------------------------
export function browserEnvironment(win = globalThis) {
  const location = win.location;
  const marker = '/stemstudio/app';
  const index = location.pathname.indexOf(marker);
  const base = index >= 0 ? location.pathname.slice(0, index) : '';
  const document = win.document;
  const download = (blob, filename) => {
    const url = URL.createObjectURL(blob); const link = document.createElement('a');
    link.href = url; link.download = filename; document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000); return filename;
  };
  let storage; try { storage = win.localStorage; storage.getItem('probe'); } catch { storage = undefined; }
  return {
    origin: location.origin, base, storage,
    fetch: (...args) => win.fetch(...args),
    // A popup that only shows the picture. It is opened inside the click (a later open would be blocked), then moved to another
    // display when the browser allows it (Window Management permission).
    preview: (() => {
      let popup = null, last = null;
      const listeners = new Set();
      const channel = typeof win.BroadcastChannel === 'function' ? new win.BroadcastChannel('stemstudio-preview') : null;
      channel?.addEventListener('message', event => {
        const message = event.data || {};
        if (message.type === 'ready' && last) channel.postMessage({ type: 'state', ...last });
        else if (message.type === 'closed') { popup = null; listeners.forEach(callback => callback()); }
      });
      return {
        async open(url, state) {
          last = state;
          popup = win.open(`${base}/stemstudio/app/preview.html?src=${encodeURIComponent(url)}`, 'stemstudio-preview', 'popup=yes,width=960,height=540');
          if (!popup) throw Error('Your browser blocked the preview window. Allow pop-ups for this page and try again.');
          let external = false;
          try {
            if (win.getScreenDetails) {
              const details = await win.getScreenDetails(), other = details.screens.find(screen => screen !== details.currentScreen);
              if (other) { popup.moveTo(other.availLeft, other.availTop); popup.resizeTo(other.availWidth, other.availHeight); external = true; }
            }
          } catch { /* the window stays where the browser put it; drag it to the other display */ }
          return { external };
        },
        sync(state) { last = state; channel?.postMessage({ type: 'state', ...state }); },
        close() { channel?.postMessage({ type: 'close' }); try { popup?.close(); } catch { /* already closed */ } popup = null; },
        status() {
          if (!channel) return Promise.resolve(!!popup && !popup.closed);
          return new Promise(resolve => {
            const answer = event => { if (event.data?.type === 'pong') { done(true); } };
            const done = value => { channel.removeEventListener('message', answer); clearTimeout(timer); resolve(value); };
            const timer = setTimeout(() => done(false), 300);
            channel.addEventListener('message', answer); channel.postMessage({ type: 'ping' });
          });
        },
        onClosed(callback) { listeners.add(callback); return () => listeners.delete(callback); },
      };
    })(),
    pickFiles: accept => new Promise(resolve => {
      const input = document.createElement('input'); input.type = 'file'; input.multiple = true; input.accept = accept || ''; input.style.display = 'none';
      input.addEventListener('change', () => { resolve([...(input.files || [])]); input.remove(); }, { once: true });
      input.addEventListener('cancel', () => { resolve([]); input.remove(); }, { once: true });
      document.body.appendChild(input); input.click();
    }),
    pickFolder: async () => { if (!win.showDirectoryPicker) return null; try { return await win.showDirectoryPicker({ mode: 'readwrite' }); } catch (error) { if (error?.name === 'AbortError') return null; throw error; } },
    async writeInFolder(root, name, files) {
      const folder = await root.getDirectoryHandle(name, { create: true });
      for (const file of files) { const handle = await folder.getFileHandle(file.filename, { create: true }); const writable = await handle.createWritable(); await writable.write(await file.load()); await writable.close(); }
    },
    socket: clientId => new win.WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${base}/ws?clientId=${encodeURIComponent(clientId)}`),
    pickFile: accept => new Promise(resolve => {
      const input = document.createElement('input'); input.type = 'file'; input.accept = accept || ''; input.style.display = 'none';
      input.addEventListener('change', () => { resolve(input.files?.[0] || null); input.remove(); }, { once: true });
      input.addEventListener('cancel', () => { resolve(null); input.remove(); }, { once: true });
      document.body.appendChild(input); input.click();
    }),
    async saveFile(blob, filename) {
      if (win.showSaveFilePicker && win.navigator?.userActivation?.isActive) {
        try {
          const handle = await win.showSaveFilePicker({ suggestedName: filename });
          const writable = await handle.createWritable(); await writable.write(blob); await writable.close(); return handle.name;
        } catch (error) { if (error?.name === 'AbortError') throw Error('Save cancelled.'); }
      }
      return download(blob, filename);
    },
    async saveFolder(files) {
      if (win.showDirectoryPicker && win.navigator?.userActivation?.isActive) {
        try {
          const folder = await win.showDirectoryPicker({ mode: 'readwrite' });
          for (const file of files) { const handle = await folder.getFileHandle(file.filename, { create: true }); const writable = await handle.createWritable(); await writable.write(await file.load()); await writable.close(); }
          return folder.name;
        } catch (error) { if (error?.name === 'AbortError') throw Error('Save cancelled.'); }
      }
      for (const file of files) download(await file.load(), file.filename);
      return `${files.length} downloaded files`;
    },
    zoom: factor => { document.documentElement.style.zoom = String(factor); document.documentElement.style.setProperty('--page-zoom', String(factor)); },
    onPageHide: callback => { const listener = () => callback(); win.addEventListener('pagehide', listener); return () => win.removeEventListener('pagehide', listener); },
  };
}
export function installWebDesktop(win = globalThis) {
  if (win.desktop) return false;
  const marker = '/stemstudio/app';
  if (!win.location?.pathname?.includes(marker)) return false;
  win.desktop = createWebDesktop(browserEnvironment(win));
  return true;
}
