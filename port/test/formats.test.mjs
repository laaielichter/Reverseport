import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { tempDir, buildPng, buildPck, buildDotNetDll } from './helpers.mjs';

const dir = await tempDir();
process.env.REVERSEPORT_HOME = path.join(dir, 'home');
const { identify, findSignatures, strideGuess } = await import('../src/formats.mjs');
const { categoryOf } = await import('../src/scan.mjs');
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

test('identifies GPU texture formats (KTX2, PVR, ASTC, QOI) and sorts them as images (#73)', () => {
  const qoi = (w, h, channels) => { const b = Buffer.alloc(14); b.write('qoif', 0); b.writeUInt32BE(w, 4); b.writeUInt32BE(h, 8); b[12] = channels; return b; };
  const ktx2 = Buffer.from([0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ktx1 = Buffer.from([0xab, 0x4b, 0x54, 0x58, 0x20, 0x31, 0x31, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a]);
  for (const [buf, id] of [[ktx2, 'ktx2'], [ktx1, 'ktx'], [Buffer.from([0x50, 0x56, 0x52, 0x03, 0, 0, 0, 0]), 'pvr'], [Buffer.from([0x13, 0xab, 0xa1, 0x5c, 4, 4, 1, 0, 0, 0]), 'astc'], [qoi(64, 64, 3), 'qoi'], [qoi(1, 1, 4), 'qoi']]) {
    const r = identify(buf);
    assert.equal(r.id, id);
    assert.equal(r.category, 'image');
  }
  // KTX 2 is no longer reported as plain KTX 1.
  assert.notEqual(identify(ktx2).id, 'ktx');
  // Look-alikes
  assert.notEqual(identify(qoi(64, 64, 5)).id, 'qoi', 'QOI channels must be 3 or 4');
  assert.notEqual(identify(qoi(0, 64, 4)).id, 'qoi', 'QOI width must be nonzero');
  assert.notEqual(identify(Buffer.from('qoif')).id, 'qoi', 'truncated QOI header');
  assert.notEqual(identify(Buffer.from([0x50, 0x56, 0x52, 0x02, 0, 0, 0, 0])).id, 'pvr', 'PVR v2 is not v3');
  assert.notEqual(identify(Buffer.from([0x13, 0xab, 0xa1, 0x5d])).id, 'astc', 'wrong ASTC magic');
  // re_scan sorts the texture extensions into the image category.
  for (const ext of ['.ktx2', '.pvr', '.astc', '.qoi']) assert.equal(categoryOf({ ext, rel: `tex${ext}` }), 'image');
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

test('compares two .NET builds by type and method, and says how to go deeper', async () => {
  const a = path.join(dir, 'Game-1.dll'), b = path.join(dir, 'Game-2.dll');
  await fs.writeFile(a, buildDotNetDll({ types: { Player: ['Awake', 'Update'], Enemy: ['OnTriggerEnter'] } }));
  await fs.writeFile(b, buildDotNetDll({ types: { Player: ['Awake', 'Update', 'Jump'], Boss: ['Rage'] } }));
  const r = await compare({ a, b });
  assert.equal(r.kind, 'binaries');
  assert.equal(r.identical, false);
  assert.deepEqual(r.dotnet.typesAdded, ['MiniHeli.Boss']);
  assert.deepEqual(r.dotnet.typesRemoved, ['MiniHeli.Enemy']);
  assert.deepEqual(r.dotnet.methodsAdded.sort(), ['MiniHeli.Boss::Rage', 'MiniHeli.Player::Jump']);
  assert.deepEqual(r.dotnet.methodsRemoved, ['MiniHeli.Enemy::OnTriggerEnter']);
  assert.match(r.next, /inspect_managed_artifact/);
  const same = await compare({ a, b: a });
  assert.equal(same.identical, true);
  assert.equal(same.next, undefined, 'nothing to follow up when the builds are the same');
});

test('game archives: Doom WAD, Quake WAD2/3, XNB, VPK; Git packs are not Quake PAKs', () => {
  const head = (magic, ...u32) => { const b = Buffer.alloc(magic.length + u32.length * 4); b.write(magic, 0, 'latin1'); u32.forEach((n, i) => b.writeUInt32LE(n, magic.length + i * 4)); return b; };
  assert.equal(identify(head('IWAD', 2, 12)).id, 'wad');
  assert.equal(identify(head('PWAD', 1, 64)).id, 'wad');
  assert.equal(identify(head('WAD3', 3, 1024)).id, 'wad-quake');
  assert.equal(identify(Buffer.from([0x58, 0x4e, 0x42, 0x77, 5, 0, 0x10, 0, 0, 0])).id, 'xnb', 'XNB, Windows, XNA 4');
  assert.equal(identify(Buffer.from([0x58, 0x4e, 0x42, 0x64, 5, 0, 0x10, 0, 0, 0])).id, 'xnb', 'MonoGame DesktopGL');
  assert.equal(identify(Buffer.from([0x34, 0x12, 0xaa, 0x55, 2, 0, 0, 0, 0, 0, 0, 0])).id, 'vpk');
  assert.equal(identify(head('PACK', 12, 128)).id, 'pak');
  const git = Buffer.from('PACK\0\0\0\x02\0\0\0\x07', 'latin1');
  assert.equal(identify(git).id, 'git-pack');
  // Look-alikes
  assert.notEqual(identify(head('IWAD', 2, 4)).id, 'wad', 'directory inside the header');
  assert.notEqual(identify(Buffer.from('XNBz\x05')).id, 'xnb', 'unknown platform');
  assert.notEqual(identify(Buffer.from('XNBw\x09')).id, 'xnb', 'unknown version');
  assert.notEqual(identify(Buffer.from([0x34, 0x12, 0xaa, 0x55, 9, 0, 0, 0])).id, 'vpk', 'unknown VPK version');
  assert.notEqual(identify(head('PACK', 12, 100)).id, 'pak', 'directory length not a multiple of 64');
});
