import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { tempDir } from './helpers.mjs';

const dir = await tempDir();
process.env.REVERSEPORT_HOME = path.join(dir, 'home');
const { archiveTool } = await import('../src/archive.mjs');
const { decodeTool } = await import('../src/godotbin.mjs');
const { identify } = await import('../src/formats.mjs');
const PCK = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'godot-4.7-export', 'game.pck');

test('a real Godot 4.7.2 export (pack format 4): identify, list, extract, decode to a project that opens', async () => {
  const head = (await fs.readFile(PCK)).subarray(0, 64);
  assert.equal(identify(head).id, 'godot-pck');
  const list = await archiveTool({ file: PCK });
  assert.equal(list.packVersion, 4);
  assert.equal(list.godotVersion, '4.7.2');
  assert.ok(list.entries.some(e => e.path === 'res://main.gdc'));
  const out = path.join(dir, 'x');
  const x = await archiveTool({ file: PCK, action: 'extract', out });
  assert.equal(x.extracted, list.totalEntries);
  assert.equal(x.md5Mismatches, undefined);
  const dec = path.join(dir, 'decoded');
  const d = await decodeTool({ path: out, out: dec });
  assert.equal(d.notConverted, undefined, JSON.stringify(d.notConverted));
  const names = (await fs.readdir(dec)).sort();
  for (const n of ['kleur.png', 'kleur.png.import', 'main.gd', 'main.tscn', 'muziek.ogg', 'piep.wav', 'piep.wav.import', 'project.godot']) assert.ok(names.includes(n), `${n} in ${names}`);
  // kleur.png: the generated gradient, pixel for pixel (it was stored as lossless WebP).
  const png = await fs.readFile(path.join(dec, 'kleur.png'));
  assert.equal(png.readUInt32BE(16), 64);
  const idat = [];
  for (let p = 8; p < png.length;) { const len = png.readUInt32BE(p); if (png.toString('latin1', p + 4, p + 8) === 'IDAT') idat.push(png.subarray(p + 8, p + 8 + len)); p += 12 + len; }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  for (const [x, y] of [[0, 0], [5, 9], [63, 63]]) {
    const o = y * (64 * 4 + 1) + 1 + x * 4;
    assert.deepEqual([...raw.subarray(o, o + 4)], [(x * 4) % 256, (y * 4) % 256, 128, 255]);
  }
  // piep.wav: 440 Hz at 22050 Hz mono for 0.5 s (stored as QOA; lossy, so count zero crossings).
  const wav = await fs.readFile(path.join(dec, 'piep.wav'));
  assert.equal(wav.readUInt32LE(24), 22050);
  const data = wav.subarray(44);
  const n = data.length / 2;
  assert.equal(n, 11025);
  let crossings = 0;
  for (let i = 1; i < n; i++) if ((data.readInt16LE(i * 2 - 2) < 0) !== (data.readInt16LE(i * 2) < 0)) crossings++;
  assert.ok(Math.abs(crossings / 2 / 0.5 - 440) < 5, `${crossings / 2 / 0.5} Hz`);
  // The exported .import keeps the uid the scene uses.
  const tscn = await fs.readFile(path.join(dec, 'main.tscn'), 'utf8');
  const uid = (await fs.readFile(path.join(dec, 'kleur.png.import'), 'utf8')).match(/uid="([^"]+)"/)[1];
  assert.ok(tscn.includes(uid));
});
