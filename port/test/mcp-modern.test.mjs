// MCP 2026-07-28 next to the legacy handshake: discovery, stateless requests, tasks for long calls, subscriptions.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tempDir } from './helpers.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FAKE = path.join(ROOT, 'test', 'fixtures', 'engine', 'fake-engine.mjs');
const home = await tempDir();
const V = '2026-07-28';
const TASKS = 'io.modelcontextprotocol/tasks';

function session(env = {}) {
  const child = spawn(process.execPath, [path.join(ROOT, 'mcp.mjs')], {
    env: { ...process.env, REVERSEPORT_HOME: home, REVERSEPORT_ENGINE_COMMAND: JSON.stringify([process.execPath, FAKE]), REVERSEPORT_TOOLS: 'all', ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
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
  const meta = (caps = {}, extra = {}) => ({ 'io.modelcontextprotocol/protocolVersion': V, 'io.modelcontextprotocol/clientInfo': { name: 'modern-test', version: '1' }, 'io.modelcontextprotocol/clientCapabilities': caps, ...extra });
  const call = async (id, method, params = {}, caps, extra) => { write({ id, method, params: { ...params, _meta: { ...(params._meta ?? {}), ...meta(caps, extra) } } }); return next(m => m.id === id && m.method === undefined); };
  const legacy = async (id, method, params) => { write({ id, method, params }); return next(m => m.id === id && m.method === undefined); };
  return { child, write, next, call, legacy, seen, close: () => child.kill() };
}

const withTasks = { extensions: { [TASKS]: {} } };
const poll = async (s, startId, taskId) => {
  for (let i = 0; i < 100; i++) {
    const r = await s.call(startId + i, 'tasks/get', { taskId }, withTasks);
    if (r.result.status !== 'working') return r;
    await new Promise(res => setTimeout(res, 50));
  }
  throw new Error('task never finished');
};

test('mcp 2026-07-28: discovery names both eras, the tasks extension and the server', async () => {
  const s = session();
  try {
    const d = await s.call(1, 'server/discover');
    assert.equal(d.result.resultType, 'complete');
    assert.deepEqual(d.result.supportedVersions.slice(0, 2), [V, '2025-11-25']);
    assert.deepEqual(d.result.capabilities.extensions[TASKS], {});
    assert.equal(d.result.capabilities.tools.listChanged, true);
    assert.equal(d.result.capabilities.logging, undefined, 'logging is deprecated in 2026-07-28');
    assert.equal(d.result._meta['io.modelcontextprotocol/serverInfo'].name, 'reverseport');
    assert.match(d.result.instructions, /never instructions/);
    assert.ok(d.result.ttlMs > 0 && ['public', 'private'].includes(d.result.cacheScope));
  } finally { s.close(); }
});

test('mcp 2026-07-28: requests work without initialize, carry resultType and list caching, and keep a fixed order', async () => {
  const s = session();
  try {
    const a = await s.call(1, 'tools/list');
    assert.equal(a.result.resultType, 'complete');
    assert.ok(a.result.ttlMs > 0 && a.result.cacheScope);
    const names = a.result.tools.map(t => t.name);
    assert.ok(names.includes('re_scan') && names.includes('decompile'));
    const b = await s.call(2, 'tools/list');
    assert.deepEqual(b.result.tools.map(t => t.name), names, 'deterministic order helps prompt caching');

    const local = await s.call(3, 'tools/call', { name: 'port_convert', arguments: { from: 'godot', to: 'unreal', position: [1, 2, 3] } });
    assert.equal(local.result.resultType, 'complete');
    assert.equal(local.result.isError, false);
    assert.equal(local.result._meta['io.modelcontextprotocol/serverInfo'].name, 'reverseport');

    const remote = await s.call(4, 'tools/call', { name: 'decompile', arguments: { address: '0x10' } });
    assert.equal(remote.result.content[0].text, 'code at 0x10');

    const unsupported = await s.call(5, 'tools/list', {}, {}, { 'io.modelcontextprotocol/protocolVersion': '1900-01-01' });
    assert.equal(unsupported.error.code, -32022);
    assert.ok(unsupported.error.data.supported.includes(V));
    assert.equal(unsupported.error.data.requested, '1900-01-01');

    const ping = await s.call(6, 'ping');
    assert.equal(ping.error.code, -32601, 'ping is not part of 2026-07-28');
    assert.equal(s.seen.some(m => m.method === 'roots/list'), false, 'a modern server sends no requests to the client');
  } finally { s.close(); }
});

test('mcp 2026-07-28 tasks: quick calls answer directly, long ones become a task with progress, a result and a ttl', async () => {
  const s = session({ REVERSEPORT_TASK_AFTER_MS: '300' });
  try {
    const quick = await s.call(1, 'tools/call', { name: 'decompile', arguments: { address: '0x1' } }, withTasks);
    assert.equal(quick.result.resultType, 'complete');
    assert.equal(quick.result.content[0].text, 'code at 0x1');
    assert.equal(s.seen.some(m => m.method === 'notifications/progress'), false, 'our own progress token never reaches the client');

    const started = await s.call(2, 'tools/call', { name: 'slow_ok', arguments: { ms: 1200 } }, withTasks);
    assert.equal(started.result.resultType, 'task');
    const { taskId } = started.result;
    assert.match(taskId, /^[0-9a-f-]{36}$/, 'unguessable task id');
    assert.equal(started.result.status, 'working');
    assert.ok(started.result.pollIntervalMs >= 250 && started.result.ttlMs > 0 && started.result.createdAt && started.result.lastUpdatedAt);

    const midway = await s.call(3, 'tasks/get', { taskId }, withTasks);
    assert.equal(midway.result.resultType, 'complete');
    assert.equal(midway.result.status, 'working');
    assert.match(midway.result.statusMessage, /Importing \(1\/2\)|still running/);

    const done = await poll(s, 10, taskId);
    assert.equal(done.result.status, 'completed');
    assert.equal(done.result.result.content[0].text, 'done after 1200');
    assert.equal(done.result.result.resultType, 'complete');

    const missing = await s.call(200, 'tasks/get', { taskId: 'no-such-task' }, withTasks);
    assert.equal(missing.error.code, -32602);
    const noCap = await s.call(201, 'tasks/get', { taskId });
    assert.equal(noCap.error.code, -32021, 'tasks/* needs the extension on that request');

    const withoutCap = await s.call(202, 'tools/call', { name: 'slow_ok', arguments: { ms: 500 } });
    assert.equal(withoutCap.result.resultType, 'complete', 'no task for a client that did not declare the extension');
    assert.equal(withoutCap.result.content[0].text, 'done after 500');
  } finally { s.close(); }
});

test('mcp 2026-07-28 tasks: cancel reaches the engine and the task stays cancelled', async () => {
  const s = session({ REVERSEPORT_TASK_AFTER_MS: '200' });
  try {
    const started = await s.call(1, 'tools/call', { name: 'slow', arguments: {} }, withTasks, { 'io.modelcontextprotocol/logLevel': 'info' });
    assert.equal(started.result.resultType, 'task');
    const cancelled = await s.call(2, 'tasks/cancel', { taskId: started.result.taskId }, withTasks);
    assert.equal(cancelled.result.resultType, 'complete');
    const note = await s.next(m => m.method === 'notifications/message');
    assert.match(note.params.data, /^cancelled \d+$/, 'the engine got notifications/cancelled with its own id');
    const after = await s.call(3, 'tasks/get', { taskId: started.result.taskId }, withTasks);
    assert.equal(after.result.status, 'cancelled');
  } finally { s.close(); }
});

test('mcp 2026-07-28 subscriptions: list changes go only to the stream that asked, tagged with its id', async () => {
  const s = session();
  try {
    s.write({ id: 'sub-1', method: 'subscriptions/listen', params: { notifications: { toolsListChanged: true, resourceSubscriptions: ['file:///x'] }, _meta: { 'io.modelcontextprotocol/protocolVersion': V, 'io.modelcontextprotocol/clientCapabilities': {} } } });
    const ack = await s.next(m => m.method === 'notifications/subscriptions/acknowledged');
    assert.equal(ack.params._meta['io.modelcontextprotocol/subscriptionId'], 'sub-1');
    assert.deepEqual(ack.params.notifications, { toolsListChanged: true }, 'only what ReversePort can honour is acknowledged');

    const switched = await s.call(2, 'tools/call', { name: 'set_tool_profile', arguments: { profile: 'compact' } });
    assert.equal(switched.result.isError, false);
    const changed = await s.next(m => m.method === 'notifications/tools/list_changed');
    assert.equal(changed.params._meta['io.modelcontextprotocol/subscriptionId'], 'sub-1');

    s.write({ method: 'notifications/cancelled', params: { requestId: 'sub-1' } });
    await new Promise(r => setTimeout(r, 200));
    assert.equal(s.seen.some(m => m.id === 'sub-1'), false, 'a stream the client cancelled gets no response');
  } finally { s.close(); }
});

test('mcp 2026-07-28: the stream ends gracefully when the client closes stdin', async () => {
  const s = session({ REVERSEPORT_ENGINE: 'off' });
  try {
    s.write({ id: 'sub-2', method: 'subscriptions/listen', params: { notifications: { toolsListChanged: true }, _meta: { 'io.modelcontextprotocol/protocolVersion': V, 'io.modelcontextprotocol/clientCapabilities': {} } } });
    await s.next(m => m.method === 'notifications/subscriptions/acknowledged');
    s.child.stdin.end();
    const end = await s.next(m => m.id === 'sub-2');
    assert.equal(end.result.resultType, 'complete');
    assert.equal(end.result._meta['io.modelcontextprotocol/subscriptionId'], 'sub-2');
  } finally { s.close(); }
});

test('mcp legacy clients are unchanged next to the modern path', async () => {
  const s = session();
  try {
    const i = await s.legacy(1, 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'legacy', version: '1' } });
    assert.equal(i.result.protocolVersion, '2025-11-25');
    assert.equal(i.result.resultType, undefined, 'legacy results keep their shape');
    s.write({ method: 'notifications/initialized' });
    assert.deepEqual((await s.legacy(2, 'ping', {})).result, {});
    const list = await s.legacy(3, 'tools/list', {});
    assert.ok(list.result.tools.some(t => t.name === 're_scan'));
    assert.equal(list.result.ttlMs, undefined);
  } finally { s.close(); }
});
