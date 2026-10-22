import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stemWorkflow } from '../src/graphs.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const load = async folder => Promise.all((await readdir(join(root, folder))).filter(name => name.endsWith('.json')).sort().map(async name => [name, JSON.parse(await readFile(join(root, folder, name), 'utf8'))]));
const python = ['detail_nodes.py', 'extra_nodes.py', '__init__.py'];
const sources = async () => (await Promise.all(python.map(name => readFile(join(root, 'comfy_nodes/StemStudio', name), 'utf8')))).join('\n');

test('graph workflows are self-consistent', async () => {
  const files = await load('workflows');
  assert.ok(files.length >= 6);
  for (const [name, flow] of files) {
    const nodes = new Map(flow.nodes.map(node => [node.id, node]));
    assert.equal(nodes.size, flow.nodes.length, `${name}: unique node ids`);
    assert.equal(new Set(flow.links.map(link => link[0])).size, flow.links.length, `${name}: unique link ids`);
    for (const [id, from, slot, to, input, type] of flow.links) {
      const source = nodes.get(from), target = nodes.get(to);
      assert.ok(source && target, `${name}: link ${id} endpoints exist`);
      assert.equal(source.outputs[slot].type, type, `${name}: link ${id} output type`);
      assert.equal(target.inputs[input].type, type, `${name}: link ${id} input type`);
      assert.equal(target.inputs[input].link, id, `${name}: link ${id} recorded on its input`);
      assert.ok(source.outputs[slot].links.includes(id), `${name}: link ${id} recorded on its output`);
    }
    for (const node of flow.nodes) for (const input of node.inputs) if (input.link != null) assert.ok(flow.links.some(link => link[0] === input.link), `${name}: input link ${input.link} exists`);
    assert.ok(flow.nodes.some(node => node.type === 'LoadAudio'), `${name}: has an input`);
    assert.ok(flow.nodes.some(node => node.type === 'SaveAudio'), `${name}: has an output`);
  }
});

test('custom node inputs in the workflows match the Python node definitions, in order', async () => {
  const code = await sources();
  const seen = new Set();
  for (const [name, flow] of await load('workflows')) {
    for (const node of flow.nodes.filter(item => item.type.startsWith('StemStudio'))) {
      const block = code.slice(code.indexOf(`class ${node.type}`)); assert.ok(block.length, `${node.type} exists in Python`);
      const body = block.slice(block.indexOf('INPUT_TYPES'), block.indexOf('RETURN_TYPES'));
      let cursor = 0;
      for (const input of node.inputs) {
        const at = Math.max(body.indexOf(`'${input.name}'`, cursor), body.indexOf(`"${input.name}"`, cursor) >= 0 ? body.indexOf(`"${input.name}"`, cursor) : -1);
        assert.ok(at >= cursor, `${name}: ${node.type}.${input.name} follows the Python order`);
        cursor = at;
      }
      const widgets = node.inputs.filter(input => input.widget).length;
      assert.equal(node.widgets_values.length, widgets, `${name}: ${node.type} widget values`);
      seen.add(node.type);
    }
  }
  for (const type of ['StemStudioSeparate', 'StemStudioExtract', 'StemStudioSAM', 'StemStudioGuideSep']) assert.ok(seen.has(type), `${type} is covered`);
});

test('API workflows are exactly what the app submits and reference real nodes', async () => {
  const files = new Map(await load('workflows/api'));
  const entries = [...files.entries()];
  const expected = [
    ['Stem-Studio_01', stemWorkflow({ mode: 'stems', model: 'mrx' })],
    ['Stem-Studio_02', stemWorkflow({ mode: 'uss', target: 'Walk, footsteps', threshold: 0.1, autoThreshold: true })],
    ['Stem-Studio_03', stemWorkflow({ mode: 'sam', target: 'footsteps', samModel: 'small-tv' })],
    ['Stem-Studio_04', stemWorkflow({ mode: 'guidesep', target: 'reference' })],
    ['Stem-Studio_06', stemWorkflow({ mode: 'brush', target: 'footsteps', brush: { prompt: 'slow footsteps on wet gravel, close up', seconds: 3, start: 2, seed: 12345 } })],
  ];
  for (const [prefix, graph] of expected) {
    const [, actual] = entries.find(([name]) => name.startsWith(prefix));
    for (const [id, node] of Object.entries(graph)) {
      assert.equal(actual[id].class_type, node.class_type, `${prefix}: node ${id}`);
      for (const [key, value] of Object.entries(node.inputs)) if (key !== 'audio' || node.class_type !== 'LoadAudio') assert.deepEqual(actual[id].inputs[key], value, `${prefix}: ${id}.${key}`);
    }
  }
  for (const [name, graph] of entries) for (const [id, node] of Object.entries(graph)) for (const value of Object.values(node.inputs)) if (Array.isArray(value)) assert.ok(graph[value[0]], `${name}: ${id} references node ${value[0]}`);
});
