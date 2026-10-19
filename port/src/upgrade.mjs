// port_upgrade: Godot 3 → Godot 4 for a whole project, as a converted COPY plus a list of what still needs a human.
// It applies the official rename table (classes, builtin types, functions, properties, signals, enums, colors,
// theme overrides, project settings, shaders) and the syntax changes an agent gets wrong most (export/onready/tool
// annotations, yield → await, instance → instantiate, string connect/emit_signal → signal calls, Pool*Array,
// OS time functions → Time). What cannot be converted mechanically (setget, funcref, move_and_slide with
// arguments, Tween nodes, yield on a coroutine, format-2 scenes that Godot re-saves itself) is reported with
// file and line. Sources are never modified. Follow with re_apicheck on the copy.
import fs from 'node:fs/promises';
import path from 'node:path';
import { RPError, requireDir, walk, limit, toPosix } from './util.mjs';
import { workspaceDir, isInside } from './workspace.mjs';
import { renameTables } from './apicheck.mjs';

const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const MANUAL = [
  [/\bsetget\b/, 'setget', 'Godot 4 uses property blocks: var x: T:\n\tset(v): …\n\tget: …'],
  [/\bfuncref\s*\(/, 'funcref', 'use a Callable: Callable(obj, "method") or obj.method'],
  [/\bmove_and_slide\s*\([^)]/, 'move_and_slide(velocity, …)', 'Godot 4: set velocity (a CharacterBody property) then call move_and_slide() without arguments; it returns bool, the velocity stays in velocity'],
  [/\bmove_and_slide_with_snap\s*\(/, 'move_and_slide_with_snap', 'set floor_snap_length and call move_and_slide()'],
  [/\bmove_and_collide\s*\([^)]*,\s*\w+\s*,/, 'move_and_collide(vel, infinite_inertia, …)', 'Godot 4 signature: move_and_collide(motion, test_only=false, safe_margin, recovery_as_collision)'],
  [/\byield\s*\(\s*[^,)]+\s*\)/, 'yield() without a signal', 'a coroutine pause: Godot 4 functions are coroutines when they await; replace with await on the signal or coroutine you wait for'],
  [/\bTween\.new\s*\(|extends\s+Tween\b|type="Tween"/, 'Tween node', 'Godot 4 tweens are created with create_tween(); interpolate_property → tween_property, start() is implicit'],
  [/\binterpolate_property\s*\(/, 'interpolate_property', 'var t := create_tween(); t.tween_property(obj, "prop", final, duration)'],
  [/\bget_node\s*\(\s*"[^"]*"\s*\)\s*\.\s*connect\s*\(\s*"[^"]*"\s*,\s*[^,]+\s*,\s*"[^"]*"\s*,\s*\[/, 'connect with binds', 'bind with Callable.bind(): sig.connect(method.bind(args))'],
  [/\bNavigation2D\b|\bNavigation\b(?!Server|Agent|Region|Polygon|Mesh|Obstacle|Link|Layer|Path)/, 'Navigation node', 'Godot 4 uses NavigationServer + NavigationAgent2D/3D and NavigationRegion2D/3D'],
  [/\bVisualServer\b|\bPhysics2DServer\b|\bPhysicsServer\b(?!2D|3D)/, 'server singletons', 'RenderingServer / PhysicsServer2D / PhysicsServer3D: names converted, but many methods changed'],
  [/\bget_overlapping_(bodies|areas)\s*\(\s*\)/, 'overlap queries', 'converted; in Godot 4 these need monitoring=true and update one physics frame later'],
  [/\bOS\.(window_|set_window_|get_window_|center_window|is_window_|get_screen_)/, 'OS window functions', 'get_window() / DisplayServer in Godot 4'],
  [/\brandomize\s*\(\s*\)/, 'randomize()', 'converted call is fine; Godot 4 seeds the RNG automatically, so remove it or keep it'],
  [/\bexport\s*\(\s*(?:PackedScene|Resource|NodePath|Texture)\b/, 'export(Resource)', 'converted to @export var x: Type where the type is clear; check the type and hints (@export_file, @export_node_path)'],
  [/\bget_tree\(\)\.(set_network_peer|network_peer|is_network_server|get_network_unique_id|network_connected|connected_to_server|server_disconnected)\b/, 'SceneTree networking', 'multiplayer API moved: get_tree().get_multiplayer() / multiplayer.multiplayer_peer, multiplayer.is_server()'],
  [/\brpc_(unreliable|id|unreliable_id)\s*\(|\bremote\s+func|\bmaster\s+func|\bpuppet\s+func/, 'RPC keywords', 'Godot 4: @rpc("any_peer", "unreliable") annotations and rpc()/rpc_id()'],
  [/\bget_tree\(\)\.change_scene\s*\(/, 'change_scene(path)', 'converted to change_scene_to_file; for a PackedScene use change_scene_to_packed'],
  [/\bString\s*\(\s*[\w.]+\s*\)\s*\.format|\.percent_encode\(|\.http_escape\(/, 'string helpers', 'http_escape → uri_encode, percent_encode → uri_encode'],
  [/^\s*var\s+velocity\b/, 'var velocity in a CharacterBody script', 'CharacterBody2D/3D already has velocity: delete this declaration and use the built-in property'],
  [/\bSCREEN_TEXTURE\b/, 'SCREEN_TEXTURE', 'Godot 4 shaders declare it: uniform sampler2D SCREEN_TEXTURE : hint_screen_texture, filter_linear_mipmap;'],
  [/\bDEPTH_TEXTURE\b/, 'DEPTH_TEXTURE', 'Godot 4 shaders declare it: uniform sampler2D DEPTH_TEXTURE : hint_depth_texture, filter_linear_mipmap;'],
  [/\bNode\.pause_mode\b|\bpause_mode\s*=\s*(?:PAUSE_MODE_|\d)/, 'pause_mode', 'process_mode with PROCESS_MODE_PAUSABLE/WHEN_PAUSED/ALWAYS/DISABLED/INHERIT'],
];

function convertGdscript(text, R, localFuncs) {
  let out = text;
  const notes = [];
  const rep = (re, to) => { out = out.replace(re, to); };
  // Annotations.
  rep(/^(\s*)tool\s*$/gm, '$1@tool');
  rep(/^(\s*)onready\s+var\b/gm, '$1@onready var');
  rep(/^(\s*)export\s*\(\s*(int|float|bool|String|Vector2|Vector3|Color|NodePath|Array|Dictionary|PackedScene|Resource|Texture2D|Texture|AudioStream|Font|Curve|Gradient|StyleBox|Shader|Material|Mesh)\s*\)\s+var\s+(\w+)\s*(?:=\s*(.+))?$/gm,
    (m, ind, type, name, val) => `${ind}@export var ${name}: ${R.classes.get(type) ?? type}${val !== undefined ? ` = ${val}` : ''}`);
  rep(/^(\s*)export\s*\(\s*(?:int|float)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)(?:\s*,\s*([-\d.]+))?\s*\)\s+var\b/gm, (m, ind, a, b, step) => `${ind}@export_range(${a}, ${b}${step ? `, ${step}` : ''}) var`);
  rep(/^(\s*)export\s*\(\s*String\s*,\s*FILE(?:\s*,\s*("[^"]*"))?\s*\)\s+var\b/gm, (m, ind, f) => `${ind}@export_file${f ? `(${f})` : ''} var`);
  rep(/^(\s*)export\s*\(\s*String\s*,\s*MULTILINE\s*\)\s+var\b/gm, '$1@export_multiline var');
  rep(/^(\s*)export\s*\(\s*(?:int|String)\s*,\s*"([^"]*(?:"\s*,\s*"[^"]*)*)"\s*\)\s+var\b/gm, (m, ind, names) => `${ind}@export_enum("${names}") var`);
  rep(/^(\s*)export\s*\(\s*int\s*,\s*FLAGS\s*(?:,\s*("[^"]*(?:"\s*,\s*"[^"]*)*"))?\s*\)\s+var\b/gm, (m, ind, names) => `${ind}@export_flags(${names ?? ''}) var`);
  rep(/^(\s*)export\s*\(\s*int\s*,\s*LAYERS_2D_PHYSICS\s*\)\s+var\b/gm, '$1@export_flags_2d_physics var');
  rep(/^(\s*)export\s*\(\s*int\s*,\s*LAYERS_3D_PHYSICS\s*\)\s+var\b/gm, '$1@export_flags_3d_physics var');
  rep(/^(\s*)export\s*\(\s*Array\s*,\s*(\w+)\s*\)\s+var\s+(\w+)/gm, (m, ind, t, name) => `${ind}@export var ${name}: Array[${R.classes.get(t) ?? t}]`);
  rep(/^(\s*)export\s+var\b/gm, '$1@export var');
  rep(/^(\s*)export\s*\([^)]*\)\s+var\b/gm, (m, ind) => { notes.push('export hint kept as plain @export; check the hint'); return `${ind}@export var`; });
  // yield(obj, "signal") → await obj.signal ; yield(coroutine_call) → await coroutine_call
  const SIG = { idle_frame: 'process_frame', ...Object.fromEntries(R.signals) };
  rep(/\byield\s*\(\s*((?:[^,()]|\((?:[^()]|\([^()]*\))*\))+?)\s*,\s*"(\w+)"\s*\)/g, (m, obj, sig) => `await ${obj.trim()}.${SIG[sig] ?? sig}`);
  rep(/\byield\s*\(\s*([\w.]+\([^()]*\))\s*\)/g, 'await $1');
  // emit_signal("sig", a, b) → sig.emit(a, b)
  rep(/\bemit_signal\s*\(\s*"(\w+)"\s*(?:,\s*([^()]*(?:\([^()]*\)[^()]*)*))?\)/g, (m, sig, args) => `${R.signals.get(sig) ?? sig}.emit(${args?.trim() ?? ''})`);
  // connect("sig", obj, "method" [, binds]) → sig.connect(obj.method[.bind(...)]) ; obj.connect(...) → obj.sig.connect(...)
  rep(/(?:(\$[\w/%]+|\w+(?:\([^()]*\))?(?:\.\w+(?:\([^()]*\))?)*)\.)?\bconnect\s*\(\s*"(\w+)"\s*,\s*([\w.$]+(?:\([^()]*\))?)\s*,\s*"(\w+)"\s*(?:,\s*(\[[^\]]*\]))?\s*(?:,\s*(\w+))?\s*\)/g,
    (m, recv, sig, target, method, binds, flags) => {
      const s = R.signals.get(sig) ?? sig;
      const callable = `${target === 'self' ? '' : target + '.'}${method}${binds ? `.bind(${binds.slice(1, -1).trim()})` : ''}`;
      return `${recv ? recv + '.' : ''}${s}.connect(${callable}${flags ? `, ${flags}` : ''})`;
    });
  rep(/\bdisconnect\s*\(\s*"(\w+)"\s*,\s*([\w.$]+)\s*,\s*"(\w+)"\s*\)/g, (m, sig, target, method) => `${R.signals.get(sig) ?? sig}.disconnect(${target === 'self' ? '' : target + '.'}${method})`);
  rep(/\bis_connected\s*\(\s*"(\w+)"\s*,\s*([\w.$]+)\s*,\s*"(\w+)"\s*\)/g, (m, sig, target, method) => `${R.signals.get(sig) ?? sig}.is_connected(${target === 'self' ? '' : target + '.'}${method})`);
  // instance() → instantiate(), OS time → Time, builtin types, classes.
  rep(/\.instance\s*\(\s*\)/g, '.instantiate()');
  rep(/\bOS\.get_ticks_msec\(\)/g, 'Time.get_ticks_msec()');
  rep(/\bOS\.get_ticks_usec\(\)/g, 'Time.get_ticks_usec()');
  rep(/\bOS\.get_unix_time\(\)/g, 'Time.get_unix_time_from_system()');
  rep(/\bOS\.get_datetime\(\)/g, 'Time.get_datetime_dict_from_system()');
  rep(/\bOS\.get_system_time_msecs\(\)/g, 'Time.get_ticks_msec()');
  rep(/\bEngine\.editor_hint\b/g, 'Engine.is_editor_hint()');
  rep(/\.empty\(\)/g, '.is_empty()');
  rep(/\.invert\(\)/g, '.reverse()');
  rep(/\bget_tree\(\)\.change_scene\s*\(/g, 'get_tree().change_scene_to_file(');
  rep(/\bparse_json\s*\(/g, 'JSON.parse_string(');
  rep(/\bto_json\s*\(/g, 'JSON.stringify(');
  rep(/\bColor\.(\w+)\b/g, (m, c) => `Color.${R.colors.get(c) ?? c}`);
  for (const [a, b] of R.builtins) rep(new RegExp(`\\b${esc(a)}\\b`, 'g'), b);
  for (const [a, b] of R.classes) rep(new RegExp(`(?<![\\w."'/])${esc(a)}\\b(?!["'])`, 'g'), b);
  // Functions: `name(` not preceded by a word char that would make it another identifier; skip locally defined funcs.
  for (const [a, b] of R.functions) { if (a === 'yield' || localFuncs.has(a) || !/^\w+$/.test(b)) continue; rep(new RegExp(`(?<![\\w])${esc(a)}(?=\\s*\\()`, 'g'), b); }
  // Properties: `.name` not followed by `(`; and bare `name =`/`name.` for self properties of common nodes.
  for (const [a, b] of R.properties) rep(new RegExp(`\\.${esc(a)}\\b(?!\\s*\\()`, 'g'), `.${b}`);
  for (const [a, b] of R.properties) rep(new RegExp(`^(\\s*)${esc(a)}(?=\\s*(?:=|\\.|\\+=|-=|\\*=|/=))`, 'gm'), `$1${b}`);
  // Enums/constants.
  for (const [a, b] of R.enums) rep(new RegExp(`\\b${esc(a)}\\b`, 'g'), b);
  // Theme overrides in code: get("custom_colors/font_color") etc.
  for (const [a, b] of R.themeOverrides) rep(new RegExp(esc(a), 'g'), b);
  return { out, notes };
}

function convertScene(text, R) {
  let out = text;
  const rep = (re, to) => { out = out.replace(re, to); };
  rep(/(\btype=")(\w+)(")/g, (m, a, t, c) => `${a}${R.classes.get(t) ?? t}${c}`);
  rep(/(\[sub_resource type=")(\w+)/g, (m, a, t) => `${a}${R.classes.get(t) ?? t}`);
  rep(/(\[ext_resource [^\]]*type=")(\w+)/g, (m, a, t) => `${a}${R.classes.get(t) ?? t}`);
  for (const [a, b] of R.themeOverrides) rep(new RegExp(`^${esc(a)}`, 'gm'), b);
  for (const [a, b] of R.properties) rep(new RegExp(`^${esc(a)}(?=\\s*=)`, 'gm'), b);
  for (const [a, b] of R.builtins) rep(new RegExp(`\\b${esc(a)}\\s*\\(`, 'g'), `${b}(`);
  rep(/\[connection signal="(\w+)" from="([^"]*)" to="([^"]*)" method="(\w+)"/g, (m, sig, from, to, method) => `[connection signal="${R.signals.get(sig) ?? sig}" from="${from}" to="${to}" method="${method}"`);
  rep(/^(\[gd_scene[^\]]*?)format=2/gm, '$1format=3');
  rep(/^(\[gd_resource[^\]]*?)format=2/gm, '$1format=3');
  return out;
}

function convertProject(text, R) {
  let out = text.replace(/^config_version=4[ \t]*$/m, 'config_version=5');
  for (const [a, b] of R.projectGodot) out = out.replace(new RegExp(`^${esc(a)}=`, 'gm'), `${b}=`);
  for (const [a, b] of R.projectSettings) out = out.replace(new RegExp(`^${esc(a)}=`, 'gm'), `${b}=`);
  for (const [a, b] of R.inputMap) out = out.split(a).join(b);
  out = out.replace(/,"command":(?:true|false)/g, '');
  if (/^\[application\]/m.test(out) && !/config\/features=/.test(out)) out = out.replace(/^\[application\][ \t]*$/m, '[application]\n\nconfig/features=PackedStringArray("4.3", "Forward Plus")');
  if (/^\[rendering\]/m.test(out)) out = out.replace(/^environment\/default_environment=/m, 'environment/defaults/default_environment=');
  return out;
}

function convertShader(text, R) {
  let out = text;
  for (const [a, b] of R.shaders) out = out.replace(new RegExp(`\\b${esc(a)}\\b`, 'g'), b);
  return out.replace(/\bhint_albedo\b/g, 'source_color').replace(/\bhint_color\b/g, 'source_color').replace(/\bhint_white\b/g, 'hint_default_white').replace(/\bhint_black\b/g, 'hint_default_black').replace(/\bhint_normal\b/g, 'hint_normal');
}

function diffCount(a, b) {
  const la = a.split('\n'), lb = b.split('\n');
  let n = 0;
  for (let i = 0; i < Math.max(la.length, lb.length); i++) if (la[i] !== lb[i]) n++;
  return n;
}

function manualFindings(text, rel) {
  const found = [];
  text.split('\n').forEach((l, i) => { for (const [re, what, how] of MANUAL) if (re.test(l)) found.push({ file: rel, line: i + 1, what, how }); });
  return found;
}

export async function upgradeTool({ path: target, action = 'check', out, limit: max = 300 } = {}) {
  if (!target) throw new RPError('INVALID_ARGUMENT', 'path is required: a Godot 3 project folder.');
  const root = await requireDir(target);
  const pg = await fs.readFile(path.join(root, 'project.godot'), 'utf8').catch(() => null);
  if (pg === null) throw new RPError('NOT_GODOT', `${root} has no project.godot.`);
  if (/config_version=5/.test(pg)) throw new RPError('INVALID_ARGUMENT', 'This is already a Godot 4 project (config_version=5). Use re_apicheck to find leftovers.');
  const rt = renameTables();
  const raw = JSON.parse(await fs.readFile(new URL('../knowledge/apis/godot-3-to-4-renames.json', import.meta.url), 'utf8')).tables;
  const R = { ...rt, colors: new Map(raw.color_renames), themeOverrides: raw.theme_override_renames, projectGodot: raw.project_godot_renames, projectSettings: raw.project_settings_renames, inputMap: raw.input_map_renames };

  let outAbs = null;
  if (action === 'apply') {
    outAbs = out ? path.resolve(out) : path.join(await workspaceDir('upgrades'), path.basename(root).replace(/[^A-Za-z0-9._-]+/g, '_') + '-godot4');
    if (isInside(outAbs, root) || isInside(root, outAbs)) throw new RPError('INVALID_ARGUMENT', 'out must be outside the source project.');
    const existing = await fs.readdir(outAbs).catch(() => []);
    if (existing.length) throw new RPError('OUTPUT_NOT_EMPTY', `out is not empty: ${outAbs}`);
  } else if (action !== 'check') throw new RPError('INVALID_ARGUMENT', 'action must be check or apply.');

  const { files, truncated } = await walk(root, { maxFiles: 50000 });
  const changed = [], manual = [], renamedFiles = [];
  let converted = 0, copied = 0;
  for (const f of files) {
    const ext = f.ext;
    const rel = f.rel;
    let text = null, after = null, destRel = rel;
    if (['.gd', '.tscn', '.tres', '.godot', '.gdshader', '.shader', '.cfg', '.import'].includes(ext) || path.basename(rel) === 'project.godot') {
      text = await fs.readFile(f.abs, 'utf8').catch(() => null);
    }
    if (text !== null) {
      if (ext === '.gd') {
        const localFuncs = new Set([...text.matchAll(/^\s*(?:static\s+)?func\s+(\w+)/gm)].map(m => m[1]));
        after = convertGdscript(text, R, localFuncs).out;
        manual.push(...manualFindings(after, rel).filter(x => x.what !== 'var velocity in a CharacterBody script' || /extends\s+CharacterBody[23]D/.test(after)));
      } else if (ext === '.tscn' || ext === '.tres') { after = convertScene(text, R); manual.push(...manualFindings(after, rel).filter(x => x.what === 'Tween node')); }
      else if (path.basename(rel) === 'project.godot') after = convertProject(text, R);
      else if (ext === '.gdshader' || ext === '.shader') { after = convertShader(text, R); manual.push(...manualFindings(after, rel).filter(x => /TEXTURE/.test(x.what))); if (ext === '.shader') { destRel = rel.slice(0, -7) + '.gdshader'; renamedFiles.push({ from: rel, to: destRel }); } }
      else if (ext === '.import') { after = null; destRel = null; } // Godot 4 regenerates .import files.
      else after = text;
    }
    if (destRel === null) continue;
    const lines = after !== null && after !== text ? diffCount(text, after) : 0;
    if (lines) { converted++; changed.push({ file: rel, lines }); }
    if (action === 'apply') {
      const dest = path.join(outAbs, destRel);
      await fs.mkdir(path.dirname(dest), { recursive: true });
      if (after !== null) await fs.writeFile(dest, after); else await fs.copyFile(f.abs, dest);
      copied++;
    }
  }
  // Rename references to renamed .shader files.
  if (action === 'apply' && renamedFiles.length) {
    for (const f of files) if (['.tscn', '.tres', '.gd'].includes(f.ext)) {
      const dest = path.join(outAbs, f.rel);
      let t = await fs.readFile(dest, 'utf8').catch(() => null);
      if (t === null) continue;
      let changedRef = false;
      for (const r of renamedFiles) { const re = new RegExp(esc(toPosix(r.from)), 'g'); if (re.test(t)) { t = t.replace(re, toPosix(r.to)); changedRef = true; } }
      if (changedRef) await fs.writeFile(dest, t);
    }
  }
  changed.sort((a, b) => b.lines - a.lines);
  const byWhat = {};
  for (const m of manual) byWhat[m.what] = (byWhat[m.what] ?? 0) + 1;
  return {
    source: root, action, ...(outAbs ? { out: outAbs, filesWritten: copied } : {}), filesScanned: files.length, filesConverted: converted, truncated,
    changed: limit(changed, max), renamedFiles: limit(renamedFiles, 100), manual: limit(manual, max), manualByKind: byWhat,
    next: action === 'check'
      ? `port_upgrade action:"apply" writes the converted copy (default under the workspace, or out). ${manual.length} place(s) need a human afterwards; they are listed in manual.`
      : `Fix the ${manual.length} manual item(s) in ${outAbs}, run re_apicheck {path:"${toPosix(outAbs)}", engine:"godot@4.3"} and open the folder in Godot 4 (it re-saves scenes to format 3 and regenerates .import files). Renamed .shader files have been updated in scenes.`,
  };
}
