import test from 'node:test';
import assert from 'node:assert/strict';
import { generate, PUBLIC_SEED } from '../../bench/challenges/generate.mjs';
import { accepts } from '../../bench/challenges/oracle.mjs';
import { selfcheck, validInput, wrongInput, findCompiler } from '../../bench/selfcheck.mjs';

test('challenge generator is deterministic and the oracle accepts one input per family', () => {
  const a = generate(PUBLIC_SEED), b = generate(PUBLIC_SEED);
  assert.deepEqual(a.map(c => c.source), b.map(c => c.source));
  assert.equal(a.length, 8);
  for (const c of a) {
    const ok = validInput(c);
    assert.ok(ok && accepts(c, ok), `${c.id}: valid input`);
    assert.equal(accepts(c, wrongInput(c, ok)), false, `${c.id}: wrong input rejected`);
  }
});

test('built challenges: ground truth holds and re_binary strings reveal only the plain compare', { skip: !findCompiler() && 'no C compiler' }, async () => {
  const r = await selfcheck({ seed: PUBLIC_SEED });
  assert.equal(r.summary.oracleAgrees, 8);
  assert.equal(r.summary.groundTruthHolds, r.summary.binaries);
  assert.ok(r.summary.binaries >= 8);
  assert.deepEqual(r.summary.revealedFamilies, ['compare']);
});

test('large challenge set: deterministic, and the oracle accepts the answer and rejects the decoy', async () => {
  const { generateLarge, LARGE_PUBLIC_SEED } = await import('../../bench/challenges/large.mjs');
  const a = generateLarge(LARGE_PUBLIC_SEED), b = generateLarge(LARGE_PUBLIC_SEED);
  assert.deepEqual(a.map(c => c.source), b.map(c => c.source));
  assert.equal(a.length, 8);
  for (const c of a) {
    const ok = validInput(c);
    assert.ok(ok && accepts(c, ok), `${c.id}: valid input`);
    if (c.answer.decoy) assert.equal(accepts(c, c.answer.decoy.input), false, `${c.id}: decoy rejected`);
  }
});

test('built large set: ground truth holds and strings reveal no answer', { skip: (!findCompiler() || !findCompiler(process.env, 'cpp')) && 'no C or C++ compiler' }, async () => {
  const r = await selfcheck({ set: 'large' });
  assert.equal(r.summary.oracleAgrees, 8);
  assert.equal(r.summary.binaries, 16);
  assert.equal(r.summary.groundTruthHolds, 16);
  assert.equal(r.summary.revealedByStrings, 0);
});
