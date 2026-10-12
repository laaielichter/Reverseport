import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const F = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const { readScene, parseGodotScene, godotTransform } = await import('../src/scene.mjs');
const { writeTscn } = await import('../src/porters.mjs');

test('Godot text scene: tree, instances, transforms, groups, connections', async () => {
  const s = await readScene(path.join(F, 'godot-mini', 'main.tscn'));
  assert.equal(s.kind, 'godot-scene');
  assert.equal(s.godotMajor, 4);
  assert.equal(s.root.name, 'Main');
  const names = s.root.children.map(c => c.name);
  assert.deepEqual(names, ['Sun', 'Camera3D', 'Player', 'Enemies', 'HUD']);
  const enemy = s.root.children[3].children[0];
  assert.equal(enemy.instance, 'res://actors/enemy.tscn');
  assert.deepEqual(enemy.transform, { position: [5, 1, -10], rotation: [0, 0, 0, 1], scale: [2, 2, 2] });
  assert.deepEqual(s.root.children[0].transform.rotation, [-0.3827, 0, 0, 0.9239]);
  assert.deepEqual(s.connections, [{ signal: 'hit', from: 'Player', to: 'HUD', method: '_on_player_hit' }]);
  assert.match(s.mermaid, /graph TD/);
});

test('Godot transform text is row-major basis + origin', () => {
  const t = godotTransform('Transform3D(-4.37114e-08, 0, 1, 0, 1, 0, -1, 0, -4.37114e-08, 0.5, 1.2, -0.3)');
  assert.deepEqual(t, { position: [0.5, 1.2, -0.3], rotation: [0, 0.7071, 0, 0.7071], scale: [1, 1, 1] });
});

test('Godot project.godot and .tres', async () => {
  const p = await readScene(path.join(F, 'godot-mini', 'project.godot'));
  assert.equal(p.project.name, 'Mini Heli');
  assert.equal(p.project.mainScene, 'res://main.tscn');
  assert.equal(p.project.version, '4.3');
  assert.deepEqual(p.project.autoload, [{ name: 'Global', path: 'res://global.gd', singleton: true }]);
  assert.deepEqual(p.project.inputActions, ['move_left', 'fire']);
  const r = await readScene(path.join(F, 'godot-mini', 'items', 'coin.tres'));
  assert.equal(r.scriptClass, 'ItemData');
  assert.equal(r.properties.name, 'Coin');
  assert.equal(r.properties.script, 'res://items/item_data.gd');
});

test('Unity prefab: hierarchy, components, scripts through .meta GUIDs', async () => {
  const s = await readScene(path.join(F, 'unity-mini', 'Assets', 'Prefabs', 'Player.prefab'));
  assert.equal(s.kind, 'unity-prefab');
  assert.equal(s.root.name, 'Player');
  assert.equal(s.root.tag, 'Player');
  const types = s.root.components.map(c => c.type);
  assert.deepEqual(types, ['MeshFilter', 'MeshRenderer', 'CapsuleCollider', 'Rigidbody', 'MonoBehaviour', 'MonoBehaviour']);
  assert.equal(s.root.components[0].mesh, 'builtin:Capsule');
  assert.deepEqual(s.scripts, ['Assets/Scripts/PlayerController.cs', 'Assets/Scripts/Health.cs']);
  assert.deepEqual(s.root.children[0].transform.rotation, [0, 0.7071, 0, 0.7071]);
  assert.equal(s.root.children[0].children[0].name, 'Muzzle');
});

test('Unity scene: roots, prefab instance with overrides', async () => {
  const s = await readScene(path.join(F, 'unity-mini', 'Assets', 'Scenes', 'Main.unity'));
  assert.equal(s.kind, 'unity-scene');
  const inst = s.root.children.find(c => c.type === 'PrefabInstance');
  assert.equal(inst.name, 'Player One');
  assert.equal(inst.prefab, 'Assets/Prefabs/Player.prefab');
  assert.deepEqual(inst.transform.position, [0, 1, 0]);
  assert.equal(s.root.children.find(c => c.name === 'Main Camera').components[0].fieldOfView, 60);
});

test('written .tscn parses back with the same transforms', () => {
  const tree = { name: 'Root', type: 'Scene', components: [], children: [
    { name: 'Box', type: 'GameObject', transform: { position: [1, 2, 3], rotation: [0, 0.7071, 0, 0.7071], scale: [2, 2, 2] }, components: [{ type: 'MeshFilter', mesh: 'builtin:Cube' }, { type: 'BoxCollider', size: { x: 1, y: 2, z: 3 } }, { type: 'Rigidbody', mass: 1 }], children: [] },
  ] };
  const text = writeTscn(tree, { engine: 'unity' });
  const back = parseGodotScene(text);
  const box = back.root.children[0];
  assert.equal(box.type, 'RigidBody3D');
  assert.deepEqual(box.transform, { position: [1, 2, 3], rotation: [0, 0.7071, 0, 0.7071], scale: [2, 2, 2] });
  assert.deepEqual(box.children.map(c => c.type), ['MeshInstance3D', 'CollisionShape3D']);
  assert.equal(back.subResourceTypes.BoxShape3D, 1);
});
