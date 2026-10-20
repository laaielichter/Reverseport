import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { tempDir, buildPng, buildPck } from './helpers.mjs';

const dir = await tempDir();
process.env.REVERSEPORT_HOME = path.join(dir, 'home');
const { identify, findSignatures, strideGuess } = await import('../src/formats.mjs');
const { probe, carve, compare } = await import('../src/compare.mjs');

function wav(seconds = 0.01) {
  const data = Buffer.alloc(Math.round(44100 * seconds) * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(44100, 24); h.writeUInt32LE(88200, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

test('identifies formats by content', () => {
  assert.equal(identify(buildPng()).id, 'png');
  assert.equal(identify(wav()).id, 'wav');
  assert.equal(identify(buildPck({ 'res://a': 'x' })).id, 'godot-pck');
  assert.equal(identify(Buffer.from('[gd_scene load_steps=2 format=3]\n')).id, 'godot-scene');
  assert.equal(identify(Buffer.from('%YAML 1.1\n%TAG !u! tag:unity3d.com,2011:\n')).id, 'unity-yaml');
  assert.equal(identify(Buffer.from('PACK')).id, 'pak');
  assert.notEqual(identify(Buffer.from('PAK!')).id, 'pak');
});

test('finds, sizes and carves files embedded in a blob', async () => {
  const png = buildPng(), w = wav();
  const blob = Buffer.concat([Buffer.alloc(1000, 7), png, Buffer.alloc(333, 1), w, Buffer.alloc(50)]);
  const file = path.join(dir, 'blob.bin');
  await fs.writeFile(file, blob);
  const hits = (await findSignatures(file)).hits;
  assert.deepEqual(hits.map(h => [h.id, h.offset, h.size]), [['png', 1000, png.length], ['wav', 1000 + png.length + 333, w.length]]);
  const c = await carve({ file, offset: 1000 + png.length + 333 });
  assert.equal(c.identified.id, 'wav');
  assert.ok((await fs.readFile(c.file)).equals(w));
  const p = await probe({ file, offset: 1000, length: 32 });
  assert.equal(p.identified.id, 'png');
  assert.match(p.hex, /^000003e8  89 50 4e 47/);
});

test('guesses record strides of a table', () => {
  const rows = [];
  for (let i = 0; i < 400; i++) { const r = Buffer.alloc(24); r.writeUInt32LE(i, 0); r.write('ITEM', 4); r.writeFloatLE(i * 0.5, 8); r.writeUInt16LE(0xbeef, 20); rows.push(r); }
  assert.equal(strideGuess(Buffer.concat(rows))[0].stride, 24);
});

test('compares folders and files', async () => {
  const a = path.join(dir, 'a'), b = path.join(dir, 'b');
  await fs.mkdir(a); await fs.mkdir(b);
  await fs.writeFile(path.join(a, 'same.txt'), 'x'); await fs.writeFile(path.join(b, 'same.txt'), 'x');
  await fs.writeFile(path.join(a, 'old.txt'), 'gone'); await fs.writeFile(path.join(b, 'new.txt'), 'new');
  await fs.writeFile(path.join(a, 'ch.bin'), Buffer.alloc(10000, 1)); await fs.writeFile(path.join(b, 'ch.bin'), Buffer.concat([Buffer.alloc(5000, 1), Buffer.alloc(5000, 2)]));
  const r = await compare({ a, b });
  assert.deepEqual(r.summary, { added: 1, removed: 1, changed: 1, unchanged: 1 });
  const f = await compare({ a: path.join(a, 'ch.bin'), b: path.join(b, 'ch.bin') });
  assert.equal(f.kind, 'bytes');
  assert.equal(f.firstDifference, 5000);
  const pa = path.join(dir, 'v1.pck'), pb = path.join(dir, 'v2.pck');
  await fs.writeFile(pa, buildPck({ 'res://a.gd': 'a', 'res://b.gd': 'b' }));
  await fs.writeFile(pb, buildPck({ 'res://a.gd': 'a', 'res://b.gd': 'bb', 'res://c.gd': 'c' }));
  const pk = await compare({ a: pa, b: pb });
  assert.equal(pk.kind, 'archives');
  assert.deepEqual(pk.summary, { added: 1, removed: 0, changed: 1, entriesA: 2, entriesB: 3 });
});
