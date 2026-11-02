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

const fits = (v, max) => Buffer.byteLength(JSON.stringify(v)) <= max;
const loneSurrogate = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

test('limit: off, 0, below 4096, not a number, spaces and capitals', () => {
  assert.equal(outputLimit({ REVERSEPORT_MAX_OUTPUT_BYTES: '0' }), Infinity);
  assert.equal(outputLimit({ REVERSEPORT_MAX_OUTPUT_BYTES: ' OFF ' }), Infinity);
  assert.equal(outputLimit({ REVERSEPORT_MAX_OUTPUT_BYTES: '4095' }), 4096);
  assert.equal(outputLimit({ REVERSEPORT_MAX_OUTPUT_BYTES: '-5' }), 4096);
  assert.equal(outputLimit({ REVERSEPORT_MAX_OUTPUT_BYTES: 'lots' }), DEFAULT_MAX_OUTPUT_BYTES);
  assert.equal(outputLimit({ REVERSEPORT_MAX_OUTPUT_BYTES: '' }), DEFAULT_MAX_OUTPUT_BYTES);
  assert.equal(outputLimit({ REVERSEPORT_MAX_OUTPUT_BYTES: '1e5' }), 100000);
});

test('emoji near the cut are never split in two', async () => {
  for (const lead of ['', 'a']) {
    const out = await budgetValue('t', { text: lead + '😀'.repeat(40000) }, 8192);
    assert.ok(fits(out, 8192));
    assert.ok(!loneSurrogate.test(out.text), 'no half emoji');
    assert.ok(out.text.startsWith(`${lead}😀😀`));
  }
});

test('one huge string fits the limit', async () => {
  const out = await budgetValue('t', { blob: 'q'.repeat(2_000_000) }, 8192);
  assert.ok(fits(out, 8192));
  assert.equal(out.outputTruncated.shortened[0].path, 'blob');
});

test('thousands of small items keep their head and fit', async () => {
  const out = await budgetValue('t', { items: Array.from({ length: 50000 }, (_, i) => i) }, 8192);
  assert.ok(fits(out, 8192));
  assert.deepEqual(out.items.slice(0, 3), [0, 1, 2]);
});

test('many medium strings (each too short to matter alone) still fit', async () => {
  const wide = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`k${i}`, 'z'.repeat(15000)]));
  assert.ok(fits(await budgetValue('t', wide, 20000), 20000));
  const rows = { rows: [['r'.repeat(15000)], ['s'.repeat(15000)], ['t'.repeat(15000)]] };
  assert.ok(fits(await budgetValue('t', rows, 8192), 8192));
});

test('a very deeply nested result fits and says what was left out', async () => {
  let deep = { leaf: 'x'.repeat(100) };
  for (let i = 0; i < 1000; i++) deep = { child: deep, pad: 'y'.repeat(50) };
  const out = await budgetValue('t', { name: 'deep', tree: deep }, 8192);
  assert.ok(fits(out, 8192));
  assert.equal(out.name, 'deep');
  assert.ok(out.outputTruncated.shortened.some(s => s.path === 'tree' && s.leftOut));
});

test('keys with dots or slashes (file names) are shortened safely', () => {
  const { value, shortened } = shrink({ byFile: { 'src/a.ts': Array.from({ length: 5000 }, (_, i) => i) } }, 4000);
  assert.ok(value.byFile['src/a.ts'].length < 5000);
  assert.equal(shortened[0].path, 'byFile["src/a.ts"]');
});
