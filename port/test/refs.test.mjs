import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tempDir } from './helpers.mjs';

const F = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const { callTool } = await import('../src/tools.mjs');

const meta = guid => `fileFormatVersion: 2\nguid: ${guid}\nMonoImporter:\n  externalObjects: {}\n`;
const G = { player: '7e6d5c4b3a291807f6e5d4c3b2a19087', moved: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', copied: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', mat: 'cccccccccccccccccccccccccccccccc' };

async function project() {
  const root = await tempDir('rp-refs-');
  const w = async (rel, text) => { const f = path.join(root, rel); await fs.mkdir(path.dirname(f), { recursive: true }); await fs.writeFile(f, text); };
  await w('ProjectSettings/ProjectVersion.txt', 'm_EditorVersion: 2022.3.1f1\n');
  await w('Assets/Scripts/Player.cs', 'public class Player {}');
  await w('Assets/Scripts/Player.cs.meta', meta(G.player));
  // Script moved outside Unity: the new file has no .meta, the scene still points at the old guid.
  await w('Assets/Scripts/Moved/Enemy.cs', 'public class Enemy {}');
  // Two assets copied with their .meta: same guid twice.
  await w('Assets/Art/a.mat', '%YAML 1.1\n--- !u!21 &2100000\nMaterial:\n  m_Name: a\n');
  await w('Assets/Art/a.mat.meta', meta(G.copied));
  await w('Assets/Art/a copy.mat', '%YAML 1.1\n--- !u!21 &2100000\nMaterial:\n  m_Name: a copy\n');
  await w('Assets/Art/a copy.mat.meta', meta(G.copied));
  // .meta without its asset.
  await w('Assets/Art/gone.png.meta', meta(G.mat));
  await w('Assets/Scenes/Main.unity', `%YAML 1.1
--- !u!114 &1
MonoBehaviour:
  m_Script: {fileID: 11500000, guid: ${G.player}, type: 3}
--- !u!114 &2
MonoBehaviour:
  m_Script: {fileID: 11500000, guid: ${G.moved}, type: 3}
--- !u!23 &3
MeshRenderer:
  m_Materials:
  - {fileID: 2100000, guid: ${G.copied}, type: 2}
--- !u!33 &4
MeshFilter:
  m_Mesh: {fileID: 10202, guid: 0000000000000000e000000000000000, type: 0}
`);
  await w('Assets/Scenes/Main.unity.meta', meta('dddddddddddddddddddddddddddddddd'));
  return root;
}

test('re_refs: dangling, duplicate and missing .meta, with a remap suggestion', async () => {
  const root = await project();
  const r = await callTool('re_refs', { path: path.join(root, 'Assets', 'Scenes') });
  assert.equal(r.passed, false);
  assert.equal(r.summary.dangling, 1);
  const d = r.dangling.items[0];
  assert.equal(d.guid, G.moved);
  assert.deepEqual(d.kinds, ['script']);
  assert.deepEqual(d.files, ['Assets/Scenes/Main.unity']);
  assert.equal(d.suggestions[0].asset, 'Assets/Scripts/Moved/Enemy.cs');
  assert.equal(d.suggestions[0].guid, null, 'the moved script has no .meta yet');
  assert.deepEqual(r.duplicateGuids.items.map(x => x.assets), [['Assets/Art/a copy.mat', 'Assets/Art/a.mat']]);
  assert.deepEqual(r.assetsWithoutMeta.items, ['Assets/Scripts/Moved/Enemy.cs']);
  assert.deepEqual(r.metaWithoutAsset.items, [{ meta: 'Assets/Art/gone.png.meta', expected: 'Assets/Art/gone.png' }]);
  assert.equal(r.summary.references, 4);
  assert.ok(r.builtin.some(b => b.guid === '0000000000000000e000000000000000'), 'built-in guids are never dangling');
  await fs.rm(root, { recursive: true, force: true });
});

test('re_refs: the mini fixture resolves everything except one external material', async () => {
  const r = await callTool('re_refs', { path: path.join(F, 'unity-mini') });
  assert.equal(r.summary.metaFiles, 5);
  assert.equal(r.summary.dangling, 1);
  assert.equal(r.summary.duplicateGuids, 0);
  assert.equal(r.summary.assetsWithoutMeta, 0);
});

test('re_refs: refuses a folder that is not a Unity project', async () => {
  await assert.rejects(callTool('re_refs', { path: path.join(F, 'godot-mini') }), e => e.code === 'NOT_UNITY');
});
