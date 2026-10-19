// port_rpgmaker: an RPG Maker MV/MZ project (data/*.json + img/ + audio/) → a runnable Godot 4 project.
// Maps become scenes whose tile layers are drawn from the original tilesets (B–E and A5 exactly, autotiles with
// their interior piece), events become nodes with their pages kept as data, and a small interpreter runs the most
// used event commands (text, choices, switches, variables, conditional branches, transfer, wait, self switches,
// common events). The database (actors, items, system …) is loaded by an autoload. Everything the interpreter does
// not run is listed per command code, so the remaining work is explicit. The source is only read.
import fs from 'node:fs/promises';
import path from 'node:path';
import { RPError, requireDir, walk, limit } from './util.mjs';
import { workspaceDir, isInside } from './workspace.mjs';

const SUPPORTED = new Map([[0, 'end'], [101, 'Show Text'], [401, 'text line'], [102, 'Show Choices'], [402, 'When [choice]'], [403, 'When Cancel'], [404, 'end choices'], [108, 'Comment'], [408, 'comment line'], [111, 'Conditional Branch (switch/variable/self switch)'], [411, 'Else'], [412, 'end branch'], [117, 'Common Event'], [121, 'Control Switches'], [122, 'Control Variables (constant/variable/random)'], [123, 'Control Self Switch'], [201, 'Transfer Player'], [230, 'Wait'], [250, 'Play SE'], [241, 'Play BGM'], [115, 'Exit Event Processing'], [112, 'Loop'], [413, 'Repeat Above'], [113, 'Break Loop']]);
const NAMES = { 103: 'Input Number', 104: 'Select Item', 105: 'Show Scrolling Text', 118: 'Label', 119: 'Jump to Label', 124: 'Control Timer', 125: 'Change Gold', 126: 'Change Items', 127: 'Change Weapons', 128: 'Change Armors', 129: 'Change Party Member', 132: 'Change Battle BGM', 133: 'Change Victory ME', 134: 'Change Save Access', 135: 'Change Menu Access', 136: 'Change Encounter', 137: 'Change Formation Access', 138: 'Change Window Color', 202: 'Set Vehicle Location', 203: 'Set Event Location', 204: 'Scroll Map', 205: 'Set Movement Route', 206: 'Get on/off Vehicle', 211: 'Change Transparency', 212: 'Show Animation', 213: 'Show Balloon Icon', 214: 'Erase Event', 216: 'Change Player Followers', 217: 'Gather Followers', 221: 'Fadeout Screen', 222: 'Fadein Screen', 223: 'Tint Screen', 224: 'Flash Screen', 225: 'Shake Screen', 231: 'Show Picture', 232: 'Move Picture', 233: 'Rotate Picture', 234: 'Tint Picture', 235: 'Erase Picture', 236: 'Set Weather Effect', 242: 'Fadeout BGM', 245: 'Play BGS', 249: 'Play ME', 261: 'Play Movie', 281: 'Change Map Name Display', 282: 'Change Tileset', 283: 'Change Battle Back', 284: 'Change Parallax', 285: 'Get Location Info', 301: 'Battle Processing', 302: 'Shop Processing', 303: 'Name Input Processing', 311: 'Change HP', 312: 'Change MP', 313: 'Change State', 314: 'Recover All', 315: 'Change EXP', 316: 'Change Level', 317: 'Change Parameter', 318: 'Change Skill', 319: 'Change Equipment', 320: 'Change Name', 321: 'Change Class', 322: 'Change Actor Images', 323: 'Change Vehicle Image', 324: 'Change Nickname', 325: 'Change Profile', 351: 'Open Menu Screen', 352: 'Open Save Screen', 353: 'Game Over', 354: 'Return to Title Screen', 355: 'Script', 655: 'script line', 356: 'Plugin Command (MV)', 357: 'Plugin Command (MZ)', 657: 'plugin args', 505: 'move route step', 601: 'If Win', 602: 'If Escape', 603: 'If Lose', 604: 'end battle branch' };

const RUNTIME = {
  'rpg/rpg_database.gd': `extends Node
## Autoload "RpgDb": the RPG Maker database (data/*.json) plus game state (switches, variables, self switches).
## Ported by ReversePort. JSON files are the original data, loaded as-is.

signal message(text: String, face: String)
signal choices_requested(options: PackedStringArray)

var system: Dictionary = {}
var map_infos: Array = []
var common_events: Array = []
var tilesets: Array = []
var actors: Array = []
var items: Array = []
var switches: Dictionary = {}
var variables: Dictionary = {}
var self_switches: Dictionary = {}
var choice_result := -1

func _ready() -> void:
\tsystem = _load("System")
\tmap_infos = _load("MapInfos")
\tcommon_events = _load("CommonEvents")
\ttilesets = _load("Tilesets")
\tactors = _load("Actors")
\titems = _load("Items")

func _load(name: String):
\tvar path := "res://data/%s.json" % name
\tif not FileAccess.file_exists(path):
\t\treturn [] if name != "System" else {}
\treturn JSON.parse_string(FileAccess.get_file_as_string(path))

func load_map(id: int) -> Dictionary:
\treturn _load("Map%03d" % id)

func map_scene(id: int) -> String:
\treturn "res://maps/map_%03d.tscn" % id

func get_switch(id: int) -> bool:
\treturn switches.get(id, false)

func set_switch(id: int, value: bool) -> void:
\tswitches[id] = value

func get_variable(id: int) -> int:
\treturn variables.get(id, 0)

func set_variable(id: int, value: int) -> void:
\tvariables[id] = value

func get_self_switch(map_id: int, event_id: int, letter: String) -> bool:
\treturn self_switches.get("%d,%d,%s" % [map_id, event_id, letter], false)

func set_self_switch(map_id: int, event_id: int, letter: String, value: bool) -> void:
\tself_switches["%d,%d,%s" % [map_id, event_id, letter]] = value
`,
  'rpg/rpg_map.gd': `extends Node2D
## A ported RPG Maker map: draws its tile layers from the original tileset images.
## B–E and A5 tiles are drawn exactly; autotiles (A1–A4) are drawn with their interior piece (edges approximated).

@export var map_id := 1
@export var tile_size := 48
var data: Dictionary = {}
var sheets: Array[Texture2D] = []

func _ready() -> void:
\tdata = RpgDb.load_map(map_id)
\tvar ts_id: int = data.get("tilesetId", 1)
\tvar ts = RpgDb.tilesets[ts_id] if ts_id < RpgDb.tilesets.size() else null
\tsheets.clear()
\tif ts:
\t\tfor name in ts["tilesetNames"]:
\t\t\tvar p := "res://img/tilesets/%s.png" % name
\t\t\tsheets.append(load(p) if name != "" and ResourceLoader.exists(p) else null)
\tqueue_redraw()

func _draw() -> void:
\tif data.is_empty():
\t\treturn
\tvar w: int = data["width"]
\tvar h: int = data["height"]
\tvar tiles: Array = data["data"]
\tfor z in range(4):
\t\tfor y in range(h):
\t\t\tfor x in range(w):
\t\t\t\tvar id: int = tiles[(z * h + y) * w + x]
\t\t\t\tif id > 0:
\t\t\t\t\t_draw_tile(id, Vector2(x * tile_size, y * tile_size))

func _draw_tile(id: int, at: Vector2) -> void:
\tvar s := tile_size
\tif id < 2048:
\t\tvar set_number := 4 if id >= 1536 else 5 + id / 256
\t\tvar tex: Texture2D = sheets[set_number] if set_number < sheets.size() else null
\t\tif tex == null:
\t\t\treturn
\t\tvar sx := ((id / 128) % 2 * 8 + id % 8) * s
\t\tvar sy := ((id % 256) / 8 % 16) * s
\t\tdraw_texture_rect_region(tex, Rect2(at, Vector2(s, s)), Rect2(sx, sy, s, s))
\t\treturn
\tvar kind := (id - 2048) / 48
\tvar set_number := 0 if id < 2816 else 1 if id < 4352 else 2 if id < 5888 else 3
\tvar tex2: Texture2D = sheets[set_number] if set_number < sheets.size() else null
\tif tex2 == null:
\t\treturn
\tvar tx := kind % 8
\tvar ty := kind / 8
\tvar bx := 0
\tvar by := 0
\tif set_number == 0:
\t\tbx = [0, 0, 6, 6][kind] if kind < 4 else (tx / 4) * 8 + (2 if kind % 2 == 1 else 0)
\t\tby = [0, 3, 0, 3][kind] if kind < 4 else ty * 6 + (tx / 2) % 2 * 3
\telif set_number == 1:
\t\tbx = tx * 2
\t\tby = (ty - 2) * 3
\telif set_number == 2:
\t\tbx = tx * 2
\t\tby = (ty - 6) * 2
\telse:
\t\tbx = tx * 2
\t\tby = int(floor((ty - 10) * 2.5 + (0.5 if ty % 2 == 1 else 0.0)))
\t# Interior piece: the four inner quarters of the autotile block.
\tvar half := s / 2
\tvar quarters := [[2, 4], [1, 4], [2, 3], [1, 3]]
\tfor i in range(4):
\t\tvar q: Array = quarters[i]
\t\tvar src := Rect2((bx * 2 + q[0]) * half, (by * 2 + q[1]) * half, half, half)
\t\tvar dst := Rect2(at + Vector2((i % 2) * half, (i / 2) * half), Vector2(half, half))
\t\tdraw_texture_rect_region(tex2, dst, src)
`,
  'rpg/rpg_event.gd': `extends Node2D
## A ported RPG Maker event: pages, conditions and a list interpreter for the common commands.
## Commands the interpreter does not run are reported once with push_warning (code and name), see PORT-NOTES.md.

@export var map_id := 1
@export var event_id := 1
@export var trigger_override := -1
var pages: Array = []
var running := false

func _ready() -> void:
\tvar map := RpgDb.load_map(map_id)
\tvar ev = map["events"][event_id] if event_id < map["events"].size() else null
\tif ev:
\t\tpages = ev["pages"]
\tvar page: Variant = active_page()
\tif page != null and int(page["trigger"]) == 3:
\t\trun()

func active_page() -> Variant:
\tfor i in range(pages.size() - 1, -1, -1):
\t\tvar c: Dictionary = pages[i]["conditions"]
\t\tif c["switch1Valid"] and not RpgDb.get_switch(c["switch1Id"]):
\t\t\tcontinue
\t\tif c["switch2Valid"] and not RpgDb.get_switch(c["switch2Id"]):
\t\t\tcontinue
\t\tif c["variableValid"] and RpgDb.get_variable(c["variableId"]) < int(c["variableValue"]):
\t\t\tcontinue
\t\tif c["selfSwitchValid"] and not RpgDb.get_self_switch(map_id, event_id, c["selfSwitchCh"]):
\t\t\tcontinue
\t\treturn pages[i]
\treturn null

func run() -> void:
\tif running:
\t\treturn
\tvar page: Variant = active_page()
\tif page == null:
\t\treturn
\trunning = true
\tawait run_list(page["list"])
\trunning = false

func run_list(list: Array) -> void:
\tvar i := 0
\twhile i < list.size():
\t\tvar cmd: Dictionary = list[i]
\t\tvar code: int = cmd["code"]
\t\tvar p: Array = cmd["parameters"]
\t\tmatch code:
\t\t\t0, 108, 408, 412, 404:
\t\t\t\tpass
\t\t\t101:
\t\t\t\tvar text := PackedStringArray()
\t\t\t\twhile i + 1 < list.size() and int(list[i + 1]["code"]) == 401:
\t\t\t\t\ti += 1
\t\t\t\t\ttext.append(list[i]["parameters"][0])
\t\t\t\tRpgDb.message.emit("\\n".join(text), str(p[0]))
\t\t\t\tawait get_tree().process_frame
\t\t\t102:
\t\t\t\tRpgDb.choice_result = -1
\t\t\t\tRpgDb.choices_requested.emit(PackedStringArray(p[0]))
\t\t\t\twhile RpgDb.choice_result < 0:
\t\t\t\t\tawait get_tree().process_frame
\t\t\t\ti = _skip_to_choice(list, i, RpgDb.choice_result, cmd["indent"])
\t\t\t\tcontinue
\t\t\t402, 403:
\t\t\t\ti = _skip_block(list, i, cmd["indent"], [404])
\t\t\t\tcontinue
\t\t\t111:
\t\t\t\tif not _condition(p):
\t\t\t\t\ti = _skip_block(list, i, cmd["indent"], [411, 412]) + 1
\t\t\t\t\tcontinue
\t\t\t411:
\t\t\t\ti = _skip_block(list, i, cmd["indent"], [412])
\t\t\t\tcontinue
\t\t\t112, 413:
\t\t\t\tif code == 413:
\t\t\t\t\ti = _loop_start(list, i, cmd["indent"])
\t\t\t\t\tcontinue
\t\t\t113:
\t\t\t\ti = _skip_block(list, _loop_end(list, i, cmd["indent"]), cmd["indent"] - 1, [413]) + 1
\t\t\t\tcontinue
\t\t\t115:
\t\t\t\treturn
\t\t\t117:
\t\t\t\tvar ce = RpgDb.common_events[p[0]] if int(p[0]) < RpgDb.common_events.size() else null
\t\t\t\tif ce:
\t\t\t\t\tawait run_list(ce["list"])
\t\t\t121:
\t\t\t\tfor id in range(int(p[0]), int(p[1]) + 1):
\t\t\t\t\tRpgDb.set_switch(id, int(p[2]) == 0)
\t\t\t122:
\t\t\t\tvar value := 0
\t\t\t\tmatch int(p[3]):
\t\t\t\t\t0: value = int(p[4])
\t\t\t\t\t1: value = RpgDb.get_variable(int(p[4]))
\t\t\t\t\t2: value = randi_range(int(p[4]), int(p[5]))
\t\t\t\t\t_: push_warning("PORT: Control Variables operand %d" % int(p[3]))
\t\t\t\tfor id in range(int(p[0]), int(p[1]) + 1):
\t\t\t\t\tvar old := RpgDb.get_variable(id)
\t\t\t\t\tvar ops := [value, old + value, old - value, old * value, old / value if value != 0 else old, old % value if value != 0 else old]
\t\t\t\t\tRpgDb.set_variable(id, ops[int(p[2])])
\t\t\t123:
\t\t\t\tRpgDb.set_self_switch(map_id, event_id, p[0], int(p[1]) == 0)
\t\t\t201:
\t\t\t\tif int(p[0]) == 0:
\t\t\t\t\tget_tree().change_scene_to_file(RpgDb.map_scene(int(p[1])))
\t\t\t\t\treturn
\t\t\t\tpush_warning("PORT: Transfer Player with variables")
\t\t\t230:
\t\t\t\tawait get_tree().create_timer(int(p[0]) / 60.0).timeout
\t\t\t241, 250:
\t\t\t\tvar folder := "bgm" if code == 241 else "se"
\t\t\t\tvar base := "res://audio/%s/%s" % [folder, p[0]["name"]]
\t\t\t\tfor ext in [".ogg", ".m4a", ".wav"]:
\t\t\t\t\tif ResourceLoader.exists(base + ext):
\t\t\t\t\t\tvar player := AudioStreamPlayer.new()
\t\t\t\t\t\tplayer.stream = load(base + ext)
\t\t\t\t\t\tadd_child(player)
\t\t\t\t\t\tplayer.play()
\t\t\t\t\t\tbreak
\t\t\t_:
\t\t\t\tpush_warning("PORT: event command %d not ported (map %d, event %d)" % [code, map_id, event_id])
\t\ti += 1

func _condition(p: Array) -> bool:
\tmatch int(p[0]):
\t\t0: return RpgDb.get_switch(int(p[1])) == (int(p[2]) == 0)
\t\t1:
\t\t\tvar a := RpgDb.get_variable(int(p[1]))
\t\t\tvar b := int(p[3]) if int(p[2]) == 0 else RpgDb.get_variable(int(p[3]))
\t\t\treturn [a == b, a >= b, a <= b, a > b, a < b, a != b][int(p[4])]
\t\t2: return RpgDb.get_self_switch(map_id, event_id, p[1]) == (int(p[2]) == 0)
\tpush_warning("PORT: Conditional Branch type %d" % int(p[0]))
\treturn false

func _skip_block(list: Array, i: int, indent: int, stop_codes: Array) -> int:
\tvar j := i + 1
\twhile j < list.size():
\t\tif int(list[j]["indent"]) == indent and stop_codes.has(int(list[j]["code"])):
\t\t\treturn j
\t\tj += 1
\treturn j

func _skip_to_choice(list: Array, i: int, choice: int, indent: int) -> int:
\tvar j := i + 1
\twhile j < list.size():
\t\tvar c: Dictionary = list[j]
\t\tif int(c["indent"]) == indent and int(c["code"]) == 402 and int(c["parameters"][0]) == choice:
\t\t\treturn j + 1
\t\tif int(c["indent"]) == indent and int(c["code"]) == 404:
\t\t\treturn j
\t\tj += 1
\treturn j

func _loop_start(list: Array, i: int, indent: int) -> int:
\tvar j := i - 1
\twhile j >= 0 and not (int(list[j]["code"]) == 112 and int(list[j]["indent"]) == indent):
\t\tj -= 1
\treturn j + 1

func _loop_end(list: Array, i: int, indent: int) -> int:
\tvar j := i
\twhile j < list.size() and not (int(list[j]["code"]) == 413):
\t\tj += 1
\treturn j
`,
  'rpg/rpg_message_box.gd': `extends CanvasLayer
## Minimal message window and choice list for ported events (replace with your own UI).

var label: Label
var box: VBoxContainer

func _ready() -> void:
\tlabel = Label.new()
\tlabel.position = Vector2(24, 460)
\tlabel.visible = false
\tadd_child(label)
\tbox = VBoxContainer.new()
\tbox.position = Vector2(560, 300)
\tadd_child(box)
\tRpgDb.message.connect(_on_message)
\tRpgDb.choices_requested.connect(_on_choices)

func _on_message(text: String, _face: String) -> void:
\tlabel.text = text
\tlabel.visible = true

func _on_choices(options: PackedStringArray) -> void:
\tfor c in box.get_children():
\t\tc.queue_free()
\tfor i in range(options.size()):
\t\tvar b := Button.new()
\t\tb.text = options[i]
\t\tb.pressed.connect(func(): RpgDb.choice_result = i; for c in box.get_children(): c.queue_free())
\t\tbox.add_child(b)
`,
};

export async function portRpgMakerTool({ path: source, out, limit: max = 300 } = {}) {
  const root = await requireDir(source, 'RPG Maker project');
  const dataDir = (await fs.stat(path.join(root, 'data')).catch(() => null)) ? path.join(root, 'data') : (await fs.stat(path.join(root, 'www', 'data')).catch(() => null)) ? path.join(root, 'www', 'data') : null;
  if (!dataDir) throw new RPError('NOT_RPGMAKER', 'No data/ folder with System.json found (RPG Maker MV/MZ project or www/ of a deployed game).');
  const base = path.dirname(dataDir);
  const readJson = async f => JSON.parse(await fs.readFile(path.join(dataDir, f), 'utf8'));
  const system = await readJson('System.json').catch(() => { throw new RPError('NOT_RPGMAKER', 'data/System.json is missing or unreadable.'); });
  const encrypted = !!(system.hasEncryptedImages || system.hasEncryptedAudio);
  const mz = await fs.stat(path.join(base, 'js', 'rmmz_core.js')).then(() => true).catch(() => false);
  const mapInfos = await readJson('MapInfos.json').catch(() => []);
  const outDir = out ? path.resolve(out) : path.join(await workspaceDir('ports'), `${path.basename(root).replace(/[^A-Za-z0-9._-]+/g, '_')}-godot`);
  if (isInside(outDir, root) || isInside(root, outDir)) throw new RPError('INVALID_ARGUMENT', 'out must be outside the source project.');
  if ((await fs.readdir(outDir).catch(() => [])).length) throw new RPError('OUTPUT_NOT_EMPTY', `out is not empty: ${outDir}`);
  await fs.mkdir(outDir, { recursive: true });

  // Copy data, images and audio as they are (encrypted .rpgmvp/.png_ files are copied but cannot be used).
  const { files } = await walk(base, { maxFiles: 100000 });
  let copied = 0;
  for (const f of files) {
    const rel = f.rel.split(path.sep).join('/');
    if (!/^(data|img|audio|fonts|movies)\//.test(rel)) continue;
    const dest = path.join(outDir, rel);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.copyFile(f.abs, dest);
    copied++;
  }
  for (const [rel, text] of Object.entries(RUNTIME)) { const d = path.join(outDir, rel); await fs.mkdir(path.dirname(d), { recursive: true }); await fs.writeFile(d, text); }

  // Maps → scenes, and a census of event commands.
  const tile = mz ? (system.tileSize ?? 48) : 48;
  const census = new Map();
  const maps = [];
  const count = list => { for (const c of list ?? []) census.set(c.code, (census.get(c.code) ?? 0) + 1); };
  for (const ce of await readJson('CommonEvents.json').catch(() => [])) if (ce) count(ce.list);
  for (const info of mapInfos) {
    if (!info) continue;
    const id = info.id;
    const map = await readJson(`Map${String(id).padStart(3, '0')}.json`).catch(() => null);
    if (!map) continue;
    const lines = [`[gd_scene load_steps=3 format=3]`, '', '[ext_resource type="Script" path="res://rpg/rpg_map.gd" id="1_map"]', '[ext_resource type="Script" path="res://rpg/rpg_event.gd" id="2_event"]', '', `[node name="Map${String(id).padStart(3, '0')}" type="Node2D"]`, 'script = ExtResource("1_map")', `map_id = ${id}`, `tile_size = ${tile}`, `metadata/display_name = ${JSON.stringify(map.displayName || info.name || '')}`];
    let events = 0;
    for (const ev of map.events ?? []) {
      if (!ev) continue;
      for (const pg of ev.pages ?? []) count(pg.list);
      const name = `EV${String(ev.id).padStart(3, '0')}_${String(ev.name || 'event').replace(/[^A-Za-z0-9_]+/g, '_')}`;
      lines.push('', `[node name="${name}" type="Node2D" parent="."]`, `position = Vector2(${ev.x * tile + tile / 2}, ${ev.y * tile + tile / 2})`, 'script = ExtResource("2_event")', `map_id = ${id}`, `event_id = ${ev.id}`);
      events++;
    }
    const sceneRel = `maps/map_${String(id).padStart(3, '0')}.tscn`;
    await fs.mkdir(path.join(outDir, 'maps'), { recursive: true });
    await fs.writeFile(path.join(outDir, sceneRel), lines.join('\n') + '\n');
    maps.push({ id, name: info.name, size: `${map.width}x${map.height}`, events, scene: sceneRel });
  }
  // Start scene: the start map with the player marker and the message box.
  const startMap = system.startMapId ?? maps[0]?.id ?? 1;
  const startScene = `res://maps/map_${String(startMap).padStart(3, '0')}.tscn`;
  await fs.writeFile(path.join(outDir, 'main.tscn'), `[gd_scene load_steps=3 format=3]\n\n[ext_resource type="PackedScene" path="${startScene}" id="1_map"]\n[ext_resource type="Script" path="res://rpg/rpg_message_box.gd" id="2_msg"]\n\n[node name="Main" type="Node2D"]\n\n[node name="Map" parent="." instance=ExtResource("1_map")]\n\n[node name="Player" type="Marker2D" parent="."]\nposition = Vector2(${(system.startX ?? 0) * tile + tile / 2}, ${(system.startY ?? 0) * tile + tile / 2})\n\n[node name="MessageBox" type="CanvasLayer" parent="."]\nscript = ExtResource("2_msg")\n`);
  const width = mz ? (system.advanced?.screenWidth ?? 816) : 816, height = mz ? (system.advanced?.screenHeight ?? 624) : 624;
  await fs.writeFile(path.join(outDir, 'project.godot'), `; Engine configuration file.\n; Ported by ReversePort from an RPG Maker ${mz ? 'MZ' : 'MV'} project.\n\nconfig_version=5\n\n[application]\n\nconfig/name=${JSON.stringify(system.gameTitle || path.basename(root))}\nrun/main_scene="res://main.tscn"\nconfig/features=PackedStringArray("4.3")\n\n[autoload]\n\nRpgDb="*res://rpg/rpg_database.gd"\n\n[display]\n\nwindow/size/viewport_width=${width}\nwindow/size/viewport_height=${height}\n\n[rendering]\n\ntextures/canvas_textures/default_texture_filter=0\n`);

  const commands = [...census.entries()].sort((a, b) => b[1] - a[1]).map(([code, n]) => ({ code, name: SUPPORTED.get(code) ?? NAMES[code] ?? `code ${code}`, count: n, ported: SUPPORTED.has(code) }));
  const missing = commands.filter(c => !c.ported);
  const notes = ['# Port notes', '', `Ported by ReversePort from RPG Maker ${mz ? 'MZ' : 'MV'}: ${maps.length} maps, ${copied} data/asset files.`, '', '## Event commands not run by rpg_event.gd', '', ...(missing.length ? missing.map(c => `- ${c.code} ${c.name}: ${c.count}×`) : ['- none']), '', '## Also by hand', '', '- Player movement, collision (tileset flags in data/Tilesets.json), followers and vehicles.', '- Menus, battle system, shops and save/load.', '- Autotile edges (A1–A4 are drawn with their interior piece), animated water and parallax.', '- Plugins (js/plugins.js): each needs its own port.', ...(encrypted ? ['- Images/audio are encrypted in the source (.rpgmvp/.png_ etc.); they are copied but not decrypted. Use the unencrypted project.'] : [])];
  await fs.writeFile(path.join(outDir, 'PORT-NOTES.md'), notes.join('\n') + '\n');
  return {
    source: root, out: outDir, engine: mz ? 'RPG Maker MZ' : 'RPG Maker MV', maps: limit(maps, max), copied, tileSize: tile, startMap,
    commands: { total: commands.reduce((s, c) => s + c.count, 0), ported: commands.filter(c => c.ported).reduce((s, c) => s + c.count, 0), missing: limit(missing, 60) },
    ...(encrypted ? { encrypted: 'images/audio are encrypted in this project: copied, never decrypted; use the unencrypted project' } : {}),
    next: `Open ${outDir} in Godot 4.3+ and run: the start map draws and its events run. PORT-NOTES.md lists the event commands and systems still to port (movement, menus, battles first). Text: re_strings on the source for translation.`,
  };
}
