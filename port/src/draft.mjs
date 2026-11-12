// port_draft: a mechanical first draft of a GDScript file in C#, for Godot C# or Unity.
// The code is parsed (logical lines → block tree → expression trees), not pattern-replaced, so nested calls,
// ternaries, string formatting, match, signals, await and node paths survive. Names are resolved against the
// script's own members, the engine API snapshot (inherited methods, properties, signals), the scenes that use the
// script (node types behind $Path) and the project's autoloads.
// Everything that cannot be carried over mechanically keeps its place in the file and gets a `PORT:` comment that
// says what is missing; nothing is dropped silently. The result is a draft to review and build, not a finished port.
import fs from 'node:fs/promises';
import path from 'node:path';
import { RPError, requireFile, walk, pascalCase, statOrNull } from './util.mjs';
import { workspaceDir } from './workspace.mjs';
import { snapshot, members as apiMembers, resolveVersion } from './apicheck.mjs';
import { apiHits, mapFor } from './knowledge.mjs';

export const DRAFT_TARGETS = ['godot-csharp', 'unity'];
const MAX_SOURCE = 2 * 1024 * 1024;

// ------------------------------------------------------------------------------------------------ lexer
const OPS = ['**=', '<<=', '>>=', '**', '<<', '>>', '==', '!=', '<=', '>=', '&&', '||', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', ':=', '->', '..',
  '+', '-', '*', '/', '%', '=', '<', '>', '!', '&', '|', '^', '~', '(', ')', '[', ']', '{', '}', ',', ':', '.', ';', '@'];
const ASSIGN = new Set(['=', '+=', '-=', '*=', '/=', '%=', '**=', '&=', '|=', '^=', '<<=', '>>=']);

class DraftError extends Error {}

/** Read one string literal starting at i (after any prefix). Returns { body, end, triple }. */
function readString(src, i) {
  const q = src[i];
  const triple = src.startsWith(q.repeat(3), i);
  const open = triple ? 3 : 1;
  let j = i + open;
  for (; j < src.length; j++) {
    if (src[j] === '\\') { j++; continue; }
    if (triple ? src.startsWith(q.repeat(3), j) : src[j] === q) return { body: src.slice(i + open, j), end: j + open, triple, quote: q };
    if (!triple && src[j] === '\n') break;
  }
  throw new DraftError('unterminated string');
}

export function tokenize(src) {
  const out = [];
  let i = 0;
  const operandNext = () => { const p = out.at(-1); return !p || (p.t === 'op' && ![')', ']', '}'].includes(p.v)) || (p.t === 'id' && ['and', 'or', 'not', 'in', 'is', 'as', 'if', 'else', 'return', 'await'].includes(p.v)); };
  while (i < src.length) {
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\\') { i++; continue; }
    if (c === '#') { while (i < src.length && src[i] !== '\n') i++; continue; }
    const prefixed = /[&^r]/.test(c) && (src[i + 1] === '"' || src[i + 1] === "'");
    if (c === '"' || c === "'" || prefixed) {
      const s = readString(src, prefixed ? i + 1 : i);
      out.push({ t: 'str', body: s.body, quote: s.quote, triple: s.triple, raw: prefixed && c === 'r' });
      i = s.end;
      continue;
    }
    if (c === '$') {
      if (src[i + 1] === '"' || src[i + 1] === "'") { const s = readString(src, i + 1); out.push({ t: 'node', v: s.body }); i = s.end; continue; }
      const m = /^\$((?:\.\.|[A-Za-z0-9_%]+)(?:\/(?:\.\.|[A-Za-z0-9_%]+))*)/.exec(src.slice(i));
      if (!m) throw new DraftError('bad node path');
      out.push({ t: 'node', v: m[1] });
      i += m[0].length;
      continue;
    }
    if (c === '%' && operandNext() && /[A-Za-z_]/.test(src[i + 1] ?? '')) {
      const m = /^%([A-Za-z0-9_]+)/.exec(src.slice(i));
      out.push({ t: 'node', v: `%${m[1]}` });
      i += m[0].length;
      continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      const m = /^(0[xX][0-9a-fA-F_]+|0[bB][01_]+|(?:\d[\d_]*)?\.?\d[\d_]*(?:[eE][-+]?\d+)?\.?)/.exec(src.slice(i));
      let v = m[1];
      // "1.method()" is not valid GDScript, so a trailing dot belongs to the number ("1." is 1.0).
      if (v.endsWith('.') && /[A-Za-z_]/.test(src[i + v.length] ?? '')) v = v.slice(0, -1);
      out.push({ t: 'num', v });
      i += v.length;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_]\w*/.exec(src.slice(i));
      out.push({ t: 'id', v: m[0] });
      i += m[0].length;
      continue;
    }
    const op = OPS.find(o => src.startsWith(o, i));
    if (!op) throw new DraftError(`unexpected character ${c}`);
    out.push({ t: 'op', v: op });
    i += op.length;
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ expression parser
/** Lookup table without Object.prototype, so a script identifier such as `constructor` never matches. */
const table = o => Object.assign(Object.create(null), o);
const BIN = table({ or: 1, '||': 1, and: 2, '&&': 2, in: 4, '==': 5, '!=': 5, '<': 5, '>': 5, '<=': 5, '>=': 5, is: 5, '|': 6, '^': 7, '&': 8, '<<': 9, '>>': 9, '+': 10, '-': 10, '*': 11, '/': 11, '%': 11, '**': 13, as: 14 });

class Parser {
  constructor(tokens) { this.t = tokens; this.i = 0; }
  peek(o = 0) { return this.t[this.i + o]; }
  is(v, o = 0) { const p = this.t[this.i + o]; return !!p && p.t !== 'str' && p.t !== 'num' && p.t !== 'node' && p.v === v; }
  eat(v) { if (!this.is(v)) throw new DraftError(`expected ${v}`); return this.t[this.i++]; }
  done() { return this.i >= this.t.length; }

  expr() {
    const a = this.bin(1);
    if (this.is('if')) {
      this.i++;
      const c = this.bin(1);
      this.eat('else');
      return { k: 'tern', c, a, b: this.expr() };
    }
    return a;
  }
  typeRef() {
    let name = this.t[this.i++]?.v;
    if (typeof name !== 'string') throw new DraftError('expected a type');
    while (this.is('.')) { this.i++; name += `.${this.t[this.i++].v}`; }
    if (this.is('[')) {
      this.i++;
      const args = [];
      while (!this.is(']')) { args.push(this.typeRef()); if (this.is(',')) this.i++; }
      this.i++;
      name += `[${args.join(', ')}]`;
    }
    return name;
  }
  bin(min) {
    let left = this.unary();
    for (;;) {
      const p = this.peek();
      if (!p || p.t === 'str' || p.t === 'num' || p.t === 'node') break;
      let op = p.v, width = 1;
      if (op === 'not' && this.is('in', 1)) { op = 'not in'; width = 2; }
      const prec = op === 'not in' ? BIN.in : BIN[op];
      if (!prec || prec < min) break;
      this.i += width;
      if (op === 'is') {
        const negate = this.is('not');
        if (negate) this.i++;
        left = { k: 'is', e: left, type: this.typeRef(), negate };
      } else if (op === 'as') left = { k: 'as', e: left, type: this.typeRef() };
      else left = { k: 'bin', op, a: left, b: this.bin(op === '**' ? prec : prec + 1) };
    }
    return left;
  }
  unary() {
    if (this.is('not') || this.is('!')) { this.i++; return { k: 'un', op: '!', e: this.bin(3) }; }
    if (this.is('-') || this.is('+') || this.is('~')) { const op = this.t[this.i++].v; return { k: 'un', op, e: this.bin(12) }; }
    if (this.is('await')) { this.i++; return { k: 'await', e: this.bin(15) }; }
    return this.postfix(this.primary());
  }
  args(close) {
    const list = [];
    while (!this.is(close)) {
      if (this.done()) throw new DraftError(`missing ${close}`);
      list.push(this.expr());
      if (this.is(',')) this.i++;
      else if (!this.is(close)) throw new DraftError(`expected , or ${close}`);
    }
    this.i++;
    return list;
  }
  postfix(e) {
    for (;;) {
      if (this.is('.')) {
        this.i++;
        const n = this.t[this.i++];
        if (!n || n.t !== 'id') throw new DraftError('expected a member name');
        e = { k: 'attr', e, name: n.v };
      } else if (this.is('(')) { this.i++; e = { k: 'call', f: e, args: this.args(')') }; }
      else if (this.is('[')) { this.i++; const idx = this.expr(); this.eat(']'); e = { k: 'index', e, idx }; }
      else return e;
    }
  }
  primary() {
    const p = this.t[this.i++];
    if (!p) throw new DraftError('unexpected end');
    if (p.t === 'num') return { k: 'num', v: p.v };
    if (p.t === 'str') return { k: 'str', tok: p };
    if (p.t === 'node') return { k: 'node', path: p.v };
    if (p.t === 'id') {
      if (p.v === 'func') return this.lambda();
      if (['if', 'else', 'in', 'is', 'as', 'and', 'or', 'elif', 'for', 'while', 'var', 'return'].includes(p.v)) throw new DraftError(`unexpected ${p.v}`);
      return { k: 'name', v: p.v };
    }
    if (p.v === '(') { const e = this.expr(); this.eat(')'); return { k: 'paren', e }; }
    if (p.v === '[') return { k: 'array', items: this.args(']') };
    if (p.v === '{') {
      const pairs = [];
      while (!this.is('}')) {
        if (this.done()) throw new DraftError('missing }');
        let key = this.expr();
        if (this.is('=')) { this.i++; if (key.k !== 'name') throw new DraftError('bad dictionary key'); key = { k: 'str', tok: { body: key.v, quote: '"' } }; }
        else this.eat(':');
        pairs.push([key, this.expr()]);
        if (this.is(',')) this.i++;
      }
      this.i++;
      return { k: 'dict', pairs };
    }
    throw new DraftError(`unexpected ${p.v}`);
  }
  lambda() {
    if (this.peek()?.t === 'id' && this.is('(', 1)) this.i++;
    this.eat('(');
    const params = [];
    while (!this.is(')')) {
      const n = this.t[this.i++];
      if (!n || n.t !== 'id') throw new DraftError('bad lambda parameter');
      let type = null;
      if (this.is(':')) { this.i++; type = this.typeRef(); }
      if (this.is('=') || this.is(':=')) throw new DraftError('lambda default value');
      params.push({ name: n.v, type });
      if (this.is(',')) this.i++;
    }
    this.i++;
    if (this.is('->')) { this.i++; this.typeRef(); }
    this.eat(':');
    if (this.is('return')) this.i++;
    if (this.done()) throw new DraftError('multi-line lambda');
    return { k: 'lambda', params, body: this.expr() };
  }
}

export function parseExpr(text) {
  const p = new Parser(tokenize(text));
  const e = p.expr();
  if (!p.done()) throw new DraftError(`unexpected ${p.peek().v ?? 'token'}`);
  return e;
}

// ------------------------------------------------------------------------------------------------ lines and blocks
/** Split GDScript into logical lines: brackets and backslashes continue a line; comments are kept apart. */
export function logicalLines(text) {
  const lines = [];
  let cur = null, depth = 0, i = 0, lineNo = 1;
  const src = text.replace(/\r\n?/g, '\n');
  const start = () => { cur = { line: lineNo, text: '', comment: '', indent: 0, sawCode: false }; };
  const flush = () => { if (cur) { cur.text = cur.text.trim(); lines.push(cur); cur = null; } };
  start();
  while (i < src.length) {
    const c = src[i];
    if (c === '\n') {
      lineNo++; i++;
      if (depth > 0 || cur.text.endsWith('\\')) { cur.text = `${cur.text.replace(/\\$/, '')} `; continue; }
      flush(); start();
      continue;
    }
    if (!cur.sawCode && (c === ' ' || c === '\t')) { cur.indent += c === '\t' ? 4 : 1; i++; continue; }
    if (c === '#') {
      let j = i;
      while (j < src.length && src[j] !== '\n') j++;
      const note = src.slice(i, j);
      if (depth === 0) cur.comment = cur.comment ? `${cur.comment} ${note}` : note;
      i = j;
      continue;
    }
    cur.sawCode = true;
    const prefixed = /[&^r]/.test(c) && (src[i + 1] === '"' || src[i + 1] === "'") && !/\w/.test(src[i - 1] ?? '');
    if (c === '"' || c === "'" || prefixed) {
      let s;
      try { s = readString(src, prefixed ? i + 1 : i); } catch { s = { end: src.indexOf('\n', i) === -1 ? src.length : src.indexOf('\n', i) }; }
      const piece = src.slice(i, s.end);
      lineNo += (piece.match(/\n/g) ?? []).length;
      cur.text += piece;
      i = s.end;
      continue;
    }
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth = Math.max(0, depth - 1);
    cur.text += c;
    i++;
  }
  flush();
  // Comment-only and blank lines take the indent of the next code line, so they never open or close a block.
  let next = 0;
  for (let k = lines.length - 1; k >= 0; k--) { if (lines[k].text) next = lines[k].indent; else lines[k].indent = next; }
  return lines;
}

/** Index of the colon that ends a block header (outside brackets and strings), or -1. */
function headerColon(text) {
  let depth = 0;
  // In "for x: Type in list:" the first colon is a type hint.
  const start = /^for\b/.test(text) ? Math.max(0, text.search(/\sin\s/)) : 0;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'") { try { i = readString(text, i).end - 1; } catch { return -1; } continue; }
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) depth--;
    else if (c === ':' && depth === 0 && text[i + 1] !== '=') return i;
  }
  return -1;
}

const BLOCK_START = /^(?:if|elif|else|for|while|match|func|static\s+func|class)\b/;

export function blockTree(lines) {
  const root = { children: [], indent: -1 };
  const stack = [root];
  for (const l of lines) {
    while (stack.length > 1 && l.indent <= stack.at(-1).indent) stack.pop();
    if (!l.text && !l.comment) { stack.at(-1).children.push({ blank: true, line: l.line, children: [] }); continue; }
    const node = { text: l.text, comment: l.comment, line: l.line, indent: l.indent, children: [] };
    stack.at(-1).children.push(node);
    if (l.text) stack.push(node);
  }
  return root.children;
}

// ------------------------------------------------------------------------------------------------ names and types
const CS_KEYWORDS = new Set('abstract as base bool break byte case catch char checked class const continue decimal default delegate do double else enum event explicit extern false finally fixed float for foreach goto if implicit in int interface internal is lock long namespace new null object operator out override params private protected public readonly ref return sbyte sealed short sizeof stackalloc static string struct switch this throw true try typeof uint ulong unchecked unsafe ushort using virtual void volatile while'.split(' '));
const words = s => s.split('_').filter(Boolean);
const cap = w => w[0].toUpperCase() + w.slice(1);
const isConstName = n => /^[A-Z][A-Z0-9_]*$/.test(n) && /[A-Z]{2}|_/.test(n);
/** snake_case → PascalCase; names that already have capitals keep them. */
const pascal = n => words(n).map(w => (/^[A-Z0-9]+$/.test(w) && w.length > 1 ? cap(w.toLowerCase()) : cap(w))).join('') || n;
const camel = n => { const p = words(n).map((w, i) => (i ? cap(w) : w)).join('') || n; return CS_KEYWORDS.has(p) ? `@${p}` : p; };
const memberVarName = (n, d) => (n.startsWith('_') ? `_${camel(n.replace(/^_+/, '')).replace(/^@/, '')}` : d === 'unity' ? camel(n) : pascal(n));
const methodName = n => pascal(n.replace(/^_+/, ''));

const GODOT_VIRTUALS = table({ _ready: [], _process: ['double'], _physics_process: ['double'], _enter_tree: [], _exit_tree: [], _input: ['InputEvent'], _unhandled_input: ['InputEvent'], _unhandled_key_input: ['InputEvent'], _shortcut_input: ['InputEvent'], _gui_input: ['InputEvent'], _draw: [], _notification: ['int'], _integrate_forces: null, _get_configuration_warnings: null, _to_string: null });
const UNITY_LIFECYCLE = table({ _ready: 'Awake', _process: 'Update', _physics_process: 'FixedUpdate', _enter_tree: 'OnEnable', _exit_tree: 'OnDestroy' });

const TYPES_GODOT = table({ int: 'int', float: 'float', bool: 'bool', String: 'string', void: 'void', Variant: 'Variant', Array: 'Godot.Collections.Array', Dictionary: 'Godot.Collections.Dictionary', Object: 'GodotObject',
  PackedStringArray: 'string[]', PackedInt32Array: 'int[]', PackedInt64Array: 'long[]', PackedFloat32Array: 'float[]', PackedFloat64Array: 'double[]', PackedVector2Array: 'Vector2[]', PackedVector3Array: 'Vector3[]', PackedColorArray: 'Color[]', PackedByteArray: 'byte[]' });
const TYPES_UNITY = table({ ...TYPES_GODOT, Variant: 'object', Array: 'List<object>', Dictionary: 'Dictionary<object, object>', Object: 'object', StringName: 'string', NodePath: 'string', PackedScene: 'GameObject', Node: 'GameObject', Node2D: 'Transform', Node3D: 'Transform' });

function csType(t, ctx) {
  const d = ctx.d;
  const types = d === 'unity' ? TYPES_UNITY : TYPES_GODOT;
  const s = String(t ?? '').trim();
  if (!s) return types.Variant;
  const g = /^(\w+)\[(.+)\]$/.exec(s);
  if (g) {
    const inner = g[2].split(',').map(x => csType(x, ctx));
    if (g[1] === 'Array') { if (d === 'unity') ctx.usings.add('System.Collections.Generic'); return d === 'unity' ? `List<${inner[0]}>` : `Godot.Collections.Array<${inner[0]}>`; }
    if (g[1] === 'Dictionary') { if (d === 'unity') ctx.usings.add('System.Collections.Generic'); return d === 'unity' ? `Dictionary<${inner.join(', ')}>` : `Godot.Collections.Dictionary<${inner.join(', ')}>`; }
  }
  if (d === 'unity' && (s === 'Array' || s === 'Dictionary')) ctx.usings.add('System.Collections.Generic');
  if (types[s]) return types[s];
  if (d === 'unity' && ctx.api.classSet.has(s) && !ctx.api.classes[s].builtin) ctx.mark(`Godot type ${s}: use the Unity component for it`);
  return s;
}

const VECTOR_CONSTS = new Set(['ZERO', 'ONE', 'INF', 'LEFT', 'RIGHT', 'UP', 'DOWN', 'FORWARD', 'BACK', 'AXIS_X', 'AXIS_Y', 'AXIS_Z', 'MIN', 'MAX', 'IDENTITY', 'FLIP_X', 'FLIP_Y', 'FLIP_Z']);
const STRUCT_TYPES = new Set(['Vector2', 'Vector2i', 'Vector3', 'Vector3i', 'Vector4', 'Vector4i', 'Transform2D', 'Transform3D', 'Basis', 'Quaternion', 'Rect2', 'Rect2i', 'AABB', 'Plane']);
const UNITY_COLORS = new Set(['red', 'green', 'blue', 'white', 'black', 'yellow', 'cyan', 'magenta', 'gray', 'grey', 'clear']);
// Properties that hold a struct: C# cannot change one field of them in place.
const STRUCT_PROPS = new Set(['velocity', 'position', 'global_position', 'scale', 'rotation', 'rotation_degrees', 'global_rotation', 'global_rotation_degrees', 'modulate', 'self_modulate', 'size', 'linear_velocity', 'angular_velocity', 'offset', 'transform', 'global_transform', 'color', 'custom_minimum_size', 'pivot_offset', 'global_scale', 'constant_linear_velocity', 'region_rect']);
const STRUCT_FIELDS = new Set(['x', 'y', 'z', 'w', 'r', 'g', 'b', 'a', 'origin', 'basis', 'position', 'size', 'end']);

// Global functions with a direct equivalent. `null` receiver means "call as written".
const GLOBALS_GODOT = table({ print: 'GD.Print', prints: 'GD.PrintS', printt: 'GD.PrintT', printerr: 'GD.PrintErr', print_rich: 'GD.PrintRich', print_debug: 'GD.Print', push_error: 'GD.PushError', push_warning: 'GD.PushWarning', str: 'GD.Str', load: 'GD.Load', randf: 'GD.Randf', randi: 'GD.Randi', randf_range: 'GD.RandRange', randi_range: 'GD.RandRange', randfn: 'GD.Randfn', randomize: 'GD.Randomize', seed: 'GD.Seed', range: 'GD.Range', var_to_str: 'GD.VarToStr', str_to_var: 'GD.StrToVar', var_to_bytes: 'GD.VarToBytes', bytes_to_var: 'GD.BytesToVar', hash: 'GD.Hash', instance_from_id: 'GodotObject.InstanceFromId', is_instance_valid: 'GodotObject.IsInstanceValid', is_instance_id_valid: 'GodotObject.IsInstanceIdValid', weakref: 'GodotObject.WeakRef',
  abs: 'Mathf.Abs', absf: 'Mathf.Abs', absi: 'Mathf.Abs', sign: 'Mathf.Sign', signf: 'Mathf.Sign', signi: 'Mathf.Sign', min: 'Mathf.Min', minf: 'Mathf.Min', mini: 'Mathf.Min', max: 'Mathf.Max', maxf: 'Mathf.Max', maxi: 'Mathf.Max', clamp: 'Mathf.Clamp', clampf: 'Mathf.Clamp', clampi: 'Mathf.Clamp', lerp: 'Mathf.Lerp', lerpf: 'Mathf.Lerp', lerp_angle: 'Mathf.LerpAngle', inverse_lerp: 'Mathf.InverseLerp', remap: 'Mathf.Remap', smoothstep: 'Mathf.SmoothStep', move_toward: 'Mathf.MoveToward', floor: 'Mathf.Floor', floorf: 'Mathf.Floor', floori: 'Mathf.FloorToInt', ceil: 'Mathf.Ceil', ceilf: 'Mathf.Ceil', ceili: 'Mathf.CeilToInt', round: 'Mathf.Round', roundf: 'Mathf.Round', roundi: 'Mathf.RoundToInt', sqrt: 'Mathf.Sqrt', pow: 'Mathf.Pow', exp: 'Mathf.Exp', log: 'Mathf.Log', sin: 'Mathf.Sin', cos: 'Mathf.Cos', tan: 'Mathf.Tan', asin: 'Mathf.Asin', acos: 'Mathf.Acos', atan: 'Mathf.Atan', atan2: 'Mathf.Atan2', fmod: 'Mathf.PosMod', fposmod: 'Mathf.PosMod', posmod: 'Mathf.PosMod', wrapf: 'Mathf.Wrap', wrapi: 'Mathf.Wrap', snapped: 'Mathf.Snapped', snappedf: 'Mathf.Snapped', snappedi: 'Mathf.Snapped', deg_to_rad: 'Mathf.DegToRad', rad_to_deg: 'Mathf.RadToDeg', is_equal_approx: 'Mathf.IsEqualApprox', is_zero_approx: 'Mathf.IsZeroApprox', is_nan: 'Mathf.IsNaN', is_inf: 'Mathf.IsInf', is_finite: 'Mathf.IsFinite', nearest_po2: 'Mathf.NearestPo2', pingpong: 'Mathf.PingPong', angle_difference: 'Mathf.AngleDifference' });
// fmod keeps the sign of the dividend in GDScript, as C# % does.
GLOBALS_GODOT.fmod = null;
const GLOBALS_UNITY = table({ print: 'Debug.Log', print_debug: 'Debug.Log', print_rich: 'Debug.Log', printerr: 'Debug.LogError', push_error: 'Debug.LogError', push_warning: 'Debug.LogWarning',
  abs: 'Mathf.Abs', absf: 'Mathf.Abs', absi: 'Mathf.Abs', sign: 'Mathf.Sign', signf: 'Mathf.Sign', min: 'Mathf.Min', minf: 'Mathf.Min', mini: 'Mathf.Min', max: 'Mathf.Max', maxf: 'Mathf.Max', maxi: 'Mathf.Max', clamp: 'Mathf.Clamp', clampf: 'Mathf.Clamp', clampi: 'Mathf.Clamp', lerp: 'Mathf.LerpUnclamped', lerpf: 'Mathf.LerpUnclamped', inverse_lerp: 'Mathf.InverseLerp', move_toward: 'Mathf.MoveTowards', floor: 'Mathf.Floor', floorf: 'Mathf.Floor', floori: 'Mathf.FloorToInt', ceil: 'Mathf.Ceil', ceilf: 'Mathf.Ceil', ceili: 'Mathf.CeilToInt', round: 'Mathf.Round', roundf: 'Mathf.Round', roundi: 'Mathf.RoundToInt', sqrt: 'Mathf.Sqrt', pow: 'Mathf.Pow', exp: 'Mathf.Exp', log: 'Mathf.Log', sin: 'Mathf.Sin', cos: 'Mathf.Cos', tan: 'Mathf.Tan', asin: 'Mathf.Asin', acos: 'Mathf.Acos', atan: 'Mathf.Atan', atan2: 'Mathf.Atan2', pingpong: 'Mathf.PingPong', is_equal_approx: 'Mathf.Approximately', randf_range: 'Random.Range' });
const RESOURCE_TYPES = [[/\.(tscn|scn)$/i, 'PackedScene'], [/\.(png|jpe?g|webp|svg|bmp|tga|exr|hdr)$/i, 'Texture2D'], [/\.(wav|ogg|mp3)$/i, 'AudioStream'], [/\.(ttf|otf|woff2?)$/i, 'FontFile'], [/\.gdshader$/i, 'Shader'], [/\.(glb|gltf|fbx|obj)$/i, 'PackedScene'], [/\.gd$/i, 'GDScript']];
const resourceType = p => RESOURCE_TYPES.find(([re]) => re.test(p))?.[1] ?? 'Resource';

// ------------------------------------------------------------------------------------------------ project facts
const sceneCache = new Map();
/** Nodes of every scene that has a script, per project root. Kept for a few seconds so a batch reads the project once. */
async function sceneIndex(root) {
  const hit = sceneCache.get(root);
  if (hit && Date.now() - hit.at < 5000) return hit.scenes;
  const { files } = await walk(root, { maxFiles: 20000 });
  const parsed = [];
  for (const f of files.filter(x => x.ext === '.tscn' && x.size <= MAX_SOURCE).slice(0, 3000)) {
    const text = await fs.readFile(f.abs, 'utf8').catch(() => '');
    const ext = new Map();
    for (const m of text.matchAll(/^\[ext_resource ([^\]]*)\]/gm)) { const p = /path="([^"]+)"/.exec(m[1])?.[1], id = /\bid="?([^"\s\]]+)"?/.exec(m[1])?.[1]; if (p && id) ext.set(id, p); }
    const nodes = [];
    for (const m of text.matchAll(/^\[node ((?:[^\]"[]|"[^"]*"|\[[^\]]*\])*)\]\s*$([\s\S]*?)(?=^\[|(?![\s\S]))/gm)) {
      const head = m[1], name = /name="([^"]+)"/.exec(head)?.[1], parent = /parent="([^"]+)"/.exec(head)?.[1];
      if (!name) continue;
      const inst = /instance=ExtResource\(\s*"?([^")\s]+)"?\s*\)/.exec(head)?.[1];
      const script = /^script = ExtResource\(\s*"?([^")\s]+)"?\s*\)/m.exec(m[2])?.[1];
      nodes.push({ path: parent === undefined ? '.' : parent === '.' ? name : `${parent}/${name}`, name, type: /type="(\w+)"/.exec(head)?.[1] ?? null, instance: inst ? ext.get(inst)?.replace(/^res:\/\//, '') ?? null : null, script: script ? ext.get(script) : null, unique: /^unique_name_in_owner = true/m.test(m[2]) });
    }
    parsed.push({ rel: f.rel, nodes });
  }
  // A node with a GDScript is an instance of that script's class (named after the file, as port_plan names it);
  // an instanced scene has the type of that scene's root node.
  const scripted = n => (n.script && /\.gd$/i.test(n.script) ? pascalCase(path.posix.basename(n.script)) : null);
  const rootType = new Map(parsed.map(sc => [sc.rel, sc.nodes[0] ? scripted(sc.nodes[0]) ?? sc.nodes[0].type : null]));
  for (const sc of parsed) for (const n of sc.nodes) n.type = scripted(n) ?? n.type ?? (n.instance ? rootType.get(n.instance) ?? null : null);
  const scenes = parsed.filter(sc => sc.nodes.some(n => n.script));
  sceneCache.set(root, { at: Date.now(), scenes });
  return scenes;
}

/** Autoloads and the node types behind a script's $paths, read from project.godot and the .tscn files. */
export async function projectFacts(file) {
  const facts = { root: null, autoloads: new Map(), nodeTypes: new Map(), unique: new Map(), scenes: [] };
  let dir = path.dirname(path.resolve(file));
  for (let i = 0; i < 12; i++) {
    if (await statOrNull(path.join(dir, 'project.godot'))) { facts.root = dir; break; }
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  if (!facts.root) return facts;
  const cfg = await fs.readFile(path.join(facts.root, 'project.godot'), 'utf8').catch(() => '');
  const auto = /^\[autoload\]\s*$([\s\S]*?)(?=^\[|(?![\s\S]))/m.exec(cfg)?.[1] ?? '';
  for (const m of auto.matchAll(/^(\w+)="\*?(?:res:\/\/)?([^"]+)"/gm)) facts.autoloads.set(m[1], m[2]);
  const res = `res://${path.relative(facts.root, path.resolve(file)).split(path.sep).join('/')}`;
  for (const scene of await sceneIndex(facts.root)) {
    for (const owner of scene.nodes.filter(n => n.script === res)) {
      facts.scenes.push(scene.rel);
      const prefix = owner.path === '.' ? '' : `${owner.path}/`;
      for (const n of scene.nodes) {
        if (n === owner || !n.type || (prefix && !n.path.startsWith(prefix))) continue;
        const rel = n.path.slice(prefix.length);
        if (rel === '.') continue;
        if (!facts.nodeTypes.has(rel)) facts.nodeTypes.set(rel, n.type);
        if (n.unique && !facts.unique.has(n.name)) facts.unique.set(n.name, n.type);
      }
    }
  }
  return facts;
}

// ------------------------------------------------------------------------------------------------ expressions → C#
/** Body of a '…' literal as the body of a "…" literal: an escaped ' loses its backslash, a bare " gains one. */
const fromSingleQuoted = body => body.replace(/\\([\s\S])|"/g, (m, ch) => (m === '"' ? '\\"' : ch === "'" ? "'" : m));

function csString(tok) {
  let b = tok.body;
  if (tok.raw) return `@"${b.replace(/"/g, '""')}"`;
  if (tok.quote === "'") b = fromSingleQuoted(b);
  b = b.replace(/\\\n/g, '').replace(/\r?\n/g, '\\n');
  if (tok.triple) b = b.replace(/(^|[^\\])((?:\\\\)*)"/g, '$1$2\\"');
  return `"${b}"`;
}

function csNumber(v) {
  if (/^0[xXbB]/.test(v)) return v;
  if (/[.eE]/.test(v)) return `${v.replace(/\.$/, '.0').replace(/^\./, '0.')}f`;
  return v;
}

const isSimple = e => ['name', 'num', 'str', 'call', 'attr', 'index', 'paren', 'node', 'array', 'dict'].includes(e.k);
const wrap = (e, s) => (isSimple(e) ? s : `(${s})`);

/** "Score: %d" % x → $"Score: {x}". Returns null when the format cannot be matched to the arguments. */
function interpolate(tok, args, ctx) {
  if (tok.raw || tok.triple) return null;
  const parts = [];
  let i = 0, n = 0, m;
  const body = tok.quote === "'" ? fromSingleQuoted(tok.body) : tok.body;
  const re = /%(-?)(0?)(\d*)(?:\.(\d+))?([sdfcx%])/g;
  const lit = s => s.replace(/\{/g, '{{').replace(/\}/g, '}}');
  while ((m = re.exec(body))) {
    parts.push(lit(body.slice(i, m.index)));
    i = m.index + m[0].length;
    if (m[5] === '%') { parts.push('%'); continue; }
    if (m[5] === 'c' || n >= args.length) return null;
    const arg = args[n++];
    let s = ex(arg, ctx);
    if (!isSimple(arg) || /[?:]/.test(s) && arg.k !== 'str') s = `(${s})`;
    let fmt = '';
    if (m[5] === 'f') fmt = `:F${m[4] ?? 6}`;
    else if (m[5] === 'x') fmt = ':x';
    else if (m[5] === 'd' && m[2] && m[3]) fmt = `:D${m[3]}`;
    const width = m[3] && !(m[5] === 'd' && m[2]) ? `,${m[1]}${m[3]}` : '';
    parts.push(`{${s}${width}${fmt}}`);
  }
  if (n !== args.length) return null;
  parts.push(lit(body.slice(i)));
  return `$"${parts.join('')}"`;
}

function inferType(e, ctx) {
  if (!e) return null;
  switch (e.k) {
    case 'num': return /^0[xXbB]/.test(e.v) || !/[.eE]/.test(e.v) ? 'int' : 'float';
    case 'str': return 'String';
    case 'array': return 'Array';
    case 'dict': return 'Dictionary';
    case 'paren': return inferType(e.e, ctx);
    case 'node': return nodeType(e.path, ctx);
    case 'as': return e.type;
    case 'is': return 'bool';
    case 'un': return e.op === '!' ? 'bool' : inferType(e.e, ctx);
    case 'tern': return inferType(e.a, ctx) ?? inferType(e.b, ctx);
    case 'name':
      if (e.v === 'true' || e.v === 'false') return 'bool';
      if (['PI', 'TAU', 'INF', 'NAN'].includes(e.v)) return 'float';
      return ctx.types.get(e.v) ?? null;
    case 'bin': {
      if (['==', '!=', '<', '>', '<=', '>=', 'and', 'or', '&&', '||', 'in', 'not in'].includes(e.op)) return 'bool';
      const a = inferType(e.a, ctx), b = inferType(e.b, ctx);
      if (e.op === '%' && a === 'String') return 'String';
      if (a === 'float' && b === 'int' || a === 'int' && b === 'float') return 'float';
      if (STRUCT_TYPES.has(a)) return a;
      if (STRUCT_TYPES.has(b) && (a === 'float' || a === 'int')) return b;
      return a && a === b ? a : null;
    }
    case 'attr':
      if (e.e.k === 'name' && STRUCT_TYPES.has(e.e.v) && VECTOR_CONSTS.has(e.name)) return e.e.v;
      if (e.e.k === 'name' && e.e.v === 'Color' && isConstName(e.name)) return 'Color';
      return null;
    case 'call': {
      const f = e.f;
      if (f.k === 'name') {
        if (f.v === 'preload' && e.args[0]?.k === 'str') return resourceType(e.args[0].tok.body);
        if (['str', 'String'].includes(f.v)) return 'String';
        if (f.v === 'get_node' && e.args[0]?.k === 'str') return nodeType(e.args[0].tok.body, ctx);
        if (f.v === 'int' || f.v === 'float' || f.v === 'bool') return f.v;
        if (/^[A-Z]/.test(f.v) && !isConstName(f.v)) return f.v;
        return ctx.members.get(f.v)?.returns ?? null;
      }
      if (f.k === 'attr' && f.name === 'new' && f.e.k === 'name') return f.e.v;
      return null;
    }
    default: return null;
  }
}

function nodeType(p, ctx) {
  if (p.startsWith('%')) return ctx.facts.unique.get(p.slice(1)) ?? null;
  return ctx.facts.nodeTypes.get(p) ?? null;
}

const UNITY_VECTOR_CONSTS = table({ ZERO: 'zero', ONE: 'one', UP: 'up', DOWN: 'down', LEFT: 'left', RIGHT: 'right' });

function exName(n, ctx, asCall = false) {
  const d = ctx.d;
  if (ctx.locals.has(n)) return ctx.deltaName === n ? ctx.deltaExpr : camel(n);
  const m = ctx.members.get(n);
  if (m) return m.cs;
  if (n === 'self') return 'this';
  if (n === 'true' || n === 'false' || n === 'null') return n;
  if (n === 'super') return 'base';
  if (n === 'PI') return d === 'unity' ? 'Mathf.PI' : 'Mathf.Pi';
  if (n === 'TAU') return d === 'unity' ? '(2f * Mathf.PI)' : 'Mathf.Tau';
  if (n === 'INF') return d === 'unity' ? 'Mathf.Infinity' : 'Mathf.Inf';
  if (n === 'NAN') return d === 'unity' ? 'float.NaN' : 'Mathf.NaN';
  if (ctx.facts.autoloads.has(n)) {
    const type = pascalCase(path.posix.basename(ctx.facts.autoloads.get(n)));
    if (d === 'unity') return `${type}.Instance`;
    return `GetNode<${type}>("/root/${n}")`;
  }
  if (ctx.api.classSet.has(n)) return n;
  if (isConstName(n)) {
    if (d !== 'unity') {
      if (n === 'OK' || n === 'FAILED') return `Error.${pascal(n.toLowerCase())}`;
      if (/^ERR_\w+$/.test(n) && ctx.api.globalEnums.has(n)) return `Error.${pascal(n.slice(4).toLowerCase())}`;
      const key = /^KEY_(\w+)$/.exec(n), btn = /^MOUSE_BUTTON_(\w+)$/.exec(n);
      if (key) return `Key.${/^\d/.test(key[1]) ? 'Key' : ''}${pascal(key[1].toLowerCase())}`;
      if (btn) return `MouseButton.${pascal(btn[1].toLowerCase())}`;
      if (ctx.inherited.constants.has(n)) return pascal(n.toLowerCase());
    }
    ctx.mark(`constant ${n}: use the ${d === 'unity' ? 'Unity' : 'C# enum'} equivalent`);
    return n;
  }
  if (/^[A-Z]/.test(n)) return (d === 'unity' ? TYPES_UNITY : TYPES_GODOT)[n] && !asCall ? csType(n, ctx) : n;
  const engine = ctx.inherited.properties.has(n) || ctx.inherited.signals.has(n) || ctx.inherited.methods.has(n);
  if (d === 'unity') {
    if (n === 'position') return 'transform.localPosition';
    if (n === 'global_position') return 'transform.position';
    if (n === 'name') return 'name';
    if (engine) { ctx.mark(`Godot member ${n}`); return n; }
    return asCall ? methodName(n) : memberVarName(n, d);
  }
  return n.startsWith('_') && !engine && !asCall ? memberVarName(n, d) : pascal(n.replace(/^_+(?=[a-z])/, asCall ? '' : '_'));
}

function exCallName(name, args, e, ctx) {
  const d = ctx.d, a = args.map(x => ex(x, ctx));
  const list = a.join(', ');
  if (ctx.locals.has(name)) return d === 'unity' ? `${camel(name)}(${list})` : `${camel(name)}.Call(${list})`;
  if (ctx.members.get(name)?.kind === 'func') return `${ctx.members.get(name).cs}(${list})`;
  if (name === 'super') return `base.${ctx.fnCs ?? 'PORT_super'}(${list})`;
  if (name === 'preload' || name === 'load') {
    const lit = args[0]?.k === 'str' ? args[0].tok.body : null;
    if (d === 'unity') { ctx.mark(`${name}(${lit ?? '…'}): use a serialized reference assigned in the inspector, or Resources.Load`); return `Resources.Load<${lit && /\.(tscn|scn)$/.test(lit) ? 'GameObject' : 'UnityEngine.Object'}>(${list})`; }
    return lit ? `GD.Load<${resourceType(lit)}>(${list})` : `GD.Load(${list})`;
  }
  if (name === 'int' || name === 'float' || name === 'bool') return name === 'bool' ? `(${list} != default)` : `(${name})(${list})`;
  if (name === 'str' || name === 'String') { if (args.length === 1) return d === 'unity' ? `${wrap(args[0], a[0])}.ToString()` : `GD.Str(${list})`; return d === 'unity' ? `string.Concat(${list})` : `GD.Str(${list})`; }
  if (name === 'len') { ctx.mark('len(): .Count for collections, .Length for strings and arrays'); return `${wrap(args[0], a[0])}.Count`; }
  if (name === 'assert') return `System.Diagnostics.Debug.Assert(${list})`;
  if (name === 'deg_to_rad' && d === 'unity') return `(${a[0]} * Mathf.Deg2Rad)`;
  if (name === 'rad_to_deg' && d === 'unity') return `(${a[0]} * Mathf.Rad2Deg)`;
  if (name === 'randf' && d === 'unity') return 'Random.value';
  if (name === 'randi_range' && d === 'unity') return `Random.Range(${a[0]}, ${wrap(args[1], a[1])} + 1)`;
  if (name === 'queue_free' && d === 'unity') return 'Destroy(gameObject)';
  if (name === 'print' && d === 'unity' && args.length !== 1) return `Debug.Log(string.Concat(${list}))`;
  if (d === 'unity' && (name === 'sign' || name === 'signf')) ctx.mark('Mathf.Sign(0) is 1 in Unity and 0 in Godot');
  if (d === 'unity' && (name === 'round' || name === 'roundf' || name === 'roundi')) ctx.mark('Mathf.Round rounds .5 to the even number in Unity, away from zero in Godot');
  const globals = d === 'unity' ? GLOBALS_UNITY : GLOBALS_GODOT;
  if (globals[name]) return `${globals[name]}(${list})`;
  if (name === 'fmod' && args.length === 2) return `(${wrap(args[0], a[0])} % ${wrap(args[1], a[1])})`;
  if (/^[A-Z]/.test(name) && !isConstName(name)) {
    if (name === 'Callable' && d !== 'unity' && args.length === 2 && args[1].k === 'str') return `new Callable(${a[0]}, ${a[1]})`;
    return `new ${csType(name, ctx)}(${list})`;
  }
  if (name === 'get_node' && d !== 'unity' && args.length === 1) {
    const type = ctx.wantType ?? (args[0].k === 'str' ? nodeType(args[0].tok.body, ctx) : null);
    if (type) return `GetNode<${csType(type, ctx)}>(${list})`;
  }
  if (ctx.inherited.methods.has(name)) {
    if (d === 'unity') { ctx.mark(`Godot API ${name}()`); return `${name}(${list})`; }
    return `${pascal(name)}(${list})`;
  }
  if (ctx.api.utility.has(name)) { ctx.mark(`${name}(): no direct equivalent mapped`); return `${d === 'unity' ? name : `GD.${pascal(name)}`}(${list})`; }
  return `${methodName(name)}(${list})`;
}

/** Signal reference: { own, target (C# expression or null for this), name }. */
function signalRef(e, ctx) {
  if (e.k === 'name' && !ctx.locals.has(e.v)) {
    if (ctx.members.get(e.v)?.kind === 'signal') return { own: true, user: true, target: null, name: e.v };
    if (ctx.inherited.signals.has(e.v)) return { own: true, user: false, target: null, name: e.v };
    return null;
  }
  if (e.k === 'attr') return { own: e.e.k === 'name' && e.e.v === 'self', user: !ctx.api.allSignals.has(e.name), target: e.e, name: e.name };
  return null;
}

function exSignalCall(sig, op, args, ctx) {
  const d = ctx.d, a = args.map(x => ex(x, ctx));
  const own = sig.own || !sig.target;
  const target = own ? '' : `${wrap(sig.target, ex(sig.target, ctx))}.`;
  const event = `${target}${pascal(sig.name)}`;
  if (d === 'unity' && !sig.user) throw new DraftError(`Godot signal ${sig.name}: ${ctx.hint(['area', 'await-signal']) ?? 'use the Unity callback or event for it'}`);
  if (op === 'connect' || op === 'disconnect') {
    if (!ctx.asStatement) {
      ctx.mark(`${op}() is used as a value: a C# event subscription returns nothing`);
      const fn = args[0]?.k === 'name' && ctx.members.get(args[0].v)?.kind === 'func' ? `new Callable(this, MethodName.${ctx.members.get(args[0].v).cs})` : a[0];
      return `${target}${pascal(op)}("${sig.user ? pascal(sig.name) : sig.name}", ${[fn, ...a.slice(1)].join(', ')})`;
    }
    if (args.length !== 1) { ctx.mark(`${op}() with flags or binds: wire by hand`); return `${event}.${pascal(op)}(${a.join(', ')})`; }
    return `${event} ${op === 'connect' ? '+=' : '-='} ${a[0]}`;
  }
  if (op === 'emit') {
    if (d === 'unity') {
      if (!own) ctx.mark(`an event can only be raised by its own class: add a public method on that class that raises ${pascal(sig.name)}`);
      return `${event}?.Invoke(${a.join(', ')})`;
    }
    if (own) return `EmitSignal(${sig.user ? `SignalName.${pascal(sig.name)}` : `"${sig.name}"`}${a.length ? `, ${a.join(', ')}` : ''})`;
    if (sig.user) ctx.mark(`signal ${sig.name} of another class: prefer <Class>.SignalName.${pascal(sig.name)}`);
    return `${target}EmitSignal("${sig.user ? pascal(sig.name) : sig.name}"${a.length ? `, ${a.join(', ')}` : ''})`;
  }
  return null;
}

function exAwait(e, ctx) {
  ctx.usesAwait = true;
  const d = ctx.d, inner = e.e;
  const timer = inner.k === 'attr' && inner.name === 'timeout' && inner.e.k === 'call' && inner.e.f.k === 'attr' && inner.e.f.name === 'create_timer';
  if (d === 'unity') {
    if (timer) { ctx.note('Timers are drafted with Awaitable.WaitForSecondsAsync (Unity 2023.1 or newer); on older versions use a coroutine with WaitForSeconds.'); return `await Awaitable.WaitForSecondsAsync(${inner.e.args.map(x => ex(x, ctx)).join(', ')})`; }
    ctx.mark(`await: ${ctx.hint(['await-signal', 'timer-await']) ?? 'use a coroutine or an Awaitable'}`);
    return `await ${ex(inner, ctx)}`;
  }
  if (timer) return `await ToSignal(${ex(inner.e, ctx)}, SceneTreeTimer.SignalName.Timeout)`;
  if (inner.k === 'call') { ctx.mark('awaited call: the called method must return a Task'); return `await ${ex(inner, ctx)}`; }
  const sig = signalRef(inner, ctx);
  if (!sig) { ctx.mark('await: expected a signal'); return `await ${ex(inner, ctx)}`; }
  if (sig.own || !sig.target) return `await ToSignal(this, ${sig.user ? `SignalName.${pascal(sig.name)}` : `"${sig.name}"`})`;
  if (sig.user) ctx.mark(`signal ${sig.name} of another class: prefer <Class>.SignalName.${pascal(sig.name)}`);
  return `await ToSignal(${ex(sig.target, ctx)}, "${sig.user ? pascal(sig.name) : sig.name}")`;
}

function exAttr(e, ctx, call) {
  const d = ctx.d, name = e.name, base = e.e;
  const args = call ? call.args : null;
  const a = () => args.map(x => ex(x, ctx));
  if (base.k === 'name' && /^[A-Z]/.test(base.v) && !ctx.locals.has(base.v) && !ctx.facts.autoloads.has(base.v)) {
    const cls = base.v;
    if (call && name === 'new') return `new ${csType(cls, ctx)}(${a().join(', ')})`;
    if (!call && isConstName(name)) {
      if (ctx.members.get(cls)?.kind === 'enum') return `${cls}.${name}`;
      if (STRUCT_TYPES.has(cls) && VECTOR_CONSTS.has(name)) {
        if (d !== 'unity') return `${cls}.${pascal(name.toLowerCase())}`;
        if (UNITY_VECTOR_CONSTS[name]) return `${cls}.${UNITY_VECTOR_CONSTS[name]}`;
        ctx.mark(`${cls}.${name}: Godot faces -Z, Unity +Z (see port_convert)`);
        return `${cls}.${name === 'FORWARD' ? 'forward' : name === 'BACK' ? 'back' : name}`;
      }
      if (cls === 'Color') {
        if (d !== 'unity') return `Colors.${pascal(name.toLowerCase())}`;
        if (UNITY_COLORS.has(name.toLowerCase())) return `Color.${name.toLowerCase()}`;
      }
      if (ctx.api.classSet.has(cls)) ctx.mark(`${cls}.${name}: ${d === 'unity' ? 'use the Unity equivalent' : `C# nests engine constants in an enum (${cls}.<Enum>.<Value>)`}`);
      return `${cls}.${name}`;
    }
    if (d === 'unity' && ctx.api.classSet.has(cls) && !ctx.api.classes[cls].builtin) {
      if (cls === 'Input' && call && args.length === 1) {
        const fn = table({ is_action_pressed: 'GetButton', is_action_just_pressed: 'GetButtonDown', is_action_just_released: 'GetButtonUp' })[name];
        if (fn) { ctx.note('Input actions are drafted with the legacy Input Manager (Input.GetButton…); the action names must exist there, or switch to the Input System.'); return `Input.${fn}(${a().join(', ')})`; }
      }
      if (cls === 'Engine' && name === 'time_scale') return 'Time.timeScale';
      ctx.mark(`Godot API ${cls}.${name}${ctx.hint() ? `: ${ctx.hint()}` : ''}`);
      return `${cls}.${name}${call ? `(${a().join(', ')})` : ''}`;
    }
  }
  if (call && ['connect', 'disconnect', 'emit'].includes(name)) {
    const sig = signalRef(base, ctx);
    if (sig) { const s = exSignalCall(sig, name, args, ctx); if (s) return s; }
  }
  if (base.k === 'name' && base.v === 'self' && ctx.members.has(name) && !(call && ['connect', 'disconnect', 'emit'].includes(name))) {
    const cs = ctx.members.get(name).cs;
    return call ? `${cs}(${a().join(', ')})` : `this.${cs}`;
  }
  const b = wrap(base, ex(base, ctx));
  if (call) {
    const list = a();
    if (name === 'size' && !args.length) return `${b}.${/^Packed\w+Array$/.test(inferType(base, ctx) ?? '') ? 'Length' : 'Count'}`;
    if ((name === 'append' || name === 'push_back') && args.length === 1) return `${b}.Add(${list[0]})`;
    if (name === 'has' && args.length === 1) { ctx.mark('has(): Contains for arrays, ContainsKey for dictionaries'); return `${b}.Contains(${list[0]})`; }
    if (name === 'keys' && !args.length) return `${b}.Keys`;
    if (name === 'values' && !args.length) return `${b}.Values`;
    if (name === 'erase' && args.length === 1) return `${b}.Remove(${list[0]})`;
    if (name === 'get_node' && d !== 'unity' && ctx.wantType && args.length === 1) return `${b}.GetNode<${csType(ctx.wantType, ctx)}>(${list[0]})`;
    if (name === 'instantiate') return d === 'unity' ? `Instantiate(${b})` : `${b}.Instantiate${ctx.wantType && !args.length ? `<${csType(ctx.wantType, ctx)}>` : ''}(${list.join(', ')})`;
    if (name === 'queue_free' && d === 'unity') { ctx.mark('queue_free(): pass the GameObject to destroy (a component reference only removes that component)'); return `Destroy(${b}.gameObject)`; }
    if (name === 'call_deferred' && d !== 'unity' && args[0]?.k === 'str') return `${b}.CallDeferred(${list.join(', ')})`;
    if (base.k === 'name' && base.v === 'super') return `base.${GODOT_VIRTUALS[name] !== undefined && d !== 'unity' ? pascal(name).replace(/^/, '_') : methodName(name)}(${list.join(', ')})`;
    if (d === 'unity' && name.includes('_') && ctx.api.allMethods.has(name)) ctx.mark(`${name}() looks like Godot API: check the Unity call`);
    return `${b}.${methodName(name)}(${list.join(', ')})`;
  }
  if (d === 'unity' && name.includes('_') && ctx.api.allProperties.has(name)) ctx.mark(`${name} looks like a Godot property: check the Unity member`);
  return `${b}.${memberVarName(name, d)}`;
}

/** Translate one expression tree. */
export function ex(e, ctx) {
  switch (e.k) {
    case 'num': return csNumber(e.v);
    case 'str': return csString(e.tok);
    case 'paren': return `(${ex(e.e, ctx)})`;
    case 'name': return exName(e.v, ctx);
    case 'node': {
      const t = nodeType(e.path, ctx) ?? ctx.wantType;
      if (ctx.d === 'unity') { ctx.mark(`node path "${e.path}": ${ctx.hint(['get-node']) ?? 'use a serialized reference'}`); return `transform.Find("${e.path.replace(/^%/, '')}")`; }
      if (!t) ctx.mark(`node "${e.path}": set its real type instead of Node`);
      return `GetNode<${t ? csType(t, ctx) : 'Node'}>("${e.path}")`;
    }
    case 'array': {
      const items = e.items.map(x => ex(x, ctx)).join(', ');
      if (ctx.d === 'unity') { ctx.usings.add('System.Collections.Generic'); return `new List<object> { ${items} }`.replace('{  }', '()').replace('> ()', '>()'); }
      return items ? `new Godot.Collections.Array { ${items} }` : 'new Godot.Collections.Array()';
    }
    case 'dict': {
      const pairs = e.pairs.map(([k, v]) => `{ ${ex(k, ctx)}, ${ex(v, ctx)} }`).join(', ');
      const type = ctx.d === 'unity' ? 'Dictionary<object, object>' : 'Godot.Collections.Dictionary';
      if (ctx.d === 'unity') ctx.usings.add('System.Collections.Generic');
      return pairs ? `new ${type} { ${pairs} }` : `new ${type}()`;
    }
    case 'un': return e.op === '!' ? `!${wrap(e.e, ex(e.e, ctx))}` : `${e.op}${wrap(e.e, ex(e.e, ctx))}`;
    case 'tern': {
      const part = x => (x.k === 'tern' || x.k === 'lambda' || x.k === 'as' ? `(${ex(x, ctx)})` : ex(x, ctx));
      return `${part(e.c)} ? ${part(e.a)} : ${part(e.b)}`;
    }
    case 'is': return `${wrap(e.e, ex(e.e, ctx))} is ${e.negate ? 'not ' : ''}${csType(e.type, ctx)}`;
    case 'as': {
      if (e.e.k === 'node' && ctx.d !== 'unity') return `GetNode<${csType(e.type, ctx)}>("${e.e.path}")`;
      return `${wrap(e.e, ex(e.e, ctx))} as ${csType(e.type, ctx)}`;
    }
    case 'await': return exAwait(e, ctx);
    case 'lambda': {
      const saved = ctx.locals;
      ctx.locals = new Set([...saved, ...e.params.map(p => p.name)]);
      const body = ex(e.body, ctx);
      ctx.locals = saved;
      return `(${e.params.map(p => (p.type ? `${csType(p.type, ctx)} ${camel(p.name)}` : camel(p.name))).join(', ')}) => ${body}`;
    }
    case 'bin': {
      if (e.op === 'in' || e.op === 'not in') {
        ctx.mark('in: Contains for arrays and strings, ContainsKey for dictionaries');
        return `${e.op === 'in' ? '' : '!'}${wrap(e.b, ex(e.b, ctx))}.Contains(${ex(e.a, ctx)})`;
      }
      if (e.op === '%' && e.a.k === 'str') {
        const s = interpolate(e.a.tok, e.b.k === 'array' ? e.b.items : [e.b], ctx);
        if (s) return s;
        ctx.mark('string format: rewrite with string interpolation');
      }
      if (e.op === '**') return `Mathf.Pow(${ex(e.a, ctx)}, ${ex(e.b, ctx)})`;
      const op = { and: '&&', or: '||' }[e.op] ?? e.op;
      const side = x => (x.k === 'tern' || x.k === 'lambda' || x.k === 'await' ? `(${ex(x, ctx)})` : ex(x, ctx));
      return `${side(e.a)} ${op} ${side(e.b)}`;
    }
    case 'index': return `${wrap(e.e, ex(e.e, ctx))}[${ex(e.idx, ctx)}]`;
    case 'attr': return exAttr(e, ctx, null);
    case 'call': {
      // Only the outermost call of an expression statement may become "event += handler".
      const top = ctx.asStatement;
      ctx.asStatement = false;
      if (e.f.k === 'attr' && top && ['connect', 'disconnect'].includes(e.f.name)) { ctx.asStatement = true; try { return exAttr(e.f, ctx, e); } finally { ctx.asStatement = false; } }
      if (e.f.k === 'name') return exCallName(e.f.v, e.args, e, ctx);
      if (e.f.k === 'attr') return exAttr(e.f, ctx, e);
      return `${wrap(e.f, ex(e.f, ctx))}(${e.args.map(x => ex(x, ctx)).join(', ')})`;
    }
    default: throw new DraftError(`cannot translate ${e.k}`);
  }
}

// ------------------------------------------------------------------------------------------------ statements
const PAD = '    ';
/** Split at a separator outside brackets and strings; empty pieces are dropped. */
function splitTop(text, sep) {
  const out = [];
  let depth = 0, cur = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'") { const s = readString(text, i); cur += text.slice(i, s.end); i = s.end - 1; continue; }
    if ('([{'.includes(c)) depth++; else if (')]}'.includes(c)) depth--;
    if (c === sep && depth === 0) { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur);
  return out.map(x => x.trim()).filter(Boolean);
}
const csComment = c => (c ? c.replace(/^##\s?/, '/// ').replace(/^#\s?(?=region\b|endregion\b)/, '#').replace(/^#(?!region|endregion)\s?/, '// ') : '');

/** Split "target op value" at the top-level assignment operator. */
function splitAssign(text) {
  const tokens = tokenize(text);
  let depth = 0;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.t !== 'op') continue;
    if ('([{'.includes(t.v)) depth++;
    else if (')]}'.includes(t.v)) depth--;
    else if (depth === 0 && ASSIGN.has(t.v)) return { op: t.v, left: tokens.slice(0, i), right: tokens.slice(i + 1) };
  }
  return null;
}
const parseTokens = tokens => { const p = new Parser(tokens); const e = p.expr(); if (!p.done()) throw new DraftError('unexpected token'); return e; };

const VAR_RE = /^(var|const)\s+(\w+)\s*(?::\s*(?!=)([^=]+?))?\s*(?:(:?=)\s*([\s\S]+))?$/;

class Emitter {
  constructor(ctx) { this.ctx = ctx; this.out = []; }

  /** Run fn for one statement; its PORT notes land on the first line it produced. */
  statement(node, ind, fn) {
    const ctx = this.ctx;
    const outer = { marks: ctx.marks, line: ctx.line };
    ctx.marks = [];
    ctx.line = node.line;
    const at = this.out.length;
    try { fn(); } catch (err) {
      if (!(err instanceof DraftError)) throw err;
      this.out.length = at;
      ctx.marks = [`could not translate (${err.message}): ${node.text}`];
      this.out.push({ ind, code: '', line: node.line });
      this.raw(node.children, ind + 1);
    }
    const first = this.out[at];
    if (first) {
      const notes = [...new Set(ctx.marks)];
      for (const n of notes) ctx.markers.push({ line: node.line, note: n });
      first.marks = [...(first.marks ?? []), ...notes];
      first.comment = csComment(node.comment);
    }
    ctx.marks = outer.marks;
    ctx.line = outer.line;
  }
  push(ind, code) { this.out.push({ ind, code }); }
  raw(nodes, ind) { for (const n of nodes) { if (n.blank) continue; this.out.push({ ind, code: `// ${n.text}${n.comment ? ` ${n.comment}` : ''}` }); this.raw(n.children, ind + 1); } }

  block(nodes, ind) {
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if (n.blank) { if (this.out.length && this.out.at(-1).code !== '' && !this.out.at(-1).code.endsWith('{')) this.out.push({ ind: 0, code: '', blank: true }); continue; }
      if (!n.text) { this.out.push({ ind, code: csComment(n.comment) }); continue; }
      this.statement(n, ind, () => this.stmt(n, ind));
    }
  }

  body(node, ind, inline) {
    this.push(ind, '{');
    if (inline) this.block([{ text: inline, comment: '', line: node.line, children: [] }], ind + 1);
    this.block(node.children, ind + 1);
    this.push(ind, '}');
  }

  header(node) {
    const at = headerColon(node.text);
    if (at === -1) throw new DraftError('missing colon');
    return { head: node.text.slice(0, at).trim(), inline: node.text.slice(at + 1).trim() };
  }

  declareLocal(name, type) { this.ctx.locals.add(name); if (type) this.ctx.types.set(name, type); else this.ctx.types.delete(name); }

  stmt(n, ind) {
    const ctx = this.ctx;
    const parts = BLOCK_START.test(n.text) ? [n.text] : splitTop(n.text, ';');
    if (parts.length > 1) { this.block(parts.map(text => ({ text, comment: '', line: n.line, children: [] })), ind); return; }
    const text = parts[0] ?? '';
    if (!text || /^@warning_ignore\b/.test(text)) { this.push(ind, ''); return; }
    const word = /^[A-Za-z_]\w*/.exec(text)?.[0];
    if (word === 'pass') { this.push(ind, ''); return; }
    if (word === 'break' || word === 'continue') { this.push(ind, `${word};`); return; }
    if (word === 'breakpoint') { this.push(ind, 'System.Diagnostics.Debugger.Break();'); return; }
    if (word === 'return') {
      const rest = text.slice(6).trim();
      this.push(ind, rest ? `return ${ex(parseExpr(rest), ctx)};` : 'return;');
      return;
    }
    if (word === 'if' || word === 'elif' || word === 'while') {
      const { head, inline } = this.header(n);
      const cond = ex(parseExpr(head.slice(word.length)), ctx);
      this.push(ind, `${word === 'elif' ? 'else if' : word} (${cond})`);
      this.body(n, ind, inline);
      return;
    }
    if (word === 'else') { const { inline } = this.header(n); this.push(ind, 'else'); this.body(n, ind, inline); return; }
    if (word === 'for') return this.forLoop(n, ind);
    if (word === 'match') return this.match(n, ind);
    if (word === 'var' || word === 'const') {
      const m = VAR_RE.exec(text);
      if (!m) throw new DraftError('bad declaration');
      const [, , name, type, , init] = m;
      const tree = init ? parseExpr(init) : null;
      ctx.wantType = type?.trim();
      const value = tree ? ex(tree, ctx) : null;
      ctx.wantType = null;
      const declared = type?.trim() || (tree ? inferType(tree, ctx) : null);
      this.declareLocal(name, declared);
      if (type) this.push(ind, `${csType(type, ctx)} ${camel(name)}${value ? ` = ${value}` : ''};`);
      else if (value && value !== 'null') this.push(ind, `var ${camel(name)} = ${value};`);
      else this.push(ind, `${csType('Variant', ctx)} ${camel(name)}${value ? ` = ${ctx.d === 'unity' ? 'null' : 'default'}` : ''};`);
      return;
    }
    const assign = splitAssign(text);
    if (assign) return this.assign(assign, ind);
    const tree = parseExpr(text);
    ctx.asStatement = tree.k === 'call';
    try { this.push(ind, `${ex(tree, ctx)};`); } finally { ctx.asStatement = false; }
  }

  assign({ op, left, right }, ind) {
    const ctx = this.ctx;
    const target = parseTokens(left), value = parseTokens(right);
    const v = ex(value, ctx);
    // A struct-valued property cannot be changed field by field in C#.
    if (ctx.d !== 'unity' && target.k === 'attr' && STRUCT_FIELDS.has(target.name)) {
      const b = target.e;
      const prop = b.k === 'name' ? !ctx.locals.has(b.v) && !ctx.members.has(b.v) && ctx.inherited.properties.has(b.v) && STRUCT_PROPS.has(b.v)
        : b.k === 'attr' && STRUCT_PROPS.has(b.name);
      if (prop) {
        const p = ex(b, ctx), f = pascal(target.name);
        const rhs = op === '=' ? v : `${p}.${f} ${op.slice(0, -1)} ${wrap(value, v)}`;
        this.push(ind, `${p} = ${p} with { ${f} = ${rhs} };`);
        return;
      }
    }
    if (op === '**=') { const t = ex(target, ctx); this.push(ind, `${t} = Mathf.Pow(${t}, ${v});`); return; }
    if (ctx.d === 'unity' && target.k === 'name' && target.v === 'visible' && !ctx.locals.has('visible') && !ctx.members.has('visible')) {
      ctx.marks = ctx.marks.filter(m => m !== 'Godot member visible');
      ctx.mark('visible: SetActive also stops this object\'s scripts; use renderer.enabled to only hide it');
      this.push(ind, `gameObject.SetActive(${v});`);
      return;
    }
    this.push(ind, `${ex(target, ctx)} ${op} ${v};`);
  }

  forLoop(n, ind) {
    const ctx = this.ctx;
    const { head, inline } = this.header(n);
    const m = /^for\s+(\w+)\s*(?::\s*([\w.[\], ]+?))?\s+in\s+([\s\S]+)$/.exec(head);
    if (!m) throw new DraftError('bad for loop');
    const [, name, type, iter] = m;
    const tree = parseExpr(iter);
    const v = camel(name);
    const range = tree.k === 'call' && tree.f.k === 'name' && tree.f.v === 'range' && tree.args.length >= 1 && tree.args.length <= 3 ? tree.args : null;
    const count = !range && (tree.k === 'num' || inferType(tree, ctx) === 'int') ? [tree] : null;
    const r = range ?? count;
    if (r) {
      const a = r.map(x => ex(x, ctx));
      const from = r.length > 1 ? a[0] : '0', to = r.length > 1 ? a[1] : a[0];
      let cmp = '<', step = `${v}++`;
      if (r.length === 3) {
        const s = r[2];
        const lit = s.k === 'num' ? Number(s.v) : s.k === 'un' && s.op === '-' && s.e.k === 'num' ? -Number(s.e.v) : null;
        if (lit === null) ctx.mark('range() step is not a literal: check the loop direction');
        if (lit !== null && lit < 0) cmp = '>';
        step = lit === 1 ? `${v}++` : lit === -1 ? `${v}--` : `${v} += ${a[2]}`;
      }
      this.declareLocal(name, 'int');
      this.push(ind, `for (int ${v} = ${from}; ${v} ${cmp} ${to}; ${step})`);
    } else {
      const it = ex(tree, ctx);
      this.declareLocal(name, type?.trim() ?? null);
      this.push(ind, `foreach (${type ? csType(type, ctx) : 'var'} ${v} in ${it})`);
    }
    this.body(n, ind, inline);
  }

  match(n, ind) {
    const ctx = this.ctx;
    const { head } = this.header(n);
    this.push(ind, `switch (${ex(parseExpr(head.slice(5)), ctx)})`);
    this.push(ind, '{');
    for (const arm of n.children) {
      if (arm.blank) continue;
      if (!arm.text) { this.push(ind + 1, csComment(arm.comment)); continue; }
      this.statement(arm, ind + 1, () => {
        const at = headerColon(arm.text);
        if (at === -1) throw new DraftError('bad match arm');
        const pattern = arm.text.slice(0, at).trim(), inline = arm.text.slice(at + 1).trim();
        if (/^(var\b|\[|\{)|\bwhen\b|\.\./.test(pattern)) { ctx.mark(`match pattern "${pattern}" (binding, array, dictionary or guard): write this case by hand`); this.push(ind + 1, 'default:'); }
        else {
          const alts = [];
          let depth = 0, cur = '';
          for (const c of pattern) { if ('([{'.includes(c)) depth++; else if (')]}'.includes(c)) depth--; if (c === ',' && depth === 0) { alts.push(cur); cur = ''; } else cur += c; }
          alts.push(cur);
          for (const alt of alts) this.push(ind + 1, alt.trim() === '_' ? 'default:' : `case ${ex(parseExpr(alt), ctx)}:`);
        }
        const start = this.out.length;
        if (inline) this.block([{ text: inline, comment: '', line: arm.line, children: [] }], ind + 2);
        this.block(arm.children, ind + 2);
        const last = this.out.slice(start).filter(l => l.code && !l.code.startsWith('//')).at(-1)?.code ?? '';
        if (!/^(return\b|break;|continue;|throw\b)/.test(last) || this.out.at(-1).ind > ind + 2) this.push(ind + 2, 'break;');
      });
    }
    this.push(ind, '}');
  }
}

// ------------------------------------------------------------------------------------------------ classes
const FUNC_RE = /^(static\s+)?func\s+(\w+)\s*\(([\s\S]*)\)\s*(?:->\s*([\w.[\], ]+?))?\s*$/;

function splitParams(text) {
  const out = [];
  let depth = 0, cur = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'") { const s = readString(text, i); cur += text.slice(i, s.end); i = s.end - 1; continue; }
    if ('([{'.includes(c)) depth++; else if (')]}'.includes(c)) depth--;
    if (c === ',' && depth === 0) { out.push(cur); cur = ''; } else cur += c;
  }
  if (cur.trim()) out.push(cur);
  return out.map(p => {
    const m = /^\s*(\w+)\s*(?::\s*(?!=)([^=]+?))?\s*(?::?=\s*([\s\S]+))?$/.exec(p);
    if (!m) throw new DraftError('bad parameter');
    return { name: m[1], type: m[2]?.trim() ?? null, init: m[3]?.trim() ?? null };
  });
}

const walkNodes = (nodes, fn) => { for (const n of nodes) { if (n.text) fn(n); walkNodes(n.children, fn); } };

/** Collect what a class declares, so names resolve before any body is translated. */
function declare(nodes, ctx) {
  const info = { base: null, className: null, tool: false };
  let pendingOnready = false;
  for (const n of nodes) {
    if (!n.text) continue;
    let t = n.text;
    let m;
    if ((m = /^extends\s+(.+)$/.exec(t))) { info.base = m[1].trim(); continue; }
    if ((m = /^class_name\s+(\w+)(?:\s+extends\s+(.+))?/.exec(t))) { info.className = m[1]; if (m[2]) info.base = m[2].trim(); continue; }
    if (/^@tool\b/.test(t)) { info.tool = true; continue; }
    const ann = [];
    while ((m = /^@(\w+)(\((?:[^()"']|"[^"]*"|'[^']*'|\([^()]*\))*\))?\s*/.exec(t))) { ann.push({ name: m[1], args: m[2] ?? '' }); t = t.slice(m[0].length); }
    n.ann = ann; n.decl = t;
    if (!t) { if (ann.some(a => a.name === 'onready')) pendingOnready = true; n.carry = ann; continue; }
    if ((m = VAR_RE.exec(t.replace(/^static\s+(?=var\b)/, '').replace(/:\s*$/, '')))) {
      const isConst = m[1] === 'const';
      ctx.members.set(m[2], { kind: isConst ? 'const' : 'var', cs: isConst ? m[2] : memberVarName(m[2], ctx.d), type: m[3]?.trim() ?? null, init: m[5] ?? null, node: n });
      if (pendingOnready) { ann.push({ name: 'onready', args: '' }); pendingOnready = false; }
    } else if ((m = /^signal\s+(\w+)/.exec(t))) ctx.members.set(m[1], { kind: 'signal', cs: pascal(m[1]) });
    else if ((m = /^enum\s+(\w+)?\s*\{([\s\S]*)\}/.exec(t))) {
      if (m[1]) ctx.members.set(m[1], { kind: 'enum', cs: m[1] });
      for (const item of m[2].split(',')) { const name = /^\s*(\w+)/.exec(item)?.[1]; if (name) ctx.members.set(name, { kind: 'const', cs: m[1] ? `${m[1]}.${name}` : name, type: m[1] ?? 'int' }); }
    } else if ((m = /^(static\s+)?func\s+(\w+)/.exec(t))) {
      const head = headerColon(t) === -1 ? t : t.slice(0, headerColon(t));
      const sig = FUNC_RE.exec(head.trim());
      const virt = ctx.d !== 'unity' && m[2] in GODOT_VIRTUALS;
      const cs = ctx.d === 'unity' && UNITY_LIFECYCLE[m[2]] ? UNITY_LIFECYCLE[m[2]] : virt ? `_${pascal(m[2].slice(1))}` : m[2] === '_init' ? null : methodName(m[2]);
      ctx.members.set(m[2], { kind: 'func', cs: cs ?? m[2], returns: sig?.[4]?.trim() ?? null });
    } else if ((m = /^class\s+(\w+)/.exec(t))) ctx.members.set(m[1], { kind: 'class', cs: m[1] });
  }
  for (const [name, mem] of ctx.members) if (mem.kind === 'var' || mem.kind === 'const') { if (mem.type) ctx.types.set(name, mem.type); }
  return info;
}

function literalConst(e) { return e && (e.k === 'num' || e.k === 'str' || (e.k === 'name' && ['true', 'false'].includes(e.v)) || (e.k === 'un' && e.op === '-' && e.e.k === 'num')); }
/** Does an initializer read instance state (which a C# field initializer cannot)? */
function usesInstance(e, ctx) {
  let hit = false;
  const visit = x => {
    if (!x || typeof x !== 'object' || hit) return;
    if (x.k === 'node') hit = true;
    else if (x.k === 'name') { const m = ctx.members.get(x.v); if (x.v === 'self' || (m && m.kind !== 'const' && m.kind !== 'enum' && m.kind !== 'class') || (!m && /^[a-z_]/.test(x.v) && !['true', 'false', 'null'].includes(x.v) && (ctx.inherited.properties.has(x.v) || ctx.inherited.methods.has(x.v)))) hit = true; }
    else if (x.k === 'call' && x.f.k === 'name') { if (ctx.inherited.methods.has(x.f.v) || ctx.members.get(x.f.v)?.kind === 'func') hit = true; x.args.forEach(visit); return; }
    for (const v of Object.values(x)) { if (Array.isArray(v)) v.flat().forEach(visit); else if (v && typeof v === 'object' && v.k) visit(v); }
  };
  visit(e);
  return hit;
}

function emitClass(nodes, ctx, em, ind, { name, top }) {
  const d = ctx.d;
  const info = declare(nodes, ctx);
  const base = info.base?.replace(/^["']|["']$/g, '') ?? (d === 'unity' ? 'Node' : 'RefCounted');
  ctx.baseIsEngine = ctx.api.classSet.has(base);
  ctx.userBase = !ctx.baseIsEngine;
  ctx.inherited = ctx.baseIsEngine ? apiMembers(ctx.api, base) : { methods: new Set(), properties: new Set(), signals: new Set(), constants: new Set() };
  const className = name ?? info.className ?? 'Unnamed';
  ctx.className = className;
  const inject = [];
  const header = () => {
    if (info.tool) em.push(ind, d === 'unity' ? '[ExecuteAlways]' : '[Tool]');
    if (d === 'unity') {
      if (base === 'CharacterBody3D') em.push(ind, '[RequireComponent(typeof(CharacterController))]');
      if (base === 'RigidBody3D') em.push(ind, '[RequireComponent(typeof(Rigidbody))]');
      const unityBase = base === 'Resource' ? 'ScriptableObject' : ctx.userBase ? base : top ? 'MonoBehaviour' : null;
      em.push(ind, `public class ${className}${unityBase ? ` : ${unityBase}` : ''}`);
    } else {
      if (info.className && top) em.push(ind, '[GlobalClass]');
      em.push(ind, `public partial class ${className} : ${/\.gd$/.test(base) ? pascalCase(path.posix.basename(base)) : base}`);
    }
    em.push(ind, '{');
  };
  header();
  const at = em.out.length;
  if (d === 'unity' && top && ctx.baseIsEngine && !['Node', 'Node2D', 'Node3D', 'Resource', 'RefCounted', 'Object'].includes(base)) {
    const hit = mapFor('godot', 'unity')?.entries.find(e => new RegExp(`\\b${base}\\b`).test(e.from) && e.id !== 'script-class');
    ctx.marks = [];
    em.out.push({ ind: ind + 1, code: '', marks: [`Godot base ${base}: ${hit?.to ?? 'add the matching Unity components to the GameObject'}`] });
    ctx.markers.push({ line: 1, note: `Godot base ${base}: ${hit?.to ?? 'add the matching Unity components'}` });
  }
  if (d === 'unity' && top && ctx.isAutoload) {
    em.push(ind + 1, `public static ${className} Instance { get; private set; }`);
    inject.push('Instance = this;', 'DontDestroyOnLoad(gameObject);');
  }
  if (info.className && top && name && info.className !== name) { em.out.push({ ind: ind + 1, code: '', marks: [`class_name ${info.className} differs from the file name: other scripts refer to ${info.className}`] }); ctx.markers.push({ line: 1, note: `class_name ${info.className} differs from the file name ${name}` }); }
  let sawReady = false;
  let carry = [];
  const readyName = d === 'unity' ? 'Awake' : '_Ready';
  for (const n of nodes) {
    if (n.blank) { if (em.out.length > at && em.out.at(-1).code !== '' ) em.out.push({ ind: 0, code: '', blank: true }); continue; }
    if (!n.text) { em.push(ind + 1, csComment(n.comment)); continue; }
    if (/^(extends\b|class_name\b|@tool\b|@icon\b)/.test(n.text)) { if (n.comment) em.push(ind + 1, csComment(n.comment)); continue; }
    if (n.carry) { carry.push(...n.carry); continue; }
    const ann = [...carry, ...(n.ann ?? [])];
    carry = [];
    em.statement(n, ind + 1, () => {
      const t = n.decl ?? n.text;
      let m;
      if ((m = VAR_RE.exec(t.replace(/^static\s+(?=var\b)/, '').replace(/:\s*$/, '')))) { emitField(n, m, ann, ctx, em, ind + 1, inject); em.raw(n.children, ind + 2); return; }
      if ((m = /^signal\s+(\w+)\s*(?:\(([\s\S]*)\))?$/.exec(t))) {
        const params = m[2]?.trim() ? splitParams(m[2]) : [];
        if (d === 'unity') { ctx.usings.add('System'); em.push(ind + 1, `public event Action${params.length ? `<${params.map(p => csType(p.type, ctx)).join(', ')}>` : ''} ${pascal(m[1])};`); }
        else { em.push(ind + 1, '[Signal]'); em.push(ind + 1, `public delegate void ${pascal(m[1])}EventHandler(${params.map(p => `${csType(p.type, ctx)} ${camel(p.name)}`).join(', ')});`); }
        return;
      }
      if ((m = /^enum\s+(\w+)?\s*\{([\s\S]*)\}$/.exec(t))) {
        const items = m[2].split(',').map(s => s.trim()).filter(Boolean);
        if (m[1]) { em.push(ind + 1, `public enum ${m[1]} { ${items.join(', ')} }`); return; }
        let next = 0;
        for (const item of items) { const [k, v] = item.split('=').map(s => s.trim()); const value = v ?? String(next); next = (Number.isFinite(Number(value)) ? Number(value) : next) + 1; em.push(ind + 1, `public const int ${k} = ${value};`); }
        return;
      }
      if (/^(static\s+)?func\b/.test(t)) {
        const isReady = /^func\s+_ready\b/.test(t);
        if (isReady) sawReady = true;
        return emitFunction(n, t, ann, ctx, em, ind + 1, isReady ? inject.splice(0) : []);
      }
      if ((m = /^class\s+(\w+)(?:\s+extends\s+([\w.]+))?\s*:\s*$/.exec(t))) {
        const scope = { members: ctx.members, types: ctx.types, locals: ctx.locals, inherited: ctx.inherited, baseIsEngine: ctx.baseIsEngine, userBase: ctx.userBase, className: ctx.className };
        Object.assign(ctx, { members: new Map(), types: new Map(), locals: new Set() });
        const kids = m[2] ? [{ text: `extends ${m[2]}`, comment: '', line: n.line, children: [] }, ...n.children] : n.children;
        try { emitClass(kids, ctx, em, ind + 1, { name: m[1], top: false }); } finally { Object.assign(ctx, scope); }
        return;
      }
      throw new DraftError('statement outside a function');
    });
  }
  if (inject.length && !sawReady) {
    em.push(ind + 1, d === 'unity' ? `void ${readyName}()` : `public override void ${readyName}()`);
    em.push(ind + 1, '{');
    for (const l of inject) em.out.push(typeof l === 'string' ? { ind: ind + 2, code: l } : { ...l, ind: ind + 2 });
    em.push(ind + 1, '}');
  }
  em.push(ind, '}');
}

function emitField(n, m, ann, ctx, em, ind, inject) {
  const d = ctx.d;
  const [, kind, name, typeText, , initText] = m;
  const mem = ctx.members.get(name);
  const has = a => ann.find(x => x.name === a);
  const exportAnn = ann.find(x => x.name.startsWith('export') && !['export_group', 'export_subgroup', 'export_category'].includes(x.name));
  for (const g of ann.filter(x => ['export_group', 'export_subgroup', 'export_category'].includes(x.name))) {
    if (d === 'unity') { if (g.name !== 'export_subgroup') em.push(ind, `[Header${g.args}]`); }
    else em.push(ind, `[${pascal(g.name)}${g.args}]`);
  }
  if (n.children.length || /:\s*$/.test(n.decl ?? n.text) || /\b(set|get)\s*=/.test(initText ?? '')) ctx.mark(`property ${name} has a setter or getter: write it as a C# property`);
  const tree = initText && !/\b(set|get)\s*=/.test(initText) ? parseExpr(initText) : null;
  const gdType = typeText?.trim() || inferType(tree, ctx);
  if (gdType) { ctx.types.set(name, gdType); mem.type = gdType; }
  else if (kind === 'var' || !literalConst(tree)) ctx.mark(`type of ${name} could not be inferred`);
  ctx.wantType = gdType;
  ctx.locals = new Set();
  let value = tree ? ex(tree, ctx) : null;
  ctx.wantType = null;
  const type = csType(gdType, ctx);
  const cs = mem.cs;
  if (kind === 'const') {
    if (d === 'unity' && tree?.k === 'call' && tree.f.k === 'name' && tree.f.v === 'preload') {
      ctx.marks = ctx.marks.filter(x => !x.startsWith('preload('));
      ctx.mark(`preload: assign ${cs} in the inspector (${tree.args[0]?.tok?.body ?? ''})`);
      em.push(ind, `[SerializeField] private ${/\.(tscn|scn)$/.test(tree.args[0]?.tok?.body ?? '') ? 'GameObject' : 'UnityEngine.Object'} ${cs};`);
      return;
    }
    em.push(ind, `public ${literalConst(tree) ? 'const' : 'static readonly'} ${type} ${cs} = ${value};`);
    return;
  }
  const access = name.startsWith('_') ? 'private' : 'public';
  const isStatic = /^static\s/.test(n.decl ?? n.text) ? 'static ' : '';
  if (has('onready')) {
    em.push(ind, `${access} ${type} ${cs};`);
    const notes = ctx.marks.splice(0).filter((x, i, all) => all.indexOf(x) === i);
    for (const note of notes) ctx.markers.push({ line: n.line, note });
    if (value) inject.push({ code: `${cs} = ${value};`, marks: notes });
    return;
  }
  if (tree && usesInstance(tree, ctx)) ctx.mark(`initializer of ${name} reads instance state: move it to ${d === 'unity' ? 'Awake()' : 'the constructor or _Ready()'}`);
  if (value === 'null' && !typeText) value = null;
  if (exportAnn) {
    if (d === 'unity') {
      const range = exportAnn.name === 'export_range' ? /^\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)/.exec(exportAnn.args) : null;
      if (range) em.push(ind, `[Range(${range[1]}f, ${range[2]}f)]`);
      else if (exportAnn.name === 'export_multiline') em.push(ind, '[TextArea]');
      em.push(ind, `${name.startsWith('_') ? '[SerializeField] private' : 'public'} ${type} ${cs}${value ? ` = ${value}` : ''};`);
    } else {
      const range = exportAnn.name === 'export_range' ? exportAnn.args.slice(1, -1).replace(/\s+/g, '').replace(/"/g, '') : null;
      const hint = range !== null ? `(PropertyHint.Range, "${range}")` : exportAnn.name === 'export_multiline' ? '(PropertyHint.MultilineText)' : exportAnn.name === 'export_file' ? '(PropertyHint.File)' : exportAnn.name === 'export_dir' ? '(PropertyHint.Dir)' : '';
      if (exportAnn.name !== 'export' && !hint) ctx.mark(`@${exportAnn.name}${exportAnn.args}: add the matching PropertyHint`);
      em.push(ind, `[Export${hint}]`);
      em.push(ind, `public ${type} ${cs} { get; set; }${value ? ` = ${value};` : ''}`);
    }
    return;
  }
  em.push(ind, `${access} ${isStatic}${type} ${cs}${value ? ` = ${value}` : ''};`);
}

function emitFunction(n, t, ann, ctx, em, ind, inject) {
  const d = ctx.d;
  const at = headerColon(t);
  if (at === -1) throw new DraftError('function without a colon');
  const m = FUNC_RE.exec(t.slice(0, at).trim());
  if (!m) throw new DraftError('bad function signature');
  const inline = t.slice(at + 1).trim();
  const [, isStatic, name, paramText, ret] = m;
  const params = splitParams(paramText);
  const saved = { locals: ctx.locals, types: new Map(ctx.types), deltaName: ctx.deltaName, deltaExpr: ctx.deltaExpr, fnCs: ctx.fnCs, usesAwait: ctx.usesAwait };
  ctx.locals = new Set(params.map(p => p.name));
  for (const p of params) { if (p.type) ctx.types.set(p.name, p.type); else ctx.types.delete(p.name); }
  ctx.deltaName = null;
  const virtual = name in GODOT_VIRTUALS;
  const cs = ctx.members.get(name)?.cs ?? methodName(name);
  ctx.fnCs = cs;
  let hasValue = false, hasAwait = false;
  walkNodes([{ text: inline, children: n.children }], x => { if (/^return\s+\S/.test(x.text)) hasValue = true; if (/\bawait\b/.test(x.text)) hasAwait = true; });
  let returns = ret ? csType(ret, ctx) : hasValue ? csType('Variant', ctx) : 'void';
  if (!ret && hasValue) ctx.mark(`return type of ${name}() is not declared: replace ${returns}`);
  let sig;
  const paramList = (types = []) => params.map((p, i) => {
    const type = types[i] ?? (p.type ? csType(p.type, ctx) : p.init ? csType(inferType(parseExpr(p.init), ctx), ctx) : csType('Variant', ctx));
    return `${type} ${camel(p.name)}${p.init ? ` = ${ex(parseExpr(p.init), ctx)}` : ''}`;
  }).join(', ');
  const isProcess = name === '_process' || name === '_physics_process';
  if (hasAwait) { if (returns === 'void') returns = 'async void'; else { ctx.usings.add('System.Threading.Tasks'); returns = `async Task<${returns}>`; } }
  if (ann.some(x => x.name === 'rpc')) { if (d !== 'unity') em.push(ind, '[Rpc]'); ctx.mark('@rpc: copy the mode and options to the target\'s networking'); }
  if (name === '_init') { if (d === 'unity' && ctx.baseIsEngine) ctx.mark('_init: a MonoBehaviour has no constructor arguments; move this to Awake() or an Init method'); sig = `public ${ctx.className}(${paramList()})`; }
  else if (d === 'unity' && UNITY_LIFECYCLE[name]) {
    if (isProcess && params[0]) { ctx.deltaName = params[0].name; ctx.deltaExpr = name === '_process' ? 'Time.deltaTime' : 'Time.fixedDeltaTime'; }
    sig = `${hasAwait ? 'async ' : ''}void ${cs}()`;
  } else if (d === 'unity' && virtual) {
    ctx.mark(`Godot callback ${name}: ${ctx.hint(['input-event']) ?? 'no Unity message with this name; call it from the matching Unity callback'}`);
    sig = `${returns} ${cs}(${paramList()})`;
  } else if (virtual) {
    if (isProcess && params[0]) { ctx.deltaName = params[0].name; ctx.deltaExpr = `(float)${camel(params[0].name)}`; }
    const fixed = GODOT_VIRTUALS[name];
    sig = `public override ${returns} ${cs}(${paramList(fixed ?? [])})`;
    if (fixed) params.forEach((p, i) => { if (fixed[i] && fixed[i] !== 'double' && fixed[i] !== 'int') ctx.types.set(p.name, fixed[i]); });
  } else sig = `${name.startsWith('_') ? 'private' : 'public'} ${isStatic ? 'static ' : ''}${returns} ${cs}(${paramList()})`;
  em.push(ind, sig);
  em.push(ind, '{');
  for (const l of inject) em.out.push(typeof l === 'string' ? { ind: ind + 1, code: l } : { ...l, ind: ind + 1 });
  if (inline) em.block([{ text: inline, comment: '', line: n.line, children: [] }], ind + 1);
  em.block(n.children, ind + 1);
  em.push(ind, '}');
  Object.assign(ctx, { locals: saved.locals, deltaName: saved.deltaName, deltaExpr: saved.deltaExpr, fnCs: saved.fnCs });
  ctx.types = saved.types;
}

// ------------------------------------------------------------------------------------------------ entry points
function render(out) {
  const lines = [];
  for (const l of out) {
    if (l.blank || (!l.code && !l.marks?.length && !l.comment)) { if (lines.length && lines.at(-1) !== '') lines.push(''); continue; }
    const tail = [l.marks?.length ? `// PORT: ${l.marks.join('; ')}` : '', l.comment ?? ''].filter(Boolean).join(' ');
    lines.push(`${PAD.repeat(l.ind)}${l.code}${l.code && tail ? ' ' : ''}${tail}`.trimEnd());
  }
  // No blank line right after "{" or before "}".
  return lines.filter((l, i) => !(l === '' && (/^\s*\}/.test(lines[i + 1] ?? '') || /\{$/.test(lines[i - 1] ?? '')))).join('\n');
}

/**
 * Draft GDScript as C#. Pure: no file access.
 * facts: { autoloads: Map(name → script path), nodeTypes: Map(node path → type), unique: Map(name → type) }.
 */
export function draftGdscript(text, { to = 'godot-csharp', className, facts, isAutoload = false, source = 'script.gd', godot = '4' } = {}) {
  if (!DRAFT_TARGETS.includes(to)) throw new RPError('INVALID_ARGUMENT', `port_draft writes C# for: ${DRAFT_TARGETS.join(', ')}. For other targets use port_unit and write the unit yourself.`);
  const api = snapshot(resolveVersion(godot));
  if (!api.allSignals) {
    api.allSignals = new Set(); api.allProperties = new Set(); api.allMethods ??= new Set();
    for (const c of Object.values(api.classes)) { for (const s of c.signals ?? []) api.allSignals.add(s); for (const s of c.methods ?? []) api.allMethods.add(s); for (const s of c.properties ?? []) api.allProperties.add(s); }
  }
  api.utility ??= new Set(api.utility_functions ?? []);
  api.globalEnums ??= new Set(api.global_enums ?? []);
  const d = to === 'unity' ? 'unity' : 'godot';
  const hits = apiHits(text, 'godot', to);
  const ctx = {
    d, api, facts: facts ?? { autoloads: new Map(), nodeTypes: new Map(), unique: new Map() }, isAutoload,
    members: new Map(), types: new Map(), locals: new Set(), inherited: null, markers: [], marks: [], notes: new Set(), line: 1, className,
    usings: new Set(d === 'unity' ? ['UnityEngine'] : ['Godot']),
    mark(note) { this.marks.push(note); },
    note(n) { this.notes.add(n); },
    /** The API map's advice for the current source line (optionally only for some entries). */
    hint(ids) {
      const here = hits.filter(x => x.lines.includes(this.line));
      const h = ids ? ids.map(id => here.find(x => x.id === id)).find(Boolean) : here[0];
      return h ? h.to : null;
    },
  };
  const tree = blockTree(logicalLines(text));
  const em = new Emitter(ctx);
  emitClass(tree, ctx, em, 0, { name: className, top: true });
  const usings = [...ctx.usings].sort((a, b) => (a === 'System' ? -1 : b === 'System' ? 1 : a.localeCompare(b)));
  const body = render(em.out);
  const content = `// Draft from ${source}, written by ReversePort (port_draft). Review the marked lines, then build.\n${usings.map(u => `using ${u};`).join('\n')}\n\n${body}\n`;
  const statements = tree.reduce(function count(s, n) { return n.children.reduce(count, s + (n.text ? 1 : 0)); }, 0);
  const marked = new Set(ctx.markers.map(m => m.line)).size;
  return { content, markers: ctx.markers, notes: [...ctx.notes], statements, markedStatements: marked, usedHints: hits.map(h => h.id) };
}

const summarize = markers => {
  const groups = new Map();
  for (const m of markers) { const key = m.note.replace(/"[^"]*"/g, '"…"').replace(/\b\w+\(\)/, 'f()').slice(0, 60); const g = groups.get(key) ?? { note: m.note, lines: [] }; g.lines.push(m.line); groups.set(key, g); }
  return [...groups.values()].sort((a, b) => b.lines.length - a.lines.length).slice(0, 30).map(g => ({ note: g.note, count: g.lines.length, sourceLines: [...new Set(g.lines)].slice(0, 12) }));
};

/** Draft one file. Used by the tool below and by port_draft with a plan (see plan.mjs). */
export async function draftFile(abs, { to, className, facts, source } = {}) {
  await requireFile(abs, 'GDScript file');
  if (path.extname(abs).toLowerCase() !== '.gd') throw new RPError('INVALID_ARGUMENT', `port_draft reads GDScript (.gd) files; ${path.basename(abs)} is not one. For other languages use port_unit and write the unit yourself.`);
  const stat = await fs.stat(abs);
  if (stat.size > MAX_SOURCE) throw new RPError('TOO_LARGE', `${path.basename(abs)} is larger than 2 MiB.`);
  const text = await fs.readFile(abs, 'utf8');
  const f = facts ?? await projectFacts(abs);
  const rel = f.root ? path.relative(f.root, abs).split(path.sep).join('/') : path.basename(abs);
  const isAutoload = [...f.autoloads.values()].includes(rel);
  const result = draftGdscript(text, { to, className: className ?? pascalCase(path.basename(abs)), facts: f, isAutoload, source: source ?? rel });
  return { ...result, facts: f, sourceLines: text.split('\n').length };
}

export function draftSummary(r, to) {
  const clean = r.statements ? Math.round(100 * (r.statements - r.markedStatements) / r.statements) : 100;
  return {
    target: to, statements: r.statements, translatedCleanly: `${clean}%`, portMarkers: r.markers.length,
    ...(r.markers.length ? { open: summarize(r.markers) } : {}),
    ...(r.facts?.scenes?.length ? { nodeTypesFrom: r.facts.scenes.slice(0, 5) } : {}),
    ...(r.notes.length ? { notes: r.notes } : {}),
  };
}

export async function draftTool({ file, to, out, name } = {}) {
  if (!file) throw new RPError('INVALID_ARGUMENT', 'Give file (a .gd script) and to, or planId and unit for a unit of a port plan.');
  if (!to) throw new RPError('INVALID_ARGUMENT', `Give to: ${DRAFT_TARGETS.join(' or ')}.`);
  const abs = path.resolve(file);
  const r = await draftFile(abs, { to, className: name });
  const cls = name ?? pascalCase(path.basename(abs));
  const dest = out ? path.resolve(out) : path.join(await workspaceDir('drafts'), `${cls}.cs`);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.writeFile(dest, r.content);
  return {
    file: dest, ...draftSummary(r, to), draft: r.content,
    next: r.markers.length ? `Resolve the ${r.markers.length} "PORT:" line(s) in ${dest}, then build it in ${to === 'unity' ? 'Unity' : 'Godot (.NET)'}.` : `Build ${dest} in ${to === 'unity' ? 'Unity' : 'Godot (.NET)'}; a draft without markers is still unbuilt code.`,
  };
}
