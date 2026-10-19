import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { saveTool, lzStringFromBase64, crc32, peel } from '../src/save.mjs';

// Minimal LZ-String compressToBase64 (from the algorithm spec) to round-trip the decoder.
function lzCompressToBase64(input) {
  const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
  const bitsPerChar = 6;
  const dict = new Map(), dictToCreate = new Map();
  let c = '', wc = '', w = '', enlargeIn = 2, dictSize = 3, numBits = 2;
  const data = []; let val = 0, position = 0;
  const writeBit = bit => { val = (val << 1) | bit; if (position === bitsPerChar - 1) { position = 0; data.push(ALPHA[val]); val = 0; } else position++; };
  const writeBits = (n, value) => { for (let i = 0; i < n; i++) { writeBit(value & 1); value >>= 1; } };
  const emit = () => {
    if (dictToCreate.has(w)) {
      if (w.charCodeAt(0) < 256) { writeBits(numBits, 0); writeBits(8, w.charCodeAt(0)); } else { writeBits(numBits, 1); writeBits(16, w.charCodeAt(0)); }
      enlargeIn--; if (enlargeIn === 0) { enlargeIn = 2 ** numBits; numBits++; } dictToCreate.delete(w);
    } else writeBits(numBits, dict.get(w));
    enlargeIn--; if (enlargeIn === 0) { enlargeIn = 2 ** numBits; numBits++; }
  };
  for (let ii = 0; ii < input.length; ii++) {
    c = input.charAt(ii);
    if (!dict.has(c)) { dict.set(c, dictSize++); dictToCreate.set(c, true); }
    wc = w + c;
    if (dict.has(wc)) w = wc; else { emit(); dict.set(wc, dictSize++); w = String(c); }
  }
  if (w !== '') emit();
  writeBits(numBits, 2);
  for (;;) { val <<= 1; if (position === bitsPerChar - 1) { data.push(ALPHA[val]); break; } position++; }
  return data.join('');
}

const save = { version: 3, player: { name: 'Hero', hp: 42, gold: 1500, pos: { x: 12.5, y: -3 } }, level: 4, inventory: ['sword', 'potion'], savedAt: 1716000000 };

test('JSON save: roles, verified md5 checksum, diff against a second save', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rp-save-'));
  const sum = o => crypto.createHash('md5').update(JSON.stringify(o)).digest('hex');
  await fs.writeFile(path.join(dir, 'a.json'), JSON.stringify({ ...save, checksum: sum(save) }));
  const b = { ...save, player: { ...save.player, gold: 1750 } };
  await fs.writeFile(path.join(dir, 'b.json'), JSON.stringify({ ...b, checksum: sum(b) }));
  const r = await saveTool({ file: path.join(dir, 'a.json'), compare: path.join(dir, 'b.json') });
  assert.deepEqual(r.layers, ['json']);
  assert.deepEqual(r.roles.currency, ['player.gold']);
  assert.deepEqual(r.roles.position, ['player.pos.x', 'player.pos.y']);
  assert.equal(r.checksums[0].verified, true);
  assert.equal(r.checksums[0].algo, 'md5');
  assert.deepEqual(r.compare.changed.items.map(c => c.path), ['player.gold', 'checksum']);
  assert.ok(r.fields.items.find(f => f.path === 'savedAt').looksLike === 'unix-seconds');
  const s = await saveTool({ file: path.join(dir, 'a.json'), action: 'schema', out: path.join(dir, 'out') });
  const gd = await fs.readFile(path.join(dir, 'out', 'SaveData.gd'), 'utf8');
  assert.ok(gd.includes('var inventory: Array[String]') && gd.includes('"player": player'));
  const cs = await fs.readFile(path.join(dir, 'out', 'SaveData.cs'), 'utf8');
  assert.ok(cs.includes('public List<string> inventory;'));
  assert.equal(s.written.length, 3);
  await fs.rm(dir, { recursive: true, force: true });
});

test('layers: gzip, base64 and LZ-String (RPG Maker) around JSON; INI; Godot store_var; CRC32 trailer', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rp-save-'));
  const body = JSON.stringify(save);
  await fs.writeFile(path.join(dir, 'a.gz'), zlib.gzipSync(Buffer.from(body)));
  await fs.writeFile(path.join(dir, 'a.b64'), Buffer.from(body).toString('base64'));
  const lz = lzCompressToBase64(body);
  assert.equal(lzStringFromBase64(lz), body);
  await fs.writeFile(path.join(dir, 'file1.rpgsave'), lz);
  await fs.writeFile(path.join(dir, 'settings.cfg'), '[audio]\nmaster=0.8\n[player]\nname="Hero"\nhp=42\n');
  const vstr = s => { const n = Buffer.byteLength(s), pad = (n + 3) & ~3, o = Buffer.alloc(8 + pad); o.writeUInt32LE(4, 0); o.writeUInt32LE(n, 4); o.write(s, 8); return o; };
  const vint = i => { const o = Buffer.alloc(8); o.writeUInt32LE(2, 0); o.writeInt32LE(i, 4); return o; };
  const dict = Buffer.concat([Buffer.from([27, 0, 0, 0, 2, 0, 0, 0]), vstr('hp'), vint(42), vstr('name'), vstr('Hero')]);
  const lp = Buffer.alloc(4); lp.writeUInt32LE(dict.length, 0);
  await fs.writeFile(path.join(dir, 'godot.save'), Buffer.concat([lp, dict]));
  const bin = Buffer.alloc(32); bin.writeUInt32LE(3, 0); bin.writeFloatLE(12.5, 4); bin.writeUInt32LE(1500, 12); bin.write('Hero\0', 16); bin.writeUInt32LE(crc32(bin.subarray(0, 28)), 28);
  await fs.writeFile(path.join(dir, 'bin.sav'), bin);
  assert.deepEqual((await saveTool({ file: path.join(dir, 'a.gz') })).layers, ['gzip', 'json']);
  assert.deepEqual((await saveTool({ file: path.join(dir, 'a.b64') })).layers, ['base64', 'json']);
  const rpg = await saveTool({ file: path.join(dir, 'file1.rpgsave') });
  assert.deepEqual(rpg.layers, ['lz-string', 'json']);
  assert.deepEqual(rpg.roles.health, ['player.hp']);
  const ini = await saveTool({ file: path.join(dir, 'settings.cfg') });
  assert.deepEqual(ini.layers, ['ini']);
  assert.ok(ini.fields.items.find(f => f.path === 'audio.master').sample === 0.8);
  const g = await saveTool({ file: path.join(dir, 'godot.save') });
  assert.equal(g.layers[0], 'godot-store_var (length-prefixed)');
  assert.deepEqual(g.roles, { health: ['hp'], identity: ['name'] });
  const b = await saveTool({ file: path.join(dir, 'bin.sav') });
  assert.equal(b.checksums[0].algo, 'crc32');
  assert.ok(b.strings.items.some(s => s.text === 'Hero'));
  await fs.rm(dir, { recursive: true, force: true });
});

test('encrypted-looking and XOR-looking content is reported, not decoded', () => {
  const rnd = crypto.randomBytes(4096);
  const e = peel(rnd, 'slot.dat');
  assert.deepEqual(e.layers, ['encrypted-or-compressed']);
  assert.equal(e.data, undefined);
  const key = 0x5a;
  const x = Buffer.from(JSON.stringify({ a: 1, b: 'x'.repeat(50), c: [1, 2, 3] }).padEnd(600, ' ')).map(b => b ^ key);
  const p = peel(Buffer.from(x), 'slot.dat');
  assert.equal(p.layers[0], 'possibly-xor-obfuscated');
  assert.equal(p.data, undefined);
});
