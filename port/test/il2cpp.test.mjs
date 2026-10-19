import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { tempDir } from './helpers.mjs';
import { il2cppTool, parseMetadata } from '../src/il2cpp.mjs';

// Builds a metadata file shaped like version 29: header of (offset,size) pairs, NUL-terminated identifiers,
// 32-byte method records, 88-byte type records and 40-byte image records.
function buildMetadata() {
  const ids = []; const idOf = new Map();
  const id = s => { if (!idOf.has(s)) { idOf.set(s, ids.reduce((n, x) => n + Buffer.byteLength(x) + 1, 0)); ids.push(s); } return idOf.get(s); };
  const i32 = n => { const b = Buffer.alloc(4); b.writeInt32LE(n); return b; };
  const types = [
    ['mscorlib.dll', 'System', 'Object', ['ToString', 'GetHashCode']],
    ['Assembly-CSharp.dll', '', 'Player', ['Awake', 'Update', 'Jump', 'TakeDamage']],
    ['Assembly-CSharp.dll', 'Game.UI', 'HealthBar', ['SetValue']],
    ['Assembly-CSharp.dll', 'Game', 'SaveSystem', ['Save', 'Load']],
  ];
  const images = [['mscorlib.dll', 0, 1], ['Assembly-CSharp.dll', 1, 3]];
  const methodRecs = [], typeRecs = [];
  types.forEach(([, ns, name, ms], ti) => { const r = Buffer.alloc(88); r.writeInt32LE(id(name), 0); r.writeInt32LE(id(ns), 4); typeRecs.push(r); for (const m of ms) { const mr = Buffer.alloc(32); mr.writeInt32LE(id(m), 0); mr.writeInt32LE(ti, 4); methodRecs.push(mr); } });
  const imageRecs = images.map(([n, start, count]) => { const r = Buffer.alloc(40); r.writeInt32LE(id(n), 0); r.writeInt32LE(start, 8); r.writeUInt32LE(count, 12); return r; });
  const strings = Buffer.concat(ids.map(s => Buffer.from(s + '\0')));
  const litData = Buffer.from('Game OverPress start');
  const lits = Buffer.concat([i32(9), i32(0), i32(11), i32(9)]);
  const sections = [lits, litData, strings, Buffer.alloc(0), Buffer.alloc(0), Buffer.concat(methodRecs), ...Array(13).fill(Buffer.alloc(0)), Buffer.concat(typeRecs), Buffer.concat(imageRecs)];
  const headerSize = 8 + sections.length * 8;
  let off = headerSize; const hdr = [Buffer.from([0xaf, 0x1b, 0xb1, 0xfa]), i32(29)];
  for (const s of sections) { hdr.push(i32(off), i32(s.length)); off += s.length; }
  return Buffer.concat([...hdr, ...sections]);
}

test('IL2CPP metadata: assemblies, types, methods, literals and a C# skeleton', async () => {
  const meta = parseMetadata(buildMetadata());
  assert.equal(meta.version, 29);
  assert.deepEqual(meta.images.map(i => i.name), ['mscorlib.dll', 'Assembly-CSharp.dll']);
  assert.equal(meta.types[1].name, 'Player');
  assert.deepEqual(meta.types[1].methods, ['Awake', 'Update', 'Jump', 'TakeDamage']);
  assert.deepEqual(meta.literals, ['Game Over', 'Press start']);
  const dir = await tempDir();
  await fs.writeFile(path.join(dir, 'global-metadata.dat'), buildMetadata());
  const r = await il2cppTool({ file: path.join(dir, 'global-metadata.dat'), out: path.join(dir, 'out') });
  assert.equal(r.gameTypes, 3);
  assert.deepEqual(r.behaviours.items, ['Player']);
  const cs = await fs.readFile(path.join(dir, 'out', 'Assembly-CSharp.cs'), 'utf8');
  assert.ok(cs.includes('namespace Game.UI') && cs.includes('public class HealthBar') && cs.includes('// TakeDamage()'));
  await assert.rejects(fs.writeFile(path.join(dir, 'enc.dat'), Buffer.alloc(100, 7)).then(() => il2cppTool({ file: path.join(dir, 'enc.dat') })), /Not IL2CPP metadata/);
  await fs.rm(dir, { recursive: true, force: true });
});
