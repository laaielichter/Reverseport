import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { upgradeTool } from '../src/upgrade.mjs';
import { apicheckTool } from '../src/apicheck.mjs';

async function fixture() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rp-g3-'));
  await fs.mkdir(path.join(dir, 'scripts'));
  await fs.mkdir(path.join(dir, 'scenes'));
  await fs.writeFile(path.join(dir, 'project.godot'), `config_version=4\n\n[application]\n\nconfig/name="Old"\nrun/main_scene="res://scenes/Main.tscn"\n\n[input]\n\njump={\n"deadzone": 0.5,\n"events": [ Object(InputEventKey,"resource_local_to_scene":false,"resource_name":"","device":0,"alt":false,"shift":false,"control":false,"meta":false,"command":false,"pressed":false,"scancode":32,"physical_scancode":0,"unicode":0,"echo":false,"script":null)\n ]\n}\n`);
  await fs.writeFile(path.join(dir, 'scripts', 'Player.gd'), `extends KinematicBody2D

export var speed = 200
export(int, 0, 10) var lives = 3
export(PackedScene) var bullet_scene
onready var sprite = $Sprite
signal died
var velocity = Vector2.ZERO
var names = PoolStringArray()

func _ready():
\tconnect("died", self, "_on_died")
\t$Timer.connect("timeout", self, "_on_timer", [1])
\tvar b = bullet_scene.instance()
\tyield(get_tree().create_timer(1.0), "timeout")
\tyield(get_tree(), "idle_frame")
\tprint(deg2rad(90), stepify(1.23, 0.1), OS.get_ticks_msec())
\tsprite.modulate = Color.aliceblue
\temit_signal("died", 1, 2)
\tif names.empty():
\t\tpass

func _physics_process(delta):
\tvelocity = move_and_slide(velocity, Vector2.UP)

func _on_died(a, b):
\tqueue_free()

func _on_timer(x):
\tpass
`);
  await fs.writeFile(path.join(dir, 'scripts', 'Hud.gd'), `tool\nextends Control\n\nvar hp = 3 setget set_hp\n\nfunc set_hp(v):\n\thp = v\n\t$Label.rect_size = Vector2(100, 20)\n`);
  await fs.writeFile(path.join(dir, 'scenes', 'Main.tscn'), `[gd_scene load_steps=2 format=2]\n\n[ext_resource path="res://scripts/Player.gd" type="Script" id=1]\n\n[node name="Main" type="Spatial"]\n\n[node name="Player" type="KinematicBody2D" parent="."]\nscript = ExtResource( 1 )\n\n[node name="Sprite" type="Sprite" parent="Player"]\n\n[node name="Hud" type="Control" parent="."]\nmargin_left = 10.0\nrect_min_size = Vector2( 100, 20 )\ncustom_colors/font_color = Color( 1, 1, 1, 1 )\n`);
  await fs.writeFile(path.join(dir, 'scenes', 'glow.shader'), 'shader_type canvas_item;\nuniform vec4 tint : hint_color;\nvoid fragment() { COLOR = texture(TEXTURE, UV) * tint; }\n');
  await fs.writeFile(path.join(dir, 'scenes', 'mat.tres'), '[gd_resource type="ShaderMaterial" load_steps=2 format=2]\n[ext_resource path="res://scenes/glow.shader" type="Shader" id=1]\n[resource]\nshader = ExtResource( 1 )\n');
  return dir;
}

test('check reports changes and manual items without writing', async () => {
  const dir = await fixture();
  const before = (await fs.readFile(path.join(dir, 'scripts', 'Player.gd'), 'utf8'));
  const r = await upgradeTool({ path: dir });
  assert.equal(r.action, 'check');
  assert.ok(r.changed.items.find(c => c.file === 'scripts/Player.gd').lines >= 12);
  assert.ok(r.manualByKind['setget'] === 1 && r.manualByKind['move_and_slide(velocity, …)'] === 1 && r.manualByKind['var velocity in a CharacterBody script'] === 1);
  assert.equal(await fs.readFile(path.join(dir, 'scripts', 'Player.gd'), 'utf8'), before);
  await fs.rm(dir, { recursive: true, force: true });
});

test('apply writes a Godot 4 copy that re_apicheck accepts apart from the manual items', async () => {
  const dir = await fixture();
  const out = path.join(dir + '-out');
  const r = await upgradeTool({ path: dir, action: 'apply', out });
  assert.equal(r.out, out);
  const gd = await fs.readFile(path.join(out, 'scripts', 'Player.gd'), 'utf8');
  for (const want of ['extends CharacterBody2D', '@export var speed', '@export_range(0, 10) var lives', '@export var bullet_scene: PackedScene', '@onready var sprite = $Sprite2D', 'PackedStringArray()',
    'died.connect(_on_died)', '$Timer.timeout.connect(_on_timer.bind(1))', 'bullet_scene.instantiate()', 'await get_tree().create_timer(1.0).timeout', 'await get_tree().process_frame',
    'deg_to_rad(90)', 'snapped(1.23, 0.1)', 'Time.get_ticks_msec()', 'Color.ALICE_BLUE', 'died.emit(1, 2)', 'names.is_empty()']) assert.ok(gd.includes(want), `missing: ${want}\n${gd}`);
  const hud = await fs.readFile(path.join(out, 'scripts', 'Hud.gd'), 'utf8');
  assert.ok(hud.startsWith('@tool\n') && hud.includes('$Label.size ='));
  const scene = await fs.readFile(path.join(out, 'scenes', 'Main.tscn'), 'utf8');
  for (const want of ['format=3', 'type="Node3D"', 'type="CharacterBody2D"', 'type="Sprite2D"', 'offset_left = 10.0', 'custom_minimum_size =', 'theme_override_colors/font_color']) assert.ok(scene.includes(want), `scene missing ${want}`);
  const pg = await fs.readFile(path.join(out, 'project.godot'), 'utf8');
  assert.ok(pg.includes('config_version=5') && pg.includes('config/features=PackedStringArray("4.3"') && pg.includes('"keycode":32') && !pg.includes('"command"'));
  assert.ok(await fs.stat(path.join(out, 'scenes', 'glow.gdshader')));
  assert.ok((await fs.readFile(path.join(out, 'scenes', 'mat.tres'), 'utf8')).includes('glow.gdshader'));
  assert.ok((await fs.readFile(path.join(out, 'scenes', 'glow.gdshader'), 'utf8')).includes('source_color'));
  const check = await apicheckTool({ path: out });
  assert.equal(check.engine, 'godot@4.3');
  const names = check.files.items.flatMap(f => f.findings.map(x => x.name));
  assert.deepEqual(names, ['setget'], JSON.stringify(check.files));
  await assert.rejects(upgradeTool({ path: dir, action: 'apply', out }), /OUTPUT_NOT_EMPTY|not empty/);
  await assert.rejects(upgradeTool({ path: out }), /already a Godot 4/);
  await fs.rm(dir, { recursive: true, force: true });
  await fs.rm(out, { recursive: true, force: true });
});
