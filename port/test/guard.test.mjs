import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tempDir } from './helpers.mjs';
import { decide, bare, findings } from '../hooks/guard.mjs';

const GUARD = fileURLToPath(new URL('../hooks/guard.mjs', import.meta.url));
const home = await tempDir('rp-guard-');
const run = (phase, input, env = {}) => {
  const r = spawnSync(process.execPath, [GUARD, phase], { input: JSON.stringify(input), encoding: 'utf8', env: { ...process.env, REVERSEPORT_HOME: home, REVERSEPORT_STASHPAD: 'off', ...env } });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout ? JSON.parse(r.stdout) : null;
};

test('tool names: plugin and plain MCP registrations, nothing else', () => {
  assert.equal(bare('mcp__plugin_reverseport_reverseport__re_scan'), 're_scan');
  assert.equal(bare('mcp__reverseport__capture_process_scenario'), 'capture_process_scenario');
  assert.equal(bare('mcp__other__re_scan'), null);
});

test('pre: remote endpoints are denied, running a program and secrets ask, reads pass', () => {
  assert.equal(decide('observe_web_execution', { cdp_endpoint: 'ws://10.0.0.5:9222' }).decision, 'deny');
  assert.equal(decide('observe_web_execution', { cdp_endpoint: 'ws://127.0.0.1:9222' }).decision, 'ask');
  assert.equal(decide('start_frida_session', { program: 'a.exe' }).decision, 'ask');
  assert.equal(decide('re_lookup', { url: 'https://x.test', env: { API_KEY: 'abcdef123456' } }).decision, 'ask');
  assert.deepEqual(findings({ note: 'a github token ghp_' + 'a'.repeat(36) }).secrets, ['note']);
  assert.equal(decide('re_scan', { path: './game' }), null);
  const out = run('pre', { tool_name: 'mcp__reverseport__start_gdb_session', tool_input: {}, session_id: 's1' });
  assert.equal(out.hookSpecificOutput.permissionDecision, 'ask');
  assert.equal(run('pre', { tool_name: 'mcp__reverseport__start_gdb_session', tool_input: {}, session_id: 's1' }, { REVERSEPORT_HOOKS: 'shadow' }), null);
  assert.equal(run('pre', { tool_name: 'Bash', tool_input: {} }), null);
});

test('stop: blocks once while a proof case from this session fails its check', async () => {
  process.env.REVERSEPORT_HOME = home;
  process.env.REVERSEPORT_STASHPAD = 'off';
  const { callTool } = await import('../src/tools.mjs');
  const { caseId, folder } = await callTool('re_case', { action: 'init', question: 'Does the pack hold scripts?', target: 'game.pck', authorized: true });
  await callTool('re_case', { action: 'evidence', caseId, content: 'res://player.gd', locator: 're_archive game.pck', note: 'listing' });
  run('post', { tool_name: 'mcp__reverseport__re_case', tool_input: { action: 'evidence', caseId }, tool_response: [{ type: 'text', text: '{"caseId":"x"}' }], session_id: 's2' });
  assert.equal(run('stop', { session_id: 's2' }), null, 'a clean case lets the agent stop');
  fs.writeFileSync(path.join(folder, 'evidence', 'E001.txt'), 'changed');
  const block = run('stop', { session_id: 's2' });
  assert.equal(block.decision, 'block');
  assert.match(block.reason, /SHA-256/);
  assert.equal(run('stop', { session_id: 's2', stop_hook_active: true }), null, 'never blocks twice in a row');
  assert.equal(run('stop', { session_id: 'other' }), null, 'other sessions are not affected');
});

test('session start note and off switch', () => {
  assert.match(run('session', { session_id: 's3' }).hookSpecificOutput.additionalContext, /re_case/);
  assert.equal(run('session', { session_id: 's3' }, { REVERSEPORT_HOOKS: 'off' }), null);
});
