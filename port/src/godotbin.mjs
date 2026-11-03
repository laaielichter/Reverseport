// Godot export leftovers back to editable form: compiled GDScript (.gdc, Godot 3 bytecode v10–13 and Godot 4.3+
// binary tokens v100/v101, zstd-compressed or not), binary resources and scenes (RSRC/RSCC .res/.scn → .tres/.tscn,
// including PackedScene _bundled trees) and exported project settings (project.binary → project.godot).
// Everything here is a faithful re-serialisation of what the file stores; comments and formatting are gone for good.
import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { RPError, requireFile, requireDir, walk, statOrNull } from './util.mjs';
import { workspaceDir } from './workspace.mjs';

// ------------------------------------------------------------------------------------------------ marshalled Variants
const M3 = ['NIL', 'BOOL', 'INT', 'FLOAT', 'STRING', 'VECTOR2', 'RECT2', 'VECTOR3', 'TRANSFORM2D', 'PLANE', 'QUATERNION', 'AABB', 'BASIS', 'TRANSFORM3D', 'COLOR', 'NODE_PATH', 'RID', 'OBJECT', 'DICTIONARY', 'ARRAY', 'PACKED_BYTE_ARRAY', 'PACKED_INT32_ARRAY', 'PACKED_FLOAT32_ARRAY', 'PACKED_STRING_ARRAY', 'PACKED_VECTOR2_ARRAY', 'PACKED_VECTOR3_ARRAY', 'PACKED_COLOR_ARRAY'];
const M4 = ['NIL', 'BOOL', 'INT', 'FLOAT', 'STRING', 'VECTOR2', 'VECTOR2I', 'RECT2', 'RECT2I', 'VECTOR3', 'VECTOR3I', 'TRANSFORM2D', 'VECTOR4', 'VECTOR4I', 'PLANE', 'QUATERNION', 'AABB', 'BASIS', 'TRANSFORM3D', 'PROJECTION', 'COLOR', 'STRING_NAME', 'NODE_PATH', 'RID', 'OBJECT', 'CALLABLE', 'SIGNAL', 'DICTIONARY', 'ARRAY', 'PACKED_BYTE_ARRAY', 'PACKED_INT32_ARRAY', 'PACKED_INT64_ARRAY', 'PACKED_FLOAT32_ARRAY', 'PACKED_FLOAT64_ARRAY', 'PACKED_STRING_ARRAY', 'PACKED_VECTOR2_ARRAY', 'PACKED_VECTOR3_ARRAY', 'PACKED_COLOR_ARRAY', 'PACKED_VECTOR4_ARRAY'];
const V = (kind, value) => ({ kind, value });
const pad4 = n => (n + 3) & ~3;

/** decode_variant (core/io/marshalls.cpp) for Godot 3 or 4. Returns { value: {kind, value}, end }. */
export function decodeMarshal(buf, off, major = 4, depth = 0) {
  if (depth > 64 || off + 4 > buf.length) throw new RPError('BAD_FORMAT', 'variant truncated');
  const head = buf.readUInt32LE(off), type = head & 0xff, flag64 = !!(head & (1 << 16));
  const names = major >= 4 ? M4 : M3;
  const kind = names[type];
  if (!kind) throw new RPError('BAD_FORMAT', `unknown variant type ${type}`);
  let p = off + 4;
  const f32 = () => { const v = buf.readFloatLE(p); p += 4; return v; };
  const real = () => { if (flag64) { const v = buf.readDoubleLE(p); p += 8; return v; } return f32(); };
  const str = () => { const n = buf.readUInt32LE(p); const s = buf.toString('utf8', p + 4, p + 4 + n).replace(/\0+$/, ''); p += 4 + pad4(n); return s; };
  const vec = n => { const out = []; for (let i = 0; i < n; i++) out.push(real()); return out; };
  const arr = (n, each) => { const out = []; for (let i = 0; i < n; i++) out.push(each()); return out; };
  switch (kind) {
    case 'NIL': return { value: V('null', null), end: p };
    case 'BOOL': { const v = buf.readUInt32LE(p) !== 0; return { value: V('bool', v), end: p + 4 }; }
    case 'INT': { if (flag64) { const v = Number(buf.readBigInt64LE(p)); return { value: V('int', v), end: p + 8 }; } return { value: V('int', buf.readInt32LE(p)), end: p + 4 }; }
    case 'FLOAT': return { value: V('float', real()), end: p };
    case 'STRING': return { value: V('string', str()), end: p };
    case 'STRING_NAME': return { value: V('stringname', str()), end: p };
    case 'VECTOR2': return { value: V('Vector2', vec(2)), end: p };
    case 'VECTOR2I': { const v = [buf.readInt32LE(p), buf.readInt32LE(p + 4)]; return { value: V('Vector2i', v), end: p + 8 }; }
    case 'RECT2': return { value: V('Rect2', vec(4)), end: p };
    case 'RECT2I': { const v = arr(4, () => { const x = buf.readInt32LE(p); p += 4; return x; }); return { value: V('Rect2i', v), end: p }; }
    case 'VECTOR3': return { value: V('Vector3', vec(3)), end: p };
    case 'VECTOR3I': { const v = arr(3, () => { const x = buf.readInt32LE(p); p += 4; return x; }); return { value: V('Vector3i', v), end: p }; }
    case 'VECTOR4': return { value: V('Vector4', vec(4)), end: p };
    case 'VECTOR4I': { const v = arr(4, () => { const x = buf.readInt32LE(p); p += 4; return x; }); return { value: V('Vector4i', v), end: p }; }
    case 'TRANSFORM2D': return { value: V('Transform2D', vec(6)), end: p };
    case 'PLANE': return { value: V('Plane', vec(4)), end: p };
    case 'QUATERNION': return { value: V('Quaternion', vec(4)), end: p };
    case 'AABB': return { value: V('AABB', vec(6)), end: p };
    case 'BASIS': return { value: V('Basis', vec(9)), end: p };
    case 'TRANSFORM3D': return { value: V('Transform3D', vec(12)), end: p };
    case 'PROJECTION': return { value: V('Projection', vec(16)), end: p };
    case 'COLOR': { const v = arr(4, f32); return { value: V('Color', v), end: p }; }
    case 'NODE_PATH': {
      let nc = buf.readUInt32LE(p); p += 4;
      if (nc & 0x80000000) { nc &= 0x7fffffff; const snc = buf.readUInt32LE(p); const flags = buf.readUInt32LE(p + 4); p += 8; const names2 = arr(nc, str), subs = arr(snc, str); return { value: V('NodePath', `${flags & 1 ? '/' : ''}${names2.join('/')}${subs.length ? ':' + subs.join(':') : ''}`), end: p }; }
      const s = buf.toString('utf8', p, p + nc); p += pad4(nc); return { value: V('NodePath', s), end: p };
    }
    case 'RID': return { value: V('RID', buf.readUInt32LE(p)), end: p + 4 };
    case 'OBJECT': {
      if (head & (1 << 16)) { const id = Number(buf.readBigUInt64LE(p)); return { value: V('object', `instance id ${id}`), end: p + 8 }; }
      const cls = str(); const n = buf.readUInt32LE(p); p += 4; const props = {};
      for (let i = 0; i < n; i++) { const k = str(); const r = decodeMarshal(buf, p, major, depth + 1); props[k] = r.value; p = r.end; }
      return { value: V('object', { class: cls, props }), end: p };
    }
    case 'CALLABLE': case 'SIGNAL': return { value: V('null', null), end: p };
    case 'DICTIONARY': { const n = buf.readUInt32LE(p) & 0x7fffffff; p += 4; const out = []; for (let i = 0; i < n; i++) { const k = decodeMarshal(buf, p, major, depth + 1); const v = decodeMarshal(buf, k.end, major, depth + 1); out.push([k.value, v.value]); p = v.end; } return { value: V('dict', out), end: p }; }
    case 'ARRAY': { const n = buf.readUInt32LE(p) & 0x7fffffff; p += 4; const out = []; for (let i = 0; i < n; i++) { const v = decodeMarshal(buf, p, major, depth + 1); out.push(v.value); p = v.end; } return { value: V('array', out), end: p }; }
    case 'PACKED_BYTE_ARRAY': { const n = buf.readUInt32LE(p); p += 4; const v = [...buf.subarray(p, p + n)]; p += pad4(n); return { value: V('PackedByteArray', v), end: p }; }
    case 'PACKED_INT32_ARRAY': { const n = buf.readUInt32LE(p); p += 4; return { value: V('PackedInt32Array', arr(n, () => { const x = buf.readInt32LE(p); p += 4; return x; })), end: p }; }
    case 'PACKED_INT64_ARRAY': { const n = buf.readUInt32LE(p); p += 4; return { value: V('PackedInt64Array', arr(n, () => { const x = Number(buf.readBigInt64LE(p)); p += 8; return x; })), end: p }; }
    case 'PACKED_FLOAT32_ARRAY': { const n = buf.readUInt32LE(p); p += 4; return { value: V('PackedFloat32Array', arr(n, f32)), end: p }; }
    case 'PACKED_FLOAT64_ARRAY': { const n = buf.readUInt32LE(p); p += 4; return { value: V('PackedFloat64Array', arr(n, () => { const x = buf.readDoubleLE(p); p += 8; return x; })), end: p }; }
    case 'PACKED_STRING_ARRAY': { const n = buf.readUInt32LE(p); p += 4; return { value: V('PackedStringArray', arr(n, str)), end: p }; }
    case 'PACKED_VECTOR2_ARRAY': { const n = buf.readUInt32LE(p); p += 4; return { value: V('PackedVector2Array', arr(n, () => [f32(), f32()])), end: p }; }
    case 'PACKED_VECTOR3_ARRAY': { const n = buf.readUInt32LE(p); p += 4; return { value: V('PackedVector3Array', arr(n, () => [f32(), f32(), f32()])), end: p }; }
    case 'PACKED_VECTOR4_ARRAY': { const n = buf.readUInt32LE(p); p += 4; return { value: V('PackedVector4Array', arr(n, () => [f32(), f32(), f32(), f32()])), end: p }; }
    case 'PACKED_COLOR_ARRAY': { const n = buf.readUInt32LE(p); p += 4; return { value: V('PackedColorArray', arr(n, () => [f32(), f32(), f32(), f32()])), end: p }; }
    default: throw new RPError('BAD_FORMAT', `variant ${kind} not handled`);
  }
}

const fnum = n => { if (!Number.isFinite(n)) return n > 0 ? 'inf' : n < 0 ? '-inf' : 'nan'; const s = Number(n.toPrecision(7)).toString(); return /[.e]/.test(s) ? s : `${s}.0`; };
const inum = n => String(n);
const qstr = s => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\t/g, '\\t')}"`;
const PACKED_3 = { PackedByteArray: 'PoolByteArray', PackedInt32Array: 'PoolIntArray', PackedFloat32Array: 'PoolRealArray', PackedStringArray: 'PoolStringArray', PackedVector2Array: 'PoolVector2Array', PackedVector3Array: 'PoolVector3Array', PackedColorArray: 'PoolColorArray' };
/** Godot text-format literal for a decoded variant. major picks Pool/Quat/Transform names (3) or Packed/Quaternion/Transform3D (4). */
export function variantText(v, major = 4, ctx = {}) {
  const names3 = { Quaternion: 'Quat', Transform3D: 'Transform' };
  const typeName = k => (major === 3 ? (names3[k] ?? PACKED_3[k] ?? k) : k);
  switch (v.kind) {
    case 'null': return 'null';
    case 'bool': return v.value ? 'true' : 'false';
    case 'int': return inum(v.value);
    case 'float': return fnum(v.value);
    case 'string': return qstr(v.value);
    case 'stringname': return `&${qstr(v.value)}`;
    case 'NodePath': return `NodePath(${qstr(v.value)})`;
    case 'RID': return `RID(${v.value})`;
    case 'Color': return `Color(${v.value.map(fnum).join(', ')})`;
    case 'Vector2i': case 'Vector3i': case 'Vector4i': case 'Rect2i': return `${v.kind}(${v.value.map(inum).join(', ')})`;
    case 'Vector2': case 'Vector3': case 'Vector4': case 'Rect2': case 'Plane': case 'Quaternion': case 'AABB': case 'Basis': case 'Transform2D': case 'Transform3D': case 'Projection': return `${typeName(v.kind)}(${v.value.map(fnum).join(', ')})`;
    case 'array': return `[${v.value.map(x => variantText(x, major, ctx)).join(', ')}]`;
    case 'dict': return v.value.length ? `{\n${v.value.map(([k, val]) => `${variantText(k, major, ctx)}: ${variantText(val, major, ctx)}`).join(',\n')}\n}` : '{}';
    case 'PackedByteArray': case 'PackedInt32Array': case 'PackedInt64Array': case 'PackedFloat32Array': case 'PackedFloat64Array': case 'PackedStringArray':
      return `${typeName(v.kind)}(${v.value.map(x => (typeof x === 'string' ? qstr(x) : /Float/.test(v.kind) ? fnum(x) : inum(x))).join(', ')})`;
    case 'PackedVector2Array': case 'PackedVector3Array': case 'PackedVector4Array': case 'PackedColorArray': return `${typeName(v.kind)}(${v.value.flat().map(fnum).join(', ')})`;
    case 'ext': return major === 3 ? `ExtResource( ${v.value} )` : `ExtResource(${qstr(v.value)})`;
    case 'sub': return major === 3 ? `SubResource( ${v.value} )` : `SubResource(${qstr(v.value)})`;
    case 'object': return typeof v.value === 'string' ? `null # ${v.value}` : `Object(${v.value.class},${Object.entries(v.value.props).map(([k, x]) => `${qstr(k)}:${variantText(x, major, ctx)}`).join(',')})`;
    default: return `null # ${v.kind}`;
  }
}

// ------------------------------------------------------------------------------------------------ GDScript bytecode
export const TK3 = ['EMPTY', 'IDENTIFIER', 'CONSTANT', 'SELF', 'BUILT_IN_TYPE', 'BUILT_IN_FUNC', 'in', '==', '!=', '<', '<=', '>', '>=', 'and', 'or', 'not', '+', '-', '*', '/', '%', '<<', '>>', '=', '+=', '-=', '*=', '/=', '%=', '<<=', '>>=', '&=', '|=', '^=', '&', '|', '^', '~',
  'if', 'elif', 'else', 'for', 'while', 'break', 'continue', 'pass', 'return', 'match', 'func', 'class', 'class_name', 'extends', 'is', 'onready', 'tool', 'static', 'export', 'setget', 'const', 'var', 'as', 'void', 'enum', 'preload', 'assert', 'yield', 'signal', 'breakpoint', 'remote', 'sync', 'master', 'slave', 'puppet', 'remotesync', 'mastersync', 'puppetsync',
  '[', ']', '{', '}', '(', ')', ',', ';', '.', '?', ':', '$', '->', 'NEWLINE', 'PI', 'TAU', '_', 'INF', 'NAN', 'ERROR', 'EOF', 'CURSOR'];
const TK3_TYPES = ['null', 'bool', 'int', 'float', 'String', 'Vector2', 'Rect2', 'Vector3', 'Transform2D', 'Plane', 'Quat', 'AABB', 'Basis', 'Transform', 'Color', 'NodePath', 'RID', 'Object', 'Dictionary', 'Array', 'PoolByteArray', 'PoolIntArray', 'PoolRealArray', 'PoolStringArray', 'PoolVector2Array', 'PoolVector3Array', 'PoolColorArray'];
const TK3_FUNCS = 'sin cos tan sinh cosh tanh asin acos atan atan2 sqrt fmod fposmod posmod floor ceil round abs sign pow log exp is_nan is_inf is_equal_approx is_zero_approx ease decimals step_decimals stepify lerp lerp_angle inverse_lerp range_lerp smoothstep move_toward dectime randomize randi randf rand_range seed rand_seed deg2rad rad2deg linear2db db2linear polar2cartesian cartesian2polar wrapi wrapf max min clamp nearest_po2 weakref funcref convert typeof type_exists char ord str print printt prints printerr printraw print_debug push_error push_warning var2str str2var var2bytes bytes2var range load inst2dict dict2inst validate_json parse_json to_json hash Color8 ColorN print_stack get_stack instance_from_id len is_instance_valid deep_equal'.split(' ');
// Godot 4 token enum (v100 = 4.3/4.4 without "..." ; v101 = 4.5+ with PERIOD_PERIOD_PERIOD).
const TK4_BASE = ['EMPTY', 'ANNOTATION', 'IDENTIFIER', 'LITERAL', '<', '<=', '>', '>=', '==', '!=', 'and', 'or', 'not', '&&', '||', '!', '&', '|', '~', '^', '<<', '>>', '+', '-', '*', '**', '/', '%', '=', '+=', '-=', '*=', '**=', '/=', '%=', '<<=', '>>=', '&=', '|=', '^=',
  'if', 'elif', 'else', 'for', 'while', 'break', 'continue', 'pass', 'return', 'match', 'when', 'as', 'assert', 'await', 'breakpoint', 'class', 'class_name', 'const', 'enum', 'extends', 'func', 'in', 'is', 'namespace', 'preload', 'self', 'signal', 'static', 'super', 'trait', 'var', 'void', 'yield',
  '[', ']', '{', '}', '(', ')', ',', ';', '.', '..', ':', '$', '->', '_', 'NEWLINE', 'INDENT', 'DEDENT', 'PI', 'TAU', 'INF', 'NAN', 'VCS', '`', '?', 'ERROR', 'EOF'];
const TK4_101 = [...TK4_BASE.slice(0, TK4_BASE.indexOf('..') + 1), '...', ...TK4_BASE.slice(TK4_BASE.indexOf('..') + 1)];

const NO_SPACE_BEFORE = new Set([')', ']', '}', ',', '.', ':', ';']);
const NO_SPACE_AFTER = new Set(['(', '[', '.', '$', '~', '@', '{']);
const KEYWORD_RE = /^[a-z_]+$/;

function joinTokens(parts) {
  // parts: [{text, kind}] with kind in word|punct|open|close|op|newline|dollar
  let out = '';
  let prev = null;
  for (const t of parts) {
    if (t.kind === 'newline') { out = out.replace(/[ \t]+$/, '') + t.text; prev = t; continue; }
    const prevText = prev?.text ?? '';
    let space = true;
    if (!prev || prev.kind === 'newline') space = false;
    else if (NO_SPACE_BEFORE.has(t.text) && t.kind !== 'word') space = false;
    else if (NO_SPACE_AFTER.has(prevText)) space = false;
    else if (prevText === '-' && (prev.unary)) space = false;
    else if (t.text === '=' && prevText === ':' && prev.kind !== 'word') space = false;
    else if ((t.text === '(' || t.text === '[') && (prev.kind === 'word' && /^[A-Za-z_@$]/.test(prevText) && !['and', 'or', 'not', 'in', 'is', 'as', 'return', 'if', 'elif', 'while', 'for', 'match', 'await', 'when', 'else', 'var', 'const'].includes(prevText))) space = false;
    else if ((t.text === '(' || t.text === '[') && (prevText === ')' || prevText === ']')) space = false;
    if (space) out += ' ';
    out += t.text;
    prev = t;
  }
  return out;
}

export function decodeGdc(buf) {
  if (buf.length < 12 || buf.toString('latin1', 0, 4) !== 'GDSC') throw new RPError('BAD_FORMAT', 'Not a compiled GDScript (GDSC).');
  const version = buf.readUInt32LE(4);
  if (version <= 13) return decodeGdc3(buf, version);
  if (version === 100 || version === 101) return decodeGdc4(buf, version);
  throw new RPError('BAD_FORMAT', `GDSC version ${version} is not known (Godot 3: ≤13, Godot 4.3+: 100/101).`);
}

function decodeGdc3(buf, version) {
  const idCount = buf.readUInt32LE(8), constCount = buf.readUInt32LE(12), lineCount = buf.readUInt32LE(16), tokenCount = buf.readUInt32LE(20);
  let p = 24;
  const identifiers = [];
  for (let i = 0; i < idCount; i++) { const len = buf.readUInt32LE(p); p += 4; const cs = Buffer.from(buf.subarray(p, p + len).map(b => b ^ 0xb6)); identifiers.push(cs.toString('utf8').replace(/\0.*$/s, '')); p += len; }
  const constants = [];
  for (let i = 0; i < constCount; i++) { const r = decodeMarshal(buf, p, 3); constants.push(r.value); p = r.end; }
  const lines = new Map();
  for (let i = 0; i < lineCount; i++) { lines.set(buf.readUInt32LE(p), buf.readUInt32LE(p + 4)); p += 8; }
  const tokens = [];
  for (let i = 0; i < tokenCount; i++) { if (buf[p] & 0x80) { tokens.push(buf.readUInt32LE(p) & ~0x80); p += 4; } else { tokens.push(buf[p]); p += 1; } }
  const parts = [];
  const warnings = [];
  let indent = 0;
  for (let i = 0; i < tokens.length; i++) {
    const tk = tokens[i] & 0xff, data = tokens[i] >> 8;
    const name = TK3[tk];
    if (name === undefined) { warnings.push(`token ${tk} unknown at ${i}`); continue; }
    switch (name) {
      case 'EMPTY': case 'CURSOR': case 'ERROR': break;
      case 'EOF': break;
      case 'IDENTIFIER': parts.push({ text: identifiers[data] ?? `_id${data}`, kind: 'word' }); break;
      case 'CONSTANT': parts.push({ text: constants[data] ? variantText(constants[data], 3) : 'null', kind: 'word' }); break;
      case 'SELF': parts.push({ text: 'self', kind: 'word' }); break;
      case 'BUILT_IN_TYPE': parts.push({ text: TK3_TYPES[data] ?? `Variant`, kind: 'word' }); break;
      case 'BUILT_IN_FUNC': parts.push({ text: TK3_FUNCS[data] ?? `builtin_${data}`, kind: 'word' }); break;
      case 'NEWLINE': indent = data; parts.push({ text: '\n' + '\t'.repeat(indent), kind: 'newline' }); break;
      case 'PI': case 'TAU': case 'INF': case 'NAN': case '_': parts.push({ text: name, kind: 'word' }); break;
      default: {
        const isWord = KEYWORD_RE.test(name);
        const unary = name === '-' && (i === 0 || ['(', '[', ',', '=', 'return', '+', '-', '*', '/', '<', '>', '==', '!=', '<=', '>=', 'NEWLINE', 'and', 'or', 'not', 'in', ':'].includes(TK3[tokens[i - 1] & 0xff]));
        parts.push({ text: name, kind: isWord ? 'word' : ['(', '[', '{'].includes(name) ? 'open' : [')', ']', '}'].includes(name) ? 'close' : 'punct', unary });
      }
    }
  }
  const source = joinTokens(parts).replace(/^\n+/, '').replace(/[ \t]+\n/g, '\n').replace(/\n+$/, '') + '\n';
  return { engine: 'godot3', bytecodeVersion: version, identifiers: identifiers.length, constants: constants.length, tokens: tokens.length, source, warnings };
}

function decodeGdc4(buf, version) {
  const decompressedSize = buf.readUInt32LE(8);
  let c;
  if (decompressedSize === 0) c = buf.subarray(12);
  else {
    if (typeof zlib.zstdDecompressSync !== 'function') throw new RPError('UNSUPPORTED', 'This .gdc is zstd-compressed and this Node version has no zstd (needs Node 22.15+ / 23.8+).');
    c = zlib.zstdDecompressSync(buf.subarray(12));
    if (c.length !== decompressedSize) throw new RPError('BAD_FORMAT', 'zstd output size does not match the header.');
  }
  // v100 (Godot 4.3/4.4): token count at 16, data at 20 (offset 12 unused); v101 (4.5+): token count at 12, data at 16.
  const idCount = c.readUInt32LE(0), constCount = c.readUInt32LE(4), lineCount = c.readUInt32LE(8), tokenCount = c.readUInt32LE(version === 100 ? 16 : 12);
  let p = version === 100 ? 20 : 16;
  const identifiers = [];
  for (let i = 0; i < idCount; i++) { const len = c.readUInt32LE(p); p += 4; let s = ''; for (let j = 0; j < len; j++) { const cp = (c[p + j * 4] ^ 0xb6) | ((c[p + j * 4 + 1] ^ 0xb6) << 8) | ((c[p + j * 4 + 2] ^ 0xb6) << 16) | ((c[p + j * 4 + 3] ^ 0xb6) << 24); s += String.fromCodePoint(cp >>> 0); } identifiers.push(s); p += len * 4; }
  const constants = [];
  for (let i = 0; i < constCount; i++) { const r = decodeMarshal(c, p, 4); constants.push(r.value); p = r.end; }
  // Lines and columns of the first token on each new line: newlines and indentation are rebuilt from these.
  const tokLine = new Map(), tokCol = new Map();
  for (let i = 0; i < lineCount; i++) { tokLine.set(c.readUInt32LE(p), c.readUInt32LE(p + 4)); p += 8; }
  for (let i = 0; i < lineCount; i++) { tokCol.set(c.readUInt32LE(p), c.readUInt32LE(p + 4)); p += 8; }
  const TK = version === 101 ? TK4_101 : TK4_BASE;
  const toks = [];
  for (let i = 0; i < tokenCount; i++) {
    const first = c[p];
    let raw, line;
    if (first & 0x80) { raw = c.readUInt32LE(p); line = c.readUInt32LE(p + 4); p += 8; } else { raw = first; line = c.readUInt32LE(p + 1); p += 5; }
    toks.push({ type: raw & 0x7f, data: raw >>> 8, line });
  }
  const parts = [];
  const warnings = [];
  let indent = 0, lastLine = toks[0]?.line ?? 1;
  const stack = [];
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    const name = TK[t.type];
    if (i > 0 && tokLine.has(i)) {
      const col = (tokCol.get(i) ?? 1) - 1;
      const prevIndent = stack.at(-1) ?? 0;
      if (col > prevIndent) stack.push(col); else while (stack.length && col < (stack.at(-1) ?? 0)) stack.pop();
      indent = stack.length;
      const line = tokLine.get(i);
      parts.push({ text: (line - lastLine > 1 ? '\n' : '') + '\n' + '\t'.repeat(indent), kind: 'newline' });
      lastLine = line;
    }
    if (name === undefined) { warnings.push(`token ${t.type} unknown at ${i}`); continue; }
    switch (name) {
      case 'EMPTY': case 'ERROR': case 'EOF': case 'VCS': break;
      case 'ANNOTATION': parts.push({ text: identifiers[t.data] ?? '@?', kind: 'word' }); break;
      case 'IDENTIFIER': parts.push({ text: identifiers[t.data] ?? `_id${t.data}`, kind: 'word' }); break;
      case 'LITERAL': parts.push({ text: constants[t.data] ? variantText(constants[t.data], 4) : 'null', kind: 'word' }); break;
      case 'INDENT': indent++; if (parts.at(-1)?.kind === 'newline') parts.at(-1).text = '\n' + '\t'.repeat(indent); break;
      case 'DEDENT': indent = Math.max(0, indent - 1); if (parts.at(-1)?.kind === 'newline') parts.at(-1).text = '\n' + '\t'.repeat(indent); break;
      case 'NEWLINE': { const blank = t.line - lastLine > 1 ? '\n' : ''; parts.push({ text: blank + '\n' + '\t'.repeat(indent), kind: 'newline' }); break; }
      case 'PI': case 'TAU': case 'INF': parts.push({ text: name, kind: 'word' }); break;
      case 'NAN': parts.push({ text: 'NAN', kind: 'word' }); break;
      case '_': parts.push({ text: '_', kind: 'word' }); break;
      default: {
        const isWord = KEYWORD_RE.test(name);
        const prevName = TK[toks[i - 1]?.type] ?? 'NEWLINE';
        const unary = name === '-' && ['(', '[', ',', '=', 'return', '+', '-', '*', '/', '<', '>', '==', '!=', '<=', '>=', 'NEWLINE', 'INDENT', 'and', 'or', 'not', 'in', ':', '**', '%'].includes(prevName);
        parts.push({ text: name, kind: isWord ? 'word' : ['(', '[', '{'].includes(name) ? 'open' : [')', ']', '}'].includes(name) ? 'close' : 'punct', unary });
      }
    }
  }
  const source = joinTokens(parts).replace(/^\n+/, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/([\w\]\)]):= /g, '$1 := ') + '\n';
  return { engine: 'godot4', bytecodeVersion: version, compressed: decompressedSize !== 0, identifiers: identifiers.length, constants: constants.length, tokens: toks.length, source, warnings };
}

// ------------------------------------------------------------------------------------------------ RSRC binary resources
const R4 = { 1: 'NIL', 2: 'BOOL', 3: 'INT', 4: 'FLOAT', 5: 'STRING', 10: 'VECTOR2', 11: 'RECT2', 12: 'VECTOR3', 13: 'PLANE', 14: 'QUATERNION', 15: 'AABB', 16: 'BASIS', 17: 'TRANSFORM3D', 18: 'TRANSFORM2D', 20: 'COLOR', 21: 'IMAGE', 22: 'NODE_PATH', 23: 'RID', 24: 'OBJECT', 25: 'INPUT_EVENT', 26: 'DICTIONARY', 30: 'ARRAY', 31: 'PACKED_BYTE_ARRAY', 32: 'PACKED_INT32_ARRAY', 33: 'PACKED_FLOAT32_ARRAY', 34: 'PACKED_STRING_ARRAY', 35: 'PACKED_VECTOR3_ARRAY', 36: 'PACKED_COLOR_ARRAY', 37: 'PACKED_VECTOR2_ARRAY', 40: 'INT64', 41: 'DOUBLE', 42: 'CALLABLE', 43: 'SIGNAL', 44: 'STRING_NAME', 45: 'VECTOR2I', 46: 'RECT2I', 47: 'VECTOR3I', 48: 'PACKED_INT64_ARRAY', 49: 'PACKED_FLOAT64_ARRAY', 50: 'VECTOR4', 51: 'VECTOR4I', 52: 'PROJECTION', 53: 'PACKED_VECTOR4_ARRAY' };

export function readRsrc(input) {
  let buf = input;
  if (buf.toString('latin1', 0, 4) === 'RSCC') buf = inflateRscc(buf);
  if (buf.toString('latin1', 0, 4) !== 'RSRC') throw new RPError('BAD_FORMAT', 'Not a Godot binary resource (RSRC/RSCC).');
  const bigEndian = buf.readUInt32LE(4) !== 0;
  if (bigEndian) throw new RPError('UNSUPPORTED', 'big-endian resource files are not supported');
  const real64 = buf.readUInt32LE(8) !== 0;
  const major = buf.readUInt32LE(12), minor = buf.readUInt32LE(16), format = buf.readUInt32LE(20);
  let p = 24;
  const ustr = () => { const n = buf.readUInt32LE(p); const s = buf.toString('utf8', p + 4, p + 4 + n).replace(/\0$/, ''); p += 4 + n; return s; };
  const type = ustr();
  p += 8; // importmd_ofs
  let flags = 0, uid = null, scriptClass = null, namedIds = false;
  if (major >= 4) {
    flags = buf.readUInt32LE(p); p += 4;
    namedIds = !!(flags & 1);
    if (flags & 2) uid = buf.readBigInt64LE(p); p += 8;
    if (flags & 8) scriptClass = ustr();
    p += 11 * 4;
  } else p += 14 * 4;
  const realIsDouble = major >= 4 ? !!(flags & 4) : real64;
  const nStrings = buf.readUInt32LE(p); p += 4;
  const strings = [];
  for (let i = 0; i < nStrings; i++) strings.push(ustr());
  const nExt = buf.readUInt32LE(p); p += 4;
  const ext = [];
  for (let i = 0; i < nExt; i++) { const t = ustr(); const pth = ustr(); let euid = null; if (flags & 2) { euid = buf.readBigInt64LE(p); p += 8; } ext.push({ type: t, path: pth, uid: euid, id: namedIds ? `${i + 1}_${hashId(pth)}` : String(i + 1) }); }
  const nInt = buf.readUInt32LE(p); p += 4;
  const internal = [];
  for (let i = 0; i < nInt; i++) { const pth = ustr(); const off = Number(buf.readBigUInt64LE(p)); p += 8; internal.push({ path: pth, offset: off }); }
  const getString = () => { const id = buf.readUInt32LE(p); p += 4; if (id & 0x80000000) { const n = id & 0x7fffffff; const s = buf.toString('utf8', p, p + n); p += n; return s; } return strings[id] ?? `str${id}`; };
  const real = () => { if (realIsDouble) { const v = buf.readDoubleLE(p); p += 8; return v; } const v = buf.readFloatLE(p); p += 4; return v; };
  const f32 = () => { const v = buf.readFloatLE(p); p += 4; return v; };
  const vec = n => { const o = []; for (let i = 0; i < n; i++) o.push(real()); return o; };
  const parse = (depth = 0) => {
    if (depth > 64) throw new RPError('BAD_FORMAT', 'resource nesting too deep');
    const t = buf.readUInt32LE(p); p += 4;
    const kind = R4[t];
    switch (kind) {
      case 'NIL': return V('null', null);
      case 'BOOL': { const v = buf.readUInt32LE(p) !== 0; p += 4; return V('bool', v); }
      case 'INT': { const v = buf.readInt32LE(p); p += 4; return V('int', v); }
      case 'INT64': { const v = Number(buf.readBigInt64LE(p)); p += 8; return V('int', v); }
      case 'FLOAT': return V('float', f32());
      case 'DOUBLE': { const v = buf.readDoubleLE(p); p += 8; return V('float', v); }
      case 'STRING': return V('string', ustr());
      case 'STRING_NAME': return V('stringname', ustr());
      case 'VECTOR2': return V('Vector2', vec(2));
      case 'VECTOR2I': { const v = [buf.readInt32LE(p), buf.readInt32LE(p + 4)]; p += 8; return V('Vector2i', v); }
      case 'RECT2': return V('Rect2', vec(4));
      case 'RECT2I': { const v = [0, 1, 2, 3].map(i => buf.readInt32LE(p + 4 * i)); p += 16; return V('Rect2i', v); }
      case 'VECTOR3': return V('Vector3', vec(3));
      case 'VECTOR3I': { const v = [0, 1, 2].map(i => buf.readInt32LE(p + 4 * i)); p += 12; return V('Vector3i', v); }
      case 'VECTOR4': return V('Vector4', vec(4));
      case 'VECTOR4I': { const v = [0, 1, 2, 3].map(i => buf.readInt32LE(p + 4 * i)); p += 16; return V('Vector4i', v); }
      case 'PLANE': return V('Plane', vec(4));
      case 'QUATERNION': return V('Quaternion', vec(4));
      case 'AABB': return V('AABB', vec(6));
      case 'TRANSFORM2D': return V('Transform2D', vec(6));
      case 'BASIS': return V('Basis', vec(9));
      case 'TRANSFORM3D': return V('Transform3D', vec(12));
      case 'PROJECTION': return V('Projection', vec(16));
      case 'COLOR': return V('Color', [f32(), f32(), f32(), f32()]);
      case 'NODE_PATH': {
        const nc = buf.readUInt16LE(p); let sc = buf.readUInt16LE(p + 2); p += 4;
        const absolute = !!(sc & 0x8000); sc &= 0x7fff; if (format < 3) sc += 1;
        const names = []; for (let i = 0; i < nc; i++) names.push(getString());
        const subs = []; for (let i = 0; i < sc; i++) subs.push(getString());
        return V('NodePath', `${absolute ? '/' : ''}${names.join('/')}${subs.filter(Boolean).length ? ':' + subs.filter(Boolean).join(':') : ''}`);
      }
      case 'RID': { const v = buf.readUInt32LE(p); p += 4; return V('RID', v); }
      case 'OBJECT': {
        const ot = buf.readUInt32LE(p); p += 4;
        if (ot === 0) return V('null', null);
        if (ot === 2) { const idx = buf.readUInt32LE(p); p += 4; return V('sub', namedIds ? (internal[idx]?.path ?? String(idx)).replace(/^local:\/\//, '').replace(/^.*::/, '') : String(idx + 1)); }
        if (ot === 1) { const et = ustr(); const pth = ustr(); return V('extpath', { type: et, path: pth }); }
        if (ot === 3) { const idx = buf.readUInt32LE(p); p += 4; return V('ext', ext[idx]?.id ?? String(idx)); }
        throw new RPError('BAD_FORMAT', `object kind ${ot}`);
      }
      case 'CALLABLE': case 'SIGNAL': return V('null', null);
      case 'DICTIONARY': { const n = buf.readUInt32LE(p) & 0x7fffffff; p += 4; const out = []; for (let i = 0; i < n; i++) { const k = parse(depth + 1); const v = parse(depth + 1); out.push([k, v]); } return V('dict', out); }
      case 'ARRAY': { const n = buf.readUInt32LE(p) & 0x7fffffff; p += 4; const out = []; for (let i = 0; i < n; i++) out.push(parse(depth + 1)); return V('array', out); }
      case 'PACKED_BYTE_ARRAY': { const n = buf.readUInt32LE(p); p += 4; const v = [...buf.subarray(p, p + n)]; p += pad4(n); return V('PackedByteArray', v); }
      case 'PACKED_INT32_ARRAY': { const n = buf.readUInt32LE(p); p += 4; const v = []; for (let i = 0; i < n; i++) { v.push(buf.readInt32LE(p)); p += 4; } return V('PackedInt32Array', v); }
      case 'PACKED_INT64_ARRAY': { const n = buf.readUInt32LE(p); p += 4; const v = []; for (let i = 0; i < n; i++) { v.push(Number(buf.readBigInt64LE(p))); p += 8; } return V('PackedInt64Array', v); }
      case 'PACKED_FLOAT32_ARRAY': { const n = buf.readUInt32LE(p); p += 4; const v = []; for (let i = 0; i < n; i++) v.push(f32()); return V('PackedFloat32Array', v); }
      case 'PACKED_FLOAT64_ARRAY': { const n = buf.readUInt32LE(p); p += 4; const v = []; for (let i = 0; i < n; i++) { v.push(buf.readDoubleLE(p)); p += 8; } return V('PackedFloat64Array', v); }
      case 'PACKED_STRING_ARRAY': { const n = buf.readUInt32LE(p); p += 4; const v = []; for (let i = 0; i < n; i++) v.push(ustr()); return V('PackedStringArray', v); }
      case 'PACKED_VECTOR2_ARRAY': { const n = buf.readUInt32LE(p); p += 4; const v = []; for (let i = 0; i < n; i++) v.push([real(), real()]); return V('PackedVector2Array', v); }
      case 'PACKED_VECTOR3_ARRAY': { const n = buf.readUInt32LE(p); p += 4; const v = []; for (let i = 0; i < n; i++) v.push([real(), real(), real()]); return V('PackedVector3Array', v); }
      case 'PACKED_VECTOR4_ARRAY': { const n = buf.readUInt32LE(p); p += 4; const v = []; for (let i = 0; i < n; i++) v.push([real(), real(), real(), real()]); return V('PackedVector4Array', v); }
      case 'PACKED_COLOR_ARRAY': { const n = buf.readUInt32LE(p); p += 4; const v = []; for (let i = 0; i < n; i++) v.push([f32(), f32(), f32(), f32()]); return V('PackedColorArray', v); }
      default: throw new RPError('BAD_FORMAT', `resource variant ${t} not handled`);
    }
  };
  const resources = [];
  for (const ir of internal) {
    p = ir.offset;
    const rtype = ustr();
    const pc = buf.readUInt32LE(p); p += 4;
    const props = [];
    for (let j = 0; j < pc; j++) { const name = getString(); const value = parse(); props.push([name, value]); }
    resources.push({ path: ir.path, type: rtype, props: props.filter(([k, v]) => !(k === 'script' && v.kind === 'null')), id: namedIds ? ir.path.replace(/^local:\/\//, '').replace(/^.*::/, '') : String(resources.length + 1) });
  }
  return { type, major, minor, format, uid: uid != null ? String(uid) : null, scriptClass, strings: strings.length, ext, resources, namedIds };
}
function hashId(s) { let h = 5381; for (const c of s) h = ((h << 5) + h + c.charCodeAt(0)) >>> 0; return (h % 46656).toString(36).padStart(3, '0').slice(-5); }

function inflateRscc(buf) {
  // FileAccessCompressed: "RSCC", mode u32, block_size u32, read_total u32, then blocks: for each block size u32 … (block data compressed). Modes: 0 FastLZ, 1 Deflate, 2 zstd, 3 gzip.
  const mode = buf.readUInt32LE(4), blockSize = buf.readUInt32LE(8), total = buf.readUInt32LE(12);
  const blocks = Math.ceil(total / blockSize) || 1;
  let p = 16;
  const sizes = [];
  for (let i = 0; i < blocks; i++) { sizes.push(buf.readUInt32LE(p)); p += 4; }
  const out = [];
  for (let i = 0; i < blocks; i++) {
    const chunk = buf.subarray(p, p + sizes[i]); p += sizes[i];
    if (mode === 1) out.push(zlib.inflateRawSync(chunk));
    else if (mode === 2) { if (typeof zlib.zstdDecompressSync !== 'function') throw new RPError('UNSUPPORTED', 'RSCC zstd needs Node 22.15+'); out.push(zlib.zstdDecompressSync(chunk)); }
    else if (mode === 3) out.push(zlib.gunzipSync(chunk));
    else throw new RPError('UNSUPPORTED', `RSCC compression mode ${mode} (FastLZ) is not supported here`);
  }
  return Buffer.concat(out).subarray(0, total);
}

/** PackedScene _bundled dictionary → node list (name, type, parent, instance, properties, groups) + connections. */
export function unpackScene(bundled, major) {
  const d = Object.fromEntries(bundled.value.map(([k, v]) => [k.value, v]));
  const names = (d.names?.value ?? []).map(x => (typeof x === 'string' ? x : x.value ?? x));
  const variants = d.variants?.value ?? [];
  const nodesArr = d.nodes?.value ?? [], conns = d.conns?.value ?? [];
  const nodeCount = d.node_count?.value ?? 0, connCount = d.conn_count?.value ?? 0, version = d.version?.value ?? 1;
  const nodePaths = (d.node_paths?.value ?? []).map(x => (typeof x.value === 'string' ? x.value.replace(/^\.\//, '') : x.value));
  const FLAG_MASK = (1 << 24) - 1, ID_IS_PATH = 1 << 30, TYPE_INSTANTIATED = 0x7fffffff, PLACEHOLDER = 1 << 30, NAME_MASK = (1 << 18) - 1;
  const nodes = [];
  let i = 0;
  for (let n = 0; n < nodeCount; n++) {
    const parent = nodesArr[i++], owner = nodesArr[i++], type = nodesArr[i++], nameIdx = nodesArr[i++], instance = nodesArr[i++];
    const pc = nodesArr[i++]; const props = [];
    for (let j = 0; j < pc; j++) { const pn = nodesArr[i++], pv = nodesArr[i++]; props.push({ name: names[pn & (ID_IS_PATH - 1)] ?? `prop${pn}`, value: variants[pv] ?? V('null', null) }); }
    const gc = nodesArr[i++]; const groups = [];
    for (let j = 0; j < gc; j++) groups.push(names[nodesArr[i++]]);
    nodes.push({ index: n, parent: parent < 0 ? null : parent & ID_IS_PATH ? { path: String(nodePaths[parent & FLAG_MASK] ?? `path${parent & FLAG_MASK}`) } : { node: parent & FLAG_MASK }, owner, type: type === TYPE_INSTANTIATED ? null : names[type] ?? `Type${type}`, name: names[nameIdx & NAME_MASK] ?? `Node${n}`, instance: instance >= 0 ? (instance & PLACEHOLDER ? { placeholder: variants[instance & FLAG_MASK] } : { resource: variants[instance & FLAG_MASK] }) : null, props, groups });
  }
  const connections = [];
  i = 0;
  for (let n = 0; n < connCount; n++) {
    const from = conns[i++], to = conns[i++], signal = conns[i++], method = conns[i++], flags = conns[i++], bc = conns[i++];
    const binds = []; for (let j = 0; j < bc; j++) binds.push(variants[conns[i++]]);
    let unbinds = 0; if (version >= 3) unbinds = conns[i++];
    connections.push({ from: from & ID_IS_PATH ? String(nodePaths[from & FLAG_MASK]) : from & FLAG_MASK, to: to & ID_IS_PATH ? String(nodePaths[to & FLAG_MASK]) : to & FLAG_MASK, signal: names[signal], method: names[method], flags, binds, unbinds });
  }
  return { nodes, connections, version, baseScene: d.base_scene?.value ?? null, editableInstances: (d.editable_instances?.value ?? []).map(x => x.value) };
}

/** Text form of a binary resource: .tscn for PackedScene, .tres otherwise. */
export function rsrcToText(r) {
  const major = r.major >= 4 ? 4 : 3;
  const isScene = r.type === 'PackedScene';
  const lines = [];
  const extLines = r.ext.map(e => (major === 4 ? `[ext_resource type=${qstr(e.type)}${e.uid != null && e.uid >= 0n ? ` uid=${qstr(uidText(e.uid))}` : ''} path=${qstr(e.path)} id=${qstr(e.id)}]` : `[ext_resource path=${qstr(e.path)} type=${qstr(e.type)} id=${e.id}]`));
  const main = r.resources.at(-1);
  const subs = r.resources.slice(0, -1);
  const loadSteps = r.ext.length + subs.length + 1;
  const propLine = (k, v) => `${k} = ${variantText(v, major)}`;
  if (isScene) {
    const bundled = main?.props.find(([k]) => k === '_bundled')?.[1];
    lines.push(`[gd_scene load_steps=${loadSteps} format=${major === 4 ? 3 : 2}${r.uid != null && !r.uid.startsWith('-') ? ` uid=${qstr(uidText(r.uid))}` : ''}]`, '');
    lines.push(...extLines);
    for (const s of subs) { lines.push('', `[sub_resource type=${qstr(s.type)} id=${major === 4 ? qstr(s.id) : s.id}]`, ...s.props.filter(([k]) => !/^resource_(local_to_scene|name)$/.test(k) || true).map(([k, v]) => propLine(k, v))); }
    if (!bundled || bundled.kind !== 'dict') { lines.push('', '# PORT: PackedScene without _bundled data'); return { text: lines.join('\n') + '\n', ext: '.tscn' }; }
    const scene = unpackScene(bundled, major);
    const pathOf = []; // node index → scene path string
    for (const n of scene.nodes) {
      const parentPath = n.parent == null ? null : n.parent.path != null ? n.parent.path : pathOf[n.parent.node];
      const myPath = n.parent == null ? '.' : parentPath === '.' ? n.name : `${parentPath}/${n.name}`;
      pathOf[n.index] = myPath;
      const attrs = [`name=${qstr(n.name)}`];
      if (n.type) attrs.push(`type=${qstr(n.type)}`);
      if (n.parent != null) attrs.push(`parent=${qstr(parentPath ?? '.')}`);
      if (n.instance?.resource) attrs.push(`instance=${variantText(n.instance.resource, major)}`);
      if (n.instance?.placeholder) attrs.push(`instance_placeholder=${variantText(n.instance.placeholder, major)}`);
      if (n.groups.length) attrs.push(`groups=[${n.groups.map(qstr).join(', ')}]`);
      lines.push('', `[node ${attrs.join(' ')}]`);
      for (const pr of n.props) lines.push(propLine(pr.name, pr.value));
    }
    for (const c of scene.connections) lines.push('', `[connection signal=${qstr(c.signal)} from=${qstr(typeof c.from === 'number' ? pathOf[c.from] : c.from)} to=${qstr(typeof c.to === 'number' ? pathOf[c.to] : c.to)} method=${qstr(c.method)}${c.flags && c.flags !== 2 ? ` flags=${c.flags & ~2}` : ''}${c.binds.length ? ` binds=[${c.binds.map(b => variantText(b, major)).join(', ')}]` : ''}${c.unbinds ? ` unbinds=${c.unbinds}` : ''}]`);
    for (const e of scene.editableInstances) lines.push('', `[editable path=${qstr(e)}]`);
    return { text: lines.join('\n') + '\n', ext: '.tscn', nodes: scene.nodes.length, connections: scene.connections.length };
  }
  lines.push(`[gd_resource type=${qstr(r.type)}${r.scriptClass ? ` script_class=${qstr(r.scriptClass)}` : ''} load_steps=${loadSteps} format=${major === 4 ? 3 : 2}${r.uid != null && !r.uid.startsWith('-') ? ` uid=${qstr(uidText(r.uid))}` : ''}]`, '');
  lines.push(...extLines);
  for (const s of subs) { lines.push('', `[sub_resource type=${qstr(s.type)} id=${major === 4 ? qstr(s.id) : s.id}]`, ...s.props.map(([k, v]) => propLine(k, v))); }
  lines.push('', '[resource]', ...(main?.props ?? []).map(([k, v]) => propLine(k, v)));
  return { text: lines.join('\n') + '\n', ext: '.tres' };
}
function uidText(uid) {
  // ResourceUID::id_to_text: base-34 over a–y and 0–8 (Godot core/io/resource_uid.cpp).
  const CH = 'abcdefghijklmnopqrstuvwxy012345678';
  let n = BigInt(uid);
  if (n < 0n) return null;
  let s = '';
  do { s = CH[Number(n % 34n)] + s; n /= 34n; } while (n > 0n);
  return `uid://${s}`;
}

// ------------------------------------------------------------------------------------------------ project.binary
export function decodeProjectBinary(buf) {
  if (buf.toString('latin1', 0, 4) !== 'ECFG') throw new RPError('BAD_FORMAT', 'Not an exported project settings file (ECFG).');
  const count = buf.readUInt32LE(4);
  let p = 8;
  const entries = [];
  for (let i = 0; i < count && p < buf.length; i++) {
    const kl = buf.readUInt32LE(p); p += 4; const key = buf.toString('utf8', p, p + kl); p += kl;
    const vl = buf.readUInt32LE(p); p += 4;
    let value;
    try { value = decodeMarshal(buf, p, 4).value; } catch { try { value = decodeMarshal(buf, p, 3).value; } catch { value = V('string', `<${vl} bytes>`); } }
    p += vl;
    entries.push({ key, value });
  }
  const major = entries.some(e => /(^|\/)config\/features$/.test(e.key) || /_pressed|PackedStringArray|stringname/.test(JSON.stringify(e.value))) ? 4 : 3;
  const sections = new Map();
  for (const e of entries) { const [sec, ...rest] = e.key.includes('/') ? e.key.split('/') : ['', e.key]; const k = rest.join('/'); if (!sections.has(sec)) sections.set(sec, []); sections.get(sec).push([k, e.value]); }
  const lines = ['; Engine configuration file.', '; Rebuilt by ReversePort from project.binary (an export); defaults are not included.', '', `config_version=${major === 4 ? 5 : 4}`, ''];
  for (const [sec, items] of [...sections.entries()].sort((a, b) => (a[0] === '' ? -1 : b[0] === '' ? 1 : a[0].localeCompare(b[0])))) {
    if (sec) lines.push(`[${sec}]`, '');
    for (const [k, v] of items) lines.push(`${k}=${variantText(v, major)}`);
    lines.push('');
  }
  return { major, settings: entries.length, text: lines.join('\n') };
}

// ------------------------------------------------------------------------------------------------ tool
export async function decodeTool({ path: target, out, limit: max = 2000 } = {}) {
  if (!target) throw new RPError('INVALID_ARGUMENT', 'path is required: a .gdc/.scn/.res/project.binary file, or a folder (an extracted .pck).');
  const abs = path.resolve(target);
  const st = await statOrNull(abs);
  if (!st) throw new RPError('NOT_FOUND', `not found: ${abs}`);
  const files = [];
  let root;
  const remaps = new Map(); // exported file → original path, from the .remap files an export leaves
  if (st.isDirectory()) { root = await requireDir(abs); const w = await walk(root, { maxFiles: 50000, ignore: new Set(['.git', 'node_modules']) });
    for (const f of w.files) if (f.rel.endsWith('.remap')) { const t = await fs.readFile(f.abs, 'utf8').catch(() => ''); const m = t.match(/^path="res:\/\/([^"]+)"/m); if (m) remaps.set(m[1], f.rel.split(path.sep).join('/').replace(/\.remap$/, '')); }
    for (const f of w.files) if (/\.(gdc|gde|scn|res|binary|material|mesh|tres|anim|shader)$/i.test(f.rel) || path.basename(f.rel) === 'project.binary') files.push({ rel: f.rel, abs: f.abs }); }
  else { root = path.dirname(abs); files.push({ rel: path.basename(abs), abs }); }
  const outDir = out ? path.resolve(out) : path.join(await workspaceDir('decoded'), path.basename(root).replace(/[^A-Za-z0-9._-]+/g, '_') || 'project');
  const results = [], skipped = [];
  let written = 0;
  for (const f of files.slice(0, max)) {
    const buf = await fs.readFile(f.abs).catch(() => null);
    if (!buf) continue;
    const magic = buf.toString('latin1', 0, 4);
    try {
      let text, destRel, info = {};
      if (magic === 'GDSC') { const r = decodeGdc(buf); text = r.source; destRel = f.rel.replace(/\.gdc$/i, '.gd'); info = { engine: r.engine, bytecodeVersion: r.bytecodeVersion, tokens: r.tokens, ...(r.compressed ? { compressed: true } : {}), ...(r.warnings.length ? { warnings: r.warnings.slice(0, 5) } : {}) }; }
      else if (magic === 'RSRC' || magic === 'RSCC') { const r = readRsrc(buf); const t = rsrcToText(r); text = t.text; const orig = remaps.get(f.rel.split(path.sep).join('/')); destRel = orig ? orig.replace(/\.(tscn|tres|scn|res)$/i, t.ext) : f.rel.replace(/\.(scn|res)$/i, t.ext); if (destRel === f.rel) destRel += t.ext; info = { type: r.type, godot: `${r.major}.${r.minor}`, format: r.format, ...(t.nodes != null ? { nodes: t.nodes, connections: t.connections } : {}), resources: r.resources.length, external: r.ext.length }; }
      else if (magic === 'ECFG') { const r = decodeProjectBinary(buf); text = r.text; destRel = path.posix.join(path.posix.dirname(f.rel.split(path.sep).join('/')), 'project.godot'); info = { settings: r.settings, godot: r.major }; }
      else if (magic === 'GDPC') { skipped.push({ file: f.rel, reason: 'a pack: extract it with re_archive first, then decode the folder' }); continue; }
      else if (/^\[gd_(scene|resource)|^;|^extends|^@tool|^class_name|^shader_type/.test(buf.toString('utf8', 0, 64))) { skipped.push({ file: f.rel, reason: 'already text' }); continue; }
      else { skipped.push({ file: f.rel, reason: `not a Godot binary format (${JSON.stringify(magic)})` }); continue; }
      const dest = path.join(outDir, destRel);
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.writeFile(dest, text);
      written++;
      results.push({ file: f.rel, decoded: destRel, ...info });
    } catch (e) { skipped.push({ file: f.rel, reason: e.message }); }
  }
  const byKind = {};
  for (const r of results) byKind[r.decoded.split('.').pop()] = (byKind[r.decoded.split('.').pop()] ?? 0) + 1;
  return {
    source: root, out: outDir, decoded: written, byKind, files: results.slice(0, 500), skipped: skipped.slice(0, 200), truncated: files.length > max,
    next: written ? `Open ${outDir} as a Godot project (project.godot was rebuilt if project.binary was present; textures stay .ctex/.stex imports — copy the original .import files or re-import). Comments and formatting are gone; names, constants and structure are exact. Run re_apicheck on the .gd files to confirm the Godot version, then re_graph/port_plan as usual.` : 'Nothing decoded: give a .gdc, .scn, .res or project.binary, or the folder re_archive extracted from the .pck.',
  };
}
