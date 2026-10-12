import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { tempDir, buildDotNetDll, buildWasm, buildPck, embedPck } from './helpers.mjs';

const dir = await tempDir();
process.env.REVERSEPORT_HOME = path.join(dir, 'home');
const { inspectBinary, parseWasm, extractStrings, toolchainHints } = await import('../src/binary.mjs');

test('reads the real Node.js executable of this platform', async () => {
  const r = await inspectBinary({ file: process.execPath, strings: { limit: 5, match: 'node' } });
  const expected = { linux: 'elf', darwin: ['macho', 'macho-fat'], win32: 'pe' }[process.platform];
  if (!expected) return;
  assert.ok([expected].flat().includes(r.binary.format), `format ${r.binary.format}`);
  if (r.binary.format !== 'macho-fat') {
    assert.ok(r.binary.sections.length >= 3, `sections: ${r.binary.sections.length}`);
    assert.ok(['x86-64', 'arm64'].includes(r.binary.arch));
    assert.ok(r.binary.imports.some(i => (i.libraries?.length ?? 0) + (i.functions?.length ?? 0) > 0), 'has imports');
  }
  assert.match(r.sha256, /^[0-9a-f]{64}$/);
  assert.ok(r.strings.items.length > 0);
});

test('lists .NET types and methods (Unity Mono builds)', async () => {
  const file = path.join(dir, 'Assembly-CSharp.dll');
  await fs.writeFile(file, buildDotNetDll({ module: 'Assembly-CSharp.dll' }));
  const r = await inspectBinary({ file });
  assert.equal(r.binary.format, 'pe');
  assert.equal(r.binary.dotnet.runtime, 'v4.0.30319');
  assert.deepEqual(r.binary.dotnet.types, [{ name: 'MiniHeli.Player', methods: ['Awake', 'Update'] }, { name: 'MiniHeli.Enemy', methods: ['OnTriggerEnter'] }]);
  assert.equal(r.hints.engine, 'Unity (Mono scripting backend)');
});

test('WebAssembly imports and exports', () => {
  const w = parseWasm(buildWasm());
  assert.deepEqual(w.imports, [{ library: 'env', functions: ['log'] }]);
  assert.deepEqual(w.exports.names, ['main']);
});

test('finds a Godot pack appended to an executable (overlay)', async () => {
  const exe = buildDotNetDll();
  const file = path.join(dir, 'Game.exe');
  await fs.writeFile(file, embedPck(exe, buildPck({ 'res://a.gd': 'extends Node\n'.repeat(200) })));
  const r = await inspectBinary({ file });
  assert.equal(r.binary.overlay.startsWith.id, 'godot-pck');
  assert.equal(r.binary.overlay.offset, exe.length);
});

test('strings: ascii + utf16, filters and toolchain hints', () => {
  const buf = Buffer.concat([Buffer.from('\0\0hello world\0\0\0\0'), Buffer.from('wide string here', 'utf16le'), Buffer.from('\0GCC: (GNU) 13.2.0\0Godot Engine 4.3.stable.official.77dcf97d8\0')]);
  const s = extractStrings(buf, { min: 6 });
  assert.ok(s.items.some(x => x.text === 'hello world' && x.encoding === 'ascii'));
  assert.ok(s.items.some(x => x.text === 'wide string here' && x.encoding === 'utf16le'));
  assert.equal(extractStrings(buf, { match: '/^gcc/i' }).items.length, 1);
  const h = toolchainHints(s.items.map(x => x.text).join('\n'));
  assert.equal(h.compiler, 'GCC 13.2.0 (GNU)');
  assert.equal(h.engine, 'Godot');
  assert.equal(h.version, '4.3');
});
