// Forgiving input for smaller models: repair slips only when the schema makes the meaning unambiguous, and say so.
import test from 'node:test';
import assert from 'node:assert/strict';
import { tempDir } from './helpers.mjs';

process.env.REVERSEPORT_HOME = await tempDir('rp-forgive-');
const { callTool } = await import('../src/tools.mjs');

test('enum case and spacing, list sent as text', async () => {
  const r = await callTool('port_convert', { from: 'Godot', to: 'UNITY', position: '[1, 2, 3]' });
  assert.equal(r.adjusted.from, 'read "Godot" as "godot"');
  assert.equal(r.adjusted.to, 'read "UNITY" as "unity"');
  assert.equal(r.adjusted.position, 'parsed the list from text');
  assert.ok(r.position, 'converted');
});

test('yes/no and 1/0 for booleans, one value where a list of strings is expected', async () => {
  const opened = await callTool('re_case', { action: 'init', question: 'What engine is this?', target: '/tmp/x', authorized: 'yes' });
  assert.equal(opened.adjusted.authorized, 'read "yes" as true');
  const c = opened.caseId;
  const ev = await callTool('re_case', { action: 'evidence', caseId: c, content: 'project.godot found', note: 'scan', locator: 're_scan /tmp/x' });
  const claim = await callTool('re_case', { action: 'claim', caseId: c, statement: 'It is a Godot project.', evidence: ev.id ?? ev.evidenceId ?? 'E001' });
  assert.equal(claim.adjusted.evidence, 'wrapped the single value in a list');
});

test('ambiguous or wrong values still fail with a clear message', async () => {
  await assert.rejects(callTool('port_convert', { from: 'nonsense', to: 'unity' }), /from must be one of/);
  await assert.rejects(callTool('port_convert', { from: 'godot', to: 'unity', position: '[1, 2' }), /position must be an array/);
});
