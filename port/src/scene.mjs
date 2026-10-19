// Scene and prefab readers: Godot text scenes/resources (.tscn/.tres/project.godot, Godot 3 and 4) and
// Unity YAML (.unity/.prefab/.asset). Both become the same neutral tree: nodes with name, type, script,
// transform (position, quaternion, scale), components, children. Port writers build on that tree.
import fs from 'node:fs/promises';
import path from 'node:path';
import { RPError, requireFile, walk } from './util.mjs';

// ---------------------------------------------------------------- Godot text format
function balanceDelta(s, state) {
  let d = state.depth;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (state.inStr) { if (c === '\\') i++; else if (c === '"') state.inStr = false; continue; }
    if (c === '"') state.inStr = true;
    else if ('([{'.includes(c)) d++;
    else if (')]}'.includes(c)) d--;
  }
  state.depth = d;
  return state;
}

export function parseAttrs(s) {
  const out = {};
  let i = 0;
  while (i < s.length) {
    while (i < s.length && /\s/.test(s[i])) i++;
    const eq = s.indexOf('=', i);
    if (eq < 0) break;
    const key = s.slice(i, eq).trim();
    i = eq + 1;
    let start = i, depth = 0, inStr = false;
    for (; i < s.length; i++) {
      const c = s[i];
      if (inStr) { if (c === '\\') i++; else if (c === '"') inStr = false; continue; }
      if (c === '"') inStr = true;
      else if ('([{'.includes(c)) depth++;
      else if (')]}'.includes(c)) depth--;
      else if (/\s/.test(c) && depth === 0) break;
    }
    out[key] = s.slice(start, i);
  }
  return out;
}

/** Split Godot's text format into [heading] sections with raw key = value properties. */
export function parseGodotText(text) {
  const sections = [];
  let current = { tag: null, attrs: {}, props: {} };
  sections.push(current);
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || line.startsWith(';')) continue;
    const head = line.match(/^\[([A-Za-z_][\w]*)(.*)\]\s*$/);
    if (head) { current = { tag: head[1], attrs: parseAttrs(head[2]), props: {} }; sections.push(current); continue; }
    const kv = line.match(/^("(?:[^"\\]|\\.)*"|[^\s=]+)\s*=\s*(.*)$/);
    if (!kv) continue;
    let value = kv[2];
    const state = balanceDelta(value, { depth: 0, inStr: false });
    while ((state.depth > 0 || state.inStr) && i + 1 < lines.length) { i++; value += '\n' + lines[i]; balanceDelta('\n' + lines[i], state); }
    current.props[kv[1].replace(/^"|"$/g, '')] = value;
  }
  return sections;
}

export const unquote = v => (typeof v === 'string' && /^".*"$/s.test(v) ? v.slice(1, -1).replace(/\\"/g, '"').replace(/\\n/g, '\n') : v);
const refId = (v, kind) => { const m = String(v ?? '').match(new RegExp(`^${kind}\\(\\s*"?([^")\\s]+)"?\\s*\\)$`)); return m ? m[1] : null; };
const nums = v => (String(v).replace(/^\s*[A-Za-z_][\w]*\(/, '(').match(/-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?|-?inf|nan/gi) ?? []).map(Number);
const r4 = x => Math.round(x * 10000) / 10000;

/** Rotation matrix (rows) → quaternion [x, y, z, w]. */
export function matToQuat(m) {
  const [[m00, m01, m02], [m10, m11, m12], [m20, m21, m22]] = m;
  const tr = m00 + m11 + m22;
  let x, y, z, w;
  if (tr > 0) { const s = Math.sqrt(tr + 1) * 2; w = s / 4; x = (m21 - m12) / s; y = (m02 - m20) / s; z = (m10 - m01) / s; }
  else if (m00 > m11 && m00 > m22) { const s = Math.sqrt(1 + m00 - m11 - m22) * 2; w = (m21 - m12) / s; x = s / 4; y = (m01 + m10) / s; z = (m02 + m20) / s; }
  else if (m11 > m22) { const s = Math.sqrt(1 + m11 - m00 - m22) * 2; w = (m02 - m20) / s; x = (m01 + m10) / s; y = s / 4; z = (m12 + m21) / s; }
  else { const s = Math.sqrt(1 + m22 - m00 - m11) * 2; w = (m10 - m01) / s; x = (m02 + m20) / s; y = (m12 + m21) / s; z = s / 4; }
  const n = Math.hypot(x, y, z, w) || 1;
  const q = [x / n, y / n, z / n, w / n];
  if (q[3] < 0) for (let i = 0; i < 4; i++) q[i] = -q[i];
  return q.map(r4);
}

/** Godot Transform3D(...) text (12 numbers, basis row-major then origin) → position, rotation, scale. */
export function godotTransform(value) {
  const n = nums(value);
  if (n.length !== 12) return null;
  const rows = [[n[0], n[1], n[2]], [n[3], n[4], n[5]], [n[6], n[7], n[8]]];
  const scale = [0, 1, 2].map(c => Math.hypot(rows[0][c], rows[1][c], rows[2][c]));
  const rot = rows.map(r => r.map((v, c) => (scale[c] ? v / scale[c] : v)));
  const det = rot[0][0] * (rot[1][1] * rot[2][2] - rot[1][2] * rot[2][1]) - rot[0][1] * (rot[1][0] * rot[2][2] - rot[1][2] * rot[2][0]) + rot[0][2] * (rot[1][0] * rot[2][1] - rot[1][1] * rot[2][0]);
  if (det < 0) { scale[0] = -scale[0]; for (const r of rot) r[0] = -r[0]; }
  return { position: n.slice(9, 12).map(r4), rotation: matToQuat(rot), scale: scale.map(r4) };
}

export function parseGodotScene(text) {
  const sections = parseGodotText(text);
  const head = sections.find(s => s.tag === 'gd_scene' || s.tag === 'gd_resource');
  if (!head) throw new RPError('BAD_FORMAT', 'Not a Godot text scene or resource ([gd_scene]/[gd_resource] header missing).');
  const ext = {}, sub = {};
  for (const s of sections) {
    if (s.tag === 'ext_resource') ext[unquote(s.attrs.id)] = { type: unquote(s.attrs.type), path: unquote(s.attrs.path), uid: unquote(s.attrs.uid) };
    if (s.tag === 'sub_resource') sub[unquote(s.attrs.id)] = { type: unquote(s.attrs.type), props: s.props };
  }
  const resolve = v => { const e = refId(v, 'ExtResource'); if (e) return ext[e]?.path ?? `ExtResource(${e})`; const sr = refId(v, 'SubResource'); if (sr) return `SubResource:${sub[sr]?.type ?? 'unknown'}#${sr}`; return unquote(v); };
  const format = Number(head.attrs.format ?? 0);
  const result = { kind: head.tag === 'gd_scene' ? 'godot-scene' : 'godot-resource', engine: 'godot', godotFormat: format, godotMajor: format >= 3 ? 4 : 3, uid: unquote(head.attrs.uid) ?? null };
  result.externalResources = Object.values(ext);
  const subTypes = {};
  for (const s of Object.values(sub)) subTypes[s.type] = (subTypes[s.type] ?? 0) + 1;
  result.subResourceTypes = subTypes;
  Object.defineProperty(result, 'subResources', { value: Object.fromEntries(Object.entries(sub).map(([id, x]) => [id, x.props])), enumerable: false });
  if (head.tag === 'gd_resource') {
    const res = sections.find(s => s.tag === 'resource');
    result.resourceType = unquote(head.attrs.type);
    if (head.attrs.script_class) result.scriptClass = unquote(head.attrs.script_class);
    result.properties = Object.fromEntries(Object.entries(res?.props ?? {}).map(([k, v]) => [k, resolve(v)]));
    return result;
  }
  const byPath = new Map();
  let root = null;
  const nodes = [];
  for (const s of sections.filter(x => x.tag === 'node')) {
    const name = unquote(s.attrs.name);
    const parent = s.attrs.parent !== undefined ? unquote(s.attrs.parent) : null;
    const node = { name, type: unquote(s.attrs.type) ?? null, children: [] };
    if (s.attrs.instance) node.instance = resolve(s.attrs.instance);
    if (s.attrs.groups) node.groups = (String(s.attrs.groups).match(/"([^"]*)"/g) ?? []).map(unquote);
    const props = { ...s.props };
    if (props.script) { node.script = resolve(props.script); delete props.script; }
    if (props.transform) { const t = godotTransform(props.transform); if (t) node.transform = t; delete props.transform; }
    for (const k of ['position', 'rotation', 'scale']) if (props[k] && !node.transform && /^Vector2\(/.test(props[k])) { node.transform2d = node.transform2d ?? {}; node.transform2d[k] = nums(props[k]).map(r4); delete props[k]; }
    if (props.rotation && !/^Vector/.test(props.rotation)) { node.transform2d = node.transform2d ?? {}; node.transform2d.rotation = r4(Number(props.rotation)); delete props.rotation; }
    const keep = Object.entries(props).slice(0, 24).map(([k, v]) => [k, resolve(v.length > 200 ? v.slice(0, 200) + '…' : v)]);
    if (keep.length) node.properties = Object.fromEntries(keep);
    if (parent === null) { if (root) throw new RPError('BAD_FORMAT', 'Scene has two root nodes'); root = node; node.path = '.'; byPath.set('.', node); }
    else {
      const parentNode = byPath.get(parent === '.' ? '.' : parent);
      node.path = parent === '.' ? name : `${parent}/${name}`;
      byPath.set(node.path, node);
      (parentNode ?? root)?.children.push(node);
      if (!parentNode) node.orphanParent = parent;
    }
    nodes.push(node);
  }
  result.root = root;
  result.nodeCount = nodes.length;
  result.connections = sections.filter(s => s.tag === 'connection').map(s => ({ signal: unquote(s.attrs.signal), from: unquote(s.attrs.from), to: unquote(s.attrs.to), method: unquote(s.attrs.method) }));
  return result;
}

/** project.godot → name, main scene, version features, autoloads, input actions. */
export function parseGodotProject(text) {
  const sections = parseGodotText(text);
  const get = (tag, key) => sections.find(s => s.tag === tag)?.props[key];
  const cfgVersion = Number(sections[0]?.props.config_version ?? 0);
  const features = (String(get('application', 'config/features') ?? '').match(/"([^"]*)"/g) ?? []).map(unquote);
  const autoload = Object.entries(sections.find(s => s.tag === 'autoload')?.props ?? {}).map(([name, v]) => ({ name, path: unquote(v).replace(/^\*/, ''), singleton: unquote(v).startsWith('*') }));
  const inputActions = Object.keys(sections.find(s => s.tag === 'input')?.props ?? {});
  return {
    name: unquote(get('application', 'config/name')) ?? null,
    mainScene: unquote(get('application', 'run/main_scene')) ?? null,
    godotMajor: cfgVersion >= 5 ? 4 : cfgVersion === 4 ? 3 : null,
    version: features.find(f => /^\d+\.\d+$/.test(f)) ?? null,
    renderer: features.find(f => /Forward|Mobile|GL Compatibility/i.test(f)) ?? unquote(get('rendering', 'renderer/rendering_method')) ?? null,
    dotnet: features.includes('C#') || !!sections.find(s => s.tag === 'dotnet'),
    autoload, inputActions,
    physicsTicks: Number(get('physics', 'common/physics_ticks_per_second') ?? 60),
  };
}

// ---------------------------------------------------------------- Unity YAML
const BUILTIN_MESHES = { 10202: 'Cube', 10206: 'Cylinder', 10207: 'Sphere', 10208: 'Capsule', 10209: 'Plane', 10210: 'Quad' };
const guidCache = new Map();

export async function findUnityRoot(file) {
  let dir = path.dirname(path.resolve(file));
  for (let i = 0; i < 30; i++) {
    try { await fs.access(path.join(dir, 'Assets')); await fs.access(path.join(dir, 'ProjectSettings')); return dir; } catch { /* up */ }
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return null;
}

/** guid → asset path for a Unity project (from the .meta files). */
export async function unityGuidMap(root) {
  if (!root) return new Map();
  if (guidCache.has(root)) return guidCache.get(root);
  const map = new Map();
  for (const sub of ['Assets', 'Packages']) {
    const base = path.join(root, sub);
    const { files } = await walk(base, { maxFiles: 200000 }).catch(() => ({ files: [] }));
    for (const f of files) {
      if (f.ext !== '.meta') continue;
      const fh = await fs.open(f.abs, 'r');
      try {
        const buf = Buffer.alloc(256);
        const { bytesRead } = await fh.read(buf, 0, 256, 0);
        const m = buf.toString('utf8', 0, bytesRead).match(/guid:\s*([0-9a-f]{32})/);
        if (m) map.set(m[1], `${sub}/${f.rel.replace(/\.meta$/, '')}`);
      } finally { await fh.close(); }
    }
  }
  guidCache.set(root, map);
  return map;
}

const ref = v => { const m = String(v ?? '').match(/fileID:\s*(-?\d+)(?:,\s*guid:\s*([0-9a-f]{32}))?/); return m ? { fileID: m[1], guid: m[2] ?? null } : null; };
const vec = v => { const o = {}; for (const m of String(v ?? '').matchAll(/([xyzw]):\s*(-?[\d.]+(?:e[-+]?\d+)?)/gi)) o[m[1]] = Number(m[2]); return o; };

function unityDocs(text) {
  const parts = text.split(/^--- !u!(\d+) &(-?\d+)( stripped)?[^\n]*$/m);
  const docs = [];
  for (let i = 1; i + 3 < parts.length; i += 4) {
    const body = parts[i + 3] ?? '';
    const lines = body.split(/\r?\n/).filter(l => l.length);
    const type = (lines[0] ?? '').replace(/:\s*$/, '').trim();
    const props = {}, lists = {};
    let listKey = null;
    for (const l of lines.slice(1)) {
      const top = l.match(/^ {2}([A-Za-z_][\w]*):\s?(.*)$/);
      if (top) { props[top[1]] = top[2]; listKey = top[2] === '' ? top[1] : null; if (listKey) lists[listKey] = []; continue; }
      if (listKey) { const item = l.match(/^ {2,}- (.*)$/); if (item) lists[listKey].push(item[1]); else if (!/^ {4,}/.test(l)) listKey = null; else lists[listKey].push(l.trim()); }
    }
    docs.push({ classId: Number(parts[i]), fileID: parts[i + 1], stripped: !!parts[i + 2], type, props, lists, body });
  }
  return docs;
}

export async function parseUnityYaml(text, file) {
  if (!/^%YAML[^\n]*\n%TAG !u! tag:unity3d\.com/.test(text)) throw new RPError('BAD_FORMAT', 'Not a Unity YAML file (save assets as Force Text: Project Settings → Editor → Asset Serialization).');
  const root = await findUnityRoot(file);
  const guids = await unityGuidMap(root);
  const asset = r => (r?.guid ? (r.guid === '0000000000000000e000000000000000' ? `builtin:${BUILTIN_MESHES[r.fileID] ?? r.fileID}` : guids.get(r.guid) ?? `guid:${r.guid}`) : null);
  const docs = unityDocs(text);
  const byId = new Map(docs.map(d => [d.fileID, d]));
  const gos = new Map(), transforms = new Map();
  for (const d of docs) {
    if (d.type === 'GameObject') gos.set(d.fileID, d);
    if (d.type === 'Transform' || d.type === 'RectTransform') transforms.set(d.fileID, d);
  }
  const prefabName = d => {
    const mods = d.body.match(/propertyPath: m_Name\s*\n\s*value: ([^\n]*)/);
    const src = asset(ref(d.props.m_SourcePrefab ?? d.body.match(/m_SourcePrefab: ([^\n]*)/)?.[1]));
    const mod = key => { const m = d.body.match(new RegExp(`propertyPath: ${key.replace('.', '\\.')}\\s*\\n\\s*value: (-?[\\d.e+-]+)`)); return m ? Number(m[1]) : null; };
    const pick = (k, axes, def) => axes.map((a, i) => mod(`${k}.${a}`) ?? def[i]);
    const transform = { position: pick('m_LocalPosition', ['x', 'y', 'z'], [0, 0, 0]).map(r4), rotation: pick('m_LocalRotation', ['x', 'y', 'z', 'w'], [0, 0, 0, 1]).map(r4), scale: pick('m_LocalScale', ['x', 'y', 'z'], [1, 1, 1]).map(r4) };
    return { name: mods?.[1]?.trim() || (src ? path.basename(src).replace(/\.prefab$/, '') : 'Prefab'), source: src, transform };
  };
  const component = c => {
    const out = { type: c.type };
    if (c.type === 'MonoBehaviour') { const s = asset(ref(c.props.m_Script)); out.script = s; const fields = Object.entries(c.props).filter(([k]) => !k.startsWith('m_')).slice(0, 30); if (fields.length) out.fields = Object.fromEntries(fields); }
    if (c.type === 'MeshFilter') out.mesh = asset(ref(c.props.m_Mesh));
    if (c.type === 'MeshRenderer' || c.type === 'SkinnedMeshRenderer') { out.materials = (c.lists.m_Materials ?? []).map(m => asset(ref(m))).filter(Boolean); if (c.type === 'SkinnedMeshRenderer') out.mesh = asset(ref(c.props.m_Mesh)); }
    if (c.type === 'Camera') { out.fieldOfView = Number(c.props['field of view'] ?? c.body.match(/field of view: ([\d.]+)/)?.[1] ?? 60); out.orthographic = c.props.orthographic === '1'; }
    if (c.type === 'Light') out.lightType = ['Spot', 'Directional', 'Point', 'Area'][Number(c.props.m_Type)] ?? c.props.m_Type;
    if (/Collider$/.test(c.type)) { out.isTrigger = c.props.m_IsTrigger === '1'; if (c.props.m_Size) out.size = vec(c.props.m_Size); if (c.props.m_Radius) out.radius = Number(c.props.m_Radius); if (c.props.m_Height) out.height = Number(c.props.m_Height); if (c.props.m_Center) out.center = vec(c.props.m_Center); }
    if (c.type === 'CharacterController') { out.radius = Number(c.props.m_Radius ?? 0.5); out.height = Number(c.props.m_Height ?? 2); }
    if (c.type === 'Rigidbody') { out.mass = Number(c.props.m_Mass ?? 1); out.isKinematic = c.props.m_IsKinematic === '1'; out.useGravity = c.props.m_UseGravity !== '0'; }
    if (c.type === 'AudioSource') out.clip = asset(ref(c.props.m_audioClip));
    if (c.type === 'Animator') out.controller = asset(ref(c.props.m_Controller));
    // uGUI
    if (c.type === 'Canvas') { out.renderMode = ['overlay', 'camera', 'world'][Number(c.props.m_RenderMode)] ?? 'overlay'; }
    if (c.type === 'CanvasScaler') { out.referenceResolution = vec(c.props.m_ReferenceResolution); out.scaleMode = Number(c.props.m_UiScaleMode ?? 0); }
    if (c.type === 'CanvasGroup') out.alpha = Number(c.props.m_Alpha ?? 1);
    if (c.type === 'MonoBehaviour') {
      const n = c.body;
      const ui = n.match(/^  m_(Sprite|Texture|Text|text|OnClick|MinValue|IsOn|Content|Spacing|FontData|fontSize|HorizontalFit|Alpha|Padding|TargetGraphic|ReferenceResolution|RenderMode|CellSize|ShowMaskGraphic|ChildAlignment|Interactable|Navigation|TextComponent|Transition)\b/m);
      if (ui) {
        const num = k => { const m = n.match(new RegExp(`^  ${k}: (-?[\\d.e+-]+)`, 'm')); return m ? Number(m[1]) : undefined; };
        const str = k => n.match(new RegExp(`^  ${k}: ['"]?([^\\n]*?)['"]?$`, 'm'))?.[1];
        const color = k => { const m = n.match(new RegExp(`^  ${k}: \\{r: ([\\d.e+-]+), g: ([\\d.e+-]+), b: ([\\d.e+-]+), a: ([\\d.e+-]+)\\}`, 'm')); return m ? m.slice(1, 5).map(Number) : undefined; };
        const sprite = n.match(/^  m_Sprite: ([^\n]*)/m)?.[1], texture = n.match(/^  m_Texture: ([^\n]*)/m)?.[1];
        const u = {};
        if (/^  m_text:/m.test(n) && /^  m_fontSize:/m.test(n)) { u.widget = 'TextMeshPro'; u.text = (n.match(/^  m_text: ([\s\S]*?)\n  m_isRightToLeft:/m)?.[1] ?? str('m_text') ?? '').replace(/^['"]|['"]$/g, '').replace(/\\n/g, '\n').replace(/\n\s{4}/g, '\n'); u.fontSize = num('m_fontSize'); u.color = color('m_fontColor'); u.alignment = num('m_textAlignment'); }
        else if (/^  m_Text:/m.test(n) && /^  m_FontData:/m.test(n)) { u.widget = 'Text'; u.text = (str('m_Text') ?? '').replace(/\\n/g, '\n'); u.fontSize = Number(n.match(/m_FontSize: (\d+)/)?.[1] ?? 14); u.color = color('m_Color'); u.alignment = Number(n.match(/m_Alignment: (\d+)/)?.[1] ?? 0); }
        else if (/^  m_Text:/m.test(n) && /^  m_TextComponent:/m.test(n)) { u.widget = 'InputField'; u.text = str('m_Text') ?? ''; }
        else if (/^  m_OnClick:/m.test(n)) { u.widget = 'Button'; u.onClick = [...n.matchAll(/m_Target: \{fileID: (\d+)\}[\s\S]*?m_MethodName: (\w+)/g)].map(m => ({ target: m[1], method: m[2] })); }
        else if (/^  m_MinValue:/m.test(n) && /^  m_Direction:/m.test(n)) { u.widget = 'Slider'; u.min = num('m_MinValue'); u.max = num('m_MaxValue'); u.value = num('m_Value'); u.wholeNumbers = /m_WholeNumbers: 1/.test(n); u.vertical = (num('m_Direction') ?? 0) >= 2; }
        else if (/^  m_IsOn:/m.test(n)) { u.widget = 'Toggle'; u.isOn = /m_IsOn: 1/.test(n); }
        else if (/^  m_Content:/m.test(n) && /^  m_Horizontal:/m.test(n)) { u.widget = 'ScrollRect'; }
        else if (/^  m_Spacing:/m.test(n) && /^  m_Padding:/m.test(n)) { u.widget = /m_CellSize/.test(n) ? 'GridLayoutGroup' : /m_ChildForceExpandWidth/.test(n) && c.props.m_Script && /vertical/i.test(String(c.props.m_Script)) ? 'VerticalLayoutGroup' : 'LayoutGroup'; u.spacing = num('m_Spacing') ?? (n.match(/m_Spacing: \{x: ([\d.]+), y: ([\d.]+)\}/) ? Number(n.match(/m_Spacing: \{x: ([\d.]+)/)[1]) : 0); u.constraintCount = num('m_ConstraintCount'); }
        else if (/^  m_ShowMaskGraphic:/m.test(n)) u.widget = 'Mask';
        else if (/^  m_ReferenceResolution:/m.test(n)) { u.widget = 'CanvasScaler'; u.referenceResolution = vec(n.match(/^  m_ReferenceResolution: ([^\n]*)/m)?.[1]); u.scaleMode = num('m_UiScaleMode'); }
        else if (texture !== undefined && /^  m_UVRect:/m.test(n)) { u.widget = 'RawImage'; u.texture = asset(ref(texture)); u.color = color('m_Color'); }
        else if (sprite !== undefined && /^  m_Type:/m.test(n)) { u.widget = 'Image'; u.sprite = asset(ref(sprite)); u.color = color('m_Color'); u.imageType = ['simple', 'sliced', 'tiled', 'filled'][num('m_Type') ?? 0]; u.preserveAspect = /m_PreserveAspect: 1/.test(n); }
        if (u.widget) { out.ui = u; }
      }
    }
    return out;
  };
  // Prefab instance overrides beyond name and transform.
  const overridesOf = d => [...d.body.matchAll(/- target: \{fileID: (-?\d+)(?:, guid: ([0-9a-f]{32}))?[^}]*\}\s*\n\s*propertyPath: ([^\n]+)\n\s*value: ([^\n]*)\n\s*objectReference: ([^\n]*)/g)]
    .filter(m => !/^m_(Name|LocalPosition|LocalRotation|LocalScale|LocalEulerAnglesHint|RootOrder)\b/.test(m[3]))
    .map(m => ({ property: m[3].trim(), value: m[4].trim(), ...(ref(m[5]) && ref(m[5]).fileID !== '0' ? { reference: asset(ref(m[5])) ?? m[5].trim() } : {}) }))
    .slice(0, 100);
  const nodeFor = (tId, seen = new Set()) => {
    if (seen.has(tId)) return null;
    seen.add(tId);
    const t = transforms.get(tId);
    if (!t) return null;
    if (t.stripped) {
      const pi = byId.get(ref(t.props.m_PrefabInstance)?.fileID);
      const pn = pi ? prefabName(pi) : { name: 'Prefab', source: null };
      const ov = pi ? overridesOf(pi) : [];
      return { name: pn.name, type: 'PrefabInstance', prefab: pn.source, ...(pn.transform ? { transform: pn.transform } : {}), ...(ov.length ? { overrides: ov } : {}), children: [] };
    }
    const go = gos.get(ref(t.props.m_GameObject)?.fileID);
    const p = vec(t.props.m_LocalPosition), q = vec(t.props.m_LocalRotation), s = vec(t.props.m_LocalScale);
    const comps = (go?.lists.m_Component ?? []).map(l => byId.get(ref(l)?.fileID)).filter(Boolean).filter(c => c.type !== 'Transform' && c.type !== 'RectTransform').map(component);
    const node = {
      name: go?.props.m_Name?.trim() || '(unnamed)', type: 'GameObject',
      transform: { position: [p.x ?? 0, p.y ?? 0, p.z ?? 0].map(r4), rotation: [q.x ?? 0, q.y ?? 0, q.z ?? 0, q.w ?? 1].map(r4), scale: [s.x ?? 1, s.y ?? 1, s.z ?? 1].map(r4) },
      ...(t.type === 'RectTransform' ? { ui: true, rect: { anchorMin: vec(t.props.m_AnchorMin), anchorMax: vec(t.props.m_AnchorMax), anchoredPosition: vec(t.props.m_AnchoredPosition), sizeDelta: vec(t.props.m_SizeDelta), pivot: vec(t.props.m_Pivot) } } : {}),
      ...(go?.props.m_TagString && go.props.m_TagString !== 'Untagged' ? { tag: go.props.m_TagString } : {}),
      ...(go?.props.m_IsActive === '0' ? { active: false } : {}),
      components: comps, children: [],
    };
    for (const c of t.lists.m_Children ?? []) { const child = nodeFor(ref(c)?.fileID, seen); if (child) node.children.push(child); }
    return node;
  };
  const roots = [];
  for (const [id, t] of transforms) if (!t.stripped && ref(t.props.m_Father)?.fileID === '0') { const n = nodeFor(id); if (n) roots.push(n); }
  // Prefab instances whose parent is the scene root
  for (const d of docs.filter(x => x.type === 'PrefabInstance')) {
    const parent = d.body.match(/m_TransformParent: ([^\n]*)/)?.[1];
    if (ref(parent)?.fileID === '0') { const pn = prefabName(d); const ov = overridesOf(d); roots.push({ name: pn.name, type: 'PrefabInstance', prefab: pn.source, transform: pn.transform, ...(ov.length ? { overrides: ov } : {}), children: [] }); }
  }
  const count = n => 1 + n.children.reduce((s, c) => s + count(c), 0);
  const ext = path.extname(file).toLowerCase();
  const compTypes = {};
  for (const d of docs) if (!['GameObject', 'Transform', 'RectTransform', 'PrefabInstance'].includes(d.type)) compTypes[d.type] = (compTypes[d.type] ?? 0) + 1;
  const isScene = ext === '.unity';
  const rootNode = !isScene && roots.length === 1 ? roots[0] : { name: path.basename(file, ext), type: isScene ? 'Scene' : 'Root', children: roots, components: [] };
  const scripts = [...new Set(docs.filter(d => d.type === 'MonoBehaviour').map(d => asset(ref(d.props.m_Script))).filter(Boolean))];
  return { kind: isScene ? 'unity-scene' : ext === '.prefab' ? 'unity-prefab' : 'unity-asset', engine: 'unity', unityProject: root, root: rootNode, nodeCount: count(rootNode), componentTypes: compTypes, scripts, unresolvedGuids: scripts.filter(s => s.startsWith('guid:')).length };
}

// ---------------------------------------------------------------- public
export function sceneMermaid(root, max = 120) {
  const lines = ['graph TD'];
  let n = 0;
  const id = new Map();
  const label = node => `${node.name}${node.type ? `<br/><small>${node.type}</small>` : ''}`.replace(/"/g, "'");
  const visit = (node, parent) => {
    if (n >= max) return;
    const me = `n${n++}`;
    id.set(node, me);
    lines.push(`  ${me}["${label(node)}"]`);
    if (parent) lines.push(`  ${parent} --> ${me}`);
    for (const c of node.children ?? []) visit(c, me);
  };
  if (root) visit(root, null);
  if (n >= max) lines.push(`  more["… more nodes"]`);
  return lines.join('\n');
}

export async function readScene(file) {
  const { abs } = await requireFile(file, 'scene');
  const text = await fs.readFile(abs, 'utf8');
  const ext = path.extname(abs).toLowerCase();
  let scene;
  if (/^﻿?\[gd_(scene|resource)/.test(text)) scene = parseGodotScene(text);
  else if (/^%YAML/.test(text)) scene = await parseUnityYaml(text, abs);
  else if (ext === '.godot' || /^; Engine configuration file/.test(text)) return { file: abs, kind: 'godot-project', engine: 'godot', project: parseGodotProject(text) };
  else throw new RPError('UNSUPPORTED_SCENE', 'Supported: Godot .tscn/.tres/.scn-as-text, project.godot, Unity .unity/.prefab/.asset saved as text. Binary Godot .scn/.res: open in the editor and save as .tscn first.');
  return { file: abs, ...scene, ...(scene.root ? { mermaid: sceneMermaid(scene.root) } : {}) };
}
