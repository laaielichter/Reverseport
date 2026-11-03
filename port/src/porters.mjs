// Deterministic generators: scene conversion between engines (Godot .tscn ⇄ Unity scene specs, three.js
// builder modules, Unreal scene specs) and project scaffolds for the target engine. Generated output is a
// starting point an agent or a person finishes; every guess is marked in the file.
import path from 'node:path';
import { convertTree } from './convert.mjs';
import { quatToMat } from './convert.mjs';
import { pascalCase, camelCase } from './util.mjs';

const f = n => { const r = Math.round(n * 1e6) / 1e6; return Object.is(r, -0) ? '0' : String(r); };
const q = s => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

// ---------------------------------------------------------------- neutral node helpers
const PRIMITIVES_FROM_UNITY = { Cube: 'box', Sphere: 'sphere', Capsule: 'capsule', Cylinder: 'cylinder', Plane: 'plane', Quad: 'quad' };
const GODOT_MESHES = { BoxMesh: 'box', SphereMesh: 'sphere', CapsuleMesh: 'capsule', CylinderMesh: 'cylinder', PlaneMesh: 'plane', QuadMesh: 'quad' };
const GODOT_SHAPES = { BoxShape3D: 'box', SphereShape3D: 'sphere', CapsuleShape3D: 'capsule', CylinderShape3D: 'cylinder' };
const nums = v => (String(v ?? '').replace(/^\s*[A-Za-z_]\w*\(/, '(').match(/-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) ?? []).map(Number);

const subId = v => String(v ?? '').match(/#(.+)$/)?.[1] ?? null;
const subsFor = (n, subResources) => ({ mesh: subResources[subId(n.properties?.mesh)] ?? {}, shape: subResources[subId(n.properties?.shape)] ?? {} });

/** Godot node → neutral roles (body, collider, mesh, camera, light, audio). */
function godotRoles(node, sub) {
  const roles = {};
  const t = node.type;
  if (t === 'CharacterBody3D') roles.body = 'character';
  if (t === 'RigidBody3D') roles.body = 'rigid';
  if (t === 'StaticBody3D') roles.body = 'static';
  if (t === 'Area3D') roles.body = 'trigger';
  if (t === 'Camera3D') roles.camera = { fov: Number(node.properties?.fov ?? 75) };
  if (/^(Directional|Omni|Spot)Light3D$/.test(t ?? '')) roles.light = { DirectionalLight3D: 'directional', OmniLight3D: 'point', SpotLight3D: 'spot' }[t];
  if (t === 'AudioStreamPlayer3D' || t === 'AudioStreamPlayer') roles.audio = { spatial: t.endsWith('3D') };
  const subRef = v => { const m = String(v ?? '').match(/^SubResource:(\w+)/); return m ? m[1] : null; };
  if (t === 'MeshInstance3D') {
    const kind = GODOT_MESHES[subRef(node.properties?.mesh)];
    roles.mesh = kind ? { primitive: kind, ...godotPrimitiveSize(kind, sub?.mesh) } : { asset: node.properties?.mesh ?? null };
  }
  if (t === 'CollisionShape3D') {
    const kind = GODOT_SHAPES[subRef(node.properties?.shape)];
    roles.collider = kind ? { shape: kind, ...godotPrimitiveSize(kind, sub?.shape) } : { shape: 'unknown' };
  }
  return roles;
}
function godotPrimitiveSize(kind, props = {}) {
  const v = k => (props[k] != null ? nums(props[k]) : null);
  if (kind === 'box') return { size: v('size') ?? [1, 1, 1] };
  if (kind === 'sphere') return { radius: Number(props.radius ?? 0.5) };
  if (kind === 'capsule' || kind === 'cylinder') return { radius: Number(props.radius ?? props.top_radius ?? 0.5), height: Number(props.height ?? 2) };
  if (kind === 'plane') return { size: v('size') ?? [2, 2] };
  if (kind === 'quad') return { size: v('size') ?? [1, 1] };
  return {};
}

/** Unity components → neutral roles. */
function unityRoles(node) {
  const roles = {};
  const has = t => node.components?.find(c => c.type === t);
  const rb = has('Rigidbody'), cc = has('CharacterController');
  const colliders = (node.components ?? []).filter(c => /Collider$/.test(c.type) && c.type !== 'CharacterController');
  if (cc) roles.body = 'character';
  else if (rb) roles.body = rb.isKinematic ? 'kinematic' : 'rigid';
  else if (colliders.some(c => c.isTrigger)) roles.body = 'trigger';
  else if (colliders.length) roles.body = 'static';
  roles.colliders = colliders.map(c => ({ shape: { BoxCollider: 'box', SphereCollider: 'sphere', CapsuleCollider: 'capsule', MeshCollider: 'mesh' }[c.type] ?? 'unknown', size: c.size ? [c.size.x ?? 1, c.size.y ?? 1, c.size.z ?? 1] : undefined, radius: c.radius, height: c.height, center: c.center ? [c.center.x ?? 0, c.center.y ?? 0, c.center.z ?? 0] : undefined }));
  if (cc) roles.colliders.push({ shape: 'capsule', radius: cc.radius, height: cc.height });
  const mf = has('MeshFilter') ?? has('SkinnedMeshRenderer');
  if (mf?.mesh) { const prim = PRIMITIVES_FROM_UNITY[String(mf.mesh).replace(/^builtin:/, '')]; roles.mesh = prim ? { primitive: prim, ...(prim === 'plane' ? { size: [10, 10] } : prim === 'capsule' || prim === 'cylinder' ? { radius: 0.5, height: 2 } : prim === 'sphere' ? { radius: 0.5 } : prim === 'quad' ? { size: [1, 1] } : { size: [1, 1, 1] }) } : { asset: mf.mesh }; }
  const cam = has('Camera'); if (cam) roles.camera = { fov: cam.fieldOfView ?? 60 };
  const light = has('Light'); if (light) roles.light = { Directional: 'directional', Point: 'point', Spot: 'spot' }[light.lightType] ?? 'point';
  const audio = has('AudioSource'); if (audio) roles.audio = { spatial: true, clip: audio.clip };
  roles.scripts = (node.components ?? []).filter(c => c.type === 'MonoBehaviour' && c.script && !c.ui).map(c => c.script);
  const anim = has('Animator'); if (anim) roles.animator = anim.controller ?? null;
  const widgets = (node.components ?? []).filter(c => c.ui).map(c => c.ui);
  if (node.ui || widgets.length || has('Canvas')) roles.ui = { canvas: !!has('Canvas'), widgets, group: has('CanvasGroup') ?? null };
  return roles;
}

// ---------------------------------------------------------------- uGUI → Control
const UI_ALIGN_H = { 0: 0, 1: 1, 2: 2, 3: 0, 4: 1, 5: 2, 6: 0, 7: 1, 8: 2 }; // Unity TextAnchor → HORIZONTAL_ALIGNMENT
const UI_ALIGN_V = { 0: 0, 1: 0, 2: 0, 3: 1, 4: 1, 5: 1, 6: 2, 7: 2, 8: 2 };
const TMP_ALIGN = a => ({ h: [1, 2, 4, 8].findIndex(b => a & b) === -1 ? 0 : { 1: 0, 2: 1, 4: 2, 8: 3 }[[1, 2, 4, 8].find(b => a & b)], v: { 256: 0, 512: 1, 1024: 2 }[[256, 512, 1024].find(b => a & b)] ?? 0 });
const color4 = c => `Color(${c.map(f).join(', ')})`;
/** Godot anchors/offsets from a Unity RectTransform (Y flipped), plus widget properties. */
function uiProps(node, roles, todo, addExt, resolve) {
  const out = [];
  const r = node.rect;
  const canvas = roles.ui.canvas;
  if (canvas) {
    out.push('anchors_preset = 15', 'anchor_right = 1.0', 'anchor_bottom = 1.0', 'grow_horizontal = 2', 'grow_vertical = 2', 'mouse_filter = 2');
    const scaler = roles.ui.widgets.find(w => w.widget === 'CanvasScaler');
    if (scaler?.referenceResolution?.x) todo.push(`Canvas scaler reference ${scaler.referenceResolution.x}x${scaler.referenceResolution.y}: set display/window/size to it and stretch mode canvas_items in Project Settings`);
  } else if (r) {
    const aMin = r.anchorMin, aMax = r.anchorMax, ap = r.anchoredPosition, sd = r.sizeDelta, pv = r.pivot;
    const offMin = { x: (ap.x ?? 0) - (sd.x ?? 0) * (pv.x ?? 0.5), y: (ap.y ?? 0) - (sd.y ?? 0) * (pv.y ?? 0.5) };
    const offMax = { x: (ap.x ?? 0) + (sd.x ?? 0) * (1 - (pv.x ?? 0.5)), y: (ap.y ?? 0) + (sd.y ?? 0) * (1 - (pv.y ?? 0.5)) };
    const vals = { anchor_left: aMin.x ?? 0, anchor_top: 1 - (aMax.y ?? 0), anchor_right: aMax.x ?? 0, anchor_bottom: 1 - (aMin.y ?? 0), offset_left: offMin.x, offset_top: -offMax.y, offset_right: offMax.x, offset_bottom: -offMin.y };
    for (const [k, v] of Object.entries(vals)) if (Math.abs(v) > 1e-9) out.push(`${k} = ${f(v)}`);
    if (Math.abs((aMin.x ?? 0) - 0) < 1e-9 && Math.abs((aMax.x ?? 0) - 1) < 1e-9) out.push('grow_horizontal = 2');
    if (Math.abs((aMin.y ?? 0) - 0) < 1e-9 && Math.abs((aMax.y ?? 0) - 1) < 1e-9) out.push('grow_vertical = 2');
    if (pv.x !== undefined && (Math.abs(pv.x - 0.5) > 1e-6 || Math.abs((pv.y ?? 0.5) - 0.5) > 1e-6)) out.push(`pivot_offset = Vector2(${f((pv.x ?? 0.5) * (sd.x ?? 0))}, ${f((1 - (pv.y ?? 0.5)) * (sd.y ?? 0))})`);
    const t = node.transform;
    if (t?.scale && (Math.abs(t.scale[0] - 1) > 1e-6 || Math.abs(t.scale[1] - 1) > 1e-6)) out.push(`scale = Vector2(${f(t.scale[0])}, ${f(t.scale[1])})`);
    if (t?.rotation) { const [x, y, z, w] = t.rotation; const ang = Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z)); if (Math.abs(ang) > 1e-6) out.push(`rotation = ${f(-ang)}`); }
  }
  for (const w of roles.ui.widgets) {
    if (w.widget === 'Image' || w.widget === 'RawImage') {
      const src = w.sprite ?? w.texture; const res = src ? resolve(src) : null;
      if (res) out.push(`texture = ExtResource("${addExt('Texture2D', res)}")`); else if (src) todo.push(`texture ${src} not ported yet`);
      out.push('expand_mode = 1', `stretch_mode = ${w.preserveAspect ? 5 : w.imageType === 'tiled' ? 1 : 1}`);
      if (w.color && w.color.some((c, i) => Math.abs(c - 1) > 1e-6)) out.push(`modulate = ${color4(w.color)}`);
      if (w.imageType === 'filled') todo.push('Unity filled Image: use a TextureProgressBar (fill_mode) or a shader for the fill amount');
      if (w.imageType === 'sliced') todo.push('Unity sliced Image: use NinePatchRect with the sprite borders');
    }
    if (w.widget === 'Text' || w.widget === 'TextMeshPro') {
      out.push(`text = ${q(w.text ?? '')}`);
      if (w.fontSize) out.push(`theme_override_font_sizes/font_size = ${Math.round(w.fontSize)}`);
      if (w.color && w.color.some((c, i) => Math.abs(c - 1) > 1e-6)) out.push(`theme_override_colors/font_color = ${color4(w.color)}`);
      const al = w.widget === 'Text' ? { h: UI_ALIGN_H[w.alignment] ?? 0, v: UI_ALIGN_V[w.alignment] ?? 0 } : TMP_ALIGN(w.alignment ?? 257);
      if (al.h) out.push(`horizontal_alignment = ${al.h}`);
      if (al.v) out.push(`vertical_alignment = ${al.v}`);
      out.push('autowrap_mode = 3');
    }
    if (w.widget === 'Button') {
      const label = (node.children ?? []).flatMap(c => (c.components ?? []).map(x => x.ui).filter(Boolean)).find(u => u.widget === 'Text' || u.widget === 'TextMeshPro');
      if (label?.text) out.push(`text = ${q(label.text)}`);
      if (w.onClick?.length) todo.push(`OnClick → ${w.onClick.map(c => c.method).join(', ')}: connect the pressed signal to the ported method`);
    }
    if (w.widget === 'Slider') { out.push(`min_value = ${f(w.min ?? 0)}`, `max_value = ${f(w.max ?? 1)}`, `value = ${f(w.value ?? 0)}`, `step = ${w.wholeNumbers ? 1 : 0.001}`); }
    if (w.widget === 'Toggle' && w.isOn) out.push('button_pressed = true');
    if (w.widget === 'InputField') out.push(`text = ${q(w.text ?? '')}`);
    if (w.widget === 'GridLayoutGroup') { out.push(`columns = ${Math.max(1, w.constraintCount ?? 2)}`); if (w.spacing) out.push(`theme_override_constants/h_separation = ${f(w.spacing)}`, `theme_override_constants/v_separation = ${f(w.spacing)}`); }
    if (w.widget === 'VerticalLayoutGroup' || w.widget === 'LayoutGroup') { if (w.spacing) out.push(`theme_override_constants/separation = ${f(w.spacing)}`); }
    if (w.widget === 'Mask') out.push('clip_contents = true');
  }
  if (roles.ui.group && roles.ui.group.alpha !== undefined && Math.abs(roles.ui.group.alpha - 1) > 1e-6) out.push(`modulate = Color(1, 1, 1, ${f(roles.ui.group.alpha)})`);
  if (node.active === false) out.push('visible = false');
  return out;
}

// ---------------------------------------------------------------- → Godot .tscn
/**
 * Write a Godot 4 text scene from a neutral tree that is already in Godot coordinates.
 * resolve(scriptOrPrefabSourcePath) → res:// path of the ported file (or null).
 */
export function writeTscn(root, { engine = 'unity', resolve = () => null, animator = () => null, name } = {}) {
  const ext = [], subs = [], nodes = [];
  const extId = new Map();
  const addExt = (type, p) => { const k = `${type}:${p}`; if (!extId.has(k)) { const id = `${ext.length + 1}_rp`; extId.set(k, id); ext.push(`[ext_resource type="${type}" path=${q(p)} id="${id}"]`); } return extId.get(k); };
  const addSub = (type, props) => { const id = `${type}_${subs.length + 1}`; subs.push([`[sub_resource type="${type}" id="${id}"]`, ...Object.entries(props).map(([k, v]) => `${k} = ${v}`)].join('\n')); return id; };
  const tf = t => { if (!t) return null; const m = quatToMat(t.rotation ?? [0, 0, 0, 1]); const s = t.scale ?? [1, 1, 1]; const r = m.map(row => row.map((v, c) => v * s[c])); return `Transform3D(${[...r.flat(), ...(t.position ?? [0, 0, 0])].map(f).join(', ')})`; };
  const isIdentity = t => !t || (t.position.every(v => Math.abs(v) < 1e-9) && Math.abs(t.rotation[3]) > 0.9999999 && t.scale.every(v => Math.abs(v - 1) < 1e-9));
  const used = new Map();
  const uniq = (parentPath, n) => { const k = `${parentPath}/${n}`; const c = used.get(k) ?? 0; used.set(k, c + 1); return c ? `${n}${c + 1}` : n; };
  const meshSub = m => {
    if (m.primitive === 'box') return addSub('BoxMesh', { size: `Vector3(${(m.size ?? [1, 1, 1]).map(f).join(', ')})` });
    if (m.primitive === 'sphere') return addSub('SphereMesh', { radius: f(m.radius ?? 0.5), height: f(2 * (m.radius ?? 0.5)) });
    if (m.primitive === 'capsule') return addSub('CapsuleMesh', { radius: f(m.radius ?? 0.5), height: f(m.height ?? 2) });
    if (m.primitive === 'cylinder') return addSub('CylinderMesh', { top_radius: f(m.radius ?? 0.5), bottom_radius: f(m.radius ?? 0.5), height: f(m.height ?? 2) });
    if (m.primitive === 'plane') return addSub('PlaneMesh', { size: `Vector2(${(m.size ?? [2, 2]).map(f).join(', ')})` });
    if (m.primitive === 'quad') return addSub('QuadMesh', { size: `Vector2(${(m.size ?? [1, 1]).map(f).join(', ')})` });
    return null;
  };
  const shapeSub = c => {
    if (c.shape === 'box') return addSub('BoxShape3D', { size: `Vector3(${(c.size ?? [1, 1, 1]).map(f).join(', ')})` });
    if (c.shape === 'sphere') return addSub('SphereShape3D', { radius: f(c.radius ?? 0.5) });
    if (c.shape === 'capsule') return addSub('CapsuleShape3D', { radius: f(c.radius ?? 0.5), height: f(c.height ?? 2) });
    return null;
  };
  const UI_TYPES = { Image: 'TextureRect', RawImage: 'TextureRect', Text: 'Label', TextMeshPro: 'Label', Button: 'Button', Slider: 'HSlider', Toggle: 'CheckBox', ScrollRect: 'ScrollContainer', InputField: 'LineEdit', GridLayoutGroup: 'GridContainer', VerticalLayoutGroup: 'VBoxContainer', LayoutGroup: 'HBoxContainer', Mask: 'Control', CanvasScaler: null };
  const godotType = (node, roles) => {
    if (node.type === 'PrefabInstance') return null;
    if (roles.ui) {
      const w = roles.ui.widgets.find(x => UI_TYPES[x.widget]);
      if (w?.widget === 'Slider' && w.vertical) return 'VSlider';
      return (w && UI_TYPES[w.widget]) || 'Control';
    }
    if (roles.body === 'character') return 'CharacterBody3D';
    if (roles.body === 'rigid') return 'RigidBody3D';
    if (roles.body === 'kinematic') return 'AnimatableBody3D';
    if (roles.body === 'trigger') return 'Area3D';
    if (roles.body === 'static') return 'StaticBody3D';
    if (roles.camera) return 'Camera3D';
    if (roles.light) return { directional: 'DirectionalLight3D', point: 'OmniLight3D', spot: 'SpotLight3D' }[roles.light];
    if (roles.audio) return roles.audio.spatial ? 'AudioStreamPlayer3D' : 'AudioStreamPlayer';
    if (roles.mesh && !roles.body) return 'MeshInstance3D';
    return 'Node3D';
  };
  const emit = (node, parentPath, isRoot) => {
    const roles = engine === 'unity' ? unityRoles(node) : {};
    const type = godotType(node, roles);
    const nodeName = isRoot ? (node.name || name || 'Root') : uniq(parentPath, node.name || 'Node');
    const attrs = [`name=${q(nodeName)}`];
    if (type) attrs.push(`type="${type}"`);
    if (!isRoot) attrs.push(`parent=${q(parentPath)}`);
    if (node.type === 'PrefabInstance') {
      const target = node.prefab ? resolve(node.prefab) : null;
      if (target) attrs.push(`instance=ExtResource("${addExt('PackedScene', target)}")`);
      else attrs.splice(1, 0, 'type="Node3D"');
    }
    if (node.tag) attrs.push(`groups=[${q(node.tag)}]`);
    const lines = [`[node ${attrs.join(' ')}]`];
    const todo = [];
    if (roles.ui) lines.push(...uiProps(node, roles, todo, addExt, resolve));
    else if (!isIdentity(node.transform)) lines.push(`transform = ${tf(node.transform)}`);
    const scripts = (roles.scripts ?? []).map(s => ({ src: s, res: resolve(s) }));
    if (scripts[0]?.res) lines.push(`script = ExtResource("${addExt('Script', scripts[0].res)}")`);
    if (node.type === 'PrefabInstance' && node.prefab && !resolve(node.prefab)) todo.push(`instance of ${node.prefab} (not ported yet)`);
    for (const ov of node.overrides ?? []) {
      if (ov.property === 'm_IsActive') { if (ov.value === '0') lines.push('visible = false'); continue; }
      todo.push(`override ${ov.property} = ${ov.reference ?? ov.value} (set it on the ported node)`);
    }
    if (scripts.length > 1) todo.push(`more scripts on this GameObject: ${scripts.slice(1).map(s => s.src).join(', ')} — add them as child nodes`);
    if (scripts[0] && !scripts[0].res) todo.push(`script ${scripts[0].src} not ported yet`);
    if (roles.camera) lines.push(`fov = ${f(roles.camera.fov)}`);
    if (node.active === false && !roles.ui) lines.push('visible = false');
    if (roles.mesh?.asset) todo.push(`mesh ${roles.mesh.asset}: import the model and assign it`);
    if (roles.audio?.clip) todo.push(`audio clip ${roles.audio.clip}`);
    if (todo.length) lines.push(`metadata/reverseport_todo = ${q(todo.join('; '))}`);
    nodes.push(lines.join('\n'));
    const myPath = isRoot ? '.' : parentPath === '.' ? nodeName : `${parentPath}/${nodeName}`;
    if (roles.animator !== undefined) {
      const info = animator(roles.animator) ?? { clips: [], script: null };
      const lib = info.clips.length ? addSub('AnimationLibrary', { _data: `{\n${info.clips.map(c => `${q(c.name)}: ExtResource("${addExt('Animation', c.res)}")`).join(',\n')}\n}` }) : null;
      nodes.push(`[node name="AnimationPlayer" type="AnimationPlayer" parent=${q(myPath)}]${lib ? `\nlibraries = {\n"": SubResource("${lib}")\n}` : ''}${info.missing?.length ? `\nmetadata/reverseport_todo = ${q(`clips not ported yet: ${info.missing.join(', ')}`)}` : ''}`);
      nodes.push(`[node name="Animator" type="Node" parent=${q(myPath)}]${info.script ? `\nscript = ExtResource("${addExt('Script', info.script)}")\nplayer = NodePath("../AnimationPlayer")` : `\nmetadata/reverseport_todo = ${q(`animator controller ${roles.animator ?? '(none)'} not ported yet: port it with port_scene, then set script here`)}`}`);
    }
    if (roles.mesh?.primitive && roles.body) {
      const id = meshSub(roles.mesh);
      nodes.push(`[node name="Mesh" type="MeshInstance3D" parent=${q(myPath)}]\nmesh = SubResource("${id}")`);
    } else if (roles.mesh?.primitive) {
      nodes[nodes.length - 1] += `\nmesh = SubResource("${meshSub(roles.mesh)}")`;
    }
    (roles.colliders ?? []).forEach((c, i) => {
      const id = shapeSub(c);
      if (!id) return;
      const center = c.center && c.center.some(v => v) ? `\ntransform = Transform3D(1, 0, 0, 0, 1, 0, 0, 0, 1, ${[c.center[0], c.center[1], -c.center[2]].map(f).join(', ')})` : '';
      const holder = roles.body ? myPath : myPath;
      nodes.push(`[node name="${i ? `Shape${i + 1}` : 'Shape'}" type="CollisionShape3D" parent=${q(holder)}]${center}\nshape = SubResource("${id}")`);
    });
    for (const c of node.children ?? []) emit(c, myPath, false);
  };
  emit(root, '.', true);
  const header = `[gd_scene load_steps=${ext.length + subs.length + 1} format=3]`;
  return [header, ext.join('\n'), subs.join('\n\n'), nodes.join('\n\n')].filter(Boolean).join('\n\n') + '\n';
}

// ---------------------------------------------------------------- → Unity scene spec (+ editor builder)
/** Flatten a Godot scene tree (already converted to Unity coordinates) into the builder's JSON spec. */
export function unitySpec(scene, { kind = 'prefab', savePath, order = 0, resolve = () => null, subResources = {} } = {}) {
  const nodes = [];
  const visit = (n, parent) => {
    const roles = godotRoles(n, subsFor(n, subResources));
    const spec = { name: n.name, parent, position: n.transform?.position ?? [0, 0, 0], rotation: n.transform?.rotation ?? [0, 0, 0, 1], scale: n.transform?.scale ?? [1, 1, 1], components: [], godotType: n.type ?? null };
    if (roles.body === 'character') spec.components.push('CharacterController');
    if (roles.body === 'rigid') spec.components.push('Rigidbody');
    if (roles.body === 'trigger') { spec.components.push('Rigidbody'); spec.kinematic = true; spec.trigger = true; }
    if (roles.camera) { spec.components.push('Camera'); spec.fov = roles.camera.fov; }
    if (roles.light) { spec.components.push('Light'); spec.light = roles.light; }
    if (roles.audio) spec.components.push('AudioSource');
    if (roles.mesh?.primitive) { spec.mesh = roles.mesh.primitive; spec.meshSize = roles.mesh.size ?? (roles.mesh.radius != null ? [roles.mesh.radius, roles.mesh.height ?? 0, 0] : null); }
    if (roles.collider?.shape && roles.collider.shape !== 'unknown') {
      if (n.__parentCharacter && roles.collider.shape === 'capsule') {
        const p = nodes[parent];
        p.radius = roles.collider.radius ?? 0.5; p.height = roles.collider.height ?? 2;
        spec.note = 'capsule used by the parent CharacterController';
      } else {
        spec.collider = roles.collider.shape; spec.size = roles.collider.size ?? null; spec.radius = roles.collider.radius ?? 0; spec.height = roles.collider.height ?? 0;
        if (n.__parentTrigger) spec.trigger = true;
      }
    }
    if (n.script) { const t = resolve(n.script); spec.script = t ? path.posix.basename(t).replace(/\.cs$/, '') : pascalCase(path.posix.basename(n.script)); }
    if (n.instance) { const t = resolve(n.instance); spec.prefab = t ?? null; spec.prefabSource = n.instance; }
    if (n.groups?.length) spec.tag = n.groups[0];
    const index = nodes.length;
    nodes.push(spec);
    for (const c of n.children ?? []) { if (roles.body === 'trigger') c.__parentTrigger = true; if (roles.body === 'character') c.__parentCharacter = true; visit(c, index); }
  };
  visit(scene, -1);
  for (const n of nodes) for (const k of Object.keys(n)) if (n[k] === null || n[k] === undefined || k.startsWith('__')) delete n[k];
  return { generator: 'ReversePort', kind, name: scene.name, order, savePath, nodes };
}

// ---------------------------------------------------------------- → three.js builder module
export function threeModule(scene, { fnName, imports = [], subResources = {} } = {}) {
  const lines = [];
  let counter = 0;
  const v3 = a => a.map(f).join(', ');
  const needs = new Set();
  const emit = (n, parentVar) => {
    const roles = godotRoles(n, subsFor(n, subResources));
    const v = `o${counter++}`;
    let ctor = 'new THREE.Group()';
    if (n.instance) { const imp = imports.find(i => i.source === n.instance); ctor = imp ? `${imp.fn}()` : 'new THREE.Group() /* TODO: instance of ' + n.instance + ' */'; }
    else if (roles.camera) ctor = `new THREE.PerspectiveCamera(${f(roles.camera.fov)}, 16 / 9, 0.05, 4000)`;
    else if (roles.light === 'directional') ctor = 'new THREE.DirectionalLight(0xffffff, 2)';
    else if (roles.light === 'point') ctor = 'new THREE.PointLight(0xffffff, 10)';
    else if (roles.light === 'spot') ctor = 'new THREE.SpotLight(0xffffff, 10)';
    else if (roles.mesh?.primitive) {
      const m = roles.mesh;
      const geo = m.primitive === 'box' ? `new THREE.BoxGeometry(${v3(m.size ?? [1, 1, 1])})`
        : m.primitive === 'sphere' ? `new THREE.SphereGeometry(${f(m.radius ?? 0.5)}, 32, 16)`
        : m.primitive === 'capsule' ? `new THREE.CapsuleGeometry(${f(m.radius ?? 0.5)}, ${f(Math.max(0, (m.height ?? 2) - 2 * (m.radius ?? 0.5)))}, 8, 16)`
        : m.primitive === 'cylinder' ? `new THREE.CylinderGeometry(${f(m.radius ?? 0.5)}, ${f(m.radius ?? 0.5)}, ${f(m.height ?? 2)}, 32)`
        : m.primitive === 'plane' ? `new THREE.PlaneGeometry(${v3(m.size ?? [2, 2])}).rotateX(-Math.PI / 2)`
        : `new THREE.PlaneGeometry(${v3(m.size ?? [1, 1])})`;
      ctor = `new THREE.Mesh(${geo}, new THREE.MeshStandardMaterial())`;
    }
    lines.push(`  const ${v} = ${ctor};`);
    lines.push(`  ${v}.name = ${JSON.stringify(n.name)};`);
    if (n.transform) {
      if (n.transform.position.some(x => x)) lines.push(`  ${v}.position.set(${v3(n.transform.position)});`);
      if (Math.abs(n.transform.rotation[3]) < 0.9999999) lines.push(`  ${v}.quaternion.set(${v3(n.transform.rotation)});`);
      if (n.transform.scale.some(x => Math.abs(x - 1) > 1e-9)) lines.push(`  ${v}.scale.set(${v3(n.transform.scale)});`);
    }
    const userData = { ...(n.type ? { godotType: n.type } : {}), ...(n.script ? { script: n.script } : {}), ...(n.groups?.length ? { groups: n.groups } : {}), ...(roles.collider ? { collider: roles.collider } : {}), ...(roles.body ? { body: roles.body } : {}) };
    if (Object.keys(userData).length) lines.push(`  Object.assign(${v}.userData, ${JSON.stringify(userData)});`);
    if (roles.light === 'directional' || roles.light === 'spot') { lines.push(`  ${v}.target.position.set(0, 0, -1);`, `  ${v}.add(${v}.target);`); needs.add('target'); }
    if (parentVar) lines.push(`  ${parentVar}.add(${v});`);
    for (const c of n.children ?? []) emit(c, v);
    return v;
  };
  const rootVar = emit(scene, null);
  const name = fnName ?? `build${pascalCase(scene.name)}`;
  return [
    '// Generated by ReversePort (port_scene) from a Godot scene. Positions/quaternions are unchanged:',
    '// Godot and three.js share axes (right-handed, Y up, -Z forward, meters). userData keeps the Godot',
    '// node type, script and collider so game code can attach behaviour and physics.',
    "import * as THREE from 'three';",
    ...imports.map(i => `import { ${i.fn} } from ${JSON.stringify(i.path)};`),
    '',
    `export function ${name}(): THREE.Object3D {`,
    ...lines,
    `  return ${rootVar};`,
    '}',
    '',
  ].join('\n');
}

// ---------------------------------------------------------------- → Unreal scene spec
export function unrealSpec(scene, { resolve = () => null, subResources = {} } = {}) {
  const visit = n => {
    const roles = godotRoles(n, subsFor(n, subResources));
    const actor = roles.body === 'character' ? 'ACharacter' : roles.camera ? 'UCameraComponent' : roles.light ? { directional: 'UDirectionalLightComponent', point: 'UPointLightComponent', spot: 'USpotLightComponent' }[roles.light] : roles.mesh ? 'UStaticMeshComponent' : roles.collider ? `U${pascalCase(roles.collider.shape ?? 'box')}Component` : roles.body === 'trigger' ? 'UBoxComponent (overlap)' : 'USceneComponent';
    return {
      name: n.name, godotType: n.type ?? null, suggested: actor,
      locationCm: n.transform?.position ?? [0, 0, 0], rotationQuat: n.transform?.rotation ?? [0, 0, 0, 1], scale: n.transform?.scale ?? [1, 1, 1],
      ...(n.script ? { script: n.script, cppClass: resolve(n.script) } : {}), ...(n.instance ? { instance: n.instance, blueprint: resolve(n.instance) } : {}),
      ...(roles.camera ? { horizontalFovAt16x9: Math.round(2 * Math.atan(Math.tan((roles.camera.fov * Math.PI) / 360) * (16 / 9)) * 18000 / Math.PI) / 100 } : {}),
      ...(n.groups?.length ? { tags: n.groups } : {}),
      children: (n.children ?? []).map(visit),
    };
  };
  return { generator: 'ReversePort', units: 'centimeters, Unreal axes (X forward, Y right, Z up)', root: visit(scene) };
}

// ---------------------------------------------------------------- scaffolds
export function scaffold(to, { name = 'PortedGame', godotVersion = '4.3', unrealVersion = '5.5', mainScene } = {}) {
  const P = pascalCase(name);
  const files = {};
  if (to === 'threejs') {
    files['package.json'] = JSON.stringify({ name: name.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'ported-game', private: true, type: 'module', scripts: { dev: 'vite', build: 'tsc --noEmit && vite build', preview: 'vite preview' }, dependencies: { three: '^0.170.0' }, devDependencies: { '@types/three': '^0.170.0', typescript: '^5.6.0', vite: '^6.0.0' } }, null, 2) + '\n';
    files['tsconfig.json'] = JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', strict: true, noEmit: true, lib: ['ES2022', 'DOM'], skipLibCheck: true }, include: ['src'] }, null, 2) + '\n';
    files['index.html'] = `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>${name}</title>\n<style>html,body{margin:0;height:100%;background:#000;overflow:hidden}canvas{display:block}</style>\n</head>\n<body>\n<script type="module" src="/src/main.ts"></script>\n</body>\n</html>\n`;
    files['src/engine/loop.ts'] = `// Fixed-step game loop: fixedUpdate at 60 Hz (like Godot's _physics_process), update every frame.
import * as THREE from 'three';

export interface Behaviour {
  update?(dt: number): void;
  fixedUpdate?(dt: number): void;
}

export class Game {
  readonly renderer = new THREE.WebGLRenderer({ antialias: true });
  readonly scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.05, 4000);
  readonly behaviours = new Set<Behaviour>();
  private readonly clock = new THREE.Clock();
  private accumulator = 0;
  static readonly FIXED_DT = 1 / 60;

  constructor(parent: HTMLElement = document.body) {
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(innerWidth, innerHeight);
    parent.appendChild(this.renderer.domElement);
    addEventListener('resize', () => this.resize());
  }

  resize(): void {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight);
  }

  start(): void {
    this.resize();
    this.renderer.setAnimationLoop(() => {
      const dt = Math.min(this.clock.getDelta(), 0.25);
      this.accumulator += dt;
      while (this.accumulator >= Game.FIXED_DT) {
        for (const b of this.behaviours) b.fixedUpdate?.(Game.FIXED_DT);
        this.accumulator -= Game.FIXED_DT;
      }
      for (const b of this.behaviours) b.update?.(dt);
      this.renderer.render(this.scene, this.camera);
    });
  }
}
`;
    const main = mainScene ? { fn: mainScene.fn, path: mainScene.path } : null;
    files['src/main.ts'] = `import * as THREE from 'three';
import { Game } from './engine/loop';
${main ? `import { ${main.fn} } from ${JSON.stringify(main.path)};\n` : ''}
const game = new Game();
game.scene.background = new THREE.Color(0x87a7c7);
game.scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1));
${main ? `const world = ${main.fn}();
game.scene.add(world);
let found: THREE.PerspectiveCamera | undefined;
world.traverse(o => { if (!found && o instanceof THREE.PerspectiveCamera) found = o; });
if (found) game.camera = found;
else game.camera.position.set(0, 2, 8);` : 'game.camera.position.set(0, 2, 8);'}
game.start();
`;
  }
  if (to === 'godot' || to === 'godot-csharp') {
    files['project.godot'] = `; Engine configuration file.\n; Generated by ReversePort; open this folder in Godot ${godotVersion}+.\n\nconfig_version=5\n\n[application]\n\nconfig/name=${q(name)}\n${mainScene ? `run/main_scene=${q(mainScene)}\n` : ''}config/features=PackedStringArray("${godotVersion}"${to === 'godot-csharp' ? ', "C#"' : ''}, "Forward Plus")\n${to === 'godot-csharp' ? `\n[dotnet]\n\nproject/assembly_name=${q(P)}\n` : ''}`;
    if (to === 'godot-csharp') files[`${P}.csproj`] = `<Project Sdk="Godot.NET.Sdk/${godotVersion}.0">\n  <PropertyGroup>\n    <TargetFramework>net8.0</TargetFramework>\n    <EnableDynamicLoading>true</EnableDynamicLoading>\n    <RootNamespace>${P}</RootNamespace>\n  </PropertyGroup>\n</Project>\n`;
  }
  if (to === 'unreal') {
    files[`${P}.uproject`] = JSON.stringify({ FileVersion: 3, EngineAssociation: unrealVersion, Category: '', Description: `Ported by ReversePort`, Modules: [{ Name: P, Type: 'Runtime', LoadingPhase: 'Default' }], Plugins: [{ Name: 'EnhancedInput', Enabled: true }] }, null, 2) + '\n';
    const target = (suffix, type) => `using UnrealBuildTool;\nusing System.Collections.Generic;\n\npublic class ${P}${suffix}Target : TargetRules\n{\n\tpublic ${P}${suffix}Target(TargetInfo Target) : base(Target)\n\t{\n\t\tType = TargetType.${type};\n\t\tDefaultBuildSettings = BuildSettingsVersion.Latest;\n\t\tIncludeOrderVersion = EngineIncludeOrderVersion.Latest;\n\t\tExtraModuleNames.Add("${P}");\n\t}\n}\n`;
    files[`Source/${P}.Target.cs`] = target('', 'Game');
    files[`Source/${P}Editor.Target.cs`] = target('Editor', 'Editor');
    files[`Source/${P}/${P}.Build.cs`] = `using UnrealBuildTool;\n\npublic class ${P} : ModuleRules\n{\n\tpublic ${P}(ReadOnlyTargetRules Target) : base(Target)\n\t{\n\t\tPCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;\n\t\tPublicDependencyModuleNames.AddRange(new string[] { "Core", "CoreUObject", "Engine", "InputCore", "EnhancedInput", "UMG" });\n\t}\n}\n`;
    files[`Source/${P}/${P}.h`] = '#pragma once\n\n#include "CoreMinimal.h"\n';
    files[`Source/${P}/${P}.cpp`] = `#include "${P}.h"\n#include "Modules/ModuleManager.h"\n\nIMPLEMENT_PRIMARY_GAME_MODULE(FDefaultGameModuleImpl, ${P}, "${P}");\n`;
  }
  return files;
}

export const sceneFunctionName = file => `build${pascalCase(path.posix.basename(file))}`;
export { camelCase };
export { convertTree };
