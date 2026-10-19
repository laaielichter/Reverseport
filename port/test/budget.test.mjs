// Output budget: big results are saved whole to the workspace and the agent gets a shortened result.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { tempDir } from './helpers.mjs';

process.env.REVERSEPORT_HOME = await tempDir('rp-budget-');
const { budgetValue, budgetMcpResult, outputLimit, shrink, DEFAULT_MAX_OUTPUT_BYTES } = await import('../src/budget.mjs');

const big = () => ({ root: '/x', count: 3000, files: Array.from({ length: 3000 }, (_, i) => ({ file: `src/file-${i}.ts`, lines: i })), next: 'call more' });

test('limit: default, custom (at least 4096), off', () => {
  assert.equal(outputLimit({}), DEFAULT_MAX_OUTPUT_BYTES);
  assert.equal(outputLimit({ REVERSEPORT_MAX_OUTPUT_BYTES: '100000' }), 100000);
  assert.equal(outputLimit({ REVERSEPORT_MAX_OUTPUT_BYTES: '10' }), 4096);
  assert.equal(outputLimit({ REVERSEPORT_MAX_OUTPUT_BYTES: 'off' }), Infinity);
});

test('small results pass unchanged', async () => {
  const v = { a: 1, list: [1, 2, 3] };
  assert.equal(await budgetValue('re_scan', v, 4096), v);
});

test('big results: shortened lists, full result saved, other fields kept', async () => {
  const v = big();
  const out = await budgetValue('re_symbols', v, 20000);
  assert.ok(Buffer.byteLength(JSON.stringify(out)) <= 20000);
  assert.equal(out.root, '/x');
  assert.equal(out.next, 'call more');
  assert.ok(out.files.length > 0 && out.files.length < 3000);
  assert.deepEqual(out.files[0], v.files[0], 'keeps the head of a list');
  const t = out.outputTruncated;
  assert.deepEqual(t.shortened[0], { path: 'files', kept: out.files.length, of: 3000 });
  assert.equal(path.dirname(t.fullOutput), path.join(process.env.REVERSEPORT_HOME, 'tool-output'));
  assert.deepEqual(JSON.parse(await fs.readFile(t.fullOutput, 'utf8')), v);
  assert.equal(v.files.length, 3000, 'the original value is not changed');
});

test('shrink goes into the item that holds most of the size', () => {
  const v = { items: [{ name: 'one', data: Array.from({ length: 5000 }, (_, i) => i) }, { name: 'two' }] };
  const { value, shortened } = shrink(v, 4000);
  assert.equal(value.items.length, 2, 'both items stay; the inner list is shortened');
  assert.ok(value.items[0].data.length < 5000);
  assert.equal(shortened[0].path, 'items[0].data');
});

test('engine results: long text keeps its head and says where the rest is', async () => {
  const text = Array.from({ length: 20000 }, (_, i) => `line ${i}`).join('\n');
  const out = await budgetMcpResult('procedure_pseudo_code', { content: [{ type: 'text', text }] }, 8192);
  const shown = out.content[0].text;
  assert.ok(shown.startsWith('line 0\nline 1\n'));
  const file = shown.match(/full output saved to (\S+?)\. /)[1];
  assert.equal(await fs.readFile(file, 'utf8'), text);
  assert.ok(Buffer.byteLength(shown) < 9000);
  const err = { content: [{ type: 'text', text }], isError: true };
  assert.equal(await budgetMcpResult('x', err, 8192), err, 'errors are never cut');
});

test('engine results with structuredContent are shortened as JSON', async () => {
  const sc = big();
  const out = await budgetMcpResult('search_strings', { content: [{ type: 'text', text: JSON.stringify(sc) }], structuredContent: sc }, 20000);
  assert.ok(out.structuredContent.outputTruncated.fullOutput);
  assert.deepEqual(JSON.parse(out.content[0].text), out.structuredContent);
});
