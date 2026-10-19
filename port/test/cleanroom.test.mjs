import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { tempDir } from './helpers.mjs';
import { cleanroomTool } from '../src/cleanroom.mjs';

const ORIGINAL = `extends CharacterBody2D

var jumpBufferTime := 0.12
var coyoteTimer := 0.0

func compute_jump_arc(height: float, apex_time: float) -> Dictionary:
	var gravity_value := 2.0 * height / (apex_time * apex_time)
	var launch := sqrt(2.0 * gravity_value * height)
	var result := {"gravity": gravity_value, "launch": launch}
	if result["launch"] > 900.0:
		result["launch"] = 900.0
	for i in range(3):
		result["launch"] *= 0.98
	return result

func say():
	print("The ancient door creaks open, revealing the Hall of Echoes.")
`;
// Same structure, identifiers renamed: must still be found.
const RENAMED = `extends CharacterBody2D

func arc_for(h: float, t: float) -> Dictionary:
	var g := 2.0 * h / (t * t)
	var v0 := sqrt(2.0 * g * h)
	var out := {"gravity": g, "launch": v0}
	if out["launch"] > 900.0:
		out["launch"] = 900.0
	for k in range(3):
		out["launch"] *= 0.98
	return out

func line():
	print("The ancient door creaks open, revealing the Hall of Echoes.")
`;
const OWN = `extends CharacterBody2D

@export var jump_height := 96.0
@export var time_to_peak := 0.4

func _physics_process(delta: float) -> void:
	velocity.y += 2.0 * jump_height / pow(time_to_peak, 2) * delta
	if Input.is_action_just_pressed("jump") and is_on_floor():
		velocity.y = -2.0 * jump_height / time_to_peak
	move_and_slide()
	print("My own words here.")
`;

test('clean-room screening: identical assets, renamed code, copied text, reused names', async () => {
  const dir = await tempDir();
  await fs.mkdir(path.join(dir, 'orig', 'art'), { recursive: true });
  await fs.mkdir(path.join(dir, 'copy', 'art'), { recursive: true });
  await fs.mkdir(path.join(dir, 'clean'), { recursive: true });
  const art = Buffer.alloc(500, 7);
  await fs.writeFile(path.join(dir, 'orig', 'player.gd'), ORIGINAL);
  await fs.writeFile(path.join(dir, 'orig', 'art', 'hero.png'), art);
  await fs.writeFile(path.join(dir, 'copy', 'jump.gd'), RENAMED);
  await fs.writeFile(path.join(dir, 'copy', 'art', 'hero2.png'), art);
  await fs.writeFile(path.join(dir, 'clean', 'player.gd'), OWN);
  const bad = await cleanroomTool({ original: path.join(dir, 'orig'), rebuild: path.join(dir, 'copy') });
  assert.equal(bad.clean, false);
  assert.deepEqual(bad.identicalFiles.items.map(x => x.file), ['art/hero2.png']);
  assert.equal(bad.codeMatches.items[0].file, 'jump.gd');
  assert.ok(bad.codeMatches.items[0].tokens >= 40);
  assert.ok(bad.copiedStrings.items.some(s => /Hall of Echoes/.test(s.text)));
  const good = await cleanroomTool({ original: path.join(dir, 'orig'), rebuild: path.join(dir, 'clean') });
  assert.equal(good.clean, true, JSON.stringify(good, null, 1));
  await fs.rm(dir, { recursive: true, force: true });
});
