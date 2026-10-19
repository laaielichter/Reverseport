import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { tempDir } from './helpers.mjs';
import { archiveTool } from '../src/archive.mjs';
import { decodeTool, decodeGdc, TK3 } from '../src/godotbin.mjs';

const F = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'godot-export');
const norm = s => s.replace(/enum (\w+) \{ (.*) \}/g, 'enum $1 {$2}');

for (const [pack, needsZstd] of [['game.pck', false], ['game-zstd.pck', true]]) {
  test(`real Godot 4.3 export (${pack}): .gdc back to the original source, scenes and project rebuilt`, { skip: needsZstd && typeof zlib.zstdDecompressSync !== 'function' ? 'no zstd in this Node' : false }, async () => {
    const dir = await tempDir();
    await archiveTool({ file: path.join(F, pack), action: 'extract', out: path.join(dir, 'x') });
    const r = await decodeTool({ path: path.join(dir, 'x'), out: path.join(dir, 'dec') });
    assert.deepEqual(r.files.map(f => f.decoded).sort(), ['project.godot', 'scenes/data.tres', 'scenes/enemy.tscn', 'scenes/main.tscn', 'scripts/game.gd', 'scripts/player.gd']);
    for (const s of ['game.gd', 'player.gd']) assert.equal(norm(await fs.readFile(path.join(dir, 'dec', 'scripts', s), 'utf8')), norm(await fs.readFile(path.join(F, 'source', 'scripts', s), 'utf8')), s);
    const main = await fs.readFile(path.join(dir, 'dec', 'scenes', 'main.tscn'), 'utf8');
    for (const want of ['[node name="Main" type="Node2D"]', '[node name="Player" type="CharacterBody2D" parent="." groups=["players"]]', 'lives = 5', '[node name="CollisionShape2D" type="CollisionShape2D" parent="Player"]', 'shape = SubResource("RectangleShape2D_1")', 'size = Vector2(32.0, 48.0)', '[node name="Enemy" parent="." instance=ExtResource(', '[connection signal="body_entered" from="Area2D" to="Player" method="_on_died" binds=["area"]]', 'path="res://scripts/player.gd"']) assert.ok(main.includes(want), `main.tscn missing ${want}\n${main}`);
    const data = await fs.readFile(path.join(dir, 'dec', 'scenes', 'data.tres'), 'utf8');
    assert.ok(data.includes('metadata/name = "Forest"') && data.includes('metadata/spawn = Vector3(1.0, 2.0, 3.0)'));
    const pg = await fs.readFile(path.join(dir, 'dec', 'project.godot'), 'utf8');
    assert.ok(pg.includes('config_version=5') && pg.includes('config/features=PackedStringArray("4.3", "Forward Plus")') && pg.includes('Game="*res://scripts/game.gd"') && pg.includes('3d/default_gravity=12.5'));
    await fs.rm(dir, { recursive: true, force: true });
  });
}

test('Godot 3 bytecode (GDSC v13) decodes to source', () => {
  const ids = ['Node', 'speed', '_ready', 'print'];
  const xor = s => Buffer.from(Buffer.from(s + '\0').map(b => b ^ 0xb6));
  const idBufs = ids.map(s => { const x = xor(s); const l = Buffer.alloc(4); l.writeUInt32LE(x.length); return Buffer.concat([l, x]); });
  const cInt = Buffer.alloc(8); cInt.writeUInt32LE(2); cInt.writeInt32LE(10, 4); // INT 10
  const T = (name, data = 0) => { const tk = TK3.indexOf(name); assert.ok(tk >= 0, name); const v = (data << 8) | tk; if (v < 0x80) return Buffer.from([v]); const b = Buffer.alloc(4); b.writeUInt32LE((v | 0x80) >>> 0); return b; };
  // extends Node / var speed = 10 / func _ready(): / <tab>print(speed)
  const toks = [T('extends'), T('IDENTIFIER', 0), T('NEWLINE', 0), T('var'), T('IDENTIFIER', 1), T('='), T('CONSTANT', 0), T('NEWLINE', 0), T('func'), T('IDENTIFIER', 2), T('('), T(')'), T(':'), T('NEWLINE', 1), T('IDENTIFIER', 3), T('('), T('IDENTIFIER', 1), T(')'), T('NEWLINE', 0), T('EOF')];
  const head = Buffer.alloc(24); head.write('GDSC'); head.writeUInt32LE(13, 4); head.writeUInt32LE(ids.length, 8); head.writeUInt32LE(1, 12); head.writeUInt32LE(0, 16); head.writeUInt32LE(toks.length, 20);
  const r = decodeGdc(Buffer.concat([head, ...idBufs, cInt, ...toks]));
  assert.equal(r.engine, 'godot3');
  assert.equal(r.source, 'extends Node\nvar speed = 10\nfunc _ready():\n\tprint(speed)\n');
});
