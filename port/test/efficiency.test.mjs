// Fewer calls and fewer tokens for agents: run_batch, short default lists, saved results as MCP resources, and a
// plain stop after the same call fails twice.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tempDir } from './helpers.mjs';
import { pick } from '../src/relay.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GODOT = path.join(ROOT, 'test', 'fixtures', 'godot-mini');
const home = await tempDir();

function session(env = {}) {
  const child = spawn(process.execPath, [path.join(ROOT, 'mcp.mjs')], { env: { ...process.env, REVERSEPORT_HOME: home, REVERSEPORT_ENGINE: 'off', ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
  const waiting = new Map();
  let out = '';
  child.stdout.on('data', d => {
    out += d;
    let i;
    while ((i = out.indexOf('\n')) >= 0) {
      const msg = JSON.parse(out.slice(0, i));
      out = out.slice(i + 1);
      waiting.get(msg.id)?.(msg);
    }
  });
  const call = (id, method, params) => new Promise(resolve => { waiting.set(id, resolve); child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`); });
  return { call, close: () => child.kill() };
}

async function started(env) {
  const s = session(env);
  await s.call(0, 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  return s;
}

test('pick reads dot paths, indexes and every item of a list', () => {
  const v = { primary: { id: 'godot' }, items: [{ file: 'a' }, { file: 'b' }] };
  assert.equal(pick(v, 'primary.id'), 'godot');
  assert.equal(pick(v, 'items[1].file'), 'b');
  assert.deepEqual(pick(v, 'items[*].file'), ['a', 'b']);
  assert.equal(pick(v, 'missing.path'), undefined);
});

test('run_batch: several steps in one call, only the selected fields, a clear stop on the first error', async () => {
  const s = await started();
  try {
    const listed = await s.call(1, 'tools/list', {});
    assert.ok(listed.result.tools.some(t => t.name === 'run_batch'), 'listed even without the engine');

    const ok = await s.call(2, 'tools/call', { name: 'run_batch', arguments: { calls: [
      { tool: 're_scan', arguments: { path: GODOT }, select: ['primary.id', 'entryPoints[*].file'] },
      { tool: 'port_convert', arguments: { from: 'godot', to: 'unreal', position: [1, 2, 3] }, select: ['position'] },
    ] } });
    const batch = ok.result.structuredContent;
    assert.equal(batch.ran, 2);
    assert.equal(batch.results[0].value['primary.id'], 'godot');
    assert.ok(Array.isArray(batch.results[0].value['entryPoints[*].file']));
    assert.deepEqual(batch.results[1].value.position, [-300, 100, 200]);
    assert.equal(Object.keys(batch.results[0].value).length, 2, 'nothing but the selected fields');

    const stopped = await s.call(3, 'tools/call', { name: 'run_batch', arguments: { calls: [
      { tool: 'port_convert', arguments: { from: 'godot', to: 'nowhere', position: [1, 2, 3] } },
      { tool: 're_scan', arguments: { path: GODOT } },
    ] } });
    assert.equal(stopped.result.structuredContent.ran, 1);
    assert.equal(stopped.result.structuredContent.stoppedAt, 0);
    assert.match(stopped.result.structuredContent.next, /from index 0/);
    assert.ok(stopped.result.structuredContent.results[0].error.code);

    const onward = await s.call(4, 'tools/call', { name: 'run_batch', arguments: { continueOnError: true, calls: [
      { tool: 'run_batch', arguments: {} },
      { tool: 'port_convert', arguments: '{"from":"godot","to":"unity","position":[1,2,3]}', select: ['position'] },
    ] } });
    assert.equal(onward.result.structuredContent.ran, 2);
    assert.match(onward.result.structuredContent.results[0].error.message, /cannot run itself/);
    assert.deepEqual(onward.result.structuredContent.results[1].value.position, [1, 2, -3], 'arguments may be a JSON string');

    const tooMany = await s.call(5, 'tools/call', { name: 'run_batch', arguments: { calls: Array.from({ length: 21 }, () => ({ tool: 're_scan', arguments: { path: GODOT } })) } });
    assert.equal(tooMany.result.isError, true);
  } finally { s.close(); }
});

test('the same failing call twice gets a plain "do not repeat it" instead of the same error again', async () => {
  const s = await started();
  try {
    const bad = { name: 'port_convert', arguments: { from: 'godot', to: 'nowhere', position: [1, 2, 3] } };
    const first = await s.call(1, 'tools/call', bad);
    assert.equal(first.result.structuredContent.error.repeated, undefined);
    const second = await s.call(2, 'tools/call', bad);
    const e = second.result.structuredContent.error;
    assert.equal(e.repeated, 2);
    assert.equal(e.retryable, false);
    assert.match(e.message, /failed 2 times in this session/);
    assert.match(e.remediation.action, /Do not send it again unchanged/);
    const fixed = await s.call(3, 'tools/call', { name: 'port_convert', arguments: { ...bad.arguments, to: 'unity' } });
    assert.equal(fixed.result.isError, false);
    const again = await s.call(4, 'tools/call', bad);
    assert.equal(again.result.structuredContent.error.repeated, 3, 'a different call in between does not reset this one');
  } finally { s.close(); }
});

test('a result too big for one answer links to the full one, readable as an MCP resource', async () => {
  const s = await started({ REVERSEPORT_MAX_OUTPUT_BYTES: '4096' });
  try {
    const res = await s.call(1, 'tools/call', { name: 're_symbols', arguments: { path: ROOT, limit: 500 } });
    const note = res.result.structuredContent.outputTruncated;
    assert.ok(note, 'every symbol of the port folder is over 4 KB');
    assert.match(note.fullOutputUri, /^reverseport:\/\/tool-output\/re_symbols-/);
    const link = res.result.content.find(c => c.type === 'resource_link');
    assert.equal(link.uri, note.fullOutputUri);
    assert.equal(link.mimeType, 'application/json');

    const read = await s.call(2, 'resources/read', { uri: note.fullOutputUri });
    const full = JSON.parse(read.result.contents[0].text);
    assert.equal(full.root, res.result.structuredContent.root);
    assert.equal(full.outputTruncated, undefined, 'the resource is the complete result');

    const templates = await s.call(3, 'resources/templates/list', {});
    assert.ok(templates.result.resourceTemplates.some(t => t.uriTemplate === 'reverseport://tool-output/{file}'));
    const escape = await s.call(4, 'resources/read', { uri: 'reverseport://tool-output/..%2F..%2Fsecret' });
    assert.equal(escape.error.code, -32602, 'only plain names inside the tool-output folder');
  } finally { s.close(); }
});

test('run_batch says which select paths found nothing, with the path that works', async () => {
  const s = await started();
  try {
    const r = await s.call(1, 'tools/call', { name: 'run_batch', arguments: { calls: [{ tool: 're_scan', arguments: { path: GODOT }, select: ['primry.id', 'entryPoints.file', 'primary.id'] }] } });
    const step = r.result.structuredContent.results[0];
    assert.equal(step.value['primary.id'], 'godot');
    assert.deepEqual(step.unresolved.map(u => [u.path, u.didYouMean]), [['primry.id', 'primary.id'], ['entryPoints.file', 'entryPoints[*].file']]);
  } finally { s.close(); }
});
