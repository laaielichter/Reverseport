import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { apicheckTool, resolveVersion, GODOT_VERSIONS } from '../src/apicheck.mjs';

const GODOT3 = `extends KinematicBody2D

export var speed = 200
onready var sprite = $Sprite

func _ready():
\tvar b = preload("res://bullet.tscn").instance()
\tconnect("body_entered", self, "_on_hit")
\tyield(get_tree().create_timer(1.0), "timeout")
\tvar m = Node2D.new()
\tm.set_posiiton(Vector2.ZERO)
\tOS.get_ticks_msec()
\tprint(deg2rad(90), stepify(1.23, 0.1))
\tadd_child(m)

func _on_hit(body):
\tqueue_free()
`;

const GODOT4 = `extends CharacterBody2D

@export var speed := 200.0
@onready var sprite: Sprite2D = $Sprite2D
signal died

func _ready() -> void:
\tbody_entered.connect(_on_hit)
\tawait get_tree().create_timer(1.0).timeout
\tvar m := Node2D.new()
\tm.position = Vector2.ZERO
\tprint(deg_to_rad(90), snapped(1.23, 0.1), Time.get_ticks_msec())
\tadd_child(m)

func _physics_process(delta: float) -> void:
\tvelocity.x = speed
\tmove_and_slide()
\tif is_on_floor():
\t\tdied.emit()

func _on_hit(body: Node2D) -> void:
\tqueue_free()
`;

test('resolveVersion picks the right snapshot', () => {
  assert.ok(GODOT_VERSIONS.includes('3') && GODOT_VERSIONS.some(v => v.startsWith('4.')));
  assert.equal(resolveVersion('3.5'), '3');
  assert.equal(resolveVersion('godot@4.3'), '4.3');
  assert.ok(resolveVersion('4').startsWith('4.'));
  assert.ok(resolveVersion('4.4') >= '4.3');
  assert.throws(() => resolveVersion('2.1'), /No API snapshot/);
});

test('Godot 3 habits in Godot 4 code get replacements; invented members get the closest real name', async () => {
  const r = await apicheckTool({ content: GODOT3, engine: 'godot@4' });
  assert.equal(r.passed, false);
  const f = r.files.items[0].findings;
  const by = name => f.find(x => x.name === name);
  assert.equal(by('KinematicBody2D').replacement, 'CharacterBody2D');
  assert.equal(by('export').replacement, '@export');
  assert.equal(by('instance').replacement, 'instantiate');
  assert.equal(by('yield').replacement, 'await');
  assert.equal(by('deg2rad').replacement, 'deg_to_rad');
  assert.equal(by('stepify').replacement, 'snapped');
  assert.match(by('OS.get_ticks_msec').replacement, /Time\.get_ticks_msec/);
  assert.equal(by('Node2D.set_posiiton').kind, 'unknown-method');
  assert.equal(by('Node2D.set_posiiton').replacement, 'set_position');
  assert.ok(f.some(x => x.kind === 'renamed-pattern' && /connect/.test(x.name)));
  assert.match(r.suspicion, /Godot 3/);
  // The same file is fine for Godot 3 apart from the typo.
  const r3 = await apicheckTool({ content: GODOT3, engine: 'godot@3' });
  assert.deepEqual(Object.keys(r3.byKind), ['unknown-method']);
});

test('clean Godot 4 code passes; Godot 4 code in a Godot 3 project is too-new', async () => {
  const ok = await apicheckTool({ content: GODOT4, engine: 'godot@4.3' });
  assert.equal(ok.passed, true, JSON.stringify(ok.files));
  const old = await apicheckTool({ content: GODOT4, engine: '3' });
  assert.ok(old.byKind['too-new'] >= 3);
  assert.match(old.suspicion, /Godot 4 names/);
});

test('project.godot decides the version; too-new classes name the version that has them', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rp-api-'));
  await fs.writeFile(path.join(dir, 'project.godot'), 'config_version=5\n[application]\nconfig/features=PackedStringArray("4.3", "Forward Plus")\n');
  await fs.writeFile(path.join(dir, 'a.gd'), 'extends Node\nvar x: Sprite2D\nfunc _ready():\n\tx.textur = null\n');
  const r = await apicheckTool({ path: dir });
  assert.equal(r.engine, 'godot@4.3');
  assert.match(r.versionSource, /project\.godot/);
  assert.equal(r.files.items[0].findings[0].replacement, 'texture');
  const newest = GODOT_VERSIONS.filter(v => v.startsWith('4')).at(-1);
  if (newest !== '4.3') {
    const { default: fsSync } = await import('node:fs');
    const newer = JSON.parse(fsSync.readFileSync(new URL(`../knowledge/apis/godot-${newest}.json`, import.meta.url), 'utf8'));
    const older = JSON.parse(fsSync.readFileSync(new URL('../knowledge/apis/godot-4.3.json', import.meta.url), 'utf8'));
    const cls = Object.keys(newer.classes).find(c => !older.classes[c]);
    const t = await apicheckTool({ content: `extends Node\nfunc _ready():\n\tvar a = ${cls}.new()\n`, engine: 'godot@4.3' });
    assert.equal(t.files.items[0].findings[0].kind, 'too-new');
    assert.match(t.files.items[0].findings[0].detail, new RegExp(newest.replace('.', '\\.')));
  }
  await fs.rm(dir, { recursive: true, force: true });
});
