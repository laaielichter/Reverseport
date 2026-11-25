# GameMaker games

ReversePort reads the data file of a GameMaker game (`data.win`, `game.unx`, `game.ios`, `game.droid`) without
GameMaker installed.

| Tool         | What you get                                                                                     |
| ------------ | ------------------------------------------------------------------------------------------------ |
| `re_scan`    | The engine, from the build folder                                                                |
| `re_archive` | Game name and version, sprite, object and room names; extract writes textures (PNG/QOI), WAV/OGG |
| `re_decode`  | GML bytecode 14 to 17 back to GML, laid out like a project                                       |

`re_decode` writes `scripts/<name>.gml`, `objects/<object>/<Event>_<n>.gml` and
`rooms/<room>/RoomCreationCode.gml`. An entry the decompiler is not sure about is written as GML assembly with the
reason, not as guessed code.

## Example

A small data file built for this page with the fixture builder from `port/test/gml.test.mjs` (bytecode 16, eight code
entries; two of them are made to fail on purpose):

```bash
reverseport decode ./data.win
```

The result, trimmed to the key fields:

```json
{
  "format": "gamemaker-data",
  "bytecodeVersion": 16,
  "scripts": 1,
  "objects": 2,
  "rooms": 1,
  "entries": { "total": 8, "decompiled": 6, "assemblyOnly": 2 },
  "unknownInstructions": 1,
  "reasons": {
    "conditional jump that fits no switch or short-circuit": 1,
    "unknown instruction (opcode 0x1)": 1
  },
  "files": [
    { "code": "gml_Script_scr_demo", "file": "scripts/scr_demo.gml" },
    {
      "code": "gml_Object_obj_player_Collision_1",
      "file": "objects/obj_player/Collision_obj_wall.gml"
    },
    {
      "code": "gml_Object_obj_player_Draw_64",
      "file": "objects/obj_player/Draw_64.gml",
      "assemblyOnly": true,
      "reason": "unknown instruction (opcode 0x1)"
    },
    {
      "code": "gml_Room_rm_main_Create",
      "file": "rooms/rm_main/RoomCreationCode.gml"
    }
  ]
}
```

`scripts/scr_demo.gml` as written:

```text
hp = 5;
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
```

And `objects/obj_player/Draw_64.gml`, the entry that was not decompiled:

```text
// not decompiled: unknown instruction (opcode 0x1)
// GML assembly of gml_Object_obj_player_Draw_64 (same text as Draw_64.asm):
// :[0]
// pushi.e 1
// unknown 0x01020304 ; opcode 0x1
// exit.i
// :[end]
```

## Options

| Option  | What it does                                                                                  |
| ------- | --------------------------------------------------------------------------------------------- |
| `match` | Only code entries whose name or output path matches (substring, glob or `/regex/`)            |
| `asm`   | Also write GML assembly (`.asm`) for every entry; it is always written for one not decompiled |
| `limit` | Maximum code entries (default: all)                                                           |
| `out`   | Output folder (default `workspace/decoded/<name>`)                                            |

## How well it works

On three real builds of an open game, every instruction was read (0 unknown instructions) and 3,747 of 3,752 code
entries came back as GML. The other five are written as assembly with the reason.

## Limits

- Decompiled GML has no comments or macros: constants are numbers, asset ids are numbers before GameMaker 2023.8, and
  `for` loops come back as `while` loops. Use it to port behaviour, not as the original source.
- YYC builds are compiled to native code. They are reported; the code is in the executable (`re_binary`, or the
  deep-analysis engine).
- Encrypted files are reported, never decrypted.
