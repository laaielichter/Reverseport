import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { tempDir, buildPck, embedPck, buildDotNetDll, buildZip, buildAsar, buildTar } from './helpers.mjs';

const dir = await tempDir();
process.env.REVERSEPORT_HOME = path.join(dir, 'home');
const { archiveTool } = await import('../src/archive.mjs');

const FILES = { 'res://project.godot': 'config_version=5\n', 'res://player.gd': 'extends CharacterBody3D\nfunc _ready():\n\tpass\n', 'res://scenes/main.tscn': '[gd_scene format=3]\n[node name="Main" type="Node3D"]\n' };

for (const [version, opts] of [[1, { godot: [3, 5, 2] }], [2, {}], [3, { godot: [4, 5, 0], stripRes: true }]]) {
  test(`Godot pack format v${version}: list and extract with MD5 check`, async () => {
    const file = path.join(dir, `game-v${version}.pck`);
    await fs.writeFile(file, buildPck(FILES, { version, ...opts }));
    const list = await archiveTool({ file });
    assert.equal(list.format, 'godot-pck');
    assert.equal(list.packVersion, version);
    assert.deepEqual(list.entries.map(e => e.path).sort(), Object.keys(FILES).sort());
    const out = path.join(dir, `out-v${version}`);
    const x = await archiveTool({ file, action: 'extract', out, match: '*.gd' });
    assert.equal(x.extracted, 1);
    assert.equal(x.md5Mismatches, undefined);
    assert.equal(await fs.readFile(path.join(out, 'player.gd'), 'utf8'), FILES['res://player.gd']);
  });
}

test('Godot pack embedded in the executable (v2 relative base and v3)', async () => {
  for (const [version, extra] of [[2, {}], [3, {}]]) {
    let pck = buildPck(FILES, { version, ...extra });
    if (version === 2) pck.writeUInt32LE(2, 20); // PACK_REL_FILEBASE
    const file = path.join(dir, `Game-v${version}.exe`);
    const exe = buildDotNetDll();
    await fs.writeFile(file, embedPck(exe, pck));
    const list = await archiveTool({ file });
    assert.equal(list.embedded, true);
    assert.equal(list.start, exe.length);
    const x = await archiveTool({ file, action: 'extract', out: path.join(dir, `emb-${version}`) });
    assert.equal(x.extracted, 3);
    assert.equal(await fs.readFile(path.join(dir, `emb-${version}`, 'scenes', 'main.tscn'), 'utf8'), FILES['res://scenes/main.tscn']);
  }
});

test('encrypted pack directory is reported, not decrypted', async () => {
  const pck = buildPck(FILES, { version: 2 });
  pck.writeUInt32LE(1, 20); // PACK_DIR_ENCRYPTED
  const file = path.join(dir, 'enc.pck');
  await fs.writeFile(file, pck);
  const r = await archiveTool({ file });
  assert.equal(r.encryptedDirectory, true);
  assert.equal(r.totalEntries, 0);
  assert.match(r.note, /does not decrypt/);
});

test('zip, tar, tar.gz and asar', async () => {
  const files = { 'a/readme.txt': 'hello', 'b/data.json': '{"x":1}' };
  for (const [name, buf, format] of [['t.zip', buildZip(files), 'zip'], ['t.tar', buildTar(files), 'tar'], ['t.unitypackage', buildTar(files, { gzip: true }), 'tar.gz'], ['app.asar', buildAsar(files), 'asar']]) {
    const file = path.join(dir, name);
    await fs.writeFile(file, buf);
    const list = await archiveTool({ file });
    assert.equal(list.format, format, name);
    assert.deepEqual(list.entries.map(e => e.path).sort(), Object.keys(files).sort(), name);
    const out = path.join(dir, `x-${name}`);
    await archiveTool({ file, action: 'extract', out });
    assert.equal(await fs.readFile(path.join(out, 'b', 'data.json'), 'utf8'), '{"x":1}', name);
  }
});

test('refuses archive entries that escape the output folder', async () => {
  const file = path.join(dir, 'evil.zip');
  await fs.writeFile(file, buildZip({ '../../evil.txt': 'x' }));
  await assert.rejects(archiveTool({ file, action: 'extract', out: path.join(dir, 'evil') }), /unsafe path/i);
});
