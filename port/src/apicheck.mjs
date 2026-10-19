// re_apicheck: does this code use APIs that exist in the engine version it targets?
// AI agents mix Godot 3 and 4 and invent members. This checks GDScript (and, for class names and renames, C#)
// against name-only snapshots of the real engine API (knowledge/apis/godot-*.json) and the official 3→4 rename
// table. It reports unknown classes, unknown members on a known receiver type, Godot 3 names used in Godot 4
// code (with the replacement), and Godot 4 names used in Godot 3 code. Static analysis only: when the receiver
// type cannot be inferred, the member is not checked.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RPError, requireDir, walk, limit, statOrNull } from './util.mjs';
import { stripComments } from './symbols.mjs';
import { closest } from './agent.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'knowledge', 'apis');
const cache = new Map();
export const GODOT_VERSIONS = fs.readdirSync(ROOT).filter(f => /^godot-\d+(?:\.\d+)*\.json$/.test(f)).map(f => f.replace(/^godot-|\.json$/g, '')).sort();

function snapshot(version) {
  const key = `godot-${version}`;
  if (!cache.has(key)) {
    const file = path.join(ROOT, `${key}.json`);
    if (!fs.existsSync(file)) throw new RPError('INVALID_ARGUMENT', `No API snapshot for Godot ${version}. Available: ${GODOT_VERSIONS.join(', ')}.`);
    const api = JSON.parse(fs.readFileSync(file, 'utf8'));
    api.classSet = new Set(Object.keys(api.classes));
    api.memberCache = new Map();
    cache.set(key, api);
  }
  return cache.get(key);
}

let renames = null;
export function renameTables() {
  if (!renames) {
    const r = JSON.parse(fs.readFileSync(path.join(ROOT, 'godot-3-to-4-renames.json'), 'utf8')).tables;
    const toMap = pairs => new Map(pairs);
    // Godot's editor converter handles these outside its rename table; agents hit them constantly.
    const extraFunctions = [['instance', 'instantiate'], ['empty', 'is_empty'], ['invert', 'reverse'], ['funcref', 'Callable(obj, "method")'], ['set_cellv', 'set_cell'], ['get_cellv', 'get_cell_source_id'],
      ['yield', 'await'], ['get_tree().change_scene', 'get_tree().change_scene_to_file'], ['is_a_parent_of', 'is_ancestor_of'], ['get_closest_point_to_segment_2d', 'get_closest_point_to_segment'], ['validate_json', 'JSON.parse_string'], ['parse_json', 'JSON.parse_string'], ['to_json', 'JSON.stringify']];
    renames = {
      classes: toMap(r.class_renames), builtins: toMap(r.builtin_types_renames), functions: toMap([...r.gdscript_function_renames, ...extraFunctions]), csFunctions: toMap(r.csharp_function_renames),
      properties: toMap(r.gdscript_properties_renames), signals: toMap(r.gdscript_signals_renames), enums: toMap(r.enum_renames), shaders: toMap(r.shaders_renames),
      reverseClasses: toMap(r.class_renames.map(([a, b]) => [b, a])), reverseFunctions: toMap([...r.gdscript_function_renames, ...extraFunctions].filter(([, b]) => /^\w+$/.test(b)).map(([a, b]) => [b, a])),
    };
  }
  return renames;
}

/** Pick the snapshot for a version string: "4", "4.3", "4.7", "3", "3.5", "godot@4.3"… */
export function resolveVersion(v) {
  const s = String(v ?? '').replace(/^godot[@ -]?/i, '').trim();
  if (!s) return GODOT_VERSIONS.filter(x => x.startsWith('4')).at(-1);
  if (GODOT_VERSIONS.includes(s)) return s;
  const major = s.split('.')[0];
  const same = GODOT_VERSIONS.filter(x => x.startsWith(major));
  if (!same.length) throw new RPError('INVALID_ARGUMENT', `No API snapshot for Godot ${s}. Available: ${GODOT_VERSIONS.join(', ')}.`);
  const minor = Number(s.split('.')[1] ?? 99);
  const notNewer = same.filter(x => Number(x.split('.')[1] ?? 0) <= minor);
  return notNewer.at(-1) ?? same[0];
}

/** All members of a class including inherited ones. */
function members(api, cls) {
  if (api.memberCache.has(cls)) return api.memberCache.get(cls);
  const out = { methods: new Set(), properties: new Set(), signals: new Set(), constants: new Set() };
  let c = cls;
  const seen = new Set();
  while (c && api.classes[c] && !seen.has(c)) {
    seen.add(c);
    const k = api.classes[c];
    for (const key of Object.keys(out)) for (const n of k[key] ?? []) out[key].add(n);
    c = k.inherits;
  }
  api.memberCache.set(cls, out);
  return out;
}

const MOVED_3_TO_4 = {
  'OS.get_ticks_msec': 'Time.get_ticks_msec()', 'OS.get_ticks_usec': 'Time.get_ticks_usec()', 'OS.get_unix_time': 'Time.get_unix_time_from_system()',
  'OS.get_datetime': 'Time.get_datetime_dict_from_system()', 'OS.get_date': 'Time.get_date_dict_from_system()', 'OS.get_time': 'Time.get_time_dict_from_system()',
  'OS.get_system_time_msecs': 'Time.get_ticks_msec()', 'OS.window_size': 'get_window().size', 'OS.set_window_size': 'get_window().size =', 'OS.window_fullscreen': 'get_window().mode == Window.MODE_FULLSCREEN',
  'OS.get_screen_size': 'DisplayServer.screen_get_size()', 'Engine.editor_hint': 'Engine.is_editor_hint()', 'Engine.target_fps': 'Engine.max_fps',
  'Input.set_mouse_mode': 'Input.mouse_mode =', 'Node.instance': 'instantiate()', 'PackedScene.instance': 'instantiate()',
};
function allMethods(api) {
  if (!api.allMethods) { api.allMethods = new Set(); for (const c of Object.values(api.classes)) for (const n of c.methods ?? []) api.allMethods.add(n); }
  return api.allMethods;
}

const GD_KEYWORDS = new Set('if elif else for while match break continue pass return class class_name extends is in as self super signal func static const enum var await yield preload load assert void null true false and or not setget onready export tool breakpoint remote master puppet remotesync mastersync puppetsync'.split(' '));
const BUILTIN_TYPES_3 = new Set('int float bool String Vector2 Vector3 Rect2 Transform2D Plane Quat AABB Basis Transform Color NodePath RID Object Dictionary Array PoolByteArray PoolIntArray PoolRealArray PoolStringArray PoolVector2Array PoolVector3Array PoolColorArray Variant'.split(' '));

/** Static type of common receivers: `self`, typed vars, `ClassName.`, `$Node as Type`, `Singleton`. */
function typeEnv(code, api) {
  const env = new Map();
  const ext = code.match(/^extends\s+([A-Z]\w*)/m);
  if (ext) env.set('self', ext[1]);
  for (const m of code.matchAll(/\b(?:var|const|@onready\s+var|onready\s+var|export(?:\([^)]*\))?\s+var)\s+(\w+)\s*:\s*([A-Z]\w*)/g)) env.set(m[1], m[2]);
  for (const m of code.matchAll(/\b(?:var|const)\s+(\w+)\s*:?=\s*([A-Z]\w*)\.new\(/g)) env.set(m[1], m[2]);
  for (const m of code.matchAll(/\b(?:var|const)\s+(\w+)\s*:?=\s*\$[\w/%"]+\s+as\s+([A-Z]\w*)/g)) env.set(m[1], m[2]);
  for (const m of code.matchAll(/func\s+\w+\s*\(([^)]*)\)/g)) for (const p of m[1].split(',')) { const t = p.match(/(\w+)\s*:\s*([A-Z]\w*)/); if (t) env.set(t[1], t[2]); }
  for (const [name, type] of Object.entries(api.singletons ?? {})) env.set(name, type);
  return env;
}

export function checkGdscript(text, version) {
  const api = snapshot(version);
  const major = version.split('.')[0];
  const R = renameTables();
  const code = stripComments(text, 'gdscript');
  const lines = code.split('\n');
  const findings = [];
  const seen = new Set();
  const add = f => { const k = `${f.kind}|${f.name}|${f.line}`; if (!seen.has(k)) { seen.add(k); findings.push(f); } };
  const env = typeEnv(code, api);
  const localFuncs = new Set([...code.matchAll(/^\s*(?:static\s+)?func\s+(\w+)/gm)].map(m => m[1]));
  const localVars = new Set([...code.matchAll(/\b(?:var|const|signal|enum)\s+(\w+)/g)].map(m => m[1]));
  const localClasses = new Set([...code.matchAll(/^\s*class(?:_name)?\s+(\w+)/gm)].map(m => m[1]));
  const utility = new Set(api.utility_functions ?? []);
  const globalEnums = new Set(api.global_enums ?? []);

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const line = i + 1;
    // Class names used as types or receivers.
    for (const m of l.matchAll(/(?<![\w.$"'/])([A-Z][A-Za-z0-9]+)\b(?!\s*(?::\s*$|"))/g)) {
      const name = m[1];
      if (api.classSet.has(name) || localClasses.has(name) || localVars.has(name) || globalEnums.has(name) || /^[A-Z_0-9]+$/.test(name)) continue;
      if (major === '4' && (R.classes.has(name) || R.builtins.has(name))) { add({ kind: 'renamed-class', name, line, replacement: R.classes.get(name) ?? R.builtins.get(name), detail: `Godot 3 name; in Godot 4 it is ${R.classes.get(name) ?? R.builtins.get(name)}` }); continue; }
      if (major === '3' && R.reverseClasses.has(name)) { add({ kind: 'too-new', name, line, replacement: R.reverseClasses.get(name), detail: `Godot 4 name; in Godot 3 it is ${R.reverseClasses.get(name)}` }); continue; }
      if (major === '3' && BUILTIN_TYPES_3.has(name)) continue;
      // Only flag names that look like engine classes (used with .new(, as a type, or as a static receiver).
      const after = l.slice(m.index + name.length);
      const before = l.slice(0, m.index);
      if (/^\s*\.\s*\w+\s*\(|^\s*\.new\(|^\s*\)|^\s*,|^\s*$/.test(after) && /(:\s*|\bextends\s+|\bis\s+|\bas\s+|\(\s*|,\s*|=\s*|->\s*)$/.test(before) || /^\s*\.new\(/.test(after) || /^\s*\.[A-Z_]+\b/.test(after)) {
        const newer = GODOT_VERSIONS.filter(v => v.startsWith(major) && v > version).find(v => snapshot(v).classSet.has(name));
        if (newer) { add({ kind: 'too-new', name, line, detail: `${name} exists from Godot ${newer}, not in ${api.version}` }); continue; }
        const near = closest(name, [...api.classSet], 2);
        add({ kind: 'unknown-class', name, line, ...(near ? { replacement: near } : {}), detail: near ? `not in Godot ${api.version}; did you mean ${near}?` : `not in Godot ${api.version}` });
      }
    }
    // Member access on a known receiver: recv.member( or recv.member
    for (const m of l.matchAll(/(?<![\w.])(\w+)\.(\w+)\s*(\()?/g)) {
      const [, recv, member, call] = m;
      if (member === 'new' && call) continue;
      let type = env.get(recv) ?? (api.classSet.has(recv) ? recv : null);
      if (!type || !api.classes[type]) {
        // Untyped receiver: only Godot 3 method names that no Godot 4 class has are safe to flag.
        if (call && major === '4' && R.functions.has(member) && !allMethods(api).has(member)) add({ kind: 'renamed-member', name: member, line, replacement: R.functions.get(member), detail: `Godot 3 name; in Godot 4 use ${R.functions.get(member)}` });
        continue;
      }
      const moved = major === '4' ? MOVED_3_TO_4[`${type}.${member}`] : null;
      if (moved) { add({ kind: 'renamed-member', name: `${type}.${member}`, line, replacement: moved, detail: `moved in Godot 4: use ${moved}` }); continue; }
      const mem = members(api, type);
      const isMethod = !!call;
      if (isMethod ? mem.methods.has(member) : (mem.properties.has(member) || mem.constants.has(member) || mem.signals.has(member) || mem.methods.has(member))) continue;
      if (recv === 'self' && (localFuncs.has(member) || localVars.has(member))) continue;
      const rn = (isMethod ? R.functions : R.properties).get(member) ?? R.signals.get(member) ?? R.enums.get(member);
      if (major === '4' && rn) { add({ kind: 'renamed-member', name: `${type}.${member}`, line, replacement: rn, detail: `Godot 3 name; in Godot 4 use ${rn}` }); continue; }
      if (major === '3' && R.reverseFunctions.has(member)) { add({ kind: 'too-new', name: `${type}.${member}`, line, replacement: R.reverseFunctions.get(member), detail: `Godot 4 name; in Godot 3 it is ${R.reverseFunctions.get(member)}` }); continue; }
      const pool = isMethod ? [...mem.methods] : [...mem.properties, ...mem.methods, ...mem.constants, ...mem.signals];
      const near = closest(member, pool, 2);
      add({ kind: isMethod ? 'unknown-method' : 'unknown-member', name: `${type}.${member}`, line, ...(near ? { replacement: near } : {}), detail: `${type} has no ${isMethod ? 'method' : 'member'} ${member} in Godot ${api.version}${near ? `; did you mean ${near}?` : ''}` });
    }
    // Method calls on call results or indexes: `preload(...).instance()`, `a[0].foo()`.
    if (major === '4') for (const m of l.matchAll(/[)\]]\.(\w+)\s*\(/g)) {
      const member = m[1];
      if (R.functions.has(member) && !allMethods(api).has(member)) add({ kind: 'renamed-member', name: member, line, replacement: R.functions.get(member), detail: `Godot 3 name; in Godot 4 use ${R.functions.get(member)}` });
    }
    // Bare calls: local func, utility function, inherited method of `self`, or renamed.
    for (const m of l.matchAll(/(?<![\w.@])([a-z_]\w*)\s*\(/g)) {
      const name = m[1];
      if (major === '4' && name === 'yield') { add({ kind: 'renamed-function', name, line, replacement: 'await', detail: 'yield() is gone in Godot 4: use await signal_or_coroutine' }); continue; }
      if (GD_KEYWORDS.has(name) || localFuncs.has(name) || localVars.has(name) || utility.has(name)) continue;
      const selfType = env.get('self');
      if (selfType && members(api, selfType).methods.has(name)) continue;
      if (major === '4' && R.functions.has(name)) { add({ kind: 'renamed-function', name, line, replacement: R.functions.get(name), detail: `Godot 3 name; in Godot 4 use ${R.functions.get(name)}` }); continue; }
      if (major === '3' && R.reverseFunctions.has(name)) { add({ kind: 'too-new', name, line, replacement: R.reverseFunctions.get(name), detail: `Godot 4 name; in Godot 3 it is ${R.reverseFunctions.get(name)}` }); continue; }
      if (selfType && api.classes[selfType]) {
        const near = closest(name, [...members(api, selfType).methods, ...utility], 2);
        add({ kind: 'unknown-function', name, line, ...(near ? { replacement: near } : {}), detail: `neither defined here, a Godot ${api.version} utility function, nor a method of ${selfType}${near ? `; did you mean ${near}?` : ''}` });
      }
    }
    if (major === '4') {
      const c3 = l.match(/\bconnect\(\s*"(\w+)"\s*,\s*\w+\s*,\s*"(\w+)"/);
      if (c3) add({ kind: 'renamed-pattern', name: 'connect("signal", obj, "method")', line, replacement: `${c3[1]}.connect(${c3[2]})`, detail: 'Godot 3 string connect; in Godot 4 connect the signal to a Callable' });
      if (/\b(?:export|onready|tool)\b(?!\s*\()/.test(l) && /^\s*(?:export|onready|tool)\b/.test(l)) add({ kind: 'renamed-pattern', name: l.trim().split(/\s/)[0], line, replacement: '@' + l.trim().split(/\s/)[0], detail: 'Godot 4 annotations start with @' });
      if (/\bsetget\b/.test(l)) add({ kind: 'renamed-pattern', name: 'setget', line, replacement: 'var x: T:\n\tset(value): …\n\tget: …', detail: 'Godot 4 uses property get/set blocks' });
    }
    if (major === '3' && /^\s*@(export|onready|tool)/.test(l)) add({ kind: 'too-new', name: '@' + l.match(/^\s*@(\w+)/)[1], line, replacement: l.match(/^\s*@(\w+)/)[1], detail: 'annotations are Godot 4; Godot 3 uses the bare keyword' });
  }
  return findings;
}

export function checkCsharp(text, version) {
  // Only class renames and well-known method renames (the C# API mirrors GDScript in PascalCase).
  const major = version.split('.')[0];
  const R = renameTables();
  const api = snapshot(version);
  const code = stripComments(text, 'csharp');
  const findings = [];
  code.split('\n').forEach((l, i) => {
    for (const m of l.matchAll(/\b([A-Z][A-Za-z0-9]+)\b/g)) {
      const name = m[1];
      if (major === '4' && R.classes.has(name) && !api.classSet.has(name)) findings.push({ kind: 'renamed-class', name, line: i + 1, replacement: R.classes.get(name), detail: `Godot 3 name; in Godot 4 it is ${R.classes.get(name)}` });
    }
    for (const m of l.matchAll(/\.(\w+)\s*\(/g)) {
      if (major === '4' && R.csFunctions.has(m[1])) findings.push({ kind: 'renamed-member', name: m[1], line: i + 1, replacement: R.csFunctions.get(m[1]), detail: `Godot 3 name; in Godot 4 use ${R.csFunctions.get(m[1])}` });
    }
  });
  return findings;
}

export function checkShader(text, version) {
  const major = version.split('.')[0];
  const R = renameTables();
  const findings = [];
  if (major !== '4') return findings;
  text.split('\n').forEach((l, i) => { for (const [old, nu] of R.shaders) if (new RegExp(`\\b${old.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(l)) findings.push({ kind: 'renamed-shader', name: old, line: i + 1, replacement: nu, detail: `Godot 3 shader name; in Godot 4 use ${nu}` }); });
  return findings;
}

function detectVersion(root) {
  try {
    const pg = fs.readFileSync(path.join(root, 'project.godot'), 'utf8');
    const f = pg.match(/config\/features=PackedStringArray\(([^)]*)\)/);
    const v = f?.[1].match(/"(\d+\.\d+)"/)?.[1];
    if (v) return { version: v, from: 'project.godot config/features' };
    if (/config_version=5/.test(pg)) return { version: '4', from: 'project.godot config_version=5' };
    if (/config_version=4/.test(pg)) return { version: '3', from: 'project.godot config_version=4' };
  } catch { /* no project.godot */ }
  return null;
}

export async function apicheckTool({ path: target, content, engine, limit: max = 300 } = {}) {
  if (!target && !content) throw new RPError('INVALID_ARGUMENT', 'Give path (file or folder) or content.');
  let root = null, files = [];
  if (content) files.push({ rel: '(content)', text: content, lang: /^\s*(?:using\s+Godot|namespace|public\s+(?:partial\s+)?class)/m.test(content) ? 'csharp' : /shader_type/.test(content) ? 'shader' : 'gdscript' });
  else {
    const abs = path.resolve(target);
    const st = await statOrNull(abs);
    if (!st) throw new RPError('NOT_FOUND', `not found: ${abs}`);
    if (st.isDirectory()) {
      root = await requireDir(abs);
      const { files: all } = await walk(root, { maxFiles: 20000 });
      for (const f of all) if (['.gd', '.cs', '.gdshader', '.shader'].includes(f.ext)) files.push({ rel: f.rel, abs: f.abs, lang: f.ext === '.gd' ? 'gdscript' : f.ext === '.cs' ? 'csharp' : 'shader' });
    } else {
      root = path.dirname(abs);
      for (let d = root; ; d = path.dirname(d)) { if (fs.existsSync(path.join(d, 'project.godot'))) { root = d; break; } if (path.dirname(d) === d) break; }
      const ext = path.extname(abs).toLowerCase();
      files.push({ rel: path.relative(root, abs), abs, lang: ext === '.gd' ? 'gdscript' : ext === '.cs' ? 'csharp' : 'shader' });
    }
  }
  const eng = String(engine ?? 'godot').toLowerCase().replace(/^(\d)/, 'godot@$1');
  if (!eng.startsWith('godot')) throw new RPError('INVALID_ARGUMENT', `re_apicheck knows Godot (${GODOT_VERSIONS.map(v => `godot@${v}`).join(', ')}) for now. Unity/Unreal: see port_verify leftovers and port_map.`);
  const detected = !/\d/.test(eng) && root ? detectVersion(root) : null;
  const version = resolveVersion(eng.includes('@') || /\d/.test(eng) ? eng.replace(/^godot[@ -]?/, '') : detected?.version);
  const api = snapshot(version);

  const perFile = [];
  const counts = {};
  let total = 0;
  for (const f of files) {
    const text = f.text ?? await fsp.readFile(f.abs, 'utf8').catch(() => null);
    if (text === null || text.length > 4 * 1024 * 1024) continue;
    const findings = f.lang === 'gdscript' ? checkGdscript(text, version) : f.lang === 'csharp' ? checkCsharp(text, version) : checkShader(text, version);
    if (!findings.length) continue;
    total += findings.length;
    for (const x of findings) counts[x.kind] = (counts[x.kind] ?? 0) + 1;
    perFile.push({ file: f.rel, findings: findings.slice(0, 60) });
  }
  perFile.sort((a, b) => b.findings.length - a.findings.length);
  const wrongMajor = (counts['renamed-class'] ?? 0) + (counts['renamed-function'] ?? 0) + (counts['renamed-member'] ?? 0) + (counts['renamed-pattern'] ?? 0) >= 3 || (counts['too-new'] ?? 0) >= 3;
  return {
    engine: `godot@${api.version}`, versionSource: detected ? detected.from : engine ? 'argument' : 'default (latest snapshot)', filesChecked: files.length, findings: total, byKind: counts,
    files: limit(perFile, max), passed: total === 0,
    ...(wrongMajor ? { suspicion: version.startsWith('4') ? 'Several Godot 3 names: this code was written for Godot 3, or the model mixed versions. Port it with the renames below, or check it against godot@3.' : 'Several Godot 4 names in a Godot 3 project: check it against godot@4.' } : {}),
    next: total ? 'Replace each finding with its replacement (renames) or a real API (unknown-*), then run re_apicheck again. unknown-* on a receiver whose type is not declared is not checked: add type hints (var x: Node3D) to check more.' : `All class names and checked members exist in Godot ${api.version}.`,
  };
}
