import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { tempDir } from './helpers.mjs';
import { buildRpgMakerProject } from './rpgmaker-fixture.mjs';
import { portRpgMakerTool } from '../src/rpgmaker.mjs';

test('RPG Maker MV → Godot: maps as scenes, events as nodes, runtime scripts, command census', async () => {
  const dir = await tempDir();
  const src = await buildRpgMakerProject(path.join(dir, 'src'));
  const r = await portRpgMakerTool({ path: src, out: path.join(dir, 'out') });
  assert.equal(r.engine, 'RPG Maker MV');
  assert.deepEqual(r.maps.items.map(m => [m.id, m.events, m.scene]), [[1, 2, 'maps/map_001.tscn']]);
  assert.deepEqual(r.commands.missing.items.map(c => c.code).sort(), [301, 314]);
  const scene = await fs.readFile(path.join(dir, 'out', 'maps', 'map_001.tscn'), 'utf8');
  assert.ok(scene.includes('[node name="EV001_Sign" type="Node2D" parent="."]\nposition = Vector2(120, 72)'));
  const pg = await fs.readFile(path.join(dir, 'out', 'project.godot'), 'utf8');
  assert.ok(pg.includes('config/name="Tiny Quest"') && pg.includes('RpgDb="*res://rpg/rpg_database.gd"') && pg.includes('viewport_width=816'));
  for (const f of ['data/Map001.json', 'img/tilesets/Outside_B.png', 'rpg/rpg_event.gd', 'rpg/rpg_map.gd', 'main.tscn', 'PORT-NOTES.md']) assert.ok(await fs.stat(path.join(dir, 'out', f)));
  assert.ok((await fs.readFile(path.join(dir, 'out', 'PORT-NOTES.md'), 'utf8')).includes('301 Battle Processing'));
  await assert.rejects(portRpgMakerTool({ path: src, out: path.join(dir, 'out') }), /not empty/);
  if (process.env.GODOT_BIN) {
    // Optional: run the port in a real Godot 4.3+ (set GODOT_BIN to the editor binary).
    await fs.writeFile(path.join(dir, 'out', 'check.gd'), 'extends Node\nfunc _ready():\n\tvar s = load("res://main.tscn").instantiate()\n\tadd_child(s)\n\tawait get_tree().create_timer(0.2).timeout\n\tawait s.get_node("Map/EV001_Sign").run()\n\tprint("CHECK ", RpgDb.get_switch(1), " ", RpgDb.get_variable(2), " ", s.get_node("Map").sheets.filter(func(t): return t != null).size())\n\tget_tree().quit()\n');
    await fs.writeFile(path.join(dir, 'out', 'check.tscn'), '[gd_scene load_steps=2 format=3]\n\n[ext_resource type="Script" path="res://check.gd" id="1"]\n\n[node name="Check" type="Node"]\nscript = ExtResource("1")\n');
    execFileSync(process.env.GODOT_BIN, ['--headless', '--path', path.join(dir, 'out'), '--import'], { stdio: 'ignore', timeout: 120000 });
    const outText = execFileSync(process.env.GODOT_BIN, ['--headless', '--path', path.join(dir, 'out'), 'res://check.tscn'], { encoding: 'utf8', timeout: 60000 });
    assert.match(outText, /CHECK true 7 2/);
  }
  await fs.rm(dir, { recursive: true, force: true });
});
