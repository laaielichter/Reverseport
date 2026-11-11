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

test('scan detects Cocos Creator 2.x, 3.x, GDevelop and Haxe projects', async () => {
  const { tempDir } = await import('./helpers.mjs');
  const fs = await import('node:fs/promises');
  const root = await tempDir();
  const put = async (rel, content) => { await fs.mkdir(path.join(root, path.dirname(rel)), { recursive: true }); await fs.writeFile(path.join(root, rel), content); };
  // The three samples from #136, plus the Cocos 3.x marker (package.json creator key).
  await put('cocos2/project.json', '{"engine":"cocos-creator-js","version":"2.4.13"}');
  await put('cocos3/package.json', JSON.stringify({ name: 'x', creator: { version: '3.8.0' } }));
  await put('gdevelop/game.json', '{"gdVersion":{"major":5},"properties":{"name":"x"}}');
  await put('haxe-flixel/build.hxml', '-main Main\n-lib flixel\n');
  await put('haxe-flixel/Main.hx', 'class Main { static function main() {} }');
  await put('haxe-openfl/project.xml', '<?xml version="1.0"?>\n<project>\n<meta title="x"/>\n<haxelib name="openfl"/>\n</project>\n');
  await put('haxe-heaps/build.hxml', '-main Main\n-lib heaps\n');
  const s = await scanProject({ path: root });
  const byId = (id, sub) => s.engines.filter(e => e.id === id && (!sub || e.root === sub));
  const cocos2 = byId('cocos-creator', 'cocos2')[0];
  assert.equal(cocos2.name, 'Cocos Creator 2.4.13');
  assert.equal(cocos2.version, '2.4.13');
  assert.deepEqual(cocos2.evidence, ['cocos2/project.json']);
  const cocos3 = byId('cocos-creator', 'cocos3')[0];
  assert.equal(cocos3.name, 'Cocos Creator 3.8.0');
  assert.equal(cocos3.version, '3.8.0');
  assert.deepEqual(cocos3.evidence, ['cocos3/package.json']);
  const gd = byId('gdevelop', 'gdevelop')[0];
  assert.equal(gd.name, 'GDevelop 5');
  assert.equal(gd.version, '5');
  assert.deepEqual(gd.evidence, ['gdevelop/game.json']);
  const flixel = byId('haxe', 'haxe-flixel')[0];
  assert.equal(flixel.name, 'Haxe (HaxeFlixel)');
  assert.equal(flixel.details.framework, 'HaxeFlixel');
  assert.deepEqual(flixel.evidence, ['haxe-flixel/build.hxml']);
  const openfl = byId('haxe', 'haxe-openfl')[0];
  assert.equal(openfl.name, 'Haxe (OpenFL)');
  assert.equal(openfl.details.framework, 'OpenFL');
  assert.deepEqual(openfl.evidence, ['haxe-openfl/project.xml']);
  const heaps = byId('haxe', 'haxe-heaps')[0];
  assert.equal(heaps.name, 'Haxe (Heaps)');
  assert.equal(s.languages.haxe.files, 1, '.hx counts as Haxe code');
});

test('scan does not report non-engine project.json, game.json or project.xml as engines', async () => {
  const { tempDir } = await import('./helpers.mjs');
  const fs = await import('node:fs/promises');
  const root = await tempDir();
  const put = async (rel, content) => { await fs.mkdir(path.join(root, path.dirname(rel)), { recursive: true }); await fs.writeFile(path.join(root, rel), content); };
  await put('plain/project.json', '{"name":"x","version":"1.0.0"}');
  await put('other-engine/project.json', '{"engine":"cocos2d-x","version":"3.17"}');
  await put('plain/game.json', '{"name":"x","properties":{}}');
  await put('plain/package.json', JSON.stringify({ name: 'x', version: '1.0.0' }));
  await put('plain/project.xml', '<?xml version="1.0"?>\n<project><name>x</name></project>\n');
  const s = await scanProject({ path: root });
  assert.deepEqual(s.engines.filter(e => ['cocos-creator', 'gdevelop', 'haxe'].includes(e.id)), []);
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
