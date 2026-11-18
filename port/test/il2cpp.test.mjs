import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { tempDir, buildIl2cppMetadata } from './helpers.mjs';
import { il2cppTool, parseMetadata } from '../src/il2cpp.mjs';

test('IL2CPP metadata: assemblies, types, methods, literals and a C# skeleton', async () => {
  const meta = parseMetadata(buildIl2cppMetadata());
  assert.equal(meta.version, 29);
  assert.deepEqual(meta.images.map(i => i.name), ['mscorlib.dll', 'Assembly-CSharp.dll']);
  assert.equal(meta.types[1].name, 'Player');
  assert.deepEqual(meta.types[1].methods, ['Awake', 'Update', 'Jump', 'TakeDamage']);
  assert.deepEqual(meta.literals, ['Game Over', 'Press start']);
  const dir = await tempDir();
  await fs.writeFile(path.join(dir, 'global-metadata.dat'), buildIl2cppMetadata());
  const r = await il2cppTool({ file: path.join(dir, 'global-metadata.dat'), out: path.join(dir, 'out') });
  assert.equal(r.gameTypes, 3);
  assert.deepEqual(r.behaviours.items, ['Player']);
  const cs = await fs.readFile(path.join(dir, 'out', 'Assembly-CSharp.cs'), 'utf8');
  assert.ok(cs.includes('namespace Game.UI') && cs.includes('public class HealthBar') && cs.includes('// TakeDamage()'));
  await assert.rejects(fs.writeFile(path.join(dir, 'enc.dat'), Buffer.alloc(100, 7)).then(() => il2cppTool({ file: path.join(dir, 'enc.dat') })), /Not IL2CPP metadata/);
  await fs.rm(dir, { recursive: true, force: true });
});
