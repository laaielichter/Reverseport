// re_struct: the layout of an unknown format, from samples built here with a known layout.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { tempDir } from './helpers.mjs';
import { structTool } from '../src/struct.mjs';
import { callTool } from '../src/tools.mjs';

const u32 = n => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };
const u32be = n => { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0); return b; };

/** "SAVE", version, reserved | body size | CRC-32 of the body | time, name, count, 12-byte records. */
function save(player, n, time) {
  const records = Buffer.concat(Array.from({ length: n }, (_, i) => { const r = Buffer.alloc(12); r.writeUInt32LE(i + 1); r.writeFloatLE(i * 1.5 + (time % 7) + 0.25, 4); r.writeUInt32LE(((i * 2654435761) | 0x80000000) >>> 0, 8); return r; }));
  const name = Buffer.from(player);
  const body = Buffer.concat([u32(time), u32(name.length), name, u32(n), records]);
  return Buffer.concat([Buffer.from('SAVE'), u32(3), u32(0), u32(body.length + 4), u32(zlib.crc32(body)), body]);
}

async function write(dir, files) {
  for (const [name, buf] of Object.entries(files)) await fs.writeFile(path.join(dir, name), buf);
  return Object.keys(files).map(n => path.join(dir, n));
}

test('re_struct: magic, length, checksum, time, text, a record count and the columns of the records', async () => {
  const dir = await tempDir();
  await write(dir, { 'a.sav': save('Roel', 3, 1700000000), 'b.sav': save('Alexandra', 10, 1710000123), 'c.sav': save('Bo', 1, 1722222222), 'd.sav': save('Player One', 25, 1733333333), 'notes.txt': Buffer.from('not a sample') });
  const r = await callTool('re_struct', { path: dir, match: '*.sav' });
  assert.equal(r.samples.length, 4);
  const [magic, length, checksum, time, name, count] = r.fields;
  assert.deepEqual([magic.offset, magic.size, magic.role], [0, 12, 'magic']);
  assert.ok(magic.hex.startsWith('53 41 56 45 03'));
  assert.deepEqual([length.offset, length.type, length.role], [12, 'u4le', 'length']);
  assert.match(length.note, /size of the file minus 16/);
  assert.deepEqual([checksum.offset, checksum.role], [16, 'checksum']);
  assert.match(checksum.note, /CRC-32 of the bytes after this field/);
  assert.deepEqual([time.offset, time.role], [20, 'time']);
  assert.equal(name.role, 'string');
  assert.deepEqual(name.values, ['Roel', 'Alexandra', 'Bo', 'Player One']);
  // After a text of different lengths every sample has its own offset.
  assert.deepEqual(count.offset, [32, 37, 30, 38]);
  assert.deepEqual([count.role, count.stride, count.values], ['count', 12, [3, 10, 1, 25]]);
  assert.equal(r.fields.length, 6);
  assert.equal(r.records.size, 12);
  assert.deepEqual(r.records.columns.map(c => c.type), ['u4le', 'f4le', 'u4le']);
  assert.match(r.records.columns[0].note, /rise/);
  assert.match(r.ksy, /id: sav\n/);
  assert.match(r.ksy, /contents: \[0x53, 0x41, 0x56, 0x45/);
  assert.match(r.ksy, /repeat-expr: num_records/);
  assert.match(r.ksy, /type: f4le/);
});

test('re_struct: big-endian length in front of text, a NUL-ended text, and a SHA-256 trailer', async () => {
  const dir = await tempDir();
  const make = (title, author, payload) => {
    const t = Buffer.from(title);
    const head = Buffer.concat([Buffer.from([0x89, 0x4c, 0x56, 0x4c]), u32be(t.length), t, Buffer.from(`${author}\0`), Buffer.from([1, 2, 3, 4]), payload]);
    return Buffer.concat([head, crypto.createHash('sha256').update(head).digest()]);
  };
  const files = await write(dir, {
    'one.lvl': make('Harbour', 'ann', crypto.randomBytes(40)),
    'two.lvl': make('The long road north', 'bartholomew', crypto.randomBytes(90)),
    'three.lvl': make('Pit', 'cy', crypto.randomBytes(64)),
  });
  const r = await structTool({ files });
  assert.equal(r.fields[0].role, 'magic');
  assert.equal(r.fields[0].size, 4, 'the zero bytes of the big-endian length are not taken as part of the magic');
  assert.equal(r.fields[1].type, 'u4be length + text');
  assert.deepEqual(r.fields[1].values, ['Harbour', 'The long road north', 'Pit']);
  assert.equal(r.fields[2].type, 'text + NUL');
  assert.deepEqual(r.fields[2].values, ['ann', 'bartholomew', 'cy']);
  assert.deepEqual([r.fields[3].type, r.fields[3].hex], ['constant', '01 02 03 04']);
  assert.match(r.rest.note, /high entropy/);
  assert.match(r.trailer.note, /last 32 bytes are the SHA-256/);
  assert.match(r.ksy, /type: strz/);
});

test('re_struct: needs two samples, and says so', async () => {
  const dir = await tempDir();
  const [only] = await write(dir, { 'a.bin': Buffer.from('abcdef') });
  await assert.rejects(() => callTool('re_struct', { path: dir }), e => e.code === 'INVALID_ARGUMENT' && /at least 2 files/.test(e.message));
  await assert.rejects(() => structTool({ files: [only, path.join(dir, 'missing.bin')] }), e => e.code === 'NOT_FOUND');
});

test('re_struct: identical samples are one constant, with the advice to bring samples that differ', async () => {
  const dir = await tempDir();
  const files = await write(dir, { 'a.bin': Buffer.from('HEADER-1234'), 'b.bin': Buffer.from('HEADER-1234') });
  const r = await structTool({ files });
  assert.equal(r.fields.length, 1);
  assert.equal(r.fields[0].text, 'HEADER-1234');
  assert.match(r.hint, /add samples that differ/);
});
