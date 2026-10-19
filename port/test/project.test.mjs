import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const F = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const { scanProject } = await import('../src/scan.mjs');
const { graphTool, symbolsTool } = await import('../src/graph.mjs');
const { extractSymbols, stripComments } = await import('../src/symbols.mjs');

test('scan detects Godot project, version, main scene and autoloads', async () => {
  const s = await scanProject({ path: path.join(F, 'godot-mini') });
  assert.equal(s.primary.id, 'godot');
  assert.equal(s.engines[0].version, '4.3');
  assert.equal(s.languages.gdscript.files, 6);
  assert.deepEqual(s.entryPoints.map(e => e.file), ['main.tscn', 'global.gd']);
});

test('scan detects Unity project, version, pipeline and build scenes', async () => {
  const s = await scanProject({ path: path.join(F, 'unity-mini') });
  assert.equal(s.primary.id, 'unity');
  assert.equal(s.engines[0].version, '2022.3.45f1');
  assert.equal(s.engines[0].details.renderPipeline, 'URP');
  assert.deepEqual(s.engines[0].details.buildScenes, ['Assets/Scenes/Main.unity']);
});

test('graph: Godot loads, scene resources, class_name and autoload references; dependencies first', async () => {
  const g = await graphTool({ path: path.join(F, 'godot-mini') });
  const has = (a, b) => g.edges.some(e => e.from === a && e.to === b);
  assert.ok(has('main.tscn', 'actors/player.tscn'));
  assert.ok(has('actors/player.gd', 'actors/bullet.tscn'));
  assert.ok(has('actors/enemy.gd', 'actors/player.gd'), 'class_name Player');
  assert.ok(has('ui/hud.gd', 'global.gd'), 'autoload Global');
  const pos = f => g.portOrder.indexOf(f);
  for (const e of g.edges) assert.ok(pos(e.to) < pos(e.from), `${e.to} before ${e.from}`);
  assert.deepEqual(g.cycles, []);
});

test('graph: Unity GUIDs and C# type references', async () => {
  const g = await graphTool({ path: path.join(F, 'unity-mini') });
  const has = (a, b) => g.edges.some(e => e.from === a && e.to === b);
  assert.ok(has('Assets/Prefabs/Player.prefab', 'Assets/Scripts/PlayerController.cs'));
  assert.ok(has('Assets/Scenes/Main.unity', 'Assets/Prefabs/Player.prefab'));
  assert.ok(has('Assets/Scripts/PlayerController.cs', 'Assets/Scripts/Health.cs'));
  assert.ok(g.externals.some(e => e.name === 'UnityEngine'));
});

test('symbols: GDScript and C# details', async () => {
  const gd = await symbolsTool({ path: path.join(F, 'godot-mini', 'actors', 'player.gd') });
  assert.equal(gd.className, 'Player');
  assert.deepEqual(gd.functions.map(f => [f.name, f.line]), [['_ready', 13], ['_physics_process', 17], ['shoot', 26], ['_on_hit', 32]]);
  assert.deepEqual(gd.signals.map(s => s.name), ['hit']);
  assert.deepEqual(gd.exports, ['speed', 'jump_velocity']);
  const cs = await symbolsTool({ path: path.join(F, 'unity-mini', 'Assets', 'Scripts', 'PlayerController.cs') });
  assert.deepEqual(cs.functions.map(f => f.name), ['Awake', 'Update', 'FixedUpdate', 'Shoot', 'OnTriggerEnter']);
  assert.deepEqual(cs.exports, ['speed', 'muzzle']);
});

test('symbols in other languages and comment stripping', () => {
  const py = extractSymbols('import os\nfrom .util import x\n# def fake():\nclass A(Base):\n    def run(self):\n        s = "# not a comment"\n', 'python');
  assert.deepEqual(py.functions.map(f => f.name), ['run']);
  assert.deepEqual(py.deps.map(d => d.spec), ['os', '.util']);
  const ts = extractSymbols("import * as THREE from 'three';\nexport class Ship extends Base {\n  update(dt: number): void {}\n}\nexport const fly = (x: number) => x;\n", 'typescript');
  assert.deepEqual(ts.classes.map(c => c.name), ['Ship']);
  assert.deepEqual(ts.functions.map(f => f.name).sort(), ['fly', 'update']);
  const cpp = extractSymbols('#include "Heli.h"\n#include <vector>\nUCLASS()\nclass GAME_API AHeli : public APawn\n{\n  GENERATED_BODY()\n};\nvoid AHeli::Tick(float DeltaTime)\n{\n}\n', 'cpp');
  assert.deepEqual(cpp.classes.map(c => [c.name, c.extends]), [['AHeli', 'APawn']]);
  assert.deepEqual(cpp.functions.map(f => f.name), ['Tick']);
  assert.equal(cpp.unreal.uclass, 1);
  const lua = extractSymbols('local M = {}\nfunction M.update(dt) end\nlocal function helper() end\nreturn require("lib.vec")\n', 'lua');
  assert.deepEqual(lua.functions.map(f => f.name), ['update', 'helper']);
  assert.equal(stripComments('a // b\n/* c */d', 'csharp'), 'a     \n       d');
});

test('scan: in a monorepo the root app wins over nested packages and Android modules', async () => {
  const { tempDir } = await import('./helpers.mjs');
  const fs = await import('node:fs/promises');
  const root = await tempDir();
  const put = async (rel, content) => { await fs.mkdir(path.join(root, path.dirname(rel)), { recursive: true }); await fs.writeFile(path.join(root, rel), content); };
  // More nested packages than the old cap of 10, all sorting before the root package.json.
  for (let i = 0; i < 12; i++) await put(`cloud/apps/svc${i}/package.json`, JSON.stringify({ name: `svc${i}`, main: 'dist/index.js' }));
  await put('mobile/modules/shell/android/src/main/AndroidManifest.xml', '<manifest/>');
  await put('mobile/package.json', JSON.stringify({ name: 'mobile', dependencies: { expo: '1', 'react-native': '1' } }));
  await put('package.json', JSON.stringify({ name: 'desk', main: './out/main/index.js', devDependencies: { 'electron-vite': '1', react: '1' } }));
  const s = await scanProject({ path: root });
  assert.notEqual(s.primary.id, 'android');
  const rootApp = s.engines.find(e => e.id === 'node' && e.root === '');
  assert.ok(rootApp.details.frameworks.includes('Electron'));
  const android = s.engines.find(e => e.id === 'android');
  assert.equal(android.root, 'mobile/modules/shell/android');
  assert.ok(s.engines.some(e => e.id === 'node' && e.details.frameworks.includes('Expo')));
  assert.ok(s.entryPoints.some(e => e.file === 'out/main/index.js'));
});
