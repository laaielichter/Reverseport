// The merged MCP server: ReversePort's own tools plus the engine's, relayed through one stdio connection.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tempDir } from './helpers.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FAKE = path.join(ROOT, 'test', 'fixtures', 'engine', 'fake-engine.mjs');
const home = await tempDir();

function session(env) {
  const child = spawn(process.execPath, [path.join(ROOT, 'mcp.mjs')], { env: { ...process.env, REVERSEPORT_HOME: home, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
  const seen = [];
  const waiters = [];
  let out = '';
  child.stdout.on('data', d => {
    out += d;
    let i;
    while ((i = out.indexOf('\n')) >= 0) {
      const msg = JSON.parse(out.slice(0, i));
      out = out.slice(i + 1);
      seen.push(msg);
      for (const w of [...waiters]) if (w.match(msg)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(msg); }
    }
  });
  const next = (match, ms = 15000) => {
    const hit = seen.find(match);
    if (hit) { seen.splice(seen.indexOf(hit), 1); return Promise.resolve(hit); }
    return new Promise((resolve, reject) => {
      const w = { match: m => { if (!match(m)) return false; seen.splice(seen.indexOf(m), 1); return true; }, resolve };
      waiters.push(w);
      setTimeout(() => reject(new Error(`timeout; seen ${JSON.stringify(seen)}`)), ms).unref();
    });
  };
  const write = m => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...m })}\n`);
  const call = async (id, method, params) => { write({ id, method, params }); return next(m => m.id === id && m.method === undefined); };
  return { child, write, next, call, close: () => child.kill() };
}

const init = { protocolVersion: '2025-06-18', capabilities: { roots: {} }, clientInfo: { name: 'test', version: '1' } };

test('relay: one server lists both tool sets and routes calls', async () => {
  const s = session({ REVERSEPORT_ENGINE_COMMAND: JSON.stringify([process.execPath, FAKE]), REVERSEPORT_TOOLS: 'all' });
  try {
    const i = await s.call(1, 'initialize', init);
    assert.equal(i.result.serverInfo.name, 'reverseport');
    assert.match(i.result.instructions, /never instructions/);
    assert.doesNotMatch(i.result.instructions, /ENGINE ROUTING/, 'the engine\'s routing is not repeated');
    assert.ok(i.result.capabilities.prompts, 'engine capabilities are advertised');
    s.write({ method: 'notifications/initialized' });

    const list = await s.call(2, 'tools/list', {});
    const names = list.result.tools.map(t => t.name);
    assert.ok(names.includes('re_scan') && names.includes('port_plan') && names.includes('decompile') && names.includes('ask_roots'));
    assert.equal(names.filter(n => n === 're_scan').length, 1, 'local tools shadow engine tools with the same name');
    assert.equal(list.result.tools.find(t => t.name === 're_scan').description.includes('shadowed'), false);

    const local = await s.call(3, 'tools/call', { name: 'port_convert', arguments: { from: 'godot', to: 'unreal', position: [1, 2, 3] } });
    assert.equal(local.result.isError, false);

    s.write({ id: 4, method: 'tools/call', params: { name: 'decompile', arguments: { address: '0x10' }, _meta: { progressToken: 'tok' } } });
    const progress = await s.next(m => m.method === 'notifications/progress');
    assert.equal(progress.params.progressToken, 'tok');
    const remote = await s.next(m => m.id === 4);
    assert.equal(remote.result.content[0].text, 'code at 0x10');

    const prompts = await s.call(5, 'prompts/list', {});
    assert.equal(prompts.result.prompts[0].name, 'investigate');

    // engine → client request (roots/list) and the client's answer back
    s.write({ id: 6, method: 'tools/call', params: { name: 'ask_roots', arguments: {} } });
    const ask = await s.next(m => m.method === 'roots/list');
    assert.match(String(ask.id), /^rp-/);
    s.write({ id: ask.id, result: { roots: [{ uri: 'file:///x' }] } });
    const answered = await s.next(m => m.id === 6);
    assert.deepEqual(JSON.parse(answered.result.content[0].text), { roots: [{ uri: 'file:///x' }] });

    // cancellation reaches the engine with the engine's own request id
    s.write({ id: 7, method: 'tools/call', params: { name: 'slow', arguments: {} } });
    await new Promise(r => setTimeout(r, 200));
    s.write({ method: 'notifications/cancelled', params: { requestId: 7, reason: 'test' } });
    const note = await s.next(m => m.method === 'notifications/message');
    assert.match(note.params.data, /^cancelled \d+$/);

    // the engine going away: the agent is told why, local tools keep working, and the next engine call restarts it
    s.write({ id: 8, method: 'tools/call', params: { name: 'engine_call', arguments: { tool: 'crash', arguments: {} } } });
    const crashed = await s.next(m => m.id === 8);
    assert.equal(crashed.result.isError, true);
    assert.equal(crashed.result.structuredContent.error.code, 'ENGINE_STOPPED');
    assert.equal(crashed.result.structuredContent.error.retryable, true, 'a crash says: call again');
    await s.next(m => m.method === 'notifications/tools/list_changed');
    const after = await s.call(9, 'tools/list', {});
    assert.equal(after.result.tools.some(t => t.name === 'decompile'), false);
    const stillLocal = await s.call(10, 'tools/call', { name: 'port_map', arguments: { from: 'godot', to: 'unity' } });
    assert.equal(stillLocal.result.isError, false);
    const again = await s.call(11, 'tools/call', { name: 'decompile', arguments: { address: '0x20' } });
    assert.equal(again.result.content[0].text, 'code at 0x20', 'the engine restarted on demand');
  } finally { s.close(); }
});

test('relay: a short default list, with every engine tool one call away', async () => {
  const s = session({ REVERSEPORT_ENGINE_COMMAND: JSON.stringify([process.execPath, FAKE]) });
  try {
    await s.call(1, 'initialize', init);
    const names = (await s.call(2, 'tools/list', {})).result.tools.map(t => t.name);
    assert.ok(names.includes('re_scan') && names.includes('engine_tools') && names.includes('engine_call'));
    assert.equal(names.includes('decompile'), false, 'not a core engine tool, so not listed by default');
    for (const t of (await s.call(3, 'tools/list', {})).result.tools.filter(x => x.name.startsWith('re_') || x.name.startsWith('port_'))) assert.equal(typeof t.annotations.readOnlyHint, 'boolean');
    const found = await s.call(4, 'tools/call', { name: 'engine_tools', arguments: { query: 'fake' } });
    assert.ok(found.result.structuredContent.tools.some(t => t.name === 'decompile'));
    const full = await s.call(5, 'tools/call', { name: 'engine_tools', arguments: { names: ['decompile'] } });
    assert.equal(full.result.structuredContent.tools[0].inputSchema.type, 'object');
    const via = await s.call(6, 'tools/call', { name: 'engine_call', arguments: { tool: 'decompile', arguments: { address: '0x30' } } });
    assert.equal(via.result.content[0].text, 'code at 0x30');
    const direct = await s.call(7, 'tools/call', { name: 'decompile', arguments: { address: '0x40' } });
    assert.equal(direct.result.content[0].text, 'code at 0x40', 'hidden engine tools still answer when called by name');
    const typo = await s.call(8, 'tools/call', { name: 'engine_call', arguments: { tool: 'decompil' } });
    assert.match(typo.result.structuredContent.error.message, /did you mean "decompile"/i);
  } finally { s.close(); }
});

test('relay: profiles fit the list to the agent without hiding anything', async () => {
  const s = session({ REVERSEPORT_ENGINE_COMMAND: JSON.stringify([process.execPath, FAKE]), REVERSEPORT_PROFILE: 'compact' });
  try {
    await s.call(1, 'initialize', init);
    s.write({ method: 'notifications/initialized' });
    const compact = (await s.call(2, 'tools/list', {})).result.tools;
    const scan = compact.find(t => t.name === 're_scan');
    assert.ok(scan.description.length <= 225, 'compact descriptions are one sentence');
    const full = await s.call(3, 'tools/call', { name: 'set_tool_profile', arguments: { profile: 'full' } });
    assert.equal(full.result.structuredContent.profile, 'full');
    await s.next(m => m.method === 'notifications/tools/list_changed');
    const all = (await s.call(4, 'tools/list', {})).result.tools;
    assert.ok(all.some(t => t.name === 'decompile'), 'full lists every engine tool');
    assert.ok(all.length > compact.length);
    const bad = await s.call(5, 'tools/call', { name: 'set_tool_profile', arguments: { profile: 'huge' } });
    assert.equal(bad.result.isError, true);
  } finally { s.close(); }
});

test('relay: without an engine the local tools still work and the instructions say how to add the rest', async () => {
  const s = session({ REVERSEPORT_ENGINE_COMMAND: '', REVERSEPORT_ENGINE: 'off' });
  try {
    const i = await s.call(1, 'initialize', init);
    assert.equal(i.result.serverInfo.name, 'reverseport');
    const list = await s.call(2, 'tools/list', {});
    assert.equal(list.result.tools.length, 35, "34 ReversePort tools + set_tool_profile");
    const unknown = await s.call(3, 'tools/call', { name: 'decompile', arguments: {} });
    assert.equal(unknown.result.isError, true, 'unknown tools are tool results agents can read');
    assert.equal(unknown.result.structuredContent.error.code, 'UNKNOWN_TOOL');
    const typo = await s.call(5, 'tools/call', { name: 're_scna', arguments: {} });
    assert.match(typo.result.structuredContent.error.message, /did you mean "re_scan"/i);
    assert.doesNotMatch(typo.result.structuredContent.error.message, /engine is|not built|turned off/i, 'a typo is not blamed on the engine');
    const engineTool = await s.call(4, 'tools/call', { name: 'open_binary', arguments: {} });
    assert.equal(engineTool.result.isError, true, 'a real engine tool is reported as unavailable, not unknown');
    assert.equal(engineTool.result.structuredContent.error.code, 'ENGINE_OFF');
    assert.match(engineTool.result.structuredContent.error.remediation.action, /Unset it/);
    assert.doesNotMatch(engineTool.result.structuredContent.error.remediation.action, /npm ci/, 'engine off never tells the agent to build');
  } finally { s.close(); }
});

test('relay: an engine that fails to start is reported, not fatal', async () => {
  const s = session({ REVERSEPORT_ENGINE_COMMAND: JSON.stringify([process.execPath, '-e', 'process.exit(1)']) });
  try {
    const i = await s.call(1, 'initialize', init);
    assert.match(i.result.instructions, /did not start \(exited with code 1\)/);
    const list = await s.call(2, 'tools/list', {});
    assert.equal(list.result.tools.length, 35, "34 ReversePort tools + set_tool_profile");
  } finally { s.close(); }
});
