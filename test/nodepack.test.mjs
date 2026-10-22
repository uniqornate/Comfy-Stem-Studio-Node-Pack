import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pack = join(root, 'comfy_nodes', 'StemStudio');
const read = path => readFile(join(root, path), 'utf8');
const walk = async folder => (await Promise.all((await readdir(folder, { withFileTypes: true })).map(entry => entry.isDirectory() ? walk(join(folder, entry.name)) : [join(folder, entry.name)]))).flat();

test('the extension web directory holds only the loader script (ComfyUI imports every .js there)', async () => {
  const files = (await walk(join(pack, 'web'))).map(path => path.slice(join(pack, 'web').length + 1));
  assert.deepEqual(files, ['stemstudio.js']);
  const script = await read('comfy_nodes/StemStudio/web/stemstudio.js');
  assert.match(script, /\/stemstudio\/app\/index\.html/);
  assert.match(script, /registerSidebarTab/);
  assert.match(script, /StemStudio\.Open/);
});

test('both entry points declare their web directory and the root one forwards the node pack', async () => {
  assert.match(await read('comfy_nodes/StemStudio/__init__.py'), /WEB_DIRECTORY = "\.\/web"/);
  const entry = await read('__init__.py');
  assert.match(entry, /from \.comfy_nodes\.StemStudio import NODE_CLASS_MAPPINGS, NODE_DISPLAY_NAME_MAPPINGS/);
  assert.match(entry, /WEB_DIRECTORY = "\.\/comfy_nodes\/StemStudio\/web"/);
});

test('the built web app is committed, relative and complete', async () => {
  const html = await read('comfy_nodes/StemStudio/app/index.html');
  const references = [...html.matchAll(/(?:src|href)="(\.\/[^"]+)"/g)].map(match => match[1]);
  assert.ok(references.some(path => path.endsWith('.js')) && references.some(path => path.endsWith('.css')), 'script and stylesheet are referenced');
  for (const path of references) assert.ok((await stat(join(pack, 'app', path))).isFile(), path);
  assert.doesNotMatch(html, /(?:src|href)="\//, 'no root-absolute URLs: the app is served below /stemstudio/app/');
});

test('versions agree and the registry file is complete', async () => {
  const version = JSON.parse(await read('package.json')).version;
  const project = await read('pyproject.toml');
  assert.match(project, new RegExp(`^version = "${version.replaceAll('.', '\\.')}"`, 'm'));
  assert.match(project, /\[tool\.comfy\]/);
  assert.match(project, /PublisherId = ""/, 'the publisher id is for the owner to fill in');
  assert.match(project, /license = \{ text = "MIT" \}/);
});

test('shared graph modules are free of Node and Electron imports', async () => {
  for (const file of ['src/graphs.mjs', 'src/engine-status.mjs', 'src/web-desktop.mjs', 'src/shared/brush.mjs', 'src/shared/music.mjs', 'src/shared/mmaudio.mjs', 'src/shared/connection.mjs', 'src/shared/node-capabilities.mjs', 'src/shared/resources.mjs']) {
    const text = await read(file);
    assert.doesNotMatch(text, /from 'node:|from "node:|require\(|from 'electron'/, file);
  }
});

test('node pack routes are local-only and keep preparation behind explicit POSTs', async () => {
  const routes = await read('comfy_nodes/StemStudio/web_routes.py');
  assert.match(routes, /is_local\(request\.remote/);
  assert.match(routes, /Cross-origin requests are not allowed/);
  const init = await read('comfy_nodes/StemStudio/__init__.py');
  assert.doesNotMatch(init, /prepare_sam|prepare_guidesep|prepare_models/, 'nothing prepares at node discovery');
});
