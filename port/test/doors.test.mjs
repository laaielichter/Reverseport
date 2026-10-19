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
  assert.equal(list.result.tools.length, 30, "29 ReversePort tools + set_tool_profile");
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
    assert.equal((await (await fetch(`${base}/api/agent/tools`)).json()).length, 30);
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
    const pre = await fetch(`${base}/mcp`, { method: 'OPTIONS', headers: { origin: 'http://localhost:3000', 'access-control-request-method': 'POST' } });
    assert.equal(pre.status, 204);
    assert.equal(pre.headers.get('access-control-allow-origin'), 'http://localhost:3000');
  } finally { server.close(); }
});
