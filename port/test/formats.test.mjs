import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { tempDir, buildPng, buildPck, buildDotNetDll } from './helpers.mjs';

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
  const ba2 = type => { const b = Buffer.alloc(12); b.write('BTDX', 0, 'latin1'); b.writeUInt32LE(1, 4); b.write(type, 8, 'latin1'); return b; };
  assert.equal(identify(head('IWAD', 2, 12)).id, 'wad');
  assert.equal(identify(head('PWAD', 1, 64)).id, 'wad');
  assert.equal(identify(head('WAD3', 3, 1024)).id, 'wad-quake');
  assert.equal(identify(Buffer.from([0x58, 0x4e, 0x42, 0x77, 5, 0, 0x10, 0, 0, 0])).id, 'xnb', 'XNB, Windows, XNA 4');
  assert.equal(identify(Buffer.from([0x58, 0x4e, 0x42, 0x64, 5, 0, 0x10, 0, 0, 0])).id, 'xnb', 'MonoGame DesktopGL');
  assert.equal(identify(Buffer.from([0x34, 0x12, 0xaa, 0x55, 2, 0, 0, 0, 0, 0, 0, 0])).id, 'vpk');
  assert.equal(identify(head('PACK', 12, 128)).id, 'pak');
  const git = Buffer.from('PACK\0\0\0\x02\0\0\0\x07', 'latin1');
  assert.equal(identify(git).id, 'git-pack');
  assert.equal(identify(head('MPQ\x1a', 32)).id, 'mpq', 'MPQ header, version 1');
  assert.equal(identify(head('MPQ\x1a', 68)).id, 'mpq', 'MPQ header, version 3');
  assert.equal(identify(head('MPQ\x1b', 512, 512, 32)).id, 'mpq', 'MPQ user-data block (StarCraft II map/replay)');
  assert.equal(identify(Buffer.from('CPK @UTF', 'latin1')).id, 'cpk');
  assert.equal(identify(Buffer.from('CPK \0\0\0\0', 'latin1')).id, 'cpk', 'CPK with masked @UTF table');
  assert.equal(identify(head('BSA\0', 103, 36)).id, 'bsa', 'BSA version 103 (Oblivion)');
  assert.equal(identify(head('BSA\0', 104, 36)).id, 'bsa', 'BSA version 104 (Fallout 3 / New Vegas)');
  assert.equal(identify(head('BSA\0', 105, 36)).id, 'bsa', 'BSA version 105 (Skyrim)');
  assert.equal(identify(ba2('GNRL')).id, 'ba2', 'BA2 general archive (Fallout 4)');
  assert.equal(identify(ba2('DX10')).id, 'ba2', 'BA2 texture archive');
  assert.equal(identify(ba2('GNMF')).id, 'ba2', 'BA2 mesh archive');
  assert.equal(identify(Buffer.from('-==--==--==--==-', 'latin1')).id, 'unreal-utoc', 'Unreal IoStore .utoc');
  // Look-alikes
  assert.notEqual(identify(head('IWAD', 2, 4)).id, 'wad', 'directory inside the header');
  assert.notEqual(identify(Buffer.from('XNBz\x05')).id, 'xnb', 'unknown platform');
  assert.notEqual(identify(Buffer.from('XNBw\x09')).id, 'xnb', 'unknown version');
  assert.notEqual(identify(Buffer.from([0x34, 0x12, 0xaa, 0x55, 9, 0, 0, 0])).id, 'vpk', 'unknown VPK version');
  assert.notEqual(identify(head('PACK', 12, 100)).id, 'pak', 'directory length not a multiple of 64');
  assert.notEqual(identify(head('MPQ\x1a', 4)).id, 'mpq', 'MPQ header size below 32');
  assert.notEqual(identify(head('MPQ\x1b', 512, 512, 4)).id, 'mpq', 'MPQ user-data block with header size below 32');
  assert.notEqual(identify(Buffer.from('CPKX', 'latin1')).id, 'cpk', 'CPK without the trailing space');
  assert.notEqual(identify(head('BSA\0', 2, 36)).id, 'bsa', 'BSA version 2');
  assert.notEqual(identify(head('BSA\0', 104, 32)).id, 'bsa', 'BSA header size not 36');
  assert.notEqual(identify(ba2('XXXX')).id, 'ba2', 'BA2 with unknown type');
  assert.notEqual(identify(Buffer.from('-==--==--==--===', 'latin1')).id, 'unreal-utoc', 'utoc magic with a wrong final byte');
});
