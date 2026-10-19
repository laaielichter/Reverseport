// Unity animation clips (.anim) and animator controllers (.controller) → Godot Animation resources and a
// state-machine script. Clips become .tres Animation resources with value tracks (position/rotation/scale/
// float properties/sprite swaps); controllers become an AnimationPlayer-driven GDScript state machine with the
// same states, parameters and transition conditions, so the behaviour is readable and finishable by hand.
import fs from 'node:fs/promises';
import path from 'node:path';
import { RPError } from './util.mjs';
import { findUnityRoot, unityGuidMap } from './scene.mjs';

const f = n => { const v = Number(n); if (!Number.isFinite(v)) return '0'; const s = v.toFixed(6).replace(/\.?0+$/, ''); return s === '-0' ? '0' : s; };
const ref = v => { const m = String(v ?? '').match(/fileID:\s*(-?\d+)(?:,\s*guid:\s*([0-9a-f]{32}))?/); return m ? { fileID: m[1], guid: m[2] ?? null } : null; };
export const snake = s => String(s).replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').toLowerCase() || 'anim';

/** Split a Unity YAML file into documents keyed by fileID with the raw body (the generic parser in scene.mjs is flat; curves need depth). */
function docs(text) {
  const parts = text.split(/^--- !u!(\d+) &(-?\d+)[^\n]*$/m);
  const out = new Map();
  for (let i = 1; i + 2 < parts.length; i += 3) {
    const body = parts[i + 2] ?? '';
    const type = (body.match(/^(\w+):/m) ?? [])[1] ?? '';
    out.set(parts[i + 1], { classId: Number(parts[i]), fileID: parts[i + 1], type, body });
  }
  return out;
}

/** Parse the `m_Curve:` key list under a block: returns [{time, value}] where value is number | {x,y,z,w}. */
function keys(block) {
  const out = [];
  for (const m of block.matchAll(/- serializedVersion: \d+\s*\n\s*time: (-?[\d.e+-]+)\s*\n\s*value: ([^\n]*)/g)) {
    const raw = m[2].trim();
    const v = raw.startsWith('{') ? Object.fromEntries([...raw.matchAll(/([xyzw]):\s*(-?[\d.e+-]+)/g)].map(x => [x[1], Number(x[2])])) : raw.startsWith('{fileID') ? ref(raw) : Number(raw);
    out.push({ time: Number(m[1]), value: v });
  }
  return out;
}

/** Top-level list blocks of a clip: `m_PositionCurves:` … up to the next `  m_` key at indent 2. */
function listBlock(body, key) {
  const m = body.match(new RegExp(`^  ${key}:\\s*\\n((?:(?! {2}\\w).*\\n?)*)`, 'm'));
  if (!m) return [];
  // Each curve starts with "  - " at indent 2.
  return m[1].split(/^  - /m).slice(1);
}

export function parseAnimClip(text, { asset = r => (r?.guid ? `guid:${r.guid}` : null) } = {}) {
  const d = [...docs(text).values()].find(x => x.type === 'AnimationClip');
  if (!d) throw new RPError('BAD_FORMAT', 'Not a Unity AnimationClip (.anim saved as text).');
  const b = d.body;
  const name = b.match(/^  m_Name: (.*)$/m)?.[1]?.trim() ?? 'clip';
  const sampleRate = Number(b.match(/m_SampleRate: ([\d.]+)/)?.[1] ?? 60);
  const loop = /m_LoopTime: 1/.test(b);
  const tracks = [];
  const curvePath = block => block.match(/^\s*path: (.*)$/m)?.[1]?.trim() ?? '';
  for (const c of listBlock(b, 'm_PositionCurves')) tracks.push({ kind: 'position', path: curvePath(c), keys: keys(c) });
  for (const c of listBlock(b, 'm_RotationCurves')) tracks.push({ kind: 'rotation', path: curvePath(c), keys: keys(c) });
  for (const c of listBlock(b, 'm_EulerCurves')) tracks.push({ kind: 'euler', path: curvePath(c), keys: keys(c) });
  for (const c of listBlock(b, 'm_ScaleCurves')) tracks.push({ kind: 'scale', path: curvePath(c), keys: keys(c) });
  for (const c of listBlock(b, 'm_FloatCurves')) {
    const attr = c.match(/^\s*attribute: (.*)$/m)?.[1]?.trim() ?? '';
    const type = c.match(/classID: (\d+)/)?.[1];
    tracks.push({ kind: 'float', path: curvePath(c), attribute: attr, classID: Number(type ?? 0), keys: keys(c) });
  }
  for (const c of listBlock(b, 'm_PPtrCurves')) {
    const attr = c.match(/^\s*attribute: (.*)$/m)?.[1]?.trim() ?? '';
    const ks = [...c.matchAll(/- time: (-?[\d.e+-]+)\s*\n\s*value: ([^\n]*)/g)].map(m => ({ time: Number(m[1]), value: asset(ref(m[2])) }));
    tracks.push({ kind: 'object', path: curvePath(c), attribute: attr, keys: ks });
  }
  const events = [...b.matchAll(/- time: (-?[\d.e+-]+)\s*\n\s*functionName: (\w+)/g)].map(m => ({ time: Number(m[1]), function: m[2] }));
  let length = 0;
  for (const t of tracks) for (const k of t.keys) length = Math.max(length, k.time);
  const stopTime = Number(b.match(/m_StopTime: ([\d.e+-]+)/)?.[1] ?? length);
  return { name, sampleRate, loop, length: Math.max(length, stopTime), tracks, events };
}

const PROPERTY_MAP = {
  'm_IsActive': 'visible', 'm_Enabled': 'visible', 'm_LocalPosition.x': 'position:x', 'm_LocalPosition.y': 'position:y', 'm_LocalPosition.z': 'position:z',
  'm_LocalScale.x': 'scale:x', 'm_LocalScale.y': 'scale:y', 'm_LocalScale.z': 'scale:z', 'localEulerAnglesRaw.x': 'rotation_degrees:x', 'localEulerAnglesRaw.y': 'rotation_degrees:y', 'localEulerAnglesRaw.z': 'rotation_degrees:z',
  'm_Color.r': 'modulate:r', 'm_Color.g': 'modulate:g', 'm_Color.b': 'modulate:b', 'm_Color.a': 'modulate:a', 'm_Sprite': 'texture', 'm_Intensity': 'light_energy', 'm_Volume': 'volume_db', 'm_Pitch': 'pitch_scale', 'm_Size': 'size', 'm_FieldOfView': 'fov',
  'm_FlipX': 'flip_h', 'm_FlipY': 'flip_v', 'm_AnchoredPosition.x': 'position:x', 'm_AnchoredPosition.y': 'position:y', 'm_SizeDelta.x': 'size:x', 'm_SizeDelta.y': 'size:y',
};

/** Godot node path for a Unity transform path ("Body/Arm" → "Body/Arm", "" → "."), with the Godot property. */
function nodePath(p, prop) { return `NodePath("${p ? p.split('/').map(s => s.replace(/[":]/g, '_')).join('/') : '.'}:${prop}")`; }

/**
 * Write a Godot 4 Animation .tres from a parsed clip.
 * coords: 'unity-3d' mirrors Z (Unity left-handed → Godot), 'unity-2d' flips Y for sprites, 'none' keeps values.
 */
export function clipToTres(clip, { coords = 'unity-3d', resolve = () => null } = {}) {
  const ext = [], extId = new Map();
  const addExt = (type, p) => { const k = `${type}:${p}`; if (!extId.has(k)) { const id = `${ext.length + 1}_rp`; extId.set(k, id); ext.push(`[ext_resource type="${type}" path="${p}" id="${id}"]`); } return extId.get(k); };
  const lines = [];
  const todo = [];
  let n = 0;
  const mirror = v => (coords === 'unity-3d' ? { ...v, z: -(v.z ?? 0) } : coords === 'unity-2d' ? { ...v, y: -(v.y ?? 0) } : v);
  const track = (pathStr, { times, values, update = 0, interp = 1 }) => {
    lines.push(`tracks/${n}/type = "value"`, `tracks/${n}/imported = false`, `tracks/${n}/enabled = true`, `tracks/${n}/path = ${pathStr}`, `tracks/${n}/interp = ${interp}`, `tracks/${n}/loop_wrap = true`,
      `tracks/${n}/keys = {\n"times": PackedFloat32Array(${times.map(f).join(', ')}),\n"transitions": PackedFloat32Array(${times.map(() => '1').join(', ')}),\n"update": ${update},\n"values": [${values.join(', ')}]\n}`);
    n++;
  };
  const floatGroups = new Map(); // path+base → {x,y,z,w} float curves merged into one vector track when they animate the same property.
  for (const t of clip.tracks) {
    if (!t.keys.length) continue;
    if (t.kind === 'position') track(nodePath(t.path, 'position'), { times: t.keys.map(k => k.time), values: t.keys.map(k => { const v = mirror(k.value); return coords === 'unity-2d' ? `Vector2(${f(v.x)}, ${f(v.y)})` : `Vector3(${f(v.x)}, ${f(v.y)}, ${f(v.z)})`; }) });
    else if (t.kind === 'scale') track(nodePath(t.path, 'scale'), { times: t.keys.map(k => k.time), values: t.keys.map(k => coords === 'unity-2d' ? `Vector2(${f(k.value.x)}, ${f(k.value.y)})` : `Vector3(${f(k.value.x)}, ${f(k.value.y)}, ${f(k.value.z)})`) });
    else if (t.kind === 'rotation') {
      // Unity quaternion (x,y,z,w) in a left-handed frame → mirror Z: negate x and y of the quaternion.
      track(nodePath(t.path, 'quaternion'), { times: t.keys.map(k => k.time), values: t.keys.map(k => { const q = k.value; const m = coords === 'unity-3d' ? { x: -q.x, y: -q.y, z: q.z, w: q.w } : q; return `Quaternion(${f(m.x)}, ${f(m.y)}, ${f(m.z)}, ${f(m.w)})`; }) });
    } else if (t.kind === 'euler') {
      track(nodePath(t.path, coords === 'unity-2d' ? 'rotation_degrees' : 'rotation_degrees'), { times: t.keys.map(k => k.time), values: t.keys.map(k => { const e = k.value; return coords === 'unity-2d' ? f(-(e.z ?? 0)) : coords === 'unity-3d' ? `Vector3(${f(-(e.x ?? 0))}, ${f(-(e.y ?? 0))}, ${f(e.z ?? 0)})` : `Vector3(${f(e.x)}, ${f(e.y)}, ${f(e.z)})`; }) });
    } else if (t.kind === 'float') {
      const prop = PROPERTY_MAP[t.attribute];
      if (!prop) { todo.push(`${t.path || '.'}: ${t.attribute} (${t.keys.length} keys) has no Godot property mapping; add a value track by hand`); continue; }
      const isBool = prop === 'visible' || prop.startsWith('flip_');
      const vals = t.keys.map(k => isBool ? (k.value >= 0.5 ? 'true' : 'false') : f(coords === 'unity-2d' && /^(position:y|rotation_degrees)$/.test(prop) ? -k.value : coords === 'unity-3d' && prop === 'position:z' ? -k.value : k.value));
      track(nodePath(t.path, prop), { times: t.keys.map(k => k.time), values: vals, update: isBool ? 1 : 0, interp: isBool ? 0 : 1 });
      void floatGroups;
    } else if (t.kind === 'object') {
      const prop = PROPERTY_MAP[t.attribute] ?? (t.attribute === 'm_Sprite' ? 'texture' : null);
      if (!prop) { todo.push(`${t.path || '.'}: object curve ${t.attribute} not mapped`); continue; }
      const vals = t.keys.map(k => { const target = k.value ? resolve(k.value) : null; if (!target) { todo.push(`${t.path || '.'}: sprite ${k.value ?? '?'} at ${k.time}s not resolved; assign the imported texture`); return 'null'; } return `ExtResource("${addExt('Texture2D', target)}")`; });
      track(nodePath(t.path, prop), { times: t.keys.map(k => k.time), values: vals, update: 1, interp: 0 });
    }
  }
  if (clip.events.length) {
    track('NodePath(".")', { times: clip.events.map(e => e.time), values: clip.events.map(e => `{\n"args": [],\n"method": &"${e.function}"\n}`), update: 1, interp: 0 });
    // Godot method tracks have their own type; rewrite the last emitted track header.
    const i = lines.findIndex((l, k) => k === lines.length - 7);
    if (i >= 0) lines[i] = `tracks/${n - 1}/type = "method"`;
  }
  const head = `[gd_resource type="Animation" load_steps=${ext.length + 1} format=3]`;
  const body = ['[resource]', `resource_name = "${snake(clip.name)}"`, `length = ${f(clip.length)}`, `loop_mode = ${clip.loop ? 1 : 0}`, `step = ${f(1 / (clip.sampleRate || 60))}`, ...lines];
  if (todo.length) body.push(`metadata/reverseport_todo = "${todo.join('; ').replace(/"/g, "'")}"`);
  return { text: [head, ext.join('\n'), body.join('\n')].filter(Boolean).join('\n\n') + '\n', tracks: n, todo };
}

const PARAM_TYPES = { 1: 'float', 3: 'int', 4: 'bool', 9: 'trigger' };
const MODES = { 1: '>', 2: '<', 3: '>', 4: '<', 6: '==', 7: '!=' }; // 1 If (bool true), 2 IfNot, 3 Greater, 4 Less, 6 Equals, 7 NotEqual

export function parseAnimatorController(text, { asset = r => (r?.guid ? `guid:${r.guid}` : null) } = {}) {
  const all = docs(text);
  const ctrl = [...all.values()].find(d => d.type === 'AnimatorController');
  if (!ctrl) throw new RPError('BAD_FORMAT', 'Not a Unity AnimatorController (.controller saved as text).');
  const name = ctrl.body.match(/^  m_Name: (.*)$/m)?.[1]?.trim() ?? 'Animator';
  const parameters = [...ctrl.body.matchAll(/- m_Name: (.*)\n\s*m_Type: (\d+)\n\s*m_DefaultFloat: ([\d.e+-]+)\n\s*m_DefaultInt: (-?\d+)\n\s*m_DefaultBool: (\d)/g)].map(m => ({ name: m[1].trim(), type: PARAM_TYPES[m[2]] ?? m[2], default: m[2] === '1' ? Number(m[3]) : m[2] === '3' ? Number(m[4]) : m[5] === '1' }));
  const layers = [...ctrl.body.matchAll(/- serializedVersion: \d+\s*\n\s*m_Name: (.*)\n\s*m_StateMachine: ([^\n]*)/g)].map(m => ({ name: m[1].trim(), stateMachine: ref(m[2])?.fileID }));
  const stateOf = id => all.get(id);
  const transitionsOf = ids => ids.map(id => all.get(id)).filter(t => t?.type === 'AnimatorStateTransition').map(t => {
    const b = t.body;
    const dst = ref(b.match(/m_DstState: ([^\n]*)/)?.[1]);
    const conditions = [...b.matchAll(/m_ConditionMode: (\d+)\s*\n\s*m_ConditionEvent: (.*)\n\s*m_EventTreshold: ([\d.e+-]+)/g)].map(c => ({ parameter: c[2].trim(), mode: Number(c[1]), op: MODES[c[1]] ?? '?', threshold: Number(c[3]) }));
    return { to: dst ? stateOf(dst.fileID)?.body.match(/^  m_Name: (.*)$/m)?.[1]?.trim() ?? null : null, exit: /m_IsExit: 1/.test(b), hasExitTime: /m_HasExitTime: 1/.test(b), exitTime: Number(b.match(/m_ExitTime: ([\d.e+-]+)/)?.[1] ?? 1), duration: Number(b.match(/m_TransitionDuration: ([\d.e+-]+)/)?.[1] ?? 0), conditions };
  });
  const machines = layers.map(l => {
    const sm = all.get(l.stateMachine);
    if (!sm) return { layer: l.name, states: [], anyState: [], defaultState: null };
    const stateIds = [...sm.body.matchAll(/- serializedVersion: \d+\s*\n\s*m_State: ([^\n]*)/g)].map(m => ref(m[1])?.fileID).filter(Boolean);
    const states = stateIds.map(id => stateOf(id)).filter(Boolean).map(s => {
      const b = s.body;
      const trIds = [...b.matchAll(/- \{fileID: (-?\d+)\}/g)].map(m => m[1]);
      return { name: b.match(/^  m_Name: (.*)$/m)?.[1]?.trim() ?? 'State', speed: Number(b.match(/m_Speed: ([\d.e+-]+)/)?.[1] ?? 1), motion: asset(ref(b.match(/m_Motion: ([^\n]*)/)?.[1])), transitions: transitionsOf(trIds), tag: b.match(/m_Tag: (.*)/)?.[1]?.trim() || null };
    });
    const anyIds = (sm.body.match(/m_AnyStateTransitions:\s*\n((?:\s*- \{fileID: -?\d+\}\n?)*)/)?.[1] ?? '').match(/-?\d+/g) ?? [];
    const defaultState = stateOf(ref(sm.body.match(/m_DefaultState: ([^\n]*)/)?.[1])?.fileID)?.body.match(/^  m_Name: (.*)$/m)?.[1]?.trim() ?? states[0]?.name ?? null;
    return { layer: l.name, states, anyState: transitionsOf(anyIds), defaultState };
  });
  return { name, parameters, layers: machines };
}

/** GDScript state machine driving an AnimationPlayer with the controller's states, parameters and conditions. */
export function controllerToGd(ctrl, { className, resolveClip = () => null } = {}) {
  const L = ctrl.layers[0] ?? { states: [], anyState: [], defaultState: null };
  const cls = className ?? `${ctrl.name.replace(/[^A-Za-z0-9]/g, '')}Animator`;
  const gdName = s => snake(s);
  const cond = c => {
    const p = ctrl.parameters.find(x => x.name === c.parameter);
    const v = gdName(c.parameter);
    if (!p) return `false # unknown parameter ${c.parameter}`;
    if (p.type === 'trigger') return `_triggers.has(&"${c.parameter}")`;
    if (p.type === 'bool') return c.mode === 1 ? v : `not ${v}`;
    return `${v} ${c.op} ${f(c.threshold)}`;
  };
  const lines = [
    `class_name ${cls}`, 'extends Node', '## Ported by ReversePort from the Unity AnimatorController "' + ctrl.name + '".', '## Same states, parameters and transition conditions; call update_state() every frame (or on parameter change),',
    '## set_trigger("Name") for triggers. Blend trees and layers beyond the first are listed in metadata/reverseport_todo.', '',
    '@export var player: AnimationPlayer', '',
    ...ctrl.parameters.filter(p => p.type !== 'trigger').map(p => `var ${gdName(p.name)}: ${p.type === 'int' ? 'int' : p.type === 'bool' ? 'bool' : 'float'} = ${p.type === 'bool' ? (p.default ? 'true' : 'false') : f(p.default)}`),
    '', 'var state: StringName = &"' + (L.defaultState ?? '') + '"', 'var _triggers: Array[StringName] = []', 'var _time_in_state := 0.0', '',
    'const CLIPS := {', ...L.states.map(s => `\t&"${s.name}": "${resolveClip(s.motion) ?? (s.motion ? `PORT: ${s.motion}` : '')}",`), '}', '',
    'func _ready() -> void:', '\tif player == null:', '\t\tplayer = get_parent().get_node_or_null("AnimationPlayer")', '\t_enter(state)', '',
    'func _process(delta: float) -> void:', '\t_time_in_state += delta', '\tupdate_state()', '',
    'func set_trigger(name: StringName) -> void:', '\tif not _triggers.has(name):', '\t\t_triggers.append(name)', '',
    'func _enter(next: StringName) -> void:', '\tstate = next', '\t_time_in_state = 0.0', '\tif player and CLIPS.has(next) and player.has_animation(CLIPS[next]):', '\t\tplayer.play(CLIPS[next])', '',
    'func _exit_time_reached(exit_time: float) -> bool:', '\tif player == null or not player.is_playing():', '\t\treturn true', '\treturn _time_in_state >= exit_time * player.current_animation_length', '',
    'func update_state() -> void:',
  ];
  const trLines = (t, indent) => {
    const parts = [...t.conditions.map(cond), ...(t.hasExitTime ? [`_exit_time_reached(${f(t.exitTime)})`] : [])];
    const target = t.exit ? (L.defaultState ?? '') : t.to;
    if (!target) return [];
    const out = [`${indent}if ${parts.length ? parts.join(' and ') : 'true'}:`, ...t.conditions.filter(c => ctrl.parameters.find(p => p.name === c.parameter)?.type === 'trigger').map(c => `${indent}\t_triggers.erase(&"${c.parameter}")`), `${indent}\t_enter(&"${target}")`, `${indent}\treturn`];
    return out;
  };
  for (const t of L.anyState) lines.push(...trLines(t, '\t'));
  lines.push('\tmatch state:');
  for (const s of L.states) {
    lines.push(`\t\t&"${s.name}":`);
    const body = s.transitions.flatMap(t => trLines(t, '\t\t\t'));
    lines.push(...(body.length ? body : ['\t\t\tpass']));
  }
  if (!L.states.length) lines.push('\t\t_:', '\t\t\tpass');
  const todo = [];
  if (ctrl.layers.length > 1) todo.push(`${ctrl.layers.length - 1} more layer(s): ${ctrl.layers.slice(1).map(l => l.layer).join(', ')} (Godot: AnimationTree with blend/add nodes, or a second player)`);
  for (const s of L.states) if (!s.motion) todo.push(`state ${s.name} has no clip (blend tree or empty): build it in an AnimationTree`);
  if (todo.length) lines.push('', `# PORT: ${todo.join('; ')}`);
  return { text: lines.join('\n') + '\n', todo, states: L.states.length, transitions: L.states.reduce((n, s) => n + s.transitions.length, L.anyState.length) };
}

/** Read a .anim or .controller from disk with GUIDs resolved through the Unity project. */
export async function readUnityAnimation(file) {
  const text = await fs.readFile(file, 'utf8');
  const root = await findUnityRoot(file);
  const guids = await unityGuidMap(root);
  const asset = r => (r?.guid ? guids.get(r.guid) ?? `guid:${r.guid}` : null);
  const ext = path.extname(file).toLowerCase();
  if (ext === '.anim') return { kind: 'unity-animation', clip: parseAnimClip(text, { asset }) };
  if (ext === '.controller') return { kind: 'unity-animator', controller: parseAnimatorController(text, { asset }) };
  throw new RPError('UNSUPPORTED_SCENE', 'Expected a .anim or .controller file.');
}
