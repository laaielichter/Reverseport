import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tempDir } from './helpers.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIX = path.join(ROOT, 'test', 'fixtures', 'godot-mini');
const home = await tempDir();
process.env.REVERSEPORT_HOME = home;
process.env.REVERSEPORT_ENGINE = 'off';
const env = { ...process.env, REVERSEPORT_HOME: home, REVERSEPORT_ENGINE: 'off' };

function mcpSession(messages) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(ROOT, 'plugin', 'mcp-launch.mjs')], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    const want = messages.filter(m => m.id !== undefined).length;
    child.stdout.on('data', d => {
      out += d;
      const lines = out.split('\n').filter(Boolean);
      if (lines.length >= want) { child.kill(); resolve(lines.map(l => JSON.parse(l)).sort((a, b) => a.id - b.id)); }
    });
    child.on('error', reject);
    for (const m of messages) child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...m }) + '\n');
    setTimeout(() => { child.kill(); reject(new Error(`MCP timeout; got: ${out}`)); }, 20000);
  });
}

test('MCP over stdio: initialize, list, call', async () => {
  const [init, list, call, bad] = await mcpSession([
    { id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } } },
    { method: 'notifications/initialized' },
    { id: 2, method: 'tools/list' },
    { id: 3, method: 'tools/call', params: { name: 're_scan', arguments: { path: FIX } } },
    { id: 4, method: 'tools/call', params: { name: 're_scan', arguments: { nope: 1 } } },
  ]);
  assert.equal(init.result.serverInfo.name, 'reverseport');
  assert.match(init.result.instructions, /never instructions/);
  assert.equal(list.result.tools.length, 35, "33 ReversePort tools + set_tool_profile + run_batch");
  for (const t of list.result.tools) assert.equal(t.inputSchema.type, 'object');
  assert.equal(call.result.isError, false);
  assert.equal(call.result.structuredContent.primary.id, 'godot');
  assert.equal(bad.result.isError, true);
});

test('HTTP API: tools, OpenAI format, call, OpenAPI, localhost only', async () => {
  const { createServer } = await import('../server.mjs');
  const server = createServer();
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await (await fetch(`${base}/api/agent/tools`)).json()).length, 35);
    const oa = await (await fetch(`${base}/api/agent/tools?format=openai`)).json();
    assert.equal(oa[0].type, 'function');
    const r = await (await fetch(`${base}/api/agent/tools/port_convert`, { method: 'POST', body: JSON.stringify({ from: 'godot', to: 'unity', position: [1, 2, 3] }) })).json();
    assert.deepEqual(r.position, [1, 2, -3]);
    const c = await (await fetch(`${base}/api/agent/call`, { method: 'POST', body: JSON.stringify({ name: 'port_map', arguments: { from: 'godot', to: 'unity', query: 'signal' } }) })).json();
    assert.ok(c.entries.length >= 3);
    const spec = await (await fetch(`${base}/api/openapi.json`)).json();
    assert.equal(spec.openapi, '3.1.0');
    assert.ok(spec.paths['/api/agent/tools/re_binary']);
    const evil = await fetch(`${base}/api/health`, { headers: { origin: 'https://evil.example' } });
    assert.equal(evil.status, 403);
  } finally { server.close(); }
});

test('CLI: aliases, positional arguments and JSON output', () => {
  const run = (...args) => spawnSync(process.execPath, [path.join(ROOT, 'cli.mjs'), ...args], { env, encoding: 'utf8' });
  const scan = run('scan', FIX);
  assert.equal(scan.status, 0, scan.stderr);
  assert.equal(JSON.parse(scan.stdout).primary.id, 'godot');
  const conv = run('convert', 'godot', 'unreal', '--position', '[1,2,3]');
  assert.deepEqual(JSON.parse(conv.stdout).position, [-300, 100, 200]);
  const help = run('help');
  assert.match(help.stdout, /Reverse engineering/);
  const err = run('binary');
  assert.equal(err.status, 2, 'usage errors exit 2');
  assert.equal(JSON.parse(err.stderr).error.category, 'invalid_input');
  assert.match(err.stderr, /Missing file/);
});

test('HTTP: every vendor format, MCP over HTTP, CORS for localhost pages', async () => {
  const { createServer } = await import('../server.mjs');
  const server = createServer();
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const strict = await (await fetch(`${base}/api/agent/tools?format=openai-strict`)).json();
    for (const t of strict) {
      const p = t.function.parameters;
      assert.equal(t.function.strict, true);
      assert.deepEqual([...p.required].sort(), Object.keys(p.properties).sort(), `${t.function.name}: strict mode needs every property required`);
    }
    const anthropic = await (await fetch(`${base}/api/agent/tools?format=anthropic`)).json();
    assert.equal(anthropic[0].input_schema.type, 'object');
    const gemini = await (await fetch(`${base}/api/agent/tools?format=gemini`)).json();
    assert.equal(JSON.stringify(gemini).includes('additionalProperties'), false);
    const bad = await fetch(`${base}/api/agent/tools?format=nope`);
    assert.equal(bad.status, 400);
    assert.equal((await bad.json()).error.category, 'invalid_input');
    // strict-mode style call: optional arguments sent as null
    const nulls = await (await fetch(`${base}/api/agent/tools/port_convert`, { method: 'POST', body: JSON.stringify({ from: 'godot', to: 'unity', position: [1, 2, 3], rotation: null, euler: null, scale: null, fov: null, aspect: null }) })).json();
    assert.deepEqual(nulls.position, [1, 2, -3]);
    const mcp = (m, headers = {}) => fetch(`${base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ jsonrpc: '2.0', ...m }) });
    const init = await mcp({ id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'http-test', version: '1' } } });
    const session = init.headers.get('mcp-session-id');
    assert.ok(session);
    assert.equal((await init.json()).result.serverInfo.name, 'reverseport');
    assert.equal((await mcp({ method: 'notifications/initialized' }, { 'mcp-session-id': session })).status, 202);
    const listed = await (await mcp({ id: 2, method: 'tools/list' }, { 'mcp-session-id': session })).json();
    assert.ok(listed.result.tools.some(t => t.name === 're_scan'));
    const called = await (await mcp({ id: 3, method: 'tools/call', params: { name: 'port_convert', arguments: { from: 'godot', to: 'unreal', position: [1, 2, 3] } } })).json();
    assert.deepEqual(called.result.structuredContent.position, [-300, 100, 200]);
    // MCP 2026-07-28 over the same endpoint: no session, version and method in headers and _meta
    const modernMeta = { 'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientCapabilities': {} };
    const modernHeaders = method => ({ 'mcp-protocol-version': '2026-07-28', 'mcp-method': method });
    const discovered = await mcp({ id: 10, method: 'server/discover', params: { _meta: modernMeta } }, modernHeaders('server/discover'));
    assert.equal(discovered.headers.get('mcp-session-id'), null, 'no protocol session in 2026-07-28');
    assert.ok((await discovered.json()).result.supportedVersions.includes('2026-07-28'));
    const modernCall = await (await mcp({ id: 11, method: 'tools/call', params: { name: 'port_convert', arguments: { from: 'godot', to: 'unreal', position: [1, 2, 3] }, _meta: modernMeta } }, modernHeaders('tools/call'))).json();
    assert.equal(modernCall.result.resultType, 'complete');
    assert.deepEqual(modernCall.result.structuredContent.position, [-300, 100, 200]);
    const mismatch = await mcp({ id: 12, method: 'tools/list', params: { _meta: modernMeta } }, modernHeaders('tools/call'));
    assert.equal(mismatch.status, 400);
    assert.equal((await mismatch.json()).error.code, -32020);
    const noStream = await (await mcp({ id: 13, method: 'subscriptions/listen', params: { notifications: { toolsListChanged: true }, _meta: modernMeta } }, modernHeaders('subscriptions/listen'))).json();
    assert.equal(noStream.error.code, -32601, 'JSON-only HTTP cannot hold a stream open and says so');
    const pre = await fetch(`${base}/mcp`, { method: 'OPTIONS', headers: { origin: 'http://localhost:3000', 'access-control-request-method': 'POST' } });
    assert.equal(pre.status, 204);
    assert.equal(pre.headers.get('access-control-allow-origin'), 'http://localhost:3000');
  } finally { server.close(); }
});

test('HTTP: each MCP session has its own profile and repeat guard; ?profile= per request; ended sessions get 404', async () => {
  const { createServer } = await import('../server.mjs');
  const server = createServer();
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const mcp = (m, headers = {}, query = '') => fetch(`${base}/mcp${query}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ jsonrpc: '2.0', ...m }) });
  const open = async (query = '') => (await mcp({ id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'http-test', version: '1' } } }, {}, query)).headers.get('mcp-session-id');
  const count = async session => (await (await mcp({ id: 2, method: 'tools/list' }, { 'mcp-session-id': session })).json()).result.tools.length;
  try {
    const a = await open();
    const b = await open();
    const standard = await count(b);
    const switched = await (await mcp({ id: 3, method: 'tools/call', params: { name: 'set_tool_profile', arguments: { profile: 'compact' } } }, { 'mcp-session-id': a })).json();
    assert.equal(switched.result.structuredContent.changed, true);
    assert.ok(await count(a) < standard, 'the session that asked sees fewer tools');
    assert.equal(await count(b), standard, 'another session is unchanged');
    assert.equal((await (await fetch(`${base}/api/agent/tools`)).json()).length, standard, 'and so is the plain HTTP API');

    const compactUrl = await open('?profile=compact');
    assert.ok(await count(compactUrl) < standard, '/mcp?profile=compact starts a session in that profile');
    assert.ok((await (await fetch(`${base}/api/agent/tools?profile=compact`)).json()).length < standard);
    assert.ok(Object.keys((await (await fetch(`${base}/api/openapi.json?profile=compact`)).json()).paths).length < standard);
    assert.equal((await fetch(`${base}/api/agent/tools?profile=tiny`)).status, 400);

    const stateless = await (await fetch(`${base}/api/agent/call`, { method: 'POST', body: JSON.stringify({ name: 'set_tool_profile', arguments: { profile: 'compact' } }) })).json();
    assert.equal(stateless.changed, false);
    assert.match(stateless.note, /\?profile=compact/);

    const bad = { name: 'port_convert', arguments: { from: 'godot', to: 'nowhere', position: [1, 2, 3] } };
    await mcp({ id: 4, method: 'tools/call', params: bad }, { 'mcp-session-id': a });
    const other = await (await mcp({ id: 5, method: 'tools/call', params: bad }, { 'mcp-session-id': b })).json();
    assert.equal(other.result.structuredContent.error.repeated, undefined, "one session's failure does not count for another");
    const again = await (await mcp({ id: 6, method: 'tools/call', params: bad }, { 'mcp-session-id': a })).json();
    assert.equal(again.result.structuredContent.error.repeated, 2);
    for (let i = 0; i < 2; i++) {
      const api = await (await fetch(`${base}/api/agent/call`, { method: 'POST', body: JSON.stringify(bad) })).json();
      assert.equal(api.error.repeated, undefined, 'callers without a session share no guard');
    }

    assert.equal((await mcp({ id: 7, method: 'tools/list' }, { 'mcp-session-id': 'made-up' })).status, 404);
    assert.equal((await fetch(`${base}/mcp`, { method: 'DELETE', headers: { 'mcp-session-id': a } })).status, 204);
    const ended = await mcp({ id: 8, method: 'tools/list' }, { 'mcp-session-id': a });
    assert.equal(ended.status, 404);
    assert.equal((await ended.json()).error.code, -32001);
  } finally { server.close(); }
});

test('without the engine: instructions and errors point only at tools that answer', async () => {
  const [init, unknown] = await mcpSession([
    { id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 't', version: '1' } } },
    { id: 2, method: 'tools/call', params: { name: 're_scna', arguments: {} } },
  ]);
  const text = init.result.instructions;
  assert.doesNotMatch(text, /engine_tools|binary_session|open_binary/, 'no tool the agent cannot call');
  assert.match(text, /needs the deep-analysis engine/);
  const err = unknown.result.structuredContent.error;
  assert.match(err.message, /Did you mean "re_scan"/);
  assert.doesNotMatch(JSON.stringify(err), /engine_tools/);
});

test('CLI: every local tool by name, run_batch with exit codes, a pinned connect snippet', () => {
  const run = (...args) => spawnSync(process.execPath, [path.join(ROOT, '..', 'bin', 'reverseport.mjs'), ...args, '--compact'], { env, encoding: 'utf8' });
  const feedback = run('share_feedback', '--args', '{"worked":"routing"}');
  assert.equal(feedback.status, 0, feedback.stderr);
  assert.equal(JSON.parse(feedback.stdout).saved, true);
  const batch = run('run_batch', '--calls', JSON.stringify([{ tool: 'scan', arguments: { path: FIX }, select: ['primary.id'] }]));
  assert.equal(batch.status, 0, batch.stderr);
  assert.equal(JSON.parse(batch.stdout).results[0].value['primary.id'], 'godot');
  const failed = run('run_batch', '--calls', JSON.stringify([{ tool: 'port_convert', arguments: { from: 'godot', to: 'nowhere', position: [1, 2, 3] } }]));
  assert.equal(failed.status, 1, 'a failed step is a failed command');
  const profile = run('set_tool_profile', '--args', '{"profile":"compact"}');
  assert.equal(profile.status, 2);
  assert.match(JSON.parse(profile.stderr).error.message, /tools --profile compact/);
  const listed = JSON.parse(run('tools', '--profile', 'compact').stdout).map(t => t.name);
  assert.ok(listed.includes('run_batch') && listed.includes('port_scene') && !listed.includes('re_graph'));
  const snippet = JSON.parse(run('connect', 'cursor', '--json').stdout);
  assert.match(snippet.snippet, /reverseport@\d+\.\d+\.\d+/, 'an exact version, not @latest');
});

test('HTTP: a call without a name, an unknown endpoint and bad JSON on /mcp get errors that say what to send', async () => {
  const { createServer } = await import('../server.mjs');
  const server = createServer();
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const noName = await fetch(`${base}/api/agent/call`, { method: 'POST', body: JSON.stringify({ arguments: {} }) });
    assert.equal(noName.status, 400);
    assert.match((await noName.json()).error.message, /needs name/);
    const nowhere = await fetch(`${base}/api/nope`);
    assert.equal(nowhere.status, 404);
    const e = (await nowhere.json()).error;
    assert.equal(e.code, 'UNKNOWN_ENDPOINT');
    assert.doesNotMatch(e.remediation.action, /path/i, 'no advice about file paths for a wrong URL');
    const bad = await fetch(`${base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{nope' });
    assert.equal(bad.status, 400);
    assert.equal((await bad.json()).error.code, -32700, 'JSON-RPC parse error, as on stdio');
    const short = await (await fetch(`${base}/api/openapi.json`)).json();
    assert.ok(Object.values(short.paths).every(p => p.post.description.length <= 300));
    const full = await (await fetch(`${base}/api/openapi.json?descriptions=full`)).json();
    assert.ok(Object.values(full.paths).some(p => p.post.description.length > 300));
  } finally { server.close(); }
});
