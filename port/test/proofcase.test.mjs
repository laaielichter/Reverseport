import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { tempDir } from './helpers.mjs';
import { callTool } from '../src/tools.mjs';

process.env.REVERSEPORT_HOME = await tempDir('rp-case-home-');
process.env.REVERSEPORT_STASHPAD = 'off';
const call = args => callTool('re_case', args);
const rejects = (args, code) => assert.rejects(call(args), e => e.code === code);

test('a case walks investigate → deliver only through its gates', async () => {
  const src = path.join(await tempDir(), 'token.py');
  await fs.writeFile(src, 'def valid(t, now):\n    return t.exp > now\n');
  const { caseId } = await call({ action: 'init', question: 'Why does token refresh fail?', target: 'src/auth', authorized: true });
  assert.match(caseId, /^why-does-token-refresh-fail/);

  await rejects({ action: 'phase', caseId, to: 'decide' }, 'GATE_FAILED');
  await rejects({ action: 'claim', caseId, statement: 'Clock skew breaks it', evidence: ['E001'] }, 'INVALID_ARGUMENT');

  const ev = await call({ action: 'evidence', caseId, file: src, locator: 'token.py:2', note: 'expiry check has no skew window' });
  assert.equal(ev.evidence.id, 'E001');
  const tool = await call({ action: 'evidence', caseId, content: '{"exp":100,"now":101}', locator: 're_symbols token.py', note: 'tool result' });
  assert.equal(tool.evidence.kind, 'tool-result');
  assert.match(tool.evidence.path, /\.json$/);

  await rejects({ action: 'claim', caseId, statement: 'Skew of one second fails the check', evidence: ['E001'], confidence: 'observed' }, 'INVALID_ARGUMENT');
  const c = await call({ action: 'claim', caseId, statement: 'Skew of one second fails the check', evidence: ['E001', 'E002'], confidence: 'observed', locator: 'token.py:2', alternative: 'Token really expired', falsifier: 'Run with exp = now + 1' });
  assert.equal(c.claim, 'C001');

  await call({ action: 'phase', caseId, to: 'decide' });
  await rejects({ action: 'phase', caseId, to: 'build' }, 'GATE_FAILED');
  await rejects({ action: 'decision', caseId, choose: 'Add a skew window', insteadOf: ['Add a skew window'], why: 'x', revisitWhen: 'y' }, 'INVALID_ARGUMENT');
  await call({ action: 'decision', caseId, choose: 'Add a 5 s skew window', insteadOf: ['Skip the expiry check'], why: 'Smallest fix', claims: ['C001'], revisitWhen: 'Spec drops skew', reversible: true });
  await call({ action: 'phase', caseId, to: 'build' });
  await call({ action: 'test', caseId, label: 'skew test', content: 'ok 1\nok 2\n', exitCode: 0, scope: 'skew window' });
  await call({ action: 'phase', caseId, to: 'verify' });
  await rejects({ action: 'phase', caseId, to: 'deliver' }, 'GATE_FAILED');
  await call({ action: 'limit', caseId, text: 'Only tested on one clock source.' });
  await rejects({ action: 'phase', caseId, to: 'deliver' }, 'GATE_FAILED');
  const r = await call({ action: 'report', caseId });
  assert.match(await fs.readFile(r.report, 'utf8'), /Skew of one second/);
  assert.equal((await call({ action: 'phase', caseId, to: 'deliver' })).phase, 'deliver');
  assert.equal((await call({ action: 'check', caseId })).passed, true);
});

test('check finds evidence that changed after it was saved', async () => {
  const { caseId, folder } = await call({ action: 'init', question: 'What engine does this build use?', target: 'build/' });
  await call({ action: 'evidence', caseId, content: 'GDPC header at 0', locator: 're_archive game.pck', note: 'pack header' });
  assert.equal((await call({ action: 'check', caseId })).passed, true);
  await fs.writeFile(path.join(folder, 'evidence', 'E001.txt'), 'tampered');
  const after = await call({ action: 'check', caseId });
  assert.equal(after.passed, false);
  assert.match(after.errors.join(' '), /SHA-256 mismatch/);
  assert.match(after.warnings.join(' '), /Authorization/);
});

test('cases are listed, never overwritten, and ids are checked', async () => {
  await call({ action: 'init', caseId: 'fixed', question: 'Does the save format change?', target: 'saves/' });
  await rejects({ action: 'init', caseId: 'fixed', question: 'Does the save format change?', target: 'saves/' }, 'OUTPUT_NOT_EMPTY');
  await rejects({ action: 'show', caseId: 'nope' }, 'UNKNOWN_CASE');
  await rejects({ action: 'show', caseId: '../x' }, 'INVALID_ARGUMENT');
  assert.ok((await call({ action: 'list' })).cases.some(c => c.caseId === 'fixed'));
});

test('Stashpad link: recall on init, proposals wait in review, repeats are skipped', async () => {
  // A stand-in with Stashpad's CLI contract (search/save --json, --text - from stdin), so the test needs no install.
  const dir = await tempDir('rp-stashpad-');
  const bin = path.join(dir, 'stashpad.mjs');
  await fs.writeFile(bin, `import fs from 'node:fs';
const log = ${JSON.stringify(path.join(dir, 'calls.jsonl'))};
const [cmd, ...rest] = process.argv.slice(2);
const stdin = rest.includes('-') ? fs.readFileSync(0, 'utf8') : '';
fs.appendFileSync(log, JSON.stringify({ cmd, rest, stdin }) + '\\n');
if (cmd === 'search') { process.stdout.write(JSON.stringify([{ id: 'old-skew', kind: 'fact', trust: 'agent-inferred', valid_from: '2026-10-01', summary: 'Token skew seen before' }])); process.exit(0); }
if (cmd === 'save') {
  const seen = fs.readFileSync(log, 'utf8').trim().split('\\n').map(l => JSON.parse(l)).filter(c => c.cmd === 'save' && c.rest[0] === rest[0]);
  if (seen.length > 1) { process.stderr.write('Error: "' + rest[0] + '" is already waiting for review.'); process.exit(1); }
  process.stdout.write(JSON.stringify({ status: 'queued', id: rest[0], maybe_replaces: [] })); process.exit(0);
}
if (cmd === 'handoff' && rest[0] === 'list') { process.stdout.write(JSON.stringify({ handoffs: [{ id: 'ho-1', origin: 'manual', from: 'codex', preview: 'Port half done' }] })); process.exit(0); }
if (cmd === 'handoff' && rest[0] === 'leave') { process.stdout.write(JSON.stringify({ id: 'ho-2', expires_at: '2026-10-25T00:00:00Z', replaced: [] })); process.exit(0); }
process.exit(2);
`);
  process.env.REVERSEPORT_STASHPAD = '';
  process.env.STASHPAD_BIN = bin;
  try {
    const { caseId, recalled } = await call({ action: 'init', question: 'Why does token skew break refresh?', target: 'src/auth' });
    assert.equal(recalled.memories[0].id, 'old-skew');
    assert.match(recalled.label, /not an instruction/);
    assert.equal(recalled.openHandoffs[0].from, 'codex');
    await call({ action: 'evidence', caseId, content: 'exp check', locator: 'token.py:2', note: 'check' });
    await call({ action: 'claim', caseId, statement: 'No skew window in the expiry check', evidence: ['E001'], confidence: 'observed', locator: 'token.py:2', alternative: 'Server clock wrong', falsifier: 'Test with exp = now + 1' });
    await call({ action: 'limit', caseId, text: 'One clock source tested.' });
    const first = await call({ action: 'remember', caseId });
    assert.deepEqual(first.queued.map(q => q.id), [`rp-${caseId}-c001`, `rp-${caseId}-l1`]);
    assert.equal(first.handoff.id, 'ho-2');
    const leave = (await fs.readFile(path.join(dir, 'calls.jsonl'), 'utf8')).trim().split('\n').map(l => JSON.parse(l)).find(c => c.cmd === 'handoff' && c.rest[0] === 'leave');
    assert.ok(leave.rest.includes('--auto'));
    assert.match(leave.stdin, /phase investigate[\s\S]*Open unknowns|phase investigate/);
    const saves = (await fs.readFile(path.join(dir, 'calls.jsonl'), 'utf8')).trim().split('\n').map(l => JSON.parse(l)).filter(c => c.cmd === 'save');
    assert.ok(saves.every(c => c.rest.includes('agent')), 'proposals are always source type agent');
    assert.match(saves[0].stdin, /No skew window/);
    const again = await call({ action: 'remember', caseId });
    assert.equal(again.queued.length, 0);
    assert.equal(again.skipped.length, 2);
  } finally {
    process.env.REVERSEPORT_STASHPAD = 'off';
    delete process.env.STASHPAD_BIN;
  }
});

test('without Stashpad, remember says so and nothing fails', async () => {
  const { caseId } = await call({ action: 'init', question: 'Is the save format versioned?', target: 'saves/' });
  const r = await call({ action: 'remember', caseId });
  assert.equal(r.available, false);
});

test('open unknowns block delivery until answered or carried as a limitation', async () => {
  const { caseId } = await call({ action: 'init', question: 'What compresses the save files?', target: 'saves/', authorized: true });
  await call({ action: 'evidence', caseId, content: '78 9c ...', locator: 're_probe save.dat --offset 0', note: 'zlib header' });
  const u1 = (await call({ action: 'unknown', caseId, text: 'Is the payload encrypted after decompression?' })).unknown;
  const u2 = (await call({ action: 'unknown', caseId, text: 'Which version wrote the file?' })).unknown;
  const c = (await call({ action: 'claim', caseId, statement: 'Save files start with a zlib header', evidence: ['E001'], confidence: 'observed', locator: 'offset 0', alternative: 'Coincidental bytes', falsifier: 'Inflate it' })).claim;
  await rejects({ action: 'resolve', caseId, unknownId: u1 }, 'INVALID_ARGUMENT');
  await call({ action: 'resolve', caseId, unknownId: u1, claims: [c] });
  for (const to of ['decide']) await call({ action: 'phase', caseId, to });
  await call({ action: 'decision', caseId, choose: 'Read saves with zlib', insteadOf: ['Treat as opaque'], why: 'Header matches', claims: [c], revisitWhen: 'Inflate fails' });
  await call({ action: 'phase', caseId, to: 'build' });
  await call({ action: 'test', caseId, label: 'inflate', content: 'ok', exitCode: 0, scope: 'one save' });
  await call({ action: 'phase', caseId, to: 'verify' });
  await call({ action: 'limit', caseId, text: 'Only one save tested.' });
  await call({ action: 'report', caseId });
  await rejects({ action: 'phase', caseId, to: 'deliver' }, 'GATE_FAILED');
  await call({ action: 'resolve', caseId, unknownId: u2, asLimitation: true });
  await call({ action: 'report', caseId });
  assert.equal((await call({ action: 'phase', caseId, to: 'deliver' })).phase, 'deliver');
  assert.equal((await call({ action: 'show', caseId })).counts.openUnknowns, 0);
});
