import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { tempDir } from './helpers.mjs';

const dir = await tempDir();
process.env.REVERSEPORT_HOME = path.join(dir, 'home');
const { decodeTool, readRsrc } = await import('../src/godotbin.mjs');
const F = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'godot-4.7-rscc');
const u32 = n => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };

/** The decompressed stream of a Godot RSCC file (zstd blocks), read here without ReversePort's reader. */
function streamOf(file) {
  const bs = file.readUInt32LE(8), total = file.readUInt32LE(12), n = Math.floor(total / bs) + 1;
  let p = 16 + n * 4;
  const parts = [];
  for (let i = 0; i < n; i++) { const size = file.readUInt32LE(16 + i * 4); parts.push(zlib.zstdDecompressSync(file.subarray(p, p + size))); p += size; }
  return Buffer.concat(parts).subarray(0, total);
}

/** RSCC the way FileAccessCompressed writes it: the stream split in (total / bs) + 1 blocks, each compressed. */
function rscc(stream, { mode, blockSize }) {
  const pack = { 1: b => zlib.deflateSync(b), 2: b => zlib.zstdCompressSync(b), 3: b => zlib.gzipSync(b) }[mode];
  const blocks = [];
  for (let i = 0; i < Math.floor(stream.length / blockSize) + 1; i++) blocks.push(pack(stream.subarray(i * blockSize, (i + 1) * blockSize)));
  return Buffer.concat([Buffer.from('RSCC'), u32(mode), u32(blockSize), u32(stream.length), ...blocks.map(b => u32(b.length)), ...blocks]);
}

const decode = async name => {
  const out = path.join(dir, `out-${name}`);
  const r = await decodeTool({ path: path.join(F, name), out });
  assert.deepEqual(r.skipped, [], JSON.stringify(r.skipped));
  return fs.readFile(path.join(out, name.replace(/\.scn$/, '.tscn')), 'utf8');
};

test('a scene Godot 4.7.2 saved compressed (RSCC, zstd) decodes to the same text as the uncompressed save', async () => {
  const fromRscc = await decode('rots.scn');
  assert.equal(fromRscc, (await decode('rots_plain.scn')));
  // And to what Godot itself writes as text, apart from unique_id and number spelling.
  const norm = t => t.replace(/ unique_id=\d+/g, '').replace(/ load_steps=\d+/g, '').replace(/(\d)\.0\b/g, '$1').split('\n').filter(Boolean);
  assert.deepEqual(norm(fromRscc), norm(await fs.readFile(path.join(F, 'rots-by-godot.tscn'), 'utf8')));
});

test('RSCC modes 1 (zlib deflate), 2 (zstd) and 3 (gzip), with the empty last block of a whole number of blocks', async () => {
  const godot = await fs.readFile(path.join(F, 'rots.scn'));
  const want = readRsrc(godot);
  const stream = streamOf(godot);
  const total = stream.length;
  assert.notEqual(stream.toString('latin1', 0, 4), 'RSRC', 'Godot writes no RSRC magic inside RSCC');
  for (const mode of [1, 2, 3]) for (const blockSize of [4096, 512, total, total % 2 ? 1 : total / 2]) {
    const r = readRsrc(rscc(stream, { mode, blockSize }));
    assert.deepEqual(r, want, `mode ${mode}, block size ${blockSize}`);
  }
});

test('a damaged RSCC is a BAD_FORMAT error', () => {
  assert.throws(() => readRsrc(Buffer.concat([Buffer.from('RSCC'), u32(2), u32(0), u32(10)])), e => e.code === 'BAD_FORMAT');
  assert.throws(() => readRsrc(Buffer.concat([Buffer.from('RSCC'), u32(2), u32(4096), u32(9000), u32(1)])), e => e.code === 'BAD_FORMAT');
});
