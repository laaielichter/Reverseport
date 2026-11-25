// GameMaker Studio GML bytecode: reader for the CODE / VARI / FUNC / SCPT / OBJT / ROOM / GLOB chunks of a
// data.win (game.unx, game.ios, game.droid: same IFF "FORM"), a disassembler for both instruction encodings
// (bytecode <= 14 and >= 15) and a best-effort decompiler back to GML. Read-only.
//
// Layouts and opcode tables were checked against UndertaleModTool (GPL-3.0; read as documentation, no code copied),
// commit d73b2cbe89675cc197033f5572c5eb635e67089a:
//   UndertaleModLib/Models/UndertaleCode.cs        opcodes, old<->new opcode conversion, instruction words, data
//                                                  types, instance types, variable reference types, comparison
//                                                  kinds, 23/24-bit branch offsets, popenv "drop" magic 0xF00000,
//                                                  reference chains (ParseReferenceChain), code entry layout
//   UndertaleModLib/Models/UndertaleVariable.cs    VARI records (12 bytes in <= 14, 20 bytes in >= 15)
//   UndertaleModLib/Models/UndertaleFunction.cs    FUNC records; first address points 4 bytes further in 2.3+
//   UndertaleModLib/UndertaleChunks.cs             CODE/VARI/FUNC chunk headers, empty CODE chunk = YYC
//   UndertaleModLib/Models/UndertaleGameObject.cs  OBJT object header, event lists, action -> code id
//   UndertaleModLib/Models/UndertaleScript.cs, UndertaleGlobalInit.cs, UndertaleRoom.cs
//   UndertaleModLib/Decompiler/Assembler.cs        names of the extended (break) instructions -1..-11
// and against Underanalyzer (MPL-2.0), commit 4ff50a866b4c1a7acee8cebe6a56d6a48709b453, for what the compiler emits:
//   Underanalyzer/Decompiler/AST/BlockSimulator.cs stack effects, dup sizes (d/l 8, i/b/s/e 4, v 16), pop order
//   Underanalyzer/Decompiler/ControlFlow/*.cs      loop, switch, with, short-circuit and repeat shapes
//   Underanalyzer/VMDataTypeExtensions.cs          result type of a binary operation
// The decompiler is honest by construction: every branch must be claimed by one of the shapes it knows, every
// instruction must be reached exactly once and the stack must be empty at each statement. When that fails the
// entry is not decompiled and its assembly is written instead, with the reason.
import fs from 'node:fs/promises';
import path from 'node:path';
import { RPError, statOrNull, compileMatcher } from './util.mjs';
import { workspaceDir, safeJoin } from './workspace.mjs';

// ------------------------------------------------------------------------------------------------ tables
// Opcode numbers of bytecode >= 15. Bytecode <= 14 is mapped onto them (OLD_OPS), as UndertaleModTool does.
const OPS = { 0x07: 'conv', 0x08: 'mul', 0x09: 'div', 0x0a: 'rem', 0x0b: 'mod', 0x0c: 'add', 0x0d: 'sub', 0x0e: 'and', 0x0f: 'or', 0x10: 'xor', 0x11: 'neg', 0x12: 'not', 0x13: 'shl', 0x14: 'shr', 0x15: 'cmp', 0x45: 'pop', 0x84: 'pushi', 0x86: 'dup', 0x99: 'callv', 0x9c: 'ret', 0x9d: 'exit', 0x9e: 'popz', 0xb6: 'b', 0xb7: 'bt', 0xb8: 'bf', 0xba: 'pushenv', 0xbb: 'popenv', 0xc0: 'push', 0xc1: 'pushloc', 0xc2: 'pushglb', 0xc3: 'pushbltn', 0xd9: 'call', 0xff: 'break' };
const OLD_OPS = { 0x03: 'conv', 0x04: 'mul', 0x05: 'div', 0x06: 'rem', 0x07: 'mod', 0x08: 'add', 0x09: 'sub', 0x0a: 'and', 0x0b: 'or', 0x0c: 'xor', 0x0d: 'neg', 0x0e: 'not', 0x0f: 'shl', 0x10: 'shr', 0x11: 'cmp', 0x12: 'cmp', 0x13: 'cmp', 0x14: 'cmp', 0x15: 'cmp', 0x16: 'cmp', 0x41: 'pop', 0x82: 'dup', 0x9d: 'ret', 0x9e: 'exit', 0x9f: 'popz', 0xb7: 'b', 0xb8: 'bt', 0xb9: 'bf', 0xbb: 'pushenv', 0xbc: 'popenv', 0xc0: 'push', 0xda: 'call', 0xff: 'break' };
const SINGLE = new Set(['neg', 'not', 'dup', 'ret', 'exit', 'popz', 'callv']);
const DOUBLE = new Set(['conv', 'mul', 'div', 'rem', 'mod', 'add', 'sub', 'and', 'or', 'xor', 'shl', 'shr']);
const GOTO = new Set(['b', 'bt', 'bf', 'pushenv', 'popenv']);
const PUSH = new Set(['push', 'pushloc', 'pushglb', 'pushbltn', 'pushi']);
const T = { d: 0, f: 1, i: 2, l: 3, b: 4, v: 5, s: 6, e: 15 };
const TYPE_LETTER = { 0: 'd', 1: 'f', 2: 'i', 3: 'l', 4: 'b', 5: 'v', 6: 's', 15: 'e' };
const TYPE_SIZE = { 0: 8, 2: 4, 3: 8, 4: 4, 5: 16, 6: 4, 15: 4 };
const INSTANCE = { '-1': 'self', '-2': 'other', '-3': 'all', '-4': 'noone', '-5': 'global', '-6': 'builtin', '-7': 'local', '-9': 'stacktop', '-15': 'arg', '-16': 'static' };
const REF_TYPE = { 0x00: 'array', 0x80: 'stacktop', 0xa0: 'normal', 0xe0: 'instance', 0x10: 'arraypushaf', 0x90: 'arraypopaf' };
const CMP = { 1: 'LT', 2: 'LTE', 3: 'EQ', 4: 'NEQ', 5: 'GTE', 6: 'GT' };
const BREAK_NAMES = { '-1': 'chkindex', '-2': 'pushaf', '-3': 'popaf', '-4': 'pushac', '-5': 'setowner', '-6': 'isstaticok', '-7': 'setstatic', '-8': 'savearef', '-9': 'restorearef', '-10': 'chknullish', '-11': 'pushref' };
const EVENT_TYPES = ['Create', 'Destroy', 'Alarm', 'Step', 'Collision', 'Keyboard', 'Mouse', 'Other', 'Draw', 'KeyPress', 'KeyRelease', 'Trigger', 'CleanUp', 'Gesture', 'PreCreate'];
const MAX_DATA = 1536 * 1024 * 1024;

// ------------------------------------------------------------------------------------------------ data file
/** Parses the code-related chunks of a GameMaker data file held in memory. A YYC build is not an error: yyc is true. */
export function parseGameMakerCode(buf) {
  try { return parseData(buf); }
  catch (e) { if (e instanceof RangeError) throw new RPError('BAD_FORMAT', `GameMaker data file is damaged or cut short (${e.message}).`); throw e; }
}

function parseData(buf) {
  if (buf.length < 16 || buf.toString('latin1', 0, 4) !== 'FORM') throw new RPError('BAD_FORMAT', 'Not a GameMaker FORM file.');
  const end = Math.min(buf.length, 8 + buf.readUInt32LE(4));
  const chunks = new Map();
  for (let p = 8; p + 8 <= end;) {
    const name = buf.toString('latin1', p, p + 4), len = buf.readUInt32LE(p + 4);
    if (!/^[A-Z0-9]{4}$/.test(name)) break;
    chunks.set(name, { off: p + 8, size: Math.min(len, buf.length - p - 8) });
    p += 8 + len;
  }
  const gen8 = chunks.get('GEN8');
  if (!gen8 || gen8.size < 0x30) throw new RPError('BAD_FORMAT', 'GameMaker file without a GEN8 chunk.');
  const bytecodeVersion = buf[gen8.off + 1];
  const major = buf.readUInt32LE(gen8.off + 0x2c);
  const u32 = p => (p >= 0 && p + 4 <= buf.length ? buf.readUInt32LE(p) : 0);
  const i32 = p => (p >= 0 && p + 4 <= buf.length ? buf.readInt32LE(p) : 0);
  const strAt = ptr => { if (ptr < 4 || ptr > buf.length) return null; const n = buf.readUInt32LE(ptr - 4); return ptr + n <= buf.length && n < 1 << 24 ? buf.toString('utf8', ptr, ptr + n) : null; };
  const ptrList = off => { const n = u32(off); const out = []; for (let i = 0; i < n && off + 8 + 4 * i <= buf.length; i++) out.push(u32(off + 4 + 4 * i)); return out; };
  const chunkList = name => { const c = chunks.get(name); return c && c.size >= 4 ? ptrList(c.off) : []; };
  const strg = chunkList('STRG');
  const string = id => (id >= 0 && id < strg.length ? strAt(strg[id] + 4) : null);
  const data = { bytecodeVersion, bc14: bytecodeVersion <= 14, gms2: major >= 2, chunks: [...chunks.keys()], stringCount: strg.length, string, code: [], variables: [], functions: [], scripts: [], objects: [], rooms: [], globalInit: [], codeLocals: 0, yyc: false, problems: [] };
  const names = name => chunkList(name).map(p => strAt(u32(p)));
  data.assetNames = { 0: null, 1: names('SPRT'), 2: names('SOND'), 3: null };

  // SCPT: name, code id (the top bit marks a constructor in 2.3+).
  for (const p of chunkList('SCPT')) { let id = i32(p + 4), ctor = false; if (id < -1) { ctor = true; id &= 0x7fffffff; } data.scripts.push({ name: strAt(u32(p)), codeId: id, constructor: ctor }); }
  // GLOB: simple list of code ids.
  const glob = chunks.get('GLOB');
  if (glob && glob.size >= 4) { const n = u32(glob.off); for (let i = 0; i < n && 8 + 4 * i <= glob.size; i++) data.globalInit.push(i32(glob.off + 4 + 4 * i)); }
  // OBJT: the header gained one field ("managed") in 2022.5; the event list is found by checking both layouts.
  for (const p of chunkList('OBJT')) {
    const obj = { name: strAt(u32(p)), events: [] };
    data.objects.push(obj);
    for (const extra of [0, 4]) {
      const vertices = i32(p + 64 + extra);
      if (vertices < 0 || vertices > 4096) continue;
      const ev = p + 80 + extra + vertices * 8, count = u32(ev);
      if (count < 10 || count > 20 || u32(ev + 4) !== ev + 4 + 4 * count) continue;
      ptrList(ev).forEach((listPtr, type) => { for (const e of ptrList(listPtr)) obj.events.push({ type, subtype: u32(e), codeIds: ptrList(e + 4).map(a => i32(a + 32)) }); });
      break;
    }
  }
  // ROOM: creation code at +32, instance list pointer at +48; an instance holds its id at +12 and creation code at +16.
  for (const p of chunkList('ROOM')) {
    const room = { name: strAt(u32(p)), creationCodeId: i32(p + 32), instances: [] };
    const list = u32(p + 48);
    if (list > 0 && list < buf.length) for (const ip of ptrList(list).slice(0, 100000)) { const cc = i32(ip + 16); if (cc >= 0) room.instances.push({ id: u32(ip + 12), creationCodeId: cc }); }
    data.rooms.push(room);
  }
  data.roomNames = data.rooms.map(r => r.name);

  const code = chunks.get('CODE');
  if (!code || code.size < 4) { data.yyc = true; return data; }
  // CODE: name, length, then either the instructions (<= 14) or locals, arguments, relative bytecode address, offset.
  const byAddress = new Map();
  for (const p of ptrList(code.off)) {
    const e = { index: data.code.length, name: strAt(u32(p)) ?? `code_${data.code.length}`, length: u32(p + 4), locals: 0, args: 0, offset: 0, parent: null, children: [] };
    if (data.bc14) e.address = p + 8;
    else {
      e.locals = buf.readUInt16LE(p + 8); const a = buf.readUInt16LE(p + 10); e.args = a & 0x7fff; e.weirdLocalFlag = (a & 0x8000) !== 0;
      e.address = p + 12 + i32(p + 12); e.offset = u32(p + 16);
      const root = byAddress.get(e.address);
      if (e.length > 0 && root) { e.parent = root; root.children.push(e); } else if (e.length > 0) byAddress.set(e.address, e);
    }
    data.code.push(e);
  }
  if (!data.code.length) { data.yyc = true; return data; }
  // Decode every root entry; index instructions by absolute address for the reference chains.
  const at = new Map();
  for (const e of data.code) {
    if (e.parent) continue;
    e.instructions = [];
    if (e.address < 0 || e.address + e.length > buf.length) { data.problems.push(`${e.name}: bytecode outside the file`); continue; }
    for (let p = e.address; p + 4 <= e.address + e.length;) { const ins = decodeInstruction(buf, p, e.address, e.length, data.bc14); e.instructions.push(ins); at.set(p, ins); p += ins.size; }
  }
  // VARI: 12 bytes of counts first in >= 15.
  const vari = chunks.get('VARI');
  if (vari && vari.size) {
    const rec = data.bc14 ? 12 : 20;
    for (let p = vari.off + (data.bc14 ? 0 : 12); p + rec <= vari.off + vari.size; p += rec) {
      const v = { name: strAt(u32(p)), instanceType: data.bc14 ? null : i32(p + 4), id: data.bc14 ? null : i32(p + 8), occurrences: u32(p + rec - 8), firstAddress: i32(p + rec - 4) };
      data.variables.push(v);
      followChain(v, v.firstAddress, at, 'variable', data);
    }
  }
  // FUNC: a bare run of records in <= 14, a counted list in >= 15 (followed by code locals before 2024.8).
  const func = chunks.get('FUNC');
  if (func && func.size) {
    let p = func.off, n = Math.floor(func.size / 12);
    if (!data.bc14) { n = Math.min(u32(p), Math.floor((func.size - 4) / 12)); p += 4; }
    for (let i = 0; i < n; i++, p += 12) {
      const f = { name: strAt(u32(p)), occurrences: u32(p + 4), firstAddress: i32(p + 8) };
      data.functions.push(f);
      // GameMaker 2.3+ stores the address of the reference word, older files the address of the instruction.
      const first = !at.has(f.firstAddress) && at.has(f.firstAddress - 4) ? f.firstAddress - 4 : f.firstAddress;
      followChain(f, first, at, 'function', data);
    }
    if (!data.bc14 && p + 4 <= func.off + func.size) { const locals = u32(p); if (locals <= data.code.length) data.codeLocals = locals; }
  }
  return data;
}

function followChain(ref, first, at, kind, data) {
  let addr = first;
  for (let i = 0; i < ref.occurrences; i++) {
    const ins = at.get(addr);
    if (!ins || ins.next == null) { data.problems.push(`${kind} ${ref.name}: reference chain broke after ${i} of ${ref.occurrences}`); return; }
    ins[kind] = ref;
    addr += ins.next;
  }
}

/** One instruction at absolute offset p. Instructions that cannot be confirmed come back as { unknown: true } with their raw word. */
function decodeInstruction(buf, p, base, length, bc14) {
  const word = buf.readUInt32LE(p);
  const kind = word >>> 24, b2 = (word >>> 16) & 0xff, low = word & 0xffff;
  const op = (bc14 ? OLD_OPS : OPS)[kind];
  const ins = { a: p - base, size: 4, op, word };
  const unknown = why => ({ a: p - base, size: 4, op: 'unknown', unknown: true, why, word });
  if (!op) return unknown(`opcode 0x${kind.toString(16)}`);
  const room = n => p + 4 + n <= base + length;
  const t1 = b2 & 0xf, t2 = b2 >> 4;
  if (SINGLE.has(op) || DOUBLE.has(op) || op === 'cmp') {
    if (!(t1 in TYPE_LETTER) || !(t2 in TYPE_LETTER)) return unknown(`data type ${t1}/${t2}`);
    ins.t1 = t1; ins.t2 = t2; ins.extra = word & 0xff;
    if (op === 'cmp') { ins.cmp = bc14 ? kind - 0x10 : (word >>> 8) & 0xff; if (!CMP[ins.cmp]) return unknown(`comparison kind ${ins.cmp}`); }
    if (op === 'dup') ins.dupKind = (word >>> 8) & 0xff;
    return ins;
  }
  if (GOTO.has(op)) {
    let off = word & 0xffffff;
    ins.drop = off === 0xf00000; // popenv that only leaves the with-scope (break/exit inside with)
    if (!bc14 && !ins.drop && (off & 0x400000)) off |= 0x800000; // 23-bit signed after bytecode 14
    if (off & 0x800000) off -= 0x1000000;
    ins.target = ins.a + off * 4;
    return ins;
  }
  if (op === 'pop') {
    if (!(t1 in TYPE_LETTER) || !(t2 in TYPE_LETTER)) return unknown(`data type ${t1}/${t2}`);
    ins.t1 = t1; ins.t2 = t2; ins.inst = (low << 16) >> 16;
    if (t1 === T.e) { ins.swap = low; return ins; } // "pop swap": reorders the stack, no destination
    if (!room(4)) return unknown('truncated');
    const v = buf.readInt32LE(p + 4);
    ins.size = 8; ins.next = v & 0x07ffffff; ins.ref = (v >>> 24) & 0xf8; ins.isVar = true;
    if (!(ins.ref in REF_TYPE)) return { ...unknown(`variable reference type 0x${ins.ref.toString(16)}`), size: 8 };
    return ins;
  }
  if (PUSH.has(op)) {
    ins.t1 = b2;
    if (op === 'pushi' && b2 !== T.e) return unknown(`pushi with data type ${b2}`);
    switch (b2) {
      case T.d: if (!room(8)) return unknown('truncated'); ins.value = buf.readDoubleLE(p + 4); ins.size = 12; break;
      case T.l: if (!room(8)) return unknown('truncated'); ins.value = buf.readBigInt64LE(p + 4); ins.size = 12; break;
      case T.i: if (!room(4)) return unknown('truncated'); ins.value = buf.readInt32LE(p + 4); ins.size = 8; ins.next = ins.value & 0x07ffffff; break; // may carry a function or variable reference
      case T.s: if (!room(4)) return unknown('truncated'); ins.value = buf.readInt32LE(p + 4); ins.size = 8; break;
      case T.v: {
        if (!room(4)) return unknown('truncated');
        const v = buf.readInt32LE(p + 4);
        ins.size = 8; ins.next = v & 0x07ffffff; ins.ref = (v >>> 24) & 0xf8; ins.inst = (low << 16) >> 16; ins.isVar = true;
        if (!(ins.ref in REF_TYPE)) return { ...unknown(`variable reference type 0x${ins.ref.toString(16)}`), size: 8 };
        break;
      }
      case T.e: ins.value = (low << 16) >> 16; break;
      default: return unknown(`push of data type ${b2}`);
    }
    return ins;
  }
  if (op === 'call') {
    if (!(t1 in TYPE_LETTER)) return unknown(`data type ${t1}`);
    if (!room(4)) return unknown('truncated');
    ins.t1 = t1; ins.argc = low; ins.size = 8; ins.next = buf.readInt32LE(p + 4) & 0x07ffffff;
    return ins;
  }
  // break: extended instructions (negative ids) in 2.3+, a debugger signal otherwise
  ins.t1 = b2; ins.ext = (low << 16) >> 16;
  if (b2 !== T.e && b2 !== T.i) return unknown(`break with data type ${b2}`);
  if (b2 === T.i) { if (!room(4)) return unknown('truncated'); ins.value = buf.readInt32LE(p + 4); ins.size = 8; ins.next = ins.value & 0x07ffffff; }
  if (ins.ext < 0 && !BREAK_NAMES[ins.ext]) return { ...unknown(`extended instruction ${ins.ext}`), size: ins.size };
  return ins;
}

// ------------------------------------------------------------------------------------------------ assembly text
const quote = s => '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t') + '"';
const instanceName = n => INSTANCE[n] ?? String(n);
const refName = ins => ins.variable?.name ?? '(null)';
function varRefText(ins) {
  if (ins.ref === 0xa0) return refName(ins);
  const owner = ins.variable ? (ins.variable.instanceType == null ? 'self' : instanceName(ins.variable.instanceType)) : 'null';
  return `[${REF_TYPE[ins.ref]}]${owner}.${refName(ins)}`;
}

/** GML assembly of one root code entry, in the notation of UndertaleModTool's disassembler. */
export function disassemble(data, entry) {
  const list = entry.instructions ?? [];
  const labels = new Map();
  const starts = new Set([0]);
  list.forEach((ins, i) => { if (GOTO.has(ins.op)) { if (!ins.drop) starts.add(ins.target); if (list[i + 1]) starts.add(list[i + 1].a); } else if ((ins.op === 'ret' || ins.op === 'exit') && list[i + 1]) starts.add(list[i + 1].a); });
  const known = new Set(list.map(i => i.a));
  [...starts].filter(a => known.has(a)).sort((a, b) => a - b).forEach((a, i) => labels.set(a, i));
  const childAt = new Map(entry.children.map(c => [c.offset, c]));
  const lines = [];
  const tl = t => TYPE_LETTER[t];
  for (const ins of list) {
    const child = childAt.get(ins.a);
    if (child && ins.a) lines.push('', `> ${child.name} (locals=${child.locals}, argc=${child.args})`);
    if (labels.has(ins.a)) lines.push(`:[${labels.get(ins.a)}]`);
    const raw = `0x${ins.word.toString(16).padStart(8, '0')}`;
    let s;
    if (ins.unknown) s = `unknown ${raw} ; ${ins.why}`;
    else if (SINGLE.has(ins.op)) s = `${ins.op}.${tl(ins.t1)}${ins.op === 'dup' || ins.op === 'callv' ? ` ${ins.extra}` : ''}${ins.op === 'dup' && ins.dupKind ? ` ${ins.dupKind & 0x7f}` : ''}`;
    else if (DOUBLE.has(ins.op)) s = `${ins.op}.${tl(ins.t1)}.${tl(ins.t2)}`;
    else if (ins.op === 'cmp') s = `cmp.${tl(ins.t1)}.${tl(ins.t2)} ${CMP[ins.cmp]}`;
    else if (GOTO.has(ins.op)) s = `${ins.op} ${ins.drop ? '<drop>' : ins.target === entry.length ? '[end]' : labels.has(ins.target) ? `[${labels.get(ins.target)}]` : String(ins.target / 4).padStart(5, '0')}`;
    else if (ins.op === 'pop') s = ins.t1 === T.e ? `pop.e.${tl(ins.t2)} ${ins.swap}` : `pop.${tl(ins.t1)}.${tl(ins.t2)} ${ins.t1 === T.v && ins.inst !== 0 ? `${ins.ref === 0xe0 ? ins.inst : instanceName(ins.inst)}.` : ''}${varRefText(ins)}`;
    else if (PUSH.has(ins.op)) {
      const head = `${ins.op}.${tl(ins.t1)} `;
      if (ins.t1 === T.v) s = `${head}${ins.inst !== 0 ? `${instanceName(ins.inst)}.` : ''}${varRefText(ins)}`;
      else if (ins.t1 === T.i && ins.function) s = `${head}[function]${ins.function.name}`;
      else if (ins.t1 === T.i && ins.variable) s = `${head}[variable]${ins.variable.name}`;
      else if (ins.t1 === T.s) s = `${head}${quote(data.string(ins.value) ?? '')}@${ins.value}`;
      else s = `${head}${ins.value}`;
    } else if (ins.op === 'call') s = `call.${tl(ins.t1)} ${ins.function?.name ?? '(null)'}(argc=${ins.argc})`;
    else { // break
      const name = BREAK_NAMES[ins.ext];
      s = `${name ?? 'break'}.${tl(ins.t1)}${name ? '' : ` ${ins.ext}`}${ins.t1 === T.i ? ` ${ins.function ? ins.function.name : ins.value}` : ''}`;
    }
    lines.push(s);
  }
  if (labels.size && !known.has(entry.length)) lines.push(':[end]');
  return lines.join('\n') + '\n';
}

// ------------------------------------------------------------------------------------------------ decompiler
class NotDecompiled extends Error {}
class WrongGuess extends Error { constructor(loop) { super('guess'); this.loop = loop; } }
const bail = reason => { throw new NotDecompiled(reason); };
const PREC = { '||': 2, '^^': 2, '&&': 3, '|': 4, '^': 5, '&': 6, '==': 7, '!=': 7, '<': 7, '<=': 7, '>': 7, '>=': 7, '<<': 8, '>>': 8, '+': 9, '-': 9, '*': 10, '/': 10, div: 10, '%': 10 };
const BIN = { mul: '*', div: '/', rem: 'div', mod: '%', add: '+', sub: '-', and: '&', or: '|', xor: '^', shl: '<<', shr: '>>' };
const CMP_OP = { 1: '<', 2: '<=', 3: '==', 4: '!=', 5: '>=', 6: '>' };
const P = (x, min) => (x.p < min ? `(${x.s})` : x.s);
const stripScript = n => n.replace(/^gml_Script_/, '');
const UNSUPPORTED_CALLS = { '@@try_hook@@': 'try/catch', '@@try_unhook@@': 'try/catch', '@@finish_catch@@': 'try/catch', '@@finish_finally@@': 'try/finally', '@@CopyStatic@@': 'constructor inheritance' };

class Decompiler {
  constructor(data, entry) {
    this.data = data; this.entry = entry; this.c = entry.instructions; this.n = this.c.length;
    this.st = []; this.used = new Set(); this.seen = new Uint8Array(this.n); this.locals = new Set(); this.dupId = 0; this.tempRet = null; this.noGuess = new Set(); this.inStatic = false;
    const index = new Map(this.c.map((ins, i) => [ins.a, i]));
    index.set(entry.length, this.n);
    this.back = new Map();
    this.c.forEach((ins, i) => {
      if (ins.unknown) bail(`unknown instruction (${ins.why})`);
      if ((ins.isVar && !ins.variable) || (ins.op === 'call' && !ins.function)) bail('unresolved variable or function reference');
      if (!GOTO.has(ins.op) || ins.drop) return;
      ins.ti = index.get(ins.target);
      if (ins.ti === undefined) bail('branch into the middle of an instruction');
      if (ins.ti <= i && ins.op !== 'popenv' && ins.op !== 'pushenv') { if (!this.back.has(ins.ti)) this.back.set(ins.ti, []); this.back.get(ins.ti).push(i); }
    });
    this.childAt = new Map();
    for (const ch of entry.children) { const i = index.get(ch.offset); if (i !== undefined && i > 0) this.childAt.set(i, ch); }
    this.functions = new Map();
  }

  run() {
    const body = this.range(0, this.n, {});
    if (this.st.length) bail('values left on the stack at the end');
    const missed = this.seen.indexOf(0);
    if (missed >= 0) bail('instructions not reached by the recovered structure');
    return printBlock(withLocals(body, this.locals), 0);
  }

  pop() { if (!this.st.length) bail('stack underflow'); return this.st.pop(); }
  push(s, p, ty, extra) { const x = { s, p, ty, ...extra }; this.st.push(x); return x; }
  emit(ctx, stmt) {
    if (this.st.length !== ctx.base) bail('expression left on the stack at a statement');
    stmt.at = ctx.start; ctx.out.push(stmt);
  }
  sub(ctx, over) { return { brk: ctx.brk, cont: ctx.cont, fwd: ctx.fwd, ...over }; }

  range(i0, i1, ctx) {
    ctx.out = []; ctx.base = this.st.length;
    let i = i0;
    while (i < i1) {
      if (this.st.length === ctx.base) ctx.start = i;
      const lb = this.loopAt(i, i1, ctx);
      i = lb >= 0 ? this.loop(i, lb, ctx) : this.step(i, i1, ctx);
    }
    if (i !== i1) bail('a structure runs past the end of its block');
    return ctx.out;
  }

  loopAt(i, i1, ctx) {
    const list = this.back.get(i);
    if (!list) return -1;
    let best = -1;
    for (const j of list) if (j < i1 && j > best && !this.used.has(j) && !(ctx.noB === i && this.c[j].op === 'b')) best = j;
    return best;
  }

  loop(h, b, ctx) {
    const ins = this.c[b];
    this.used.add(b); this.seen[b] = 1;
    const base = this.st.length;
    if (ins.op === 'b') { // while / for: [h] condition, bf after, body, b h
      // "if (x) continue;" in a for loop is byte-identical to "if (x) {} else { rest }": the first reading is tried,
      // and dropped again when the jump target turns out not to be a for-loop increment.
      const snap = { st: [...this.st], seen: this.seen.slice(), used: new Set(this.used), locals: new Set(this.locals), functions: new Map(this.functions), tempRet: this.tempRet };
      const info = { after: b + 1, cond: null }, fwd = { hi: b, t: null, loop: b, guess: !this.noGuess.has(b) };
      const inner = { brk: b + 1, cont: h, fwd, loop: info, noB: h };
      let body;
      try { body = this.range(h, b, inner); if (fwd.guessed && fwd.t != null && fwd.t < b && !(info.cond && body.filter(s => s.at >= fwd.t).length === 1 && body.some(s => s.at === fwd.t && s.k === 's'))) throw new WrongGuess(b); }
      catch (e) {
        if (!(e instanceof WrongGuess) || e.loop !== b) throw e;
        Object.assign(this, snap); this.noGuess.add(b);
        return this.loop(h, b, ctx);
      }
      if (this.st.length !== base) bail('loop body leaves values on the stack');
      const cond = info.cond ? info.cond.s : 'true';
      if (fwd.t != null && fwd.t < b) { // "continue" jumps forward to the increment of a for loop
        const inc = body.filter(s => s.at >= fwd.t);
        if (!info.cond || inc.length !== 1 || inc[0].k !== 's' || !body.some(s => s.at === fwd.t)) bail('continue target that is not a simple for-loop increment');
        body = body.filter(s => s.at < fwd.t);
        this.emit(ctx, { k: 'for', c: cond, inc: inc[0].s.replace(/;$/, ''), body });
      } else this.emit(ctx, { k: 'while', c: cond, body });
      return b + 1;
    }
    if (ins.op === 'bf') { // do-until: [h] body, condition, bf h
      const fwd = { hi: b, t: null };
      const body = this.range(h, b, { brk: b + 1, cont: null, fwd });
      if (this.st.length !== base + 1) bail('do-until without a condition');
      const cond = this.pop();
      if (fwd.t != null && body.some(s => s.at >= fwd.t)) bail('continue target inside a do-until body');
      this.emit(ctx, { k: 'do', c: cond.s, body });
      return b + 1;
    }
    return bail('backward branch that is not a loop');
  }

  // repeat (n): n, dup.i 0, push 0, cmp LTE, bt end | body | push 1, sub, dup.i 0, [conv.i.b], bt body | end: popz.i
  repeatAt(i) {
    const c = this.c, g = c[i + 3];
    if (!(c[i].t1 === T.i && c[i].extra === 0 && !c[i].dupKind && c[i + 1] && PUSH.has(c[i + 1].op) && c[i + 1].value === 0 && c[i + 2]?.op === 'cmp' && c[i + 2].cmp === 2 && g?.op === 'bt' && g.ti > i + 3 && g.ti < this.n)) return null;
    const t = g.ti, back = c[t - 1];
    if (c[t].op !== 'popz' || back.op !== 'bt' || back.ti !== i + 4) return null;
    let k = t - 2;
    if (c[k].op === 'conv') k--;
    if (!(c[k].op === 'dup' && c[k - 1].op === 'sub' && PUSH.has(c[k - 2].op) && c[k - 2].value === 1)) return null;
    return { end: t, tail: k - 2 };
  }

  step(i, i1, ctx) {
    const ins = this.c[i], st = this.st;
    this.seen[i] = 1;
    switch (ins.op) {
      case 'pushi': this.push(String(ins.value), ins.value < 0 ? 11 : 12, T.i, { k: 'int', v: ins.value }); return i + 1;
      case 'push': case 'pushloc': case 'pushglb': case 'pushbltn': this.pushValue(ins); return i + 1;
      case 'conv': {
        const x = this.pop();
        if (ins.t1 === T.b && x.k === 'int' && (x.v === 0 || x.v === 1) && !x.conv) st.push({ ...x, s: x.v ? 'true' : 'false', p: 12, k: 'bool', ty: ins.t2 });
        else st.push({ ...x, ty: ins.t2, conv: true });
        return i + 1;
      }
      case 'neg': case 'not': { const x = this.pop(); const o = ins.op === 'neg' ? '-' : ins.t1 === T.b ? '!' : '~'; const inner = P(x, 11); this.push(o + (inner.startsWith(o) ? `(${inner})` : inner), 11, x.ty); return i + 1; }
      case 'cmp': {
        const r = this.pop(), l = this.pop();
        const isCase = ins.cmp === 3 && l.dupOf && l.dupOf === st[st.length - 1]; // switch case test: dup of the value below
        const x = this.binary(l, r, CMP_OP[ins.cmp], T.b);
        if (isCase) x.sw = r;
        return i + 1;
      }
      case 'call': this.call(ins, ctx); return i + 1;
      case 'callv': {
        const fn = this.pop(); this.pop();
        const args = []; for (let k = 0; k < ins.extra; k++) args.push(this.pop().s);
        this.push(`${P(fn, 12)}(${args.join(', ')})`, 12, T.v, { k: 'call' });
        return i + 1;
      }
      case 'dup': {
        const rep = ctx.out ? this.repeatAt(i) : null;
        if (rep) return this.repeat(i, rep, ctx);
        this.dup(ins); return i + 1;
      }
      case 'pop': this.assign(ins, ctx); return i + 1;
      case 'popz': {
        if (st.length && st[st.length - 1].keep) return i + 1; // early exit out of a switch/repeat: the value is popped on that path only
        const x = this.pop();
        if (x.k === 'void' || x.dup || x.k === 'fdecl') return i + 1;
        if (x.k !== 'call' && x.k !== 'incdec' && x.k !== 'new') bail('free-floating expression');
        this.emit(ctx, { k: 's', s: `${x.s};` });
        return i + 1;
      }
      // ret/exit inside a switch or repeat run with the switch value / counter still below (ctx.base counts it)
      case 'ret': { const x = this.pop(); this.emit(ctx, { k: 's', s: `return ${x.s};` }); return i + 1; }
      case 'exit': this.emit(ctx, { k: 's', s: 'exit;' }); return i + 1;
      case 'b': return this.onB(i, ctx);
      case 'bf': return this.onBf(i, i1, ctx);
      case 'bt': return this.onBt(i, i1, ctx);
      case 'pushenv': return this.onWith(i, i1, ctx);
      case 'popenv': if (ins.drop) return i + 1; return bail('popenv without a matching with');
      case 'break': return this.extended(i, i1, ctx);
      default: {
        if (!BIN[ins.op]) bail(`instruction ${ins.op}`);
        const r = this.pop(), l = this.pop();
        let o = BIN[ins.op];
        if (ins.t1 === T.b && ins.t2 === T.b) o = { '&': '&&', '|': '||', '^': '^^' }[o] ?? o;
        this.binary(l, r, o, resultType(ins));
        return i + 1;
      }
    }
  }

  binary(l, r, o, ty) {
    const p = PREC[o];
    const mixed = x => x.k === 'bin' && x.p <= 8 && x.o !== o;
    const ls = mixed(l) ? `(${l.s})` : P(l, p), rs = mixed(r) ? `(${r.s})` : P(r, p + 1);
    return this.push(`${ls} ${o} ${rs}`, p, ty, { k: 'bin', o, l, r });
  }

  pushValue(ins) {
    const d = this.data;
    switch (ins.t1) {
      case T.e: this.push(String(ins.value), ins.value < 0 ? 11 : 12, T.i, { k: 'int', v: ins.value, pe: !d.bc14 }); return;
      case T.i:
        if (ins.function) this.push(stripScript(ins.function.name), 12, T.i, { k: 'funcref', name: ins.function.name });
        else if (ins.variable) this.push(`variable_get_hash(${quote(ins.variable.name)})`, 12, T.i, { k: 'call' }); // 2024+: struct_get_from_hash(s, <hash of name>)
        else this.push(String(ins.value), ins.value < 0 ? 11 : 12, T.i, { k: 'int', v: ins.value });
        return;
      case T.l: this.push(String(ins.value), ins.value < 0n ? 11 : 12, T.l, { k: 'num' }); return;
      case T.d: this.push(formatDouble(ins.value), ins.value < 0 || Object.is(ins.value, -0) ? 11 : 12, T.d, { k: 'num' }); return;
      case T.s: { const s = d.string(ins.value); if (s == null) bail('string id outside STRG'); this.push(gmlString(s, d.gms2), 12, T.s, { k: 'str' }); return; }
      default: {
        if (ins.variable.name === '$$$$temp$$$$' && this.tempRet) { this.st.push(this.tempRet); this.tempRet = null; return; }
        this.push(this.variable(ins), 12, T.v, { k: 'var' });
      }
    }
  }

  /** Text of the variable an instruction refers to; pops the instance and index it needs (Underanalyzer's order). */
  variable(ins) {
    const name = ins.variable.name;
    let prefix, index = '';
    const fromStack = x => {
      if (x.k === 'int' && x.v === -9) x = this.pop(); // stacktop: the real instance is one further down (2.3+ structs)
      if (x.k === 'int') { if (x.v === -7) this.locals.add(name); return this.instancePrefix(x.v, 0xa0); }
      if (x.k === 'self') return x.s === 'self' ? '' : `${x.s}.`;
      return `${P(x, 12)}.`;
    };
    if (ins.ref === 0xa0 && ins.inst === -9) prefix = fromStack(this.pop());
    else if (ins.ref === 0x80) prefix = fromStack(this.pop());
    else if (ins.ref === 0x00) {
      const ix = this.pop();
      // before 2.3 a 2D index is i * 32000 + j
      if (!this.data.gms2 || this.data.bytecodeVersion < 17) { const m = ix.k === 'bin' && ix.o === '+' && ix.l.k === 'bin' && ix.l.o === '*' && ix.l.r.k === 'int' && ix.l.r.v === 32000; index = m ? `[${ix.l.l.s}, ${ix.r.s}]` : `[${ix.s}]`; } else index = `[${ix.s}]`;
      prefix = fromStack(this.pop());
    } else if (ins.ref === 0x10 || ins.ref === 0x90) { const ix = this.pop(); index = `[${ix.s}]`; prefix = fromStack(this.pop()); }
    else { if (ins.inst === -7) this.locals.add(name); prefix = this.instancePrefix(ins.inst, ins.ref); }
    return `${prefix}${name}${index}`;
  }

  instancePrefix(inst, ref) {
    if (ref === 0xe0) return `(${inst + 100000}).`; // room instance id
    switch (inst) {
      case -1: case -6: case -7: case -15: case -16: return '';
      case -2: return 'other.';
      case -3: return 'all.';
      case -4: return 'noone.';
      case -5: return 'global.';
      default: {
        if (inst < 0) bail(`instance type ${inst}`);
        const obj = this.data.objects[inst]?.name;
        return obj ? `${obj}.` : `(${inst}).`;
      }
    }
  }

  dup(ins) {
    const st = this.st;
    let type = ins.t1, size = ins.extra, swap = (ins.dupKind & 0x7f) >> 3;
    if (!(type in TYPE_SIZE)) bail('dup of an unsized type');
    let unit = TYPE_SIZE[type];
    if (type === T.e) { unit = 16; [size, swap] = [swap, size]; }
    const take = bytes => { const got = []; while (bytes > 0) { const x = this.pop(); if (x.keep) bail('dup reaches below the current statement'); got.unshift(x); bytes -= TYPE_SIZE[x.ty] ?? bail('dup over an unsized value'); } if (bytes < 0) bail('dup does not line up with the stack'); return got; };
    if (ins.dupKind && swap !== 0) { // "dup swap": moves the top block under the next one
      if (type === T.v && size === 0) return;
      const top = take(size * unit), bottom = take(swap * unit);
      st.push(...top, ...bottom);
      return;
    }
    const items = take((size + 1) * unit);
    for (const x of items) { x.duped = true; x.dupId ??= ++this.dupId; }
    st.push(...items, ...items.map(x => ({ ...x, dup: true, dupOf: x })));
  }

  assign(ins, ctx) {
    const st = this.st;
    if (ins.t1 === T.e) { // pop swap (bytecode <= 16)
      const e1 = this.pop(), e2 = this.pop(), e3 = this.pop();
      if (ins.swap === 5) st.push(e1, e3, e2); else { const e4 = this.pop(); st.push(e1, e4, e3, e2); }
      return;
    }
    let value = ins.t1 === T.i ? this.pop() : null;
    const temp = ins.variable.name === '$$$$temp$$$$';
    const target = this.variable(ins);
    value ??= this.pop();
    if (value.k === 'int' && ins.t2 === T.b && (value.v === 0 || value.v === 1)) value = { ...value, s: value.v ? 'true' : 'false' };
    if (temp) { this.locals.delete('$$$$temp$$$$'); this.tempRet = value; return; } // return value parked while a with/switch is left
    if (this.inStatic && ins.ref === 0xa0 && ins.inst === -16) {
      const top = this.st[this.st.length - 1];
      const extra = value.k === 'fdecl' && value.dup && top?.k === 'fdecl' ? 1 : 0;
      this.emit({ ...ctx, base: ctx.base + extra }, { k: 's', s: `static ${target} = ${value.s};`, isStatic: true });
      return;
    }
    this.store(target, value, ctx);
  }

  store(target, value, ctx) {
    const st = this.st, top = st[st.length - 1];
    if (value.k === 'fdecl') {
      if (value.dup && top?.k === 'fdecl' && /^global\.___struct___\d+$/.test(target)) return; // the function behind a struct literal: kept for @@NewGMLObject@@
      if (value.dup && value.name === target && top?.k === 'fdecl') { this.emit({ ...ctx, base: ctx.base + 1 }, { k: 'func', fn: value.fn }); return; }
      if (value.dup && top?.k === 'fdecl') { this.emit({ ...ctx, base: ctx.base + 1 }, { k: 's', s: `${target} = ${value.s};` }); return; }
    }
    if (value.k === 'bin' && (value.o === '+' || value.o === '-') && value.r.k === 'int' && value.r.v === 1) {
      const sign = value.o + value.o;
      if (value.dupId && top?.dupId === value.dupId) { st.pop(); this.push(`${sign}${target}`, 11, value.ty, { k: 'incdec' }); return; }
      if (value.l.dupId && top?.dupId === value.l.dupId) { st.pop(); this.push(`${target}${sign}`, 12, value.ty, { k: 'incdec' }); return; }
      if (value.l.s === target && value.r.pe) { this.emit(ctx, { k: 's', s: `${target}${sign};` }); return; }
    }
    if (value.k === 'bin' && value.l.s === target && value.l.k === 'var' && !['==', '!=', '<', '<=', '>', '>=', '&&', '||', '^^', '<<', '>>', 'div'].includes(value.o)) { this.emit(ctx, { k: 's', s: `${target} ${value.o}= ${value.r.s};` }); return; }
    this.emit(ctx, { k: 's', s: `${target} = ${value.s};` });
  }

  call(ins, ctx) {
    const name = ins.function.name;
    if (UNSUPPORTED_CALLS[name]) bail(UNSUPPORTED_CALLS[name]);
    const raw = []; for (let k = 0; k < ins.argc; k++) raw.push(this.pop());
    const args = raw.map(a => a.s);
    switch (name) {
      case '@@SetStatic@@': return; // marks a function with statics; pushes nothing (Underanalyzer ignores it too)
      case '@@This@@': this.push('self', 12, T.v, { k: 'self' }); return;
      case '@@Other@@': this.push('other', 12, T.v, { k: 'self' }); return;
      case '@@Global@@': this.push('global', 12, T.v, { k: 'self' }); return;
      case '@@GetInstance@@': { const x = raw[0]; const obj = x?.k === 'int' && x.v >= 0 ? this.data.objects[x.v]?.name : null; this.push(obj ?? x.s, obj ? 12 : x.p, T.v, { k: 'expr' }); return; }
      case '@@NewGMLArray@@': this.push(`[${args.join(', ')}]`, 12, T.v, { k: 'expr' }); return;
      case '@@NewGMLObject@@':
        if (!raw.length) this.push('{}', 12, T.v, { k: 'expr' });
        else {
          const literal = raw[0].k === 'fdecl' && !raw[0].fn.name ? structLiteral(raw[0].fn, args.slice(1)) : null;
          if (literal) this.push(literal, 12, T.v, { k: 'expr' });
          else this.push(`new ${raw[0].k === 'fdecl' ? `(${raw[0].s})` : P(raw[0], 12)}(${args.slice(1).join(', ')})`, 12, T.v, { k: 'new' });
        }
        return;
      case '@@throw@@': this.emit({ ...ctx, base: this.st.length }, { k: 's', s: `throw ${args[0]};` }); this.push('', 12, T.v, { k: 'void' }); return;
      case 'method': {
        const fn = raw[1]?.k === 'funcref' ? this.functions.get(raw[1].name) : null;
        if (fn) { this.push(printFunction(fn, true), 1, T.v, { k: 'fdecl', fn, name: fn.name }); return; }
      }
    }
    this.push(`${stripScript(name)}(${args.join(', ')})`, 12, T.v, { k: 'call' });
  }

  extended(i, i1, ctx) {
    const c = this.c, ins = c[i];
    switch (BREAK_NAMES[ins.ext]) {
      case 'isstaticok': { // static x = ...: isstaticok, bt after, setstatic, initialisers, after:
        const t = c[i + 1]?.op === 'bt' ? c[i + 1].ti : -1;
        if (t <= i + 2 || t > i1 || c[i + 2].op !== 'break' || BREAK_NAMES[c[i + 2].ext] !== 'setstatic' || this.st.length !== ctx.base) bail('static initialiser block not recognised');
        this.seen[i + 1] = this.seen[i + 2] = 1;
        const was = this.inStatic; this.inStatic = true;
        const body = this.range(i + 3, t, this.sub(ctx));
        this.inStatic = was;
        if (this.st.length !== ctx.base || body.some(s => !s.isStatic)) bail('static initialiser block holds other statements');
        ctx.out.push(...body);
        return t;
      }
      case 'chknullish': { // a ?? b: a, chknullish, bf end, popz, b, end:
        const t = c[i + 1]?.op === 'bf' ? c[i + 1].ti : -1;
        if (t <= i + 2 || t > i1 || c[i + 2].op !== 'popz') bail('nullish operator not recognised');
        const a = this.pop(), d = this.st.length;
        this.seen[i + 1] = this.seen[i + 2] = 1;
        const body = this.range(i + 3, t, this.sub(ctx));
        if (body.length || this.st.length !== d + 1) bail('nullish assignment');
        const b = this.pop();
        this.push(`${P(a, 2)} ?? ${P(b, 2)}`, 1, T.v, { k: 'expr' });
        return t;
      }
    }
    this.extendedSimple(ins, ctx);
    return i + 1;
  }

  extendedSimple(ins, ctx) {
    switch (BREAK_NAMES[ins.ext]) {
      case 'chkindex': case 'savearef': case 'restorearef': return;
      case 'setowner': this.pop(); return;
      case 'pushaf': case 'pushac': { const ix = this.pop(), v = this.pop(); if (v.k !== 'var') bail('array access on a non-variable'); this.push(`${v.s}[${ix.s}]`, 12, T.v, { k: 'var', dup: v.dup, dupOf: v.dupOf }); return; }
      case 'popaf': { const ix = this.pop(), v = this.pop(), value = this.pop(); if (v.k !== 'var') bail('array store on a non-variable'); this.store(`${v.s}[${ix.s}]`, value, ctx); return; }
      case 'pushref': {
        if (ins.function) { this.push(stripScript(ins.function.name), 12, T.v, { k: 'funcref', name: ins.function.name }); return; }
        const id = ins.value & 0xffffff, type = ins.value >> 24; // types 0-3 mean the same in every version
        const known = type === 0 ? this.data.objects[id]?.name : type === 3 ? this.data.roomNames[id] : type === 1 || type === 2 ? this.data.assetNames[type]?.[id] : null;
        this.push(known ?? `${id} /* asset reference, type ${type} */`, 12, T.v, { k: 'expr' });
        return;
      }
      case 'setstatic': return bail('static variables outside an initialiser block');
      default: return bail(`break ${ins.ext}`);
    }
  }

  onB(i, ctx) {
    const t = this.c[i].ti;
    if (t > i && this.childAt.has(i + 1)) return this.funcDecl(i, t);
    if (t === ctx.brk) { this.emit(ctx, { k: 's', s: 'break;' }); return i + 1; }
    if (t === ctx.cont) { this.emit(ctx, { k: 's', s: 'continue;' }); return i + 1; }
    if (t === i + 1) return i + 1; // jump to the next instruction: the end of an empty else
    if (ctx.fwd && t > i && t <= ctx.fwd.hi && (ctx.fwd.t == null || ctx.fwd.t === t)) { ctx.fwd.t = t; this.emit(ctx, { k: 's', s: 'continue;' }); return i + 1; }
    return bail('jump that fits no if, loop, switch or with');
  }

  // a && b: a, bf F, b, b E, F: push.e 0, E:   |   a || b: a, bt T, b, b E, T: push.e 1, E:
  shortCircuit(i, value) {
    const c = this.c, ins = c[i], f = ins.ti;
    const tail = c[f];
    if (!(f < this.n && tail.op === 'push' && tail.t1 === T.e && tail.value === value && c[f - 1].op === 'b' && c[f - 1].ti === f + 1 && f - 1 > i)) return -1;
    const o = value ? '||' : '&&';
    let acc = this.pop();
    const ectx = { out: [], base: this.st.length, brk: null, cont: null };
    let j = i + 1;
    const fold = () => { const r = this.pop(); if (this.st.length !== ectx.base) bail('short-circuit operand leaves values on the stack'); acc = this.binary(acc, r, o, T.b); this.st.pop(); };
    while (j < f - 1) {
      if (c[j].op === ins.op && c[j].ti === f) { fold(); this.seen[j] = 1; j++; continue; }
      j = this.step(j, f - 1, ectx);
    }
    if (j !== f - 1 || ectx.out.length) bail('statement inside a short-circuit expression');
    fold();
    this.seen[f - 1] = this.seen[f] = 1;
    this.st.push(acc);
    return f + 1;
  }

  onBf(i, i1, ctx) {
    const c = this.c, L = c[i].ti;
    if (L <= i) bail('backward conditional branch that is not a do-until');
    const sc = this.shortCircuit(i, 0);
    if (sc >= 0) return sc;
    if (ctx.loop && !ctx.loop.cond && L === ctx.loop.after && ctx.out.length === 0 && this.st.length === ctx.base + 1) { ctx.loop.cond = this.pop(); return i + 1; }
    if (L > i1) bail('conditional branch out of its block');
    const cond = this.pop();
    const d = this.st.length;
    const prev = c[L - 1];
    if (L - 1 === i + 1 && prev.op === 'b' && ctx.fwd?.guess && prev.ti > L && prev.ti < ctx.fwd.hi && (ctx.fwd.t == null || ctx.fwd.t === prev.ti)) {
      ctx.fwd.t = prev.ti; ctx.fwd.guessed = true; this.seen[L - 1] = 1;
      this.emit(ctx, { k: 'if', c: cond.s, a: [{ k: 's', s: 'continue;' }], b: null });
      return L;
    }
    if (L - 1 > i && prev.op === 'b' && !this.childAt.has(L) && prev.ti > L && prev.ti <= i1 && ((prev.ti !== ctx.brk && prev.ti !== ctx.cont) || prev.ti === i1)) {
      const M = prev.ti; // (a jump to the break/continue target is read as else only when the if closes its block: same behaviour either way)
      const a = this.range(i + 1, L - 1, this.sub(ctx));
      this.seen[L - 1] = 1;
      if (this.st.length === d + 1 && !a.length) { // cond ? x : y
        const x = this.pop();
        const b = this.range(L, M, this.sub(ctx));
        if (this.st.length !== d + 1 || b.length) bail('ternary with unbalanced arms');
        const y = this.pop();
        this.push(`${P(cond, 2)} ? ${P(x, 2)} : ${P(y, 2)}`, 1, x.ty === y.ty ? x.ty : T.v, { k: 'expr' });
        return M;
      }
      if (this.st.length !== d) bail('if body leaves values on the stack');
      const b = this.range(L, M, this.sub(ctx));
      if (this.st.length !== d) bail('else body leaves values on the stack');
      this.emit(ctx, { k: 'if', c: cond.s, a, b });
      return M;
    }
    const a = this.range(i + 1, L, this.sub(ctx));
    if (this.st.length !== d) bail('if body leaves values on the stack');
    this.emit(ctx, { k: 'if', c: cond.s, a, b: null });
    return L;
  }

  onBt(i, i1, ctx) {
    if (this.c[i].ti <= i) bail('backward conditional branch that is not a repeat');
    const sc = this.shortCircuit(i, 1);
    if (sc >= 0) return sc;
    const cond = this.pop();
    if (!cond.sw) bail('conditional jump that fits no switch or short-circuit');
    return this.switch(i, cond, i1, ctx);
  }

  // value | dup, case, cmp EQ, bt body ... | b default | [b end] | bodies | end: popz
  switch(i, first, i1, ctx) {
    const c = this.c, st = this.st;
    const value = st[st.length - 1];
    const cases = [{ e: first.sw.s, t: c[i].ti }];
    let j = i + 1;
    while (j < i1 && c[j].op !== 'b') {
      const ectx = { out: [], base: st.length };
      while (j < i1 && c[j].op !== 'bt') j = this.step(j, i1, ectx);
      if (j >= i1 || ectx.out.length) bail('switch header does not end in a jump');
      const cond = this.pop();
      if (!cond.sw || st[st.length - 1] !== value) bail('switch case test not recognised');
      this.seen[j] = 1; cases.push({ e: cond.sw.s, t: c[j].ti }); j++;
    }
    if (j >= i1) bail('switch without an end');
    const targets = new Set(cases.map(x => x.t));
    let end = c[j].ti, def = null, start = j + 1;
    this.seen[j] = 1;
    if (c[j + 1]?.op === 'b' && !targets.has(j + 1) && c[j].ti !== j + 1) { def = c[j].ti; end = c[j + 1].ti; this.seen[j + 1] = 1; start = j + 2; if (def === end) def = null; }
    if (end > i1 || end >= this.n || c[end].op !== 'popz' || end < start) bail('switch end not found');
    const labels = [...new Set([...targets, ...(def != null ? [def] : [])])].sort((a, b) => a - b);
    if (labels.some(t => t < start || t > end) || (labels.length && labels[0] !== start && start !== end)) bail('switch cases out of order');
    // "continue" inside a switch in a loop goes through a block after the end: popz, b <loop continue>
    let alt = null, next = end + 1;
    if (c[end + 1]?.op === 'b' && c[end + 1].ti === end + 4 && c[end + 2]?.op === 'popz' && c[end + 3]?.op === 'b') {
      const t = c[end + 3].ti;
      const isContinue = t === ctx.cont || (ctx.fwd && t > end && t <= ctx.fwd.hi && (ctx.fwd.t == null || ctx.fwd.t === t));
      if (!isContinue) bail('switch continue block without a loop');
      if (t !== ctx.cont) ctx.fwd.t = t;
      alt = end + 2; next = end + 4;
      for (let k = end + 1; k < end + 4; k++) this.seen[k] = 1;
    }
    value.keep = true;
    const out = [];
    labels.forEach((t, k) => {
      const stop = labels[k + 1] ?? end;
      const body = this.range(t, stop, { brk: end, cont: alt ?? ctx.cont, fwd: alt != null ? null : ctx.fwd });
      if (st[st.length - 1] !== value) bail('switch case leaves values on the stack');
      out.push({ labels: [...cases.filter(x => x.t === t).map(x => x.e), ...(def === t ? [null] : [])], body });
    });
    this.seen[end] = 1;
    st.pop();
    this.emit(ctx, { k: 'switch', c: value.s, cases: out });
    return next;
  }

  repeat(i, rep, ctx) {
    const c = this.c;
    const count = this.pop();
    const counter = this.push(count.s, count.p, T.i, { keep: true });
    for (let k = i; k < i + 4; k++) this.seen[k] = 1;
    for (let k = rep.tail; k <= rep.end; k++) this.seen[k] = 1;
    this.used.add(rep.end - 1);
    const body = this.range(i + 4, rep.tail, { brk: rep.end, cont: rep.tail, fwd: null });
    if (this.st.pop() !== counter) bail('repeat body leaves values on the stack');
    if (c[rep.end].t1 !== T.i) bail('repeat end not recognised');
    this.emit(ctx, { k: 'repeat', c: count.s, body });
    return rep.end + 1;
  }

  // with (x): x, pushenv end | body | end: popenv body  [| b after | popenv <drop> | after:]  (the extra block serves "break")
  onWith(i, i1, ctx) {
    const c = this.c, t = c[i].ti;
    if (t <= i || t >= i1 || c[t].op !== 'popenv' || c[t].drop || c[t].ti !== i + 1) bail('with block not recognised');
    let x = this.pop();
    if (x.k === 'int' && x.v === -9) x = this.pop();
    let target = x.s;
    if (x.k === 'int') { const names = { '-1': 'self', '-2': 'other', '-3': 'all', '-4': 'noone', '-5': 'global' }; target = names[x.v] ?? (x.v >= 0 ? this.data.objects[x.v]?.name ?? x.s : x.s); }
    let brk = null, next = t + 1;
    if (c[t + 1]?.op === 'b' && c[t + 1].ti === t + 3 && c[t + 2]?.op === 'popenv' && c[t + 2].drop) { brk = t + 2; next = t + 3; this.seen[t + 1] = this.seen[t + 2] = 1; }
    const d = this.st.length;
    const body = this.range(i + 1, t, { brk, cont: t, fwd: null });
    if (this.st.length !== d) bail('with body leaves values on the stack');
    this.seen[t] = 1;
    this.emit(ctx, { k: 'with', c: target, body });
    return next;
  }

  // 2.3+: b after | body of the child entry | after: push function, ..., call method — the body is parsed on its own
  funcDecl(i, after) {
    const child = this.childAt.get(i + 1);
    const saved = { st: this.st, locals: this.locals, tempRet: this.tempRet };
    this.st = []; this.locals = new Set(); this.tempRet = null;
    const body = this.range(i + 1, after, {});
    if (this.st.length) bail('function body leaves values on the stack');
    const name = stripScript(child.name);
    if (body.length && body[body.length - 1].s === 'exit;') body.pop(); // the exit the compiler puts at the end of every function
    this.functions.set(child.name, { name: /^anon_|^___struct___/.test(name) ? null : name, args: child.args, body: withLocals(body, this.locals), constructor: this.data.scripts.some(s => s.codeId === child.index && s.constructor) });
    Object.assign(this, saved);
    return after;
  }
}

function resultType(ins) {
  const a = ins.t1, b = ins.t2;
  if (['sub', 'div', 'mod', 'and', 'or', 'xor', 'shl', 'shr'].includes(ins.op) && (a === T.s || b === T.s)) return T.d;
  if (ins.op === 'rem' && ((a === T.s && b !== T.v) || b === T.s)) return T.d;
  const bias = t => (t === T.v ? 2 : t === T.d || t === T.l ? 1 : 0);
  return bias(a) === bias(b) ? Math.min(a, b) : bias(a) > bias(b) ? a : b;
}
const formatDouble = v => String(v);
function gmlString(s, gms2) {
  if (gms2) return quote(s);
  if (!s.includes('"')) return `"${s}"`;
  if (!s.includes("'")) return `'${s}'`;
  return s.split('"').map(part => `"${part}"`).join(` + '"' + `);
}
/** { a: x, b: y } is compiled as new (function() { a = argument0; b = argument1; })(x, y): print it as the literal when the body is only that. */
function structLiteral(fn, args) {
  const fields = [];
  for (const s of fn.body) {
    const m = s.k === 's' ? /^([A-Za-z_]\w*) = ([\s\S]*);$/.exec(s.s) : null;
    if (!m || (/["']/.test(m[2]) && /argument/.test(m[2]))) return null;
    let bad = false;
    const value = m[2].replace(/\bargument(?:\[(\d+)\]|(\d+))(?![\w[])/g, (whole, a, b) => { const v = args[a ?? b]; if (v == null) bad = true; return whole === m[2] || /^[\w.]+$/.test(v ?? '') ? v : `(${v})`; });
    if (bad || /\bargument/.test(value) && value !== m[2] || /\bargument(\d|\[|_count)/.test(m[2]) && value === m[2]) return null;
    fields.push(`${m[1]}: ${value}`);
  }
  return fields.length ? `{ ${fields.join(', ')} }` : '{}';
}
function withLocals(body, locals) {
  const names = [...locals].filter(n => n !== '$$$$temp$$$$' && !/^argument\d*$/.test(n));
  return names.length ? [{ k: 's', s: `var ${names.join(', ')};` }, ...body] : body;
}
function printFunction(fn, anonymous) {
  const args = Array.from({ length: fn.args }, (_, i) => `argument${i}`).join(', ');
  return `function${anonymous || !fn.name ? '' : ` ${fn.name}`}(${args})${fn.constructor ? ' constructor' : ''} {\n${printBlock(fn.body, 1)}}`;
}
function printBlock(list, depth) {
  const pad = '    '.repeat(depth);
  let out = '';
  const line = s => { for (const l of s.split('\n')) out += `${pad}${l}\n`; };
  const block = body => printBlock(body, depth + 1);
  for (const s of list) {
    switch (s.k) {
      case 's': line(s.s); break;
      case 'func': line(printFunction(s.fn, false)); break;
      case 'if': {
        let cur = s;
        line(`if (${cur.c}) {`); out += block(cur.a);
        while (cur.b && cur.b.length === 1 && cur.b[0].k === 'if') { cur = cur.b[0]; line(`} else if (${cur.c}) {`); out += block(cur.a); }
        if (cur.b) { line('} else {'); out += block(cur.b); }
        line('}');
        break;
      }
      case 'while': line(`while (${s.c}) {`); out += block(s.body); line('}'); break;
      case 'for': line(`for (; ${s.c}; ${s.inc}) {`); out += block(s.body); line('}'); break;
      case 'do': line('do {'); out += block(s.body); line(`} until (${s.c});`); break;
      case 'repeat': line(`repeat (${s.c}) {`); out += block(s.body); line('}'); break;
      case 'with': line(`with (${s.c}) {`); out += block(s.body); line('}'); break;
      case 'switch':
        line(`switch (${s.c}) {`);
        for (const cs of s.cases) { for (const l of cs.labels) out += `${pad}    ${l == null ? 'default' : `case ${l}`}:\n`; out += printBlock(cs.body, depth + 2); }
        line('}');
        break;
    }
  }
  return out;
}

/** Decompiles one root code entry. Returns { gml } or { reason } — never GML it is not sure about. */
export function decompile(data, entry) {
  try { return { gml: new Decompiler(data, entry).run() }; }
  catch (e) {
    if (e instanceof NotDecompiled) return { reason: e.message };
    if (e instanceof RangeError || e instanceof TypeError) return { reason: `decompiler error (${e.message})` };
    throw e;
  }
}

// ------------------------------------------------------------------------------------------------ project layout
const safeName = s => String(s ?? 'unnamed').replace(/[^A-Za-z0-9._@-]+/g, '_').slice(0, 120) || 'unnamed';
/** Where each root code entry belongs in a project: scripts/, objects/<object>/<Event>_<n>, rooms/<room>/... */
export function codeLayout(data) {
  const place = new Map();
  const set = (id, rel) => { const e = data.code[id]; if (e && !place.has(e.parent ?? e)) place.set(e.parent ?? e, rel); };
  for (const o of data.objects) for (const ev of o.events) ev.codeIds.forEach((id, k) => {
    const sub = ev.type === 4 ? safeName(data.objects[ev.subtype]?.name ?? ev.subtype) : ev.subtype;
    set(id, `objects/${safeName(o.name)}/${EVENT_TYPES[ev.type] ?? `Event${ev.type}`}_${sub}${k ? `_${k}` : ''}.gml`);
  });
  for (const r of data.rooms) { if (r.creationCodeId >= 0) set(r.creationCodeId, `rooms/${safeName(r.name)}/RoomCreationCode.gml`); for (const inst of r.instances) set(inst.creationCodeId, `rooms/${safeName(r.name)}/InstanceCreationCode_${inst.id}.gml`); }
  for (const id of data.globalInit) { const e = data.code[id]; if (e) set(id, `scripts/${safeName(e.name.replace(/^gml_(GlobalScript|Script)_/, ''))}.gml`); }
  for (const s of data.scripts) if (s.codeId >= 0) set(s.codeId, `scripts/${safeName(s.name)}.gml`);
  const taken = new Set();
  const out = [];
  for (const e of data.code) {
    if (e.parent) continue;
    let rel = place.get(e);
    if (!rel) { // not linked from any chunk: go by the entry's own name
      const m = /^gml_(GlobalScript|Script)_(.+)$/.exec(e.name) ?? null;
      const o = /^gml_Object_(.+)_([A-Za-z]+)_(\w+)$/.exec(e.name);
      const r = /^gml_Room(?:CC)?_(.+?)(?:_(\d+))?_Create$/.exec(e.name);
      rel = m ? `scripts/${safeName(m[2])}.gml` : o ? `objects/${safeName(o[1])}/${o[2]}_${o[3]}.gml` : r ? `rooms/${safeName(r[1])}/${r[2] != null ? `InstanceCreationCode_${r[2]}` : 'RoomCreationCode'}.gml` : `code/${safeName(e.name)}.gml`;
    }
    for (let k = 2; taken.has(rel.toLowerCase()); k++) rel = rel.replace(/(_\d+)?\.gml$/, `_${k}.gml`);
    taken.add(rel.toLowerCase());
    out.push({ entry: e, file: rel });
  }
  return out;
}

const GM_DATA_NAMES = ['data.win', 'game.unx', 'game.ios', 'game.droid'];
/** The GameMaker data file a path refers to (the file itself, or data.win / game.unx / game.ios / game.droid in a folder), or null. */
export async function findGameMakerData(target) {
  const abs = path.resolve(target);
  const st = await statOrNull(abs);
  if (!st) return null;
  const candidates = st.isDirectory() ? GM_DATA_NAMES.flatMap(n => [path.join(abs, n), path.join(abs, 'assets', n)]) : [abs];
  for (const file of candidates) {
    const fst = st.isDirectory() ? await statOrNull(file) : st;
    if (!fst?.isFile() || fst.size < 16) continue;
    const fh = await fs.open(file, 'r');
    try { const head = Buffer.alloc(12); await fh.read(head, 0, 12, 0); if (head.toString('latin1', 0, 4) === 'FORM' && head.toString('latin1', 8, 12) === 'GEN8') return { file, size: fst.size }; } finally { await fh.close(); }
  }
  return null;
}

/** re_decode for a GameMaker data file: one .gml per code entry, laid out like a project. */
export async function decodeGameMaker({ file, size, out, limit, match, asm = false } = {}) {
  if (size > MAX_DATA) throw new RPError('TOO_LARGE', `${path.basename(file)} is ${Math.round(size / 1048576)} MiB; the GML reader loads the file in memory and stops at ${MAX_DATA / 1048576} MiB.`);
  if (limit != null && (!Number.isInteger(limit) || limit < 1)) throw new RPError('INVALID_ARGUMENT', 'limit must be a positive integer.');
  const matches = compileMatcher(match);
  const data = parseGameMakerCode(await fs.readFile(file));
  const base = { source: file, format: 'gamemaker-data', bytecodeVersion: data.bytecodeVersion, scripts: data.scripts.length, objects: data.objects.length, rooms: data.rooms.length };
  if (data.yyc) return { ...base, yyc: true, decoded: 0, entries: { total: 0 }, next: 'This is a YYC build: the GML was compiled to native code and the CODE chunk is empty, so there is no bytecode to decompile. Names of scripts, objects and rooms and all strings are still in the data file (re_archive, re_strings); the logic is in the executable (re_binary, re_deep).' };
  const outDir = out ? path.resolve(out) : path.join(await workspaceDir('decoded'), safeName(path.basename(path.dirname(file))) || 'gamemaker');
  const layout = codeLayout(data);
  const selected = layout.filter(x => matches(x.entry.name) || matches(x.file));
  const todo = selected.slice(0, limit ?? selected.length);
  const reasons = {}, files = [];
  let decompiled = 0, assemblyOnly = 0, unknown = 0, written = 0;
  const save = async (rel, text) => { const dest = safeJoin(outDir, rel); await fs.mkdir(path.dirname(dest), { recursive: true }); await fs.writeFile(dest, text); written++; };
  for (const { entry, file: rel } of todo) {
    const text = disassemble(data, entry);
    unknown += entry.instructions.filter(i => i.unknown).length;
    const r = decompile(data, entry);
    if (r.gml != null) { decompiled++; await save(rel, r.gml); }
    else {
      assemblyOnly++; reasons[r.reason] = (reasons[r.reason] ?? 0) + 1;
      await save(rel, `// not decompiled: ${r.reason}\n// GML assembly of ${entry.name} (same text as ${path.posix.basename(rel).replace(/\.gml$/, '.asm')}):\n${text.split('\n').map(l => (l ? `// ${l}` : '//')).join('\n')}\n`);
    }
    if (asm || r.gml == null) await save(rel.replace(/\.gml$/, '.asm'), text);
    if (files.length < 500) files.push({ code: entry.name, file: rel, ...(r.gml != null ? {} : { assemblyOnly: true, reason: r.reason }), ...(entry.children.length ? { functions: entry.children.length } : {}) });
  }
  const roots = layout.length;
  return {
    ...base, out: outDir, decoded: written,
    entries: { total: data.code.length, roots, functionsInside: data.code.length - roots, selected: selected.length, processed: todo.length, decompiled, assemblyOnly },
    unknownInstructions: unknown, reasons: Object.fromEntries(Object.entries(reasons).sort((a, b) => b[1] - a[1])),
    variables: data.variables.length, functions: data.functions.length, ...(data.problems.length ? { problems: data.problems.slice(0, 20), problemCount: data.problems.length } : {}),
    files, truncated: todo.length < selected.length,
    next: `${decompiled} of ${todo.length} code entries were decompiled to GML in ${outDir}; ${assemblyOnly} did not fit a shape the decompiler is sure about and were written as GML assembly (.asm, and as comments in the .gml, with the reason on the first line). Decompiled GML has no comments or macros: constants are numbers, asset ids are numbers before GameMaker 2023.8, and for loops come back as while loops. Use it to port behaviour (port_plan, re_graph), not as the original source.`,
  };
}
