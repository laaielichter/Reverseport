import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readUnityAnimation, clipToTres, controllerToGd } from '../src/unity-anim.mjs';
import { readScene } from '../src/scene.mjs';
import { convertTree } from '../src/convert.mjs';
import { writeTscn } from '../src/porters.mjs';
import { planPort, portScene, loadPlan } from '../src/plan.mjs';

const F = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'unity-anim');

test('.anim → Godot Animation: position/euler/float/sprite/method tracks, Z mirrored, bools discrete', async () => {
  const { clip } = await readUnityAnimation(path.join(F, 'Assets', 'Anim', 'Walk.anim'));
  assert.equal(clip.name, 'Walk');
  assert.equal(clip.loop, true);
  assert.equal(clip.tracks.length, 5);
  const r = clipToTres(clip, { resolve: p => `res://assets/${p.replace(/^Assets\//, '')}` });
  assert.equal(r.tracks, 6);
  assert.ok(r.text.includes('NodePath("Body:position")') && r.text.includes('Vector3(0, 1, -2)'));
  assert.ok(r.text.includes('NodePath("Body/Arm:rotation_degrees")') && r.text.includes('Vector3(0, -90, 0)'));
  assert.ok(r.text.includes('NodePath("Body/Weapon:visible")') && r.text.includes('"values": [true, false]'));
  assert.ok(r.text.includes('NodePath("Lamp:light_energy")'));
  assert.ok(r.text.includes('NodePath(".:texture")') && r.text.includes('ExtResource("1_rp"), ExtResource("2_rp")'));
  assert.ok(r.text.includes('tracks/5/type = "method"') && r.text.includes('"method": &"Footstep"'));
  assert.deepEqual(r.todo, []);
});

test('.controller → GDScript state machine with the same states, parameters and conditions', async () => {
  const { controller } = await readUnityAnimation(path.join(F, 'Assets', 'Anim', 'Player.controller'));
  assert.deepEqual(controller.parameters.map(p => `${p.name}:${p.type}`), ['Speed:float', 'Grounded:bool', 'Jump:trigger']);
  assert.equal(controller.layers[0].defaultState, 'Idle');
  assert.equal(controller.layers[0].states.find(s => s.name === 'Walk').motion, 'Assets/Anim/Walk.anim');
  const g = controllerToGd(controller, { resolveClip: p => (p?.endsWith('.anim') ? 'walk' : null) });
  assert.equal(g.states, 2);
  assert.equal(g.transitions, 3);
  assert.ok(g.text.includes('var speed: float = 0') && g.text.includes('var grounded: bool = true'));
  assert.ok(g.text.includes('if speed > 0.1:') && g.text.includes('if speed < 0.1 and not grounded and _exit_time_reached(0.9):'));
  assert.ok(g.text.includes('if _triggers.has(&"Jump"):') && g.text.includes('&"Walk": "walk"'));
});

test('uGUI prefab → Control tree with Godot anchors/offsets, labels, buttons', async () => {
  const scene = await readScene(path.join(F, 'Assets', 'UI', 'Hud.prefab'));
  const tscn = writeTscn(convertTree(scene.root, 'unity', 'godot'), { name: 'Hud', resolve: p => (p.endsWith('.png') ? `res://assets/${p.replace(/^Assets\//, '')}` : null) });
  assert.ok(tscn.includes('[node name="Canvas" type="Control"]') && tscn.includes('anchors_preset = 15'));
  assert.ok(tscn.includes('[node name="HealthBar" type="TextureRect" parent="."]\noffset_left = 20\noffset_top = 25\noffset_right = 220\noffset_bottom = 55'), tscn);
  assert.ok(tscn.includes('modulate = Color(1, 0.2, 0.2, 1)') && tscn.includes('texture = ExtResource("1_rp")'));
  assert.ok(tscn.includes('[node name="Label" type="Label" parent="HealthBar"]\nanchor_right = 1\nanchor_bottom = 1'));
  assert.ok(tscn.includes('text = "HP: 100"') && tscn.includes('theme_override_font_sizes/font_size = 18'));
  assert.ok(tscn.includes('[node name="StartButton" type="Button" parent="."]') && tscn.includes('offset_top = 80\noffset_right = 80\noffset_bottom = 120\ntext = "Start"'));
  assert.ok(tscn.includes('OnClick → StartGame'));
  assert.ok(!tscn.includes('Transform3D'), 'UI nodes must not get 3D transforms');
});

test('prefab variant → inherited scene with overrides applied or listed', async () => {
  const scene = await readScene(path.join(F, 'Assets', 'Prefabs', 'EnemyVariant.prefab'));
  assert.equal(scene.root.type, 'PrefabInstance');
  assert.equal(scene.root.name, 'EnemyFast');
  assert.deepEqual(scene.root.overrides.map(o => o.property), ['m_IsActive', 'm_Controller']);
  const tscn = writeTscn(convertTree(scene.root, 'unity', 'godot'), { name: 'EnemyVariant', resolve: p => (p.endsWith('.prefab') ? 'res://scenes/enemy.tscn' : null) });
  assert.ok(tscn.includes('[node name="EnemyFast" instance=ExtResource("1_rp")]'));
  assert.ok(tscn.includes('visible = false') && tscn.includes('override m_Controller = Assets/Anim/Player.controller'));
});

test('port_plan + port_scene: animation units become .tres/.gd and the Animator node gets an AnimationPlayer library', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rp-anim-'));
  const prev = process.env.REVERSEPORT_HOME;
  process.env.REVERSEPORT_HOME = path.join(dir, 'home');
  try {
    const created = await planPort({ source: F, to: 'godot' });
    const plan = await loadPlan(created.planId);
    const byKind = Object.fromEntries(plan.units.map(u => [u.source, `${u.kind}:${u.action}:${u.target}`]));
    assert.equal(byKind['Assets/Anim/Walk.anim'], 'animation:convert-scene:animations/walk.tres');
    assert.equal(byKind['Assets/Anim/Player.controller'], 'animation:convert-scene:animations/player_animator.gd');
    for (let i = 0; i < 10; i++) { const r = await portScene({ planId: plan.id }); if (r.message) break; }
    const enemy = await fs.readFile(path.join(plan.output, 'scenes', 'enemy.tscn'), 'utf8');
    assert.ok(enemy.includes('[sub_resource type="AnimationLibrary"') && enemy.includes('"walk": ExtResource('));
    assert.ok(enemy.includes('[node name="AnimationPlayer" type="AnimationPlayer" parent="."]'));
    assert.ok(enemy.includes('[node name="Animator" type="Node" parent="."]\nscript = ExtResource(') && enemy.includes('player = NodePath("../AnimationPlayer")'));
    assert.ok((await fs.readFile(path.join(plan.output, 'animations', 'walk.tres'), 'utf8')).includes('[gd_resource type="Animation"'));
    assert.ok((await fs.readFile(path.join(plan.output, 'animations', 'player_animator.gd'), 'utf8')).includes('&"Walk": "walk"'));
  } finally {
    if (prev === undefined) delete process.env.REVERSEPORT_HOME; else process.env.REVERSEPORT_HOME = prev;
    await fs.rm(dir, { recursive: true, force: true });
  }
});
