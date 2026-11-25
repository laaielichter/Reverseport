// GML bytecode reader, disassembler and decompiler (port/src/gml.mjs).
//
// Every fixture here is SELF-BUILT: the data files are written in memory by buildGameMakerCodeData and the bytecode
// by assembleGml (test/helpers.mjs), a tiny assembler for UndertaleModTool-style assembly text. No game file is in
// the repository. The assembler was checked once, outside the test suite, against real open-source builds
// (Spelunky Classic HD 1.1.1 data.win = bytecode 15, 1.1.7 game.unx = bytecode 16, 1.2.2 data.win = bytecode 17):
// disassembling every code entry and assembling the text again gave the original bytes for all of them.
// Bytecode 14 was not available as a real file: its encoding is tested against words computed by hand from
// UndertaleModTool's opcode table.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { tempDir, assembleGml, buildGameMakerCodeData } from './helpers.mjs';
import { parseGameMakerCode, disassemble, decompile } from '../src/gml.mjs';
import { decodeTool } from '../src/godotbin.mjs';
import { archiveTool } from '../src/archive.mjs';

const SCRIPT = `
pushi.e 5
pop.v.i self.hp
push.v self.hp
pushi.e 1
add.i.v
pop.v.v self.hp
push.v self.hp
pushi.e 3
cmp.i.v GT
bf ELSE
push.s "big"
conv.s.v
call.i show_message(argc=1)
popz.v
b DONE
:ELSE
pushi.e -1
pushi.e 2
push.v [array]self.arr
pop.v.v global.last
:DONE
push.v self.hp
pushi.e 0
cmp.i.v GT
bf OUT
push.v self.hp
pushi.e 1
sub.i.v
pop.v.v self.hp
b DONE
:OUT
push.v self.hp
ret.v`;
const SCRIPT_GML = `hp = 5;
hp += 1;
if (hp > 3) {
    show_message("big");
} else {
    global.last = arr[2];
}
while (hp > 0) {
    hp -= 1;
}
return hp;
`;
// switch with fall-through and default, repeat, with inside a short-circuit if, do-until
const CREATE = `
push.v self.kind
dup.v 0
pushi.e 1
cmp.i.v EQ
bt CASE1
dup.v 0
pushi.e 2
cmp.i.v EQ
bt CASE2
b DEFAULT
b SWITCH_END
:CASE1
pushi.e 10
pop.v.i self.speed
b SWITCH_END
:CASE2
pushi.e 20
pop.v.i self.speed
:DEFAULT
pushi.e 0
pop.v.i self.speed
b SWITCH_END
:SWITCH_END
popz.v
pushi.e 3
dup.i 0
push.i 0
cmp.i.i LTE
bt REPEAT_END
:REPEAT_BODY
push.v self.n
pushi.e 2
mul.i.v
pop.v.v self.n
push.i 1
sub.i.i
dup.i 0
conv.i.b
bt REPEAT_BODY
:REPEAT_END
popz.i
push.v self.a
conv.v.b
bf AND_FALSE
push.v self.b
conv.v.b
b AND_END
:AND_FALSE
push.e 0
:AND_END
bf WITH_SKIP
pushi.e 1
pushenv WITH_POP
:WITH_BODY
pushi.e 1
pop.v.i self.hit
:WITH_POP
popenv WITH_BODY
:WITH_SKIP
:DO_HEAD
push.v self.i
pushi.e 1
add.i.v
pop.v.v self.i
push.v self.i
pushi.e 10
cmp.i.v GTE
bf DO_HEAD`;
const CREATE_GML = `switch (kind) {
    case 1:
        speed = 10;
        break;
    case 2:
        speed = 20;
    default:
        speed = 0;
        break;
}
repeat (3) {
    n *= 2;
}
if (a && b) {
    with (obj_wall) {
        hit = 1;
    }
}
do {
    i += 1;
} until (i >= 10);
`;
// for loop: the continue jumps forward to the increment
const ALARM = `
pushi.e 0
pop.v.i local.j
:HEAD
pushloc.v local.j
pushi.e 4
cmp.i.v LT
bf END
pushloc.v local.j
pushi.e 2
cmp.i.v EQ
bf GO
b INC
:GO
pushloc.v local.j
call.i show_debug_message(argc=1)
popz.v
:INC
pushloc.v local.j
push.e 1
add.i.v
pop.v.v local.j
b HEAD
:END`;
const ALARM_GML = `var j;
j = 0;
for (; j < 4; j++) {
    if (j == 2) {
        continue;
    }
    show_debug_message(j);
}
`;
// || , unary minus, 2D array of GameMaker: Studio 1 (index = i * 32000 + j) on global
const COLLISION = `
push.v self.x
pushi.e 0
cmp.i.v LT
bt OR_TRUE
push.v self.y
pushi.e 0
cmp.i.v LT
b OR_END
:OR_TRUE
push.e 1
:OR_END
bf SKIP
push.v self.x
neg.v
pushi.e -5
pushi.e 1
chkindex.e
push.i 32000
mul.i.i
pushi.e 2
chkindex.e
add.i.i
pop.v.v [array]self.grid
:SKIP`;
const COLLISION_GML = `if ((x < 0) || (y < 0)) {
    global.grid[1, 2] = -x;
}
`;
const UNSTRUCTURED = `
push.v self.a
conv.v.b
bt X
pushi.e 1
pop.v.i self.b
:X
exit.i`;
const UNKNOWN = `
pushi.e 1
raw 0x01020304
exit.i`;

function studio1(bytecode = 16, extra = {}) {
  return buildGameMakerCodeData({
    bytecode,
    code: [
      { name: 'gml_Script_scr_demo', asm: SCRIPT },
      { name: 'gml_Object_obj_player_Create_0', asm: CREATE },
      { name: 'gml_Object_obj_player_Alarm_0', asm: ALARM, locals: 1 },
      { name: 'gml_Object_obj_player_Collision_1', asm: COLLISION },
      { name: 'gml_Object_obj_player_Step_1', asm: UNSTRUCTURED },
      { name: 'gml_Object_obj_player_Draw_64', asm: UNKNOWN },
      { name: 'gml_Room_rm_main_Create', asm: 'pushi.e 1\npop.v.i global.started' },
      { name: 'gml_RoomCC_rm_main_0_Create', asm: 'pushi.e 7\npop.v.i self.tag' },
    ],
    scripts: [{ name: 'scr_demo', code: 0 }],
    objects: [
      { name: 'obj_player', events: [{ type: 0, subtype: 0, code: 1 }, { type: 2, subtype: 0, code: 2 }, { type: 4, subtype: 1, code: 3 }, { type: 3, subtype: 1, code: 4 }, { type: 8, subtype: 64, code: 5 }] },
      { name: 'obj_wall', events: [] },
    ],
    rooms: [{ name: 'rm_main', code: 6, instances: [{ id: 100001, code: 7 }] }],
    ...extra,
  });
}
const entry = (data, name) => data.code.find(e => e.name === name);

test('GML assembler fixture: instruction words match UndertaleModTool\'s tables in both encodings', () => {
  const words = (text, bytecode) => { const b = assembleGml(text, { bytecode }).bytes; return Array.from({ length: b.length / 4 }, (_, i) => b.readUInt32LE(4 * i).toString(16).padStart(8, '0')); };
  // bytecode 15+: opcode, type nibbles (second type high), comparison kind in the second byte, 23-bit branch offsets
  assert.deepEqual(words(':A\npushi.e 5\ncmp.i.v GT\nconv.v.b\nadd.i.v\ndup.v 0\nret.v\nexit.i\npopz.v\nchkindex.e\nb A\nbf A\nbt [end]\npushenv [end]\npopenv <drop>', 16),
    ['840f0005', '15520600', '07450000', '0c520000', '86050000', '9c050000', '9d020000', '9e050000', 'ff0fffff', 'b67ffff7', 'b87ffff6', 'b7000003', 'ba000002', 'bbf00000']);
  // bytecode 14: other opcode numbers, the comparison kind is the opcode (slt 0x11 … sgt 0x16), 24-bit branch offsets
  assert.deepEqual(words(':A\npush.e 5\ncmp.i.v GT\ncmp.i.v LT\ncmp.i.v EQ\nconv.v.b\nadd.i.v\ndup.v 0\nret.v\nexit.i\npopz.v\nb A\nbf A\nbt [end]\npushenv [end]\npopenv <drop>', 14),
    ['c00f0005', '16520000', '11520000', '13520000', '03450000', '08520000', '82050000', '9d050000', '9e020000', '9f050000', 'b7fffff6', 'b9fffff5', 'b8000003', 'bb000002', 'bcf00000']);
  // operands: variable instance in the low word, call argument count, values after the instruction word
  const b = assembleGml('pop.v.i self.hp\npushloc.v local.j\ncall.i f(argc=2)\npush.i 70000\npush.d 0.5\npush.l 9', { bytecode: 16 }).bytes;
  assert.deepEqual([0, 8, 16, 24, 32, 44].map(o => b.readUInt32LE(o).toString(16)), ['4525ffff', 'c105fff9', 'd9020002', 'c0020000', 'c0000000', 'c0030000']);
  assert.equal(b.readInt32LE(28), 70000);
  assert.equal(b.readDoubleLE(36), 0.5);
  assert.equal(b.readBigInt64LE(48), 9n);
});

test('GML reader: chunks, code entries, reference chains and assembly text (bytecode 16)', () => {
  const data = parseGameMakerCode(studio1());
  assert.equal(data.bytecodeVersion, 16);
  assert.equal(data.yyc, false);
  assert.deepEqual(data.code.map(e => e.name).slice(0, 3), ['gml_Script_scr_demo', 'gml_Object_obj_player_Create_0', 'gml_Object_obj_player_Alarm_0']);
  assert.deepEqual(data.scripts, [{ name: 'scr_demo', codeId: 0, constructor: false }]);
  assert.deepEqual(data.objects[0].events.map(e => [e.type, e.subtype, e.codeIds]), [[0, 0, [1]], [2, 0, [2]], [3, 1, [4]], [4, 1, [3]], [8, 64, [5]]]);
  assert.deepEqual(data.rooms, [{ name: 'rm_main', creationCodeId: 6, instances: [{ id: 100001, creationCodeId: 7 }] }]);
  assert.deepEqual(data.problems, []);
  const hp = data.variables.find(v => v.name === 'hp');
  assert.deepEqual([hp.instanceType, hp.occurrences], [-1, 8]);
  assert.equal(data.functions.find(f => f.name === 'show_message').occurrences, 1);
  assert.equal(entry(data, 'gml_Object_obj_player_Alarm_0').locals, 1);
  const text = disassemble(data, entry(data, 'gml_Script_scr_demo'));
  assert.equal(text.split('\n').slice(0, 15).join('\n'), [':[0]', 'pushi.e 5', 'pop.v.i self.hp', 'push.v self.hp', 'pushi.e 1', 'add.i.v', 'pop.v.v self.hp', 'push.v self.hp', 'pushi.e 3', 'cmp.i.v GT', 'bf [2]', ':[1]', 'push.s "big"@' + text.match(/"big"@(\d+)/)[1], 'conv.s.v', 'call.i show_message(argc=1)'].join('\n'));
  assert.match(text, /\nb \[3\]\n:\[2\]\npushi\.e -1\npushi\.e 2\npush\.v \[array\]self\.arr\npop\.v\.v global\.last\n:\[3\]\n/);
  assert.match(text, /\nbf \[5\]\n:\[4\]\n[\s\S]*\nb \[3\]\n:\[5\]\npush\.v self\.hp\nret\.v\n:\[end\]\n$/);
  assert.match(disassemble(data, entry(data, 'gml_Object_obj_player_Create_0')), /\npushenv \[15\]\n:\[14\]\npushi\.e 1\npop\.v\.i self\.hit\n:\[15\]\npopenv \[14\]\n/);
});

test('GML decompiler: assignments, if/else, loops, switch, with, repeat, short-circuit, arrays', () => {
  const data = parseGameMakerCode(studio1());
  assert.equal(decompile(data, entry(data, 'gml_Script_scr_demo')).gml, SCRIPT_GML);
  assert.equal(decompile(data, entry(data, 'gml_Object_obj_player_Create_0')).gml, CREATE_GML);
  assert.equal(decompile(data, entry(data, 'gml_Object_obj_player_Alarm_0')).gml, ALARM_GML);
  assert.equal(decompile(data, entry(data, 'gml_Object_obj_player_Collision_1')).gml, COLLISION_GML);
});

test('GML decompiler: what does not fit a known shape is reported, never guessed', () => {
  const data = parseGameMakerCode(studio1());
  assert.deepEqual(decompile(data, entry(data, 'gml_Object_obj_player_Step_1')), { reason: 'conditional jump that fits no switch or short-circuit' });
  const unknown = entry(data, 'gml_Object_obj_player_Draw_64');
  assert.equal(disassemble(data, unknown), ':[0]\npushi.e 1\nunknown 0x01020304 ; opcode 0x1\nexit.i\n:[end]\n');
  assert.deepEqual(decompile(data, unknown), { reason: 'unknown instruction (opcode 0x1)' });
  // a value left on the stack, a jump into nowhere and a loop that is no loop are refused too
  const odd = parseGameMakerCode(buildGameMakerCodeData({ code: [
    { name: 'left_over', asm: 'pushi.e 1\npushi.e 2\npop.v.i self.a' },
    { name: 'goto', asm: 'b L\npushi.e 1\npop.v.i self.a\npushi.e 2\npop.v.i self.b\n:L\nexit.i' },
    { name: 'stray_popenv', asm: ':A\npushi.e 1\npop.v.i self.a\npopenv A' },
  ] }));
  assert.deepEqual(odd.code.map(e => decompile(odd, e).reason), ['expression left on the stack at a statement', 'jump that fits no if, loop, switch or with', 'popenv without a matching with']);
});

test('GML bytecode 14: old opcode numbers, inline code entries, and.b.b instead of short-circuit jumps', () => {
  const buf = buildGameMakerCodeData({ bytecode: 14, code: [
    { name: 'gml_Script_scr_demo', asm: SCRIPT },
    { name: 'gml_Script_scr_and', asm: 'push.v self.a\nconv.v.b\npush.v self.b\nconv.v.b\nand.b.b\nbf E\nexit.i\n:E' },
    { name: 'gml_Object_obj_player_Create_0', asm: CREATE },
  ], scripts: [{ name: 'scr_demo', code: 0 }, { name: 'scr_and', code: 1 }], objects: [{ name: 'obj_player', events: [{ type: 0, subtype: 0, code: 2 }] }, { name: 'obj_wall' }] });
  const data = parseGameMakerCode(buf);
  assert.equal(data.bytecodeVersion, 14);
  assert.deepEqual(data.problems, []);
  assert.equal(data.code.every(e => e.instructions.every(i => !i.unknown)), true);
  assert.match(disassemble(data, data.code[0]), /^:\[0\]\npush\.e 5\npop\.v\.i self\.hp\npush\.v self\.hp\npush\.e 1\nadd\.i\.v\n/);
  assert.equal(decompile(data, data.code[0]).gml, SCRIPT_GML);
  assert.equal(decompile(data, data.code[1]).gml, 'if (a && b) {\n    exit;\n}\n');
  assert.equal(decompile(data, data.code[2]).gml, CREATE_GML);
});

test('GML 2.3+: a function inside a global script, function references that point at the operand', () => {
  const buf = buildGameMakerCodeData({ bytecode: 17, code: [
    { name: 'gml_GlobalScript_scr_add', asm: `
b AFTER
:BODY
push.v arg.argument0
push.v arg.argument1
add.v.v
pop.v.v local.total
pushloc.v local.total
push.s "sum"
conv.s.v
call.i show_debug_message(argc=2)
popz.v
pushloc.v local.total
pushi.e 0
cmp.i.v LT
bf POSITIVE
pushi.e 0
conv.i.v
ret.v
:POSITIVE
pushi.e -1
pushloc.v local.total
push.v [array]self.table
push.v self.fallback
chknullish.e
bf HAVE
popz.v
pushi.e 0
conv.i.v
:HAVE
add.v.v
ret.v
exit.i
:AFTER
push.i [function]gml_Script_scr_add
conv.i.v
pushi.e -1
conv.i.v
call.i method(argc=2)
dup.v 0
pushi.e -1
pop.v.v [stacktop]self.scr_add
popz.v` },
    { name: 'gml_Script_scr_add', parent: 0, label: 'BODY', args: 2, locals: 1 },
  ], scripts: [{ name: 'scr_add', code: 0 }, { name: 'gml_Script_scr_add', code: 1 }], globalInit: [0] });
  const data = parseGameMakerCode(buf);
  assert.equal(data.bytecodeVersion, 17);
  assert.deepEqual(data.problems, []);
  assert.equal(data.code[1].parent, data.code[0]);
  assert.equal(data.functions.find(f => f.name === 'gml_Script_scr_add').occurrences, 1);
  const text = disassemble(data, data.code[0]);
  assert.match(text, /^:\[0\]\nb \[\d\]\n\n> gml_Script_scr_add \(locals=1, argc=2\)\n:\[1\]\npush\.v arg\.argument0\n/);
  assert.match(text, /\npush\.i \[function\]gml_Script_scr_add\nconv\.i\.v\npushi\.e -1\nconv\.i\.v\ncall\.i method\(argc=2\)\ndup\.v 0\npushi\.e -1\npop\.v\.v \[stacktop\]self\.scr_add\npopz\.v\n/);
  assert.match(text, /\nchknullish\.e\n/);
  assert.equal(decompile(data, data.code[0]).gml, `function scr_add(argument0, argument1) {
    var total;
    total = argument0 + argument1;
    show_debug_message("sum", total);
    if (total < 0) {
        return 0;
    }
    return table[total] + (fallback ?? 0);
}
`);
});

test('re_decode on a GameMaker data file: one .gml per entry in a project layout, .asm where not decompiled', async () => {
  const dir = await tempDir();
  await fs.mkdir(path.join(dir, 'game'));
  await fs.writeFile(path.join(dir, 'game', 'data.win'), studio1());
  const out = path.join(dir, 'out');
  const r = await decodeTool({ path: path.join(dir, 'game'), out });
  assert.equal(r.format, 'gamemaker-data');
  assert.equal(r.bytecodeVersion, 16);
  assert.deepEqual(r.entries, { total: 8, roots: 8, functionsInside: 0, selected: 8, processed: 8, decompiled: 6, assemblyOnly: 2 });
  assert.equal(r.unknownInstructions, 1);
  assert.deepEqual(r.reasons, { 'conditional jump that fits no switch or short-circuit': 1, 'unknown instruction (opcode 0x1)': 1 });
  assert.deepEqual(r.files.map(f => f.file), ['scripts/scr_demo.gml', 'objects/obj_player/Create_0.gml', 'objects/obj_player/Alarm_0.gml', 'objects/obj_player/Collision_obj_wall.gml', 'objects/obj_player/Step_1.gml', 'objects/obj_player/Draw_64.gml', 'rooms/rm_main/RoomCreationCode.gml', 'rooms/rm_main/InstanceCreationCode_100001.gml']);
  const read = rel => fs.readFile(path.join(out, rel), 'utf8');
  assert.equal(await read('scripts/scr_demo.gml'), SCRIPT_GML);
  assert.equal(await read('objects/obj_player/Collision_obj_wall.gml'), COLLISION_GML);
  assert.equal(await read('rooms/rm_main/RoomCreationCode.gml'), 'global.started = 1;\n');
  assert.equal(await read('rooms/rm_main/InstanceCreationCode_100001.gml'), 'tag = 7;\n');
  const failed = await read('objects/obj_player/Step_1.gml');
  assert.match(failed, /^\/\/ not decompiled: conditional jump that fits no switch or short-circuit\n/);
  assert.match(failed, /\n\/\/ bt \[2\]\n/);
  assert.equal(await read('objects/obj_player/Step_1.asm'), ':[0]\npush.v self.a\nconv.v.b\nbt [2]\n:[1]\npushi.e 1\npop.v.i self.b\n:[2]\nexit.i\n:[end]\n');
  await assert.rejects(read('scripts/scr_demo.asm'), { code: 'ENOENT' });
  assert.equal(r.decoded, 10); // 8 .gml + 2 .asm

  // asm: true writes the assembly of every entry; match and limit choose entries
  const all = await decodeTool({ path: path.join(dir, 'game', 'data.win'), out: path.join(dir, 'out2'), asm: true, match: 'obj_player', limit: 2 });
  assert.deepEqual([all.entries.selected, all.entries.processed, all.truncated, all.decoded], [5, 2, true, 4]);
  assert.match(await fs.readFile(path.join(dir, 'out2', 'objects', 'obj_player', 'Create_0.asm'), 'utf8'), /^:\[0\]\npush\.v self\.kind\ndup\.v 0\n/);
  await fs.rm(dir, { recursive: true, force: true });
});

test('GameMaker YYC builds and re_archive counts: no bytecode is said plainly', async () => {
  const dir = await tempDir();
  const vm = path.join(dir, 'data.win'), unx = path.join(dir, 'game.unx'), ios = path.join(dir, 'game.ios');
  await fs.writeFile(vm, studio1(16, { managed: true }));
  await fs.writeFile(unx, studio1(16, { yyc: 'empty' }));
  await fs.writeFile(ios, studio1(16, { yyc: 'missing' }));
  const list = await archiveTool({ file: vm });
  assert.equal(list.format, 'gamemaker-data');
  assert.equal(list.game.yyc, undefined);
  assert.deepEqual([list.counts.codeEntries, list.counts.scripts, list.counts.objects], [8, 1, 2]);
  // the object header with the extra "managed" field (2022.5+) still gives its events
  assert.equal(parseGameMakerCode(await fs.readFile(vm)).objects[0].events.length, 5);
  for (const file of [unx, ios]) {
    const yyc = await archiveTool({ file });
    assert.equal(yyc.game.yyc, true); // archiveTool passes `game` through; a top-level yyc needs the key in its field list
    assert.deepEqual([yyc.counts.codeEntries, yyc.counts.scripts, yyc.counts.objects], [0, 1, 2]);
    const r = await decodeTool({ path: file, out: path.join(dir, 'out') });
    assert.equal(r.yyc, true);
    assert.equal(r.decoded, 0);
    assert.match(r.next, /YYC build/);
  }
  await fs.rm(dir, { recursive: true, force: true });
});
