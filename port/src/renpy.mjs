// Ren'Py compiled scripts (.rpyc / .rpymc) back to .rpy text.
// Container: RPYC2 ("RENPY RPC2" + slot table of u32 slot, start, length; slot 1 is a zlib-compressed pickle of
// (data, statements)) and the legacy format without a header (the whole file is that zlib pickle).
// The pickle is read as data only (gamearchives.mjs unpickle, objects mode): nothing in it is imported or run.
// The printer follows the statement layout of unrpyc (https://github.com/CensoredUsername/unrpyc, MIT,
// Copyright (c) 2012-2024 Yuri K. Schlesner, CensoredUsername, Jackmcbarn): same statement forms, same line
// placement from the stored line numbers, so blank lines land where the original had them. Comments are not in a
// compiled script and cannot come back. A node class the printer does not know becomes a comment line
// "# <class> (not decompiled), line N" and is counted; it is never dropped and never guessed.
import zlib from 'node:zlib';
import { RPError } from './util.mjs';
import { unpickle, PyObj } from './gamearchives.mjs';

const MAX_PICKLE = 512 * 1024 * 1024;
const MAX_BLANK_LINES = 5000;

// ------------------------------------------------------------------------------------------------ container
/** Reads an .rpyc/.rpymc buffer. Returns { container, slots, data, stmts, pickle: { protocol, py2Strings, globals } }. */
export function readRpyc(buf) {
  let chunk = null, container, slots = [];
  if (buf.length >= 10 && buf.toString('latin1', 0, 10) === 'RENPY RPC2') {
    container = 'RPYC2';
    const chunks = new Map();
    for (let p = 10; p + 12 <= buf.length; p += 12) {
      const slot = buf.readUInt32LE(p), start = buf.readUInt32LE(p + 4), length = buf.readUInt32LE(p + 8);
      if (slot === 0) break;
      if (start + length > buf.length) throw new RPError('BAD_FORMAT', `rpyc slot ${slot} points outside the file`);
      slots.push({ slot, start, length });
      if (!chunks.has(slot)) chunks.set(slot, buf.subarray(start, start + length));
      if (slots.length > 64) break;
    }
    chunk = chunks.get(1) ?? null;
    if (!chunk) throw new RPError('BAD_FORMAT', `rpyc has no slot 1 (slots: ${slots.map(s => s.slot).join(', ') || 'none'}); the header was changed, which some games do to stop decompilers`);
  } else { container = 'RPYC1 (legacy, no header)'; chunk = buf; }
  let raw;
  try { raw = zlib.inflateSync(chunk, { maxOutputLength: MAX_PICKLE }); } catch (e) { throw new RPError('BAD_FORMAT', `rpyc: no zlib data where the script should be (${e.code ?? e.message})`); }
  const pickle = {};
  const top = unpickle(raw, { objects: true, info: pickle });
  if (!Array.isArray(top) || top.length < 2 || !Array.isArray(top[1])) throw new RPError('BAD_FORMAT', 'rpyc pickle is not (data, statements)');
  return { container, slots, data: top[0], stmts: top[1], pickle };
}

/** What the pickle shows about the Ren'Py version that wrote it. Hints, not a version number: the file does not store one. */
export function renpyHints({ data, pickle, container }) {
  const g = pickle.globals ?? new Set();
  const hints = [];
  const has = re => [...g].some(n => re.test(n));
  if (container.startsWith('RPYC1')) hints.push("legacy container without header: Ren'Py 6.17 or older");
  if (pickle.py2Strings) hints.push("Python 2 str values: written by Ren'Py 7 or older (Python 2)");
  else if (pickle.protocol != null) hints.push(`pickle protocol ${pickle.protocol} with Python 3 strings only: Ren'Py 8`);
  if (has(/^renpy\.astsupport\./)) hints.push("renpy.astsupport.PyExpr: Ren'Py 8.4 or newer");
  if (has(/^renpy\.parameter\.Signature$/)) hints.push("renpy.parameter.Signature: Ren'Py 7.7 / 8.2 or newer");
  else if (has(/^renpy\.parameter\.ParameterInfo$/)) hints.push("renpy.parameter.ParameterInfo: Ren'Py 7.5-7.6 / 8.0-8.1");
  else if (has(/^renpy\.ast\.ParameterInfo$/)) hints.push("renpy.ast.ParameterInfo: Ren'Py 7.4 or older");
  if (has(/^renpy\.revertable\./)) hints.push("renpy.revertable: Ren'Py 7.5 / 8.0 or newer");
  if (has(/^renpy\.ast\.TranslateSay$/)) hints.push("TranslateSay: Ren'Py 7.6 / 8.1 or newer");
  if (has(/^renpy\.screenlang\./)) hints.push("screen language 1 (renpy.screenlang): Ren'Py 6.17 or older screens, not decompiled");
  const version = data instanceof Map ? data.get('version') : null;
  return { ...(typeof version === 'number' ? { scriptVersion: version } : {}), pickleProtocol: pickle.protocol ?? 0, python: pickle.py2Strings ? 2 : 3, hints };
}

// ------------------------------------------------------------------------------------------------ helpers
const cls = o => (o instanceof PyObj ? o.$class : o === null || o === undefined ? '(none)' : Array.isArray(o) ? '(list)' : `(${typeof o})`);
const is = (o, ...names) => o instanceof PyObj && names.includes(o.$class);
const isPyExpr = o => o instanceof PyObj && o.$str !== undefined;
const S = v => (v === null || v === undefined ? 'None' : String(v));
/** PyCode keeps its fields in a __setstate__ tuple: (version, source, location, mode[, py, hashcode, col_offset]). */
const source = code => (code instanceof PyObj ? S(Array.isArray(code.$state) ? code.$state[1] : code.source ?? '') : S(code));
const items = v => (Array.isArray(v) ? v : v instanceof Set ? [...v] : v instanceof Map ? [...v.values()] : v instanceof PyObj && Array.isArray(v.$items) ? v.$items : []);
const entries = v => (v instanceof Map ? [...v] : v instanceof PyObj && v.$dict instanceof Map ? [...v.$dict] : []);
const inSet = (set, i) => (set instanceof Set ? set.has(i) : Array.isArray(set) ? set.includes(i) : false);
const lineOf = o => (o instanceof PyObj && typeof o.linenumber === 'number' ? o.linenumber : null);

function first(yes, no) { let f = true; return () => { if (f) { f = false; return yes; } return no; }; }

export function stringEscape(s) { return S(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\t/g, '\\t'); }
function encodeSayString(s) { return '"' + S(s).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"').replace(/(?<= ) /g, '\\ ') + '"'; }

/** Joins words with single spaces, keeping one trailing space a pre-6.17 simple expression may carry. */
class Words {
  constructor(needsSpace, reorderable = false) { this.words = []; this.needsSpace = needsSpace; this.reorderable = reorderable; }
  append(...args) { for (const a of args) { if (a === null || a === undefined || a === false) continue; const s = String(a); if (s) this.words.push(s); } }
  join() {
    if (!this.words.length) return '';
    if (this.reorderable && this.words.at(-1).endsWith(' ')) {
      for (let i = this.words.length - 1; i >= 0; i--) if (!this.words[i].endsWith(' ')) { this.words.push(this.words.splice(i, 1)[0]); break; }
    }
    const last = this.words.at(-1);
    this.words = this.words.slice(0, -1).map(x => (x.endsWith(' ') ? x.slice(0, -1) : x));
    this.words.push(last);
    const rv = (this.needsSpace ? ' ' : '') + this.words.join(' ');
    this.needsSpace = !rv.endsWith(' ');
    return rv;
  }
}

const PY_STRING = /(u?(?<a>"(?:"")?|'(?:'')?).*?(?<=[^\\])(?:\\\\)*\k<a>)/sy;
const PY_COMMENT = /[^\n]*/y, PY_CHUNK = /[\p{L}\p{N}_]+| +|./suy;
/** Splits Python source into logical lines: newlines inside brackets, strings and after a backslash do not split. */
export function splitLogicalLines(s) {
  const lines = [];
  let contained = 0, start = 0, pos = 0;
  const re = r => { r.lastIndex = pos; const m = r.exec(s); if (!m) return false; pos = r.lastIndex > pos ? r.lastIndex : pos + 1; return true; };
  while (pos < s.length) {
    const c = s[pos];
    if (c === '\n' && !contained && (!pos || s[pos - 1] !== '\\')) { lines.push(s.slice(start, pos)); pos++; start = pos; continue; }
    if (c === '(' || c === '[' || c === '{') { contained++; pos++; continue; }
    if ((c === ')' || c === ']' || c === '}') && contained) { contained--; pos++; continue; }
    if (c === '#') { PY_COMMENT.lastIndex = pos; PY_COMMENT.exec(s); pos = Math.max(PY_COMMENT.lastIndex, pos + 1); continue; }
    PY_STRING.lastIndex = pos;
    if (PY_STRING.exec(s)) { pos = PY_STRING.lastIndex; continue; }
    if (!re(PY_CHUNK)) pos++;
  }
  if (pos !== start) lines.push(s.slice(start));
  return lines;
}

export function reconstructParaminfo(p) {
  if (p === null || p === undefined) return '';
  const rv = ['('];
  const sep = first('', ', ');
  const pair = x => (Array.isArray(x) ? x : [x?.name, x?.default]);
  if (p.positional_only !== undefined) { // Ren'Py 7.5-7.6 and 8.0-8.1
    const posOnly = items(p.positional_only).map(pair), kwOnly = items(p.keyword_only).map(pair);
    const accounted = new Set([...posOnly, ...kwOnly].map(x => x[0]));
    const other = items(p.parameters).map(pair).filter(x => !accounted.has(x[0]));
    const put = ([name, def]) => { rv.push(sep(), S(name)); if (def !== null && def !== undefined) rv.push('=', S(def)); };
    posOnly.forEach(put);
    if (posOnly.length) rv.push(sep(), '/');
    other.forEach(put);
    if (p.extrapos) rv.push(sep(), '*', S(p.extrapos));
    else if (kwOnly.length) rv.push(sep(), '*');
    kwOnly.forEach(put);
    if (p.extrakw) rv.push(sep(), '**', S(p.extrakw));
  } else if (p.extrapos !== undefined) { // Ren'Py 7.4 and older
    const names = new Set(items(p.positional));
    const all = items(p.parameters).map(pair);
    const positional = all.filter(x => names.has(x[0])), nameonly = all.filter(x => !names.has(x[0]));
    const put = ([name, def]) => { rv.push(sep(), S(name)); if (def !== null && def !== undefined) rv.push(`=${S(def)}`); };
    positional.forEach(put);
    if (p.extrapos) rv.push(sep(), `*${S(p.extrapos)}`);
    if (nameonly.length) { if (!p.extrapos) rv.push(sep(), '*'); nameonly.forEach(put); }
    if (p.extrakw) rv.push(sep(), `**${S(p.extrakw)}`);
  } else { // Ren'Py 7.7 / 8.2 and newer: Signature of Parameter(name, kind, default)
    let state = 1; // 0 positional only, 1 positional or keyword, 2 keyword only
    for (const par of items(p.parameters)) {
      rv.push(sep());
      const def = par?.default !== null && par?.default !== undefined ? `=${S(par.default)}` : '';
      if (par?.kind === 0) { state = 0; rv.push(S(par.name), def); continue; }
      if (state === 0) { state = 1; rv.push('/', sep()); }
      if (par?.kind === 1) rv.push(S(par.name), def);
      else if (par?.kind === 2) { state = 2; rv.push(`*${S(par.name)}`); }
      else if (par?.kind === 3) { if (state === 1) { state = 2; rv.push('*', sep()); } rv.push(S(par.name), def); }
      else if (par?.kind === 4) { state = 3; rv.push(`**${S(par.name)}`); }
    }
  }
  rv.push(')');
  return rv.join('');
}

export function reconstructArginfo(a) {
  if (a === null || a === undefined) return '';
  const rv = ['('];
  const sep = first('', ', ');
  const args = items(a.arguments);
  if (a.starred_indexes !== undefined || a.extrapos === undefined) { // Ren'Py 7.5 and newer
    args.forEach(([name, val], i) => {
      rv.push(sep());
      if (name !== null && name !== undefined) rv.push(`${name}=`);
      else if (inSet(a.starred_indexes, i)) rv.push('*');
      else if (inSet(a.doublestarred_indexes, i)) rv.push('**');
      rv.push(S(val));
    });
  } else { // Ren'Py 7.4 and older
    for (const [name, val] of args) { rv.push(sep()); if (name !== null && name !== undefined) rv.push(`${name}=`); rv.push(S(val)); }
    if (a.extrapos) rv.push(sep(), `*${S(a.extrapos)}`);
    if (a.extrakw) rv.push(sep(), `**${S(a.extrakw)}`);
  }
  rv.push(')');
  return rv.join('');
}

function sayGetCode(ast, inmenu = false) {
  const rv = [];
  if (ast.who) rv.push(S(ast.who));
  if (ast.attributes !== null && ast.attributes !== undefined) rv.push(...items(ast.attributes).map(S));
  if (ast.temporary_attributes !== null && ast.temporary_attributes !== undefined) rv.push('@', ...items(ast.temporary_attributes).map(S));
  rv.push(encodeSayString(ast.what));
  if (!(ast.interact ?? true) && !inmenu) rv.push('nointeract');
  if (ast.explicit_identifier) rv.push('id', S(ast.identifier));
  else if (ast.identifier !== null && ast.identifier !== undefined && !is(ast, 'renpy.ast.TranslateSay')) rv.push('id', S(ast.identifier)); // a Say only stores one written by hand; a TranslateSay always stores its translation identifier
  if (ast.arguments !== null && ast.arguments !== undefined) rv.push(reconstructArginfo(ast.arguments));
  if (ast.with_) rv.push('with', S(ast.with_));
  return rv.join(' ');
}

// ------------------------------------------------------------------------------------------------ printer base
class Base {
  constructor(shared, out, indentLevel = 0, linenumber = 1, skip = false) {
    this.shared = shared; this.out = out; this.indentation = shared.indentation;
    this.linenumber = linenumber; this.indentLevel = indentLevel; this.skip = skip;
    this.blockStack = []; this.indexStack = []; this.blankQueue = [];
  }
  write(string) {
    const s = String(string);
    for (let i = s.indexOf('\n'); i >= 0; i = s.indexOf('\n', i + 1)) this.linenumber++;
    this.skip = false;
    this.out.push(s);
  }
  writeLines(lines) { for (const l of lines) { if (l === '') this.write('\n'); else { this.indent(); this.write(l); } } }
  indent() { if (!this.skip) this.write('\n' + this.indentation.repeat(this.indentLevel)); }
  advanceToLine(n) {
    if (typeof n !== 'number') return;
    this.blankQueue = this.blankQueue.filter(m => m(n));
    if (this.linenumber < n) this.write('\n'.repeat(Math.min(n - this.linenumber - 1, MAX_BLANK_LINES))); // a wild line number must not buy gigabytes of newlines
  }
  indented(fn, amount = 1) { this.indentLevel += amount; try { fn(); } finally { this.indentLevel -= amount; } }
  printNodes(list, extra = 0) {
    const nodes = items(list);
    this.indented(() => {
      this.blockStack.push(nodes); this.indexStack.push(0);
      for (let i = 0; i < nodes.length; i++) { this.indexStack[this.indexStack.length - 1] = i; this.printNode(nodes[i]); }
      this.blockStack.pop(); this.indexStack.pop();
    }, extra);
  }
  get block() { return this.blockStack.at(-1); }
  get index() { return this.indexStack.at(-1); }
  get parent() { return this.blockStack.length < 2 ? null : this.blockStack.at(-2)[this.indexStack.at(-2)]; }
  /** A node this printer has no form for: one comment line, counted, nothing guessed. */
  printUnknown(ast, line = null) {
    const name = cls(ast), n = line ?? lineOf(ast) ?? (Array.isArray(ast?.location) ? ast.location[1] : Array.isArray(ast?.loc) ? ast.loc[1] : null);
    const st = this.shared.stats;
    st.notDecompiled++; st.notDecompiledClasses[name] = (st.notDecompiledClasses[name] ?? 0) + 1;
    this.indent();
    this.write(`# ${name} (not decompiled)${typeof n === 'number' ? `, line ${n}` : ''}`);
  }
  dispatch(table, ast) {
    const m = ast instanceof PyObj ? table[ast.$class] : null;
    if (m) this[m](ast); else this.printUnknown(ast);
  }
  sub(Kind, ast, method = 'dump', indent = this.indentLevel) {
    const d = new Kind(this.shared, this.out, indent, this.linenumber, this.skip);
    d[method](ast);
    this.linenumber = d.linenumber;
    this.skip = false;
  }
}

// ------------------------------------------------------------------------------------------------ ATL
const ATL = {
  'renpy.atl.RawMultipurpose': 'multi', 'renpy.atl.RawBlock': 'rawblock', 'renpy.atl.RawChild': 'child', 'renpy.atl.RawChoice': 'choice',
  'renpy.atl.RawContainsExpr': 'containsExpr', 'renpy.atl.RawEvent': 'event', 'renpy.atl.RawFunction': 'func', 'renpy.atl.RawOn': 'on',
  'renpy.atl.RawParallel': 'parallel', 'renpy.atl.RawRepeat': 'repeat', 'renpy.atl.RawTime': 'time',
};
const noLoc = loc => Array.isArray(loc) && loc[0] === '' && loc[1] === 0;
class AtlPrinter extends Base {
  /** The ":" is already written; the top node is a RawBlock without its own "block:" line. */
  dump(ast) { if (is(ast, 'renpy.atl.RawBlock')) this.printBlock(ast); else this.indented(() => this.printUnknown(ast)); }
  printNode(ast) {
    this.shared.stats.atl++;
    if (Array.isArray(ast?.loc)) { if (is(ast, 'renpy.atl.RawBlock')) this.advanceToBlock(ast); else this.advanceToLine(ast.loc[1]); }
    this.dispatch(ATL, ast);
  }
  printBlock(block) {
    this.indented(() => {
      if (block.animation) { this.indent(); this.write('animation'); }
      if (items(block.statements).length) this.printNodes(block.statements);
      else if (!noLoc(block.loc)) { this.indent(); this.write('pass'); }
    });
  }
  advanceToBlock(block) { if (Array.isArray(block?.loc) && !noLoc(block.loc)) this.advanceToLine(block.loc[1] - 1); }
  multi(ast) {
    const warpWords = new Words(false);
    if (ast.warp_function) warpWords.append('warp', ast.warp_function, ast.duration);
    else if (ast.warper) warpWords.append(ast.warper, ast.duration);
    else if (S(ast.duration) !== '0') warpWords.append('pause', ast.duration);
    const warp = warpWords.join();
    const words = new Words(warp !== '' && !warp.endsWith(' '), true);
    if (ast.revolution) words.append(ast.revolution);
    if (ast.circles !== undefined && S(ast.circles) !== '0') words.append(`circles ${S(ast.circles)}`);
    const splineWords = new Words(false);
    for (const [name, exprs] of items(ast.splines)) {
      const e = items(exprs);
      splineWords.append(name, e.at(-1));
      for (const x of e.slice(0, -1)) splineWords.append('knot', x);
    }
    words.append(splineWords.join());
    const propertyWords = new Words(false);
    for (const [key, value] of items(ast.properties)) propertyWords.append(key, value);
    words.append(propertyWords.join());
    const exprWords = new Words(false);
    const exprs = items(ast.expressions);
    const needsPass = exprs.length > 1;
    for (const [expression, withExpression] of exprs) {
      exprWords.append(expression);
      if (withExpression) exprWords.append('with', withExpression);
      if (needsPass) exprWords.append('pass');
    }
    words.append(exprWords.join());
    const toWrite = warp + words.join();
    if (toWrite) { this.indent(); this.write(toWrite); }
    else this.write(','); // a trailing comma leaves an empty node on the line of the last real one
  }
  rawblock(ast) { this.indent(); this.write('block:'); this.printBlock(ast); }
  child(ast) { for (const c of items(ast.children)) { this.advanceToBlock(c); this.indent(); this.write('contains:'); this.printBlock(c); } }
  choice(ast) {
    for (const [chance, block] of items(ast.choices)) {
      this.advanceToBlock(block); this.indent(); this.write('choice');
      if (S(chance) !== '1.0') this.write(` ${S(chance)}`);
      this.write(':'); this.printBlock(block);
    }
    if (this.index + 1 < this.block.length && is(this.block[this.index + 1], 'renpy.atl.RawChoice')) { this.indent(); this.write('pass'); }
  }
  containsExpr(ast) { this.indent(); this.write(`contains ${S(ast.expression)}`); }
  event(ast) { this.indent(); this.write(`event ${S(ast.name)}`); }
  func(ast) { this.indent(); this.write(`function ${S(ast.expr)}`); }
  on(ast) {
    const handlers = entries(ast.handlers).sort((a, b) => (a[1]?.loc?.[1] ?? 0) - (b[1]?.loc?.[1] ?? 0));
    for (const [name, block] of handlers) { this.advanceToBlock(block); this.indent(); this.write(`on ${S(name)}:`); this.printBlock(block); }
  }
  parallel(ast) {
    for (const block of items(ast.blocks)) { this.advanceToBlock(block); this.indent(); this.write('parallel:'); this.printBlock(block); }
    if (this.index + 1 < this.block.length && is(this.block[this.index + 1], 'renpy.atl.RawParallel')) { this.indent(); this.write('pass'); }
  }
  repeat(ast) { this.indent(); this.write('repeat'); if (ast.repeats) this.write(` ${S(ast.repeats)}`); }
  time(ast) { this.indent(); this.write(`time ${S(ast.time)}`); }
}

// ------------------------------------------------------------------------------------------------ screen language 2
const SL = {
  'renpy.sl2.slast.SLScreen': 'screen', 'renpy.sl2.slast.SLIf': 'slIf', 'renpy.sl2.slast.SLShowIf': 'slShowIf', 'renpy.sl2.slast.SLFor': 'slFor',
  'renpy.sl2.slast.SLContinue': 'slContinue', 'renpy.sl2.slast.SLBreak': 'slBreak', 'renpy.sl2.slast.SLPython': 'slPython', 'renpy.sl2.slast.SLPass': 'slPass',
  'renpy.sl2.slast.SLUse': 'slUse', 'renpy.sl2.slast.SLTransclude': 'slTransclude', 'renpy.sl2.slast.SLDefault': 'slDefault', 'renpy.sl2.slast.SLDisplayable': 'displayable',
  'renpy.sl2.slast.SLBlock': 'slBlock',
};
// (displayable class, style) → statement name and how many children it takes (0, 1 or 'many').
const B = 'renpy.display.behavior.', L = 'renpy.display.layout.', SD = 'renpy.sl2.sldisplayables.', UI = 'renpy.ui.';
const DISPLAYABLES = new Map([
  [B + 'AreaPicker|default', ['areapicker', 1]], [B + 'Button|button', ['button', 1]], [B + 'DismissBehavior|default', ['dismiss', 0]], [B + 'Input|input', ['input', 0]],
  [B + 'MouseArea|0', ['mousearea', 0]], [B + 'MouseArea|None', ['mousearea', 0]], [B + 'OnEvent|0', ['on', 0]], [B + 'OnEvent|None', ['on', 0]], [B + 'Timer|default', ['timer', 0]],
  ['renpy.display.dragdrop.Drag|drag', ['drag', 1]], ['renpy.display.dragdrop.Drag|None', ['drag', 1]], ['renpy.display.dragdrop.DragGroup|None', ['draggroup', 'many']],
  ['renpy.display.im.image|default', ['image', 0]], [L + 'Grid|grid', ['grid', 'many']], [L + 'MultiBox|fixed', ['fixed', 'many']], [L + 'MultiBox|hbox', ['hbox', 'many']],
  [L + 'MultiBox|vbox', ['vbox', 'many']], [L + 'NearRect|default', ['nearrect', 1]], [L + 'Null|default', ['null', 0]], [L + 'Side|side', ['side', 'many']],
  [L + 'Window|frame', ['frame', 1]], [L + 'Window|window', ['window', 1]], ['renpy.display.motion.Transform|transform', ['transform', 1]],
  [SD + 'sl2add|None', ['add', 0]], [SD + 'sl2bar|None', ['bar', 0]], [SD + 'sl2vbar|None', ['vbar', 0]], [SD + 'sl2viewport|viewport', ['viewport', 1]], [SD + 'sl2vpgrid|vpgrid', ['vpgrid', 'many']],
  ['renpy.text.text.Text|text', ['text', 0]], ['renpy.display.transform.Transform|transform', ['transform', 1]],
  [UI + '_add|None', ['add', 0]], [UI + '_hotbar|hotbar', ['hotbar', 0]], [UI + '_hotspot|hotspot', ['hotspot', 1]], [UI + '_imagebutton|image_button', ['imagebutton', 0]],
  [UI + '_imagemap|imagemap', ['imagemap', 'many']], [UI + '_key|None', ['key', 0]], [UI + '_label|label', ['label', 0]], [UI + '_textbutton|button', ['textbutton', 0]], [UI + '_textbutton|0', ['textbutton', 0]],
]);
const slLine = n => (Array.isArray(n?.location) ? n.location[1] : null);

class SlPrinter extends Base {
  dump(ast) { this.printNodes([ast]); }
  printNode(ast) { this.shared.stats.screenNodes++; this.advanceToLine(slLine(ast)); this.dispatch(SL, ast); }
  screen(ast) {
    this.indent();
    this.write(`screen ${S(ast.name)}`);
    if (ast.parameters) this.write(reconstructParaminfo(ast.parameters));
    const [firstLine, otherLines] = this.sortKeywordsAndChildren(ast);
    this.printKeywordOrChild(firstLine, true, otherLines.length > 0);
    if (otherLines.length) this.indented(() => { for (const l of otherLines) this.printKeywordOrChild(l); });
  }
  slIf(ast) { this.ifLike(ast, 'if'); }
  slShowIf(ast) { this.ifLike(ast, 'showif'); }
  ifLike(ast, word) {
    const keyword = first(word, 'elif');
    for (const [condition, block] of items(ast.entries)) {
      this.advanceToLine(slLine(block));
      this.indent();
      if (condition === null || condition === undefined) this.write('else'); else this.write(`${keyword()} ${S(condition)}`);
      this.printBlock(block, true);
    }
  }
  slBlock(ast) { this.printBlock(ast, true); }
  printBlock(ast, immediateBlock = false) {
    const [firstLine, otherLines] = this.sortKeywordsAndChildren(ast, immediateBlock);
    this.printKeywordOrChild(firstLine, true, immediateBlock || otherLines.length > 0);
    if (otherLines.length) this.indented(() => { for (const l of otherLines) this.printKeywordOrChild(l); });
    else if (immediateBlock) this.indented(() => { this.indent(); this.write('pass'); });
  }
  slFor(ast) {
    let variable, children = items(ast.children);
    if (ast.variable === '_sl2_i' && children.length) { variable = source(children[0].code).slice(0, -9); children = children.slice(1); } // "a, b = _sl2_i" holds the tuple target
    else variable = S(ast.variable).trim() + ' ';
    this.indent();
    if (ast.index_expression !== null && ast.index_expression !== undefined) this.write(`for ${variable}index ${S(ast.index_expression)} in ${S(ast.expression)}:`);
    else this.write(`for ${variable}in ${S(ast.expression)}:`);
    this.printNodes(children, 1);
  }
  slContinue() { this.indent(); this.write('continue'); }
  slBreak() { this.indent(); this.write('break'); }
  slPython(ast) {
    this.indent();
    const code = source(ast.code);
    if (code.startsWith('\n')) { this.write('python:'); this.indented(() => this.writeLines(splitLogicalLines(code.slice(1)))); }
    else this.write(`$ ${code}`);
  }
  slPass() { this.indent(); this.write('pass'); }
  slUse(ast) {
    this.indent();
    this.write('use ');
    const args = reconstructArginfo(ast.args);
    if (isPyExpr(ast.target)) { this.write(`expression ${S(ast.target)}`); if (args) this.write(' pass '); }
    else this.write(S(ast.target));
    this.write(args);
    if (ast.id !== null && ast.id !== undefined) this.write(` id ${S(ast.id)}`);
    if (ast.block) this.printBlock(ast.block);
  }
  slTransclude() { this.indent(); this.write('transclude'); }
  slDefault(ast) { this.indent(); this.write(`default ${S(ast.variable)} = ${S(ast.expression)}`); }
  displayable(ast, hasBlock = false) {
    const target = ast.displayable?.__global__ ?? cls(ast.displayable);
    let found = DISPLAYABLES.get(`${target}|${ast.style === null || ast.style === undefined ? 'None' : ast.style}`);
    if (!found) { // a displayable registered by the game: its statement name is not stored, the style name usually matches
      found = [S(ast.style), 'many'];
      const w = this.shared.warnings;
      if (w.length < 20) w.push(`line ${slLine(ast)}: custom screen displayable ${target}: its statement name is not stored, the style name "${S(ast.style)}" was written instead`);
      this.shared.stats.customDisplayables++;
    }
    const [name, children] = found;
    this.indent();
    this.write(name);
    const positional = items(ast.positional);
    if (positional.length) this.write(' ' + positional.map(S).join(' '));
    const atl = ast.atl_transform ?? null;
    const kids = items(ast.children), kw = items(ast.keyword);
    if (!hasBlock && children === 1 && kids.length === 1 && is(kids[0], 'renpy.sl2.slast.SLDisplayable') && items(kids[0].children).length
      && (!kw.length || (kw.at(-1)[1] !== null && kw.at(-1)[1] !== undefined && slLine(kids[0]) > lineOf(kw.at(-1)[1])))
      && (atl === null || slLine(kids[0]) > atl.loc?.[1])) {
      // one child that has children itself, placed after the keywords: written as a "has" statement
      const [firstLine, otherLines] = this.sortKeywordsAndChildren(ast, false, true);
      this.printKeywordOrChild(firstLine, true, true);
      this.indented(() => {
        for (const l of otherLines) this.printKeywordOrChild(l);
        this.advanceToLine(slLine(kids[0]));
        this.indent();
        this.write('has ');
        this.skip = true;
        this.shared.stats.screenNodes++;
        this.displayable(kids[0], true);
      });
    } else if (hasBlock) {
      const [firstLine, otherLines] = this.sortKeywordsAndChildren(ast);
      this.printKeywordOrChild(firstLine, true, false);
      for (const l of otherLines) this.printKeywordOrChild(l);
    } else {
      const [firstLine, otherLines] = this.sortKeywordsAndChildren(ast);
      this.printKeywordOrChild(firstLine, true, otherLines.length > 0);
      this.indented(() => { for (const l of otherLines) this.printKeywordOrChild(l); });
    }
  }
  /** Orders a statement's keyword properties, children and "at transform:" block by line. Returns [firstLine, otherLines]; each is [line, type, keywords, extra]. */
  sortKeywordsAndChildren(node, immediateBlock = false, ignoreChildren = false) {
    const keywords = items(node.keyword), children = ignoreChildren ? [] : items(node.children);
    const blockLine = slLine(node) ?? 0, startLine = immediateBlock ? blockLine + 1 : blockLine;
    const keywordTag = node.tag ?? null, keywordAs = is(node, 'renpy.sl2.slast.SLDisplayable') ? node.variable ?? null : null, atl = node.atl_transform ?? null;
    const kwByLine = keywords.map(([name, value]) => [value ? lineOf(value) : null, value ? 'keyword' : 'broken', [name, value]]).reverse();
    const chByLine = children.map(c => [slLine(c), 'child', c]).reverse();
    const ordered = [];
    while (kwByLine.length && chByLine.length) {
      if (kwByLine.at(-1)[0] === null) ordered.push(kwByLine.pop());
      else if (kwByLine.at(-1)[0] < chByLine.at(-1)[0]) ordered.push(kwByLine.pop());
      else ordered.push(chByLine.pop());
    }
    while (kwByLine.length) ordered.push(kwByLine.pop());
    while (chByLine.length) ordered.push(chByLine.pop());
    if (atl !== null) {
      const atlLine = atl.loc?.[1] ?? 0;
      let at = ordered.findIndex(([line]) => line !== null && atlLine < line);
      if (at < 0) at = ordered.length;
      ordered.splice(at, 0, [atlLine, 'atl', atl]);
    }
    const grouped = [];
    let cur = null; // the keyword line being collected
    for (const [line, ty, content] of ordered) {
      if (cur === null) {
        if (ty === 'child') grouped.push([line, 'child', content]);
        else if (ty === 'keyword') cur = [line, 'keywords', [content]];
        else if (ty === 'broken') grouped.push([line, 'keywords_broken', [], content]);
        else grouped.push([line, 'keywords_atl', [], content]);
      } else if (ty === 'child') { grouped.push(cur); cur = null; grouped.push([line, 'child', content]); }
      else if (ty === 'keyword') { if (cur[0] === line) cur[2].push(content); else { grouped.push(cur); cur = [line, 'keywords', [content]]; } }
      else if (ty === 'broken') { grouped.push([cur[0], 'keywords_broken', cur[2], content]); cur = null; }
      else if (cur[0] === line) { grouped.push([line, 'keywords_atl', cur[2], content]); cur = null; }
      else { grouped.push(cur); cur = null; grouped.push([line, 'keywords_atl', [], content]); }
    }
    if (cur !== null) grouped.push(cur);
    for (let i = 0; i < grouped.length; i++) if (grouped[i][1] === 'keywords_broken' && grouped[i][0] === null) grouped[i] = [i ? grouped[i - 1][0] + 1 : startLine, 'keywords_broken', [], grouped[i][3]];
    const merge = (word, value, emptyLine) => { // "tag" and "as" carry no line number
      if (!grouped.length) grouped.push([emptyLine, 'keywords', [[word, value]]]);
      else if (grouped[0][0] > blockLine + 1) grouped.unshift([blockLine + 1, 'keywords', [[word, value]]]);
      else if (word === 'as' && grouped[0][0] > startLine) grouped.unshift([startLine, 'keywords', [[word, value]]]);
      else { const e = grouped.find(g => g[1].startsWith('keywords')); if (e) e[2].push([word, value]); else grouped.unshift([word === 'as' ? startLine : blockLine + 1, 'keywords', [[word, value]]]); }
    };
    if (keywordTag) merge('tag', keywordTag, blockLine + 1);
    if (keywordAs) merge('as', keywordAs, startLine);
    if (immediateBlock || !grouped.length || grouped[0][0] !== blockLine) grouped.unshift([blockLine, 'keywords', []]);
    return [grouped[0], grouped.slice(1)];
  }
  printKeywordOrChild(item, firstLine = false, hasBlock = false) {
    const sep = first(firstLine ? ' ' : '', ' ');
    const [line, ty] = item;
    if (ty === 'child') { this.printNode(item[2]); return; }
    if (!firstLine) { this.advanceToLine(line); this.indent(); }
    for (const [name, value] of item[2]) { this.write(sep()); this.write(`${S(name)} ${S(value)}`); }
    if (ty === 'keywords_atl') { this.write(sep()); this.write('at transform:'); this.sub(AtlPrinter, item[3]); return; }
    if (ty === 'keywords_broken') { this.write(sep()); this.write(S(item[3][0])); }
    if (firstLine && hasBlock) this.write(':');
  }
}

// ------------------------------------------------------------------------------------------------ testcase statements
const T = 'renpy.test.testast.';
const TEST = { [T + 'Python']: 'python', [T + 'If']: 'tIf', [T + 'Assert']: 'assert', [T + 'Jump']: 'jump', [T + 'Call']: 'call', [T + 'Action']: 'action', [T + 'Pause']: 'pause',
  [T + 'Label']: 'label', [T + 'Type']: 'type', [T + 'Drag']: 'drag', [T + 'Move']: 'move', [T + 'Click']: 'click', [T + 'Scroll']: 'scroll', [T + 'Until']: 'until' };
class TestPrinter extends Base {
  dump(ast) { this.printNodes(ast); }
  printNode(ast) { this.advanceToLine(lineOf(ast)); this.dispatch(TEST, ast); }
  python(ast) { this.indent(); const code = source(ast.code); if (code[0] === '\n') { this.write('python:'); this.indented(() => this.writeLines(splitLogicalLines(code.slice(1)))); } else this.write(`$ ${code}`); }
  tIf(ast) { this.indent(); this.write(`if ${S(ast.condition)}:`); this.printNodes(ast.block, 1); }
  assert(ast) { this.indent(); this.write(`assert ${S(ast.expr)}`); }
  jump(ast) { this.indent(); this.write(`jump ${S(ast.target)}`); }
  call(ast) { this.indent(); this.write(`call ${S(ast.target)}`); }
  action(ast) { this.indent(); this.write(`run ${S(ast.expr)}`); }
  pause(ast) { this.indent(); this.write(`pause ${S(ast.expr)}`); }
  label(ast) { this.indent(); this.write(`label ${S(ast.name)}`); }
  pattern(ast) { if (ast.pattern !== null && ast.pattern !== undefined) this.write(` pattern "${stringEscape(ast.pattern)}"`); }
  type(ast) {
    this.indent();
    const keys = items(ast.keys);
    if (S(keys[0]).length === 1) this.write(`type "${stringEscape(keys.join(''))}"`); else this.write(`type ${S(keys[0])}`);
    this.pattern(ast);
    if (ast.position !== null && ast.position !== undefined) this.write(` pos ${S(ast.position)}`);
  }
  drag(ast) { this.indent(); this.write(`drag ${S(ast.points)}`); if (ast.button !== 1) this.write(` button ${S(ast.button)}`); this.pattern(ast); if (ast.steps !== 10) this.write(` steps ${S(ast.steps)}`); }
  move(ast) { this.indent(); this.write(`move ${S(ast.position)}`); this.pattern(ast); }
  click(ast) {
    this.indent();
    if (ast.pattern !== null && ast.pattern !== undefined) this.write(`"${stringEscape(ast.pattern)}"`); else this.write('click');
    if (ast.button !== undefined && ast.button !== 1) this.write(` button ${S(ast.button)}`);
    if (ast.position !== null && ast.position !== undefined) this.write(` pos ${S(ast.position)}`);
    if (ast.always) this.write(' always');
  }
  scroll(ast) { this.indent(); this.write(`scroll "${stringEscape(ast.pattern)}"`); }
  until(ast) { this.advanceToLine(lineOf(ast.right)); this.printNode(ast.left); this.write(' until '); this.skip = true; this.printNode(ast.right); }
}

// ------------------------------------------------------------------------------------------------ script statements
const A = 'renpy.ast.';
const AST = {
  [A + 'Image']: 'image', [A + 'Transform']: 'transform', [A + 'Show']: 'show', [A + 'ShowLayer']: 'showLayer', [A + 'Scene']: 'scene', [A + 'Hide']: 'hide', [A + 'With']: 'with',
  [A + 'Camera']: 'camera', [A + 'Label']: 'label', [A + 'Jump']: 'jump', [A + 'Call']: 'call', [A + 'Return']: 'return', [A + 'If']: 'if', [A + 'While']: 'while', [A + 'Pass']: 'pass',
  [A + 'Init']: 'init', [A + 'Menu']: 'menu', [A + 'Python']: 'python', [A + 'EarlyPython']: 'earlyPython', [A + 'Define']: 'define', [A + 'Default']: 'default', [A + 'Say']: 'say',
  [A + 'UserStatement']: 'userStatement', [A + 'Style']: 'style', [A + 'Translate']: 'translate', [A + 'EndTranslate']: 'endTranslate', [A + 'TranslateString']: 'translateString',
  [A + 'TranslateBlock']: 'translateBlock', [A + 'TranslateEarlyBlock']: 'translateBlock', [A + 'TranslateSay']: 'translateSay', [A + 'Screen']: 'screenStmt', [A + 'Testcase']: 'testcase', [A + 'RPY']: 'rpy',
};
const NO_ADVANCE = [A + 'TranslateString', A + 'With', A + 'Label', A + 'Pass', A + 'Return'];
const before = (a, b) => lineOf(a) < lineOf(b);
/** imspec tuple of any age → [name, expression, tag, at_list, layer, zorder, behind]. */
function imspec7(i) {
  const v = items(i);
  if (v.length === 3) return [v[0], null, null, v[1], v[2], null, []];
  if (v.length === 6) return [...v, []];
  return v;
}

class ScriptPrinter extends Base {
  constructor(shared, out) {
    super(shared, out);
    this.pairedWith = false; this.sayInsideMenu = null; this.labelInsideMenu = null; this.inInit = false; this.missingInit = false;
    this.initOffset = 0; this.mostLinesBehind = 0; this.lastLinesBehind = 0; this.seenLabel = false; this.rpyArgs = [];
  }
  advanceToLine(n) {
    if (typeof n !== 'number') return;
    this.lastLinesBehind = Math.max(this.linenumber + (this.skip ? 0 : 1) - n, 0);
    this.mostLinesBehind = Math.max(this.lastLinesBehind, this.mostLinesBehind);
    super.advanceToLine(n);
  }
  saveState() {
    const st = { out: this.out, skip: this.skip, linenumber: this.linenumber, blockStack: [...this.blockStack], indexStack: [...this.indexStack], indentLevel: this.indentLevel, blankQueue: this.blankQueue,
      pairedWith: this.pairedWith, sayInsideMenu: this.sayInsideMenu, labelInsideMenu: this.labelInsideMenu, inInit: this.inInit, missingInit: this.missingInit,
      mostLinesBehind: this.mostLinesBehind, lastLinesBehind: this.lastLinesBehind, seenLabel: this.seenLabel, rpyArgs: this.rpyArgs, stats: structuredClone(this.shared.stats), warnings: this.shared.warnings.length };
    this.out = [];
    return st;
  }
  commitState(st) { st.out.push(...this.out); this.out = st.out; }
  rollbackState(st) {
    for (const k of ['out', 'skip', 'linenumber', 'blockStack', 'indexStack', 'indentLevel', 'blankQueue', 'pairedWith', 'sayInsideMenu', 'labelInsideMenu', 'inInit', 'missingInit', 'mostLinesBehind', 'lastLinesBehind', 'seenLabel', 'rpyArgs']) this[k] = st[k];
    this.shared.stats = st.stats; this.shared.warnings.length = st.warnings;
  }
  dump(ast) {
    if (this.shared.initOffset) this.setBestInitOffset(ast);
    this.skip = true; // no blank first line
    this.printNodes(ast);
    for (const m of this.blankQueue) m(null);
    if (this.missingInit) this.shared.warnings.push('a statement that needs an init block (define, image, style, screen, ...) was found outside one; it was written without it');
  }
  printNode(ast) {
    this.shared.stats.statements++;
    if (is(ast, A + 'Say') && this.handleSayPossiblyInsideMenu(ast)) return;
    if (lineOf(ast) !== null && !is(ast, ...NO_ADVANCE)) this.advanceToLine(ast.linenumber);
    this.dispatch(AST, ast);
  }
  printAtl(ast) { this.sub(AtlPrinter, ast); }
  atlTail(ast) { if (ast.atl !== null && ast.atl !== undefined) { this.write(':'); this.printAtl(ast.atl); } }

  // displayables
  printImspec(spec) {
    const i = imspec7(spec);
    const begin = i[1] !== null && i[1] !== undefined ? `expression ${S(i[1])}` : items(i[0]).map(S).join(' ');
    const words = new Words(begin !== '' && !begin.endsWith(' '), true);
    if (i[2] !== null && i[2] !== undefined) words.append(`as ${S(i[2])}`);
    if (items(i[6]).length) words.append(`behind ${items(i[6]).map(S).join(', ')}`);
    if (typeof i[4] === 'string') words.append(`onlayer ${i[4]}`);
    if (i[5] !== null && i[5] !== undefined) words.append(`zorder ${S(i[5])}`);
    if (items(i[3]).length) words.append(`at ${items(i[3]).map(S).join(', ')}`);
    this.write(begin + words.join());
    return words.needsSpace;
  }
  pairedTail(needsSpace) { if (this.pairedWith) { if (needsSpace) this.write(' '); this.write(`with ${S(this.pairedWith)}`); this.pairedWith = true; } }
  image(ast) {
    this.requireInit(); this.indent();
    this.write(`image ${items(ast.imgname).map(S).join(' ')}`);
    if (ast.code !== null && ast.code !== undefined) this.write(` = ${source(ast.code)}`);
    else this.atlTail(ast);
  }
  implicitPriority(ast) { // a short-form statement whose hidden init block has a priority of its own
    const init = this.parent;
    if (is(init, A + 'Init') && (init.priority ?? 0) !== this.initOffset && items(init.block).length === 1 && !before(init, ast)) return ` ${(init.priority ?? 0) - this.initOffset}`;
    return '';
  }
  transform(ast) {
    this.requireInit(); this.indent();
    this.write(`transform${this.implicitPriority(ast)} ${S(ast.varname)}`);
    if (ast.parameters !== null && ast.parameters !== undefined) this.write(reconstructParaminfo(ast.parameters));
    this.atlTail(ast);
  }
  show(ast) { this.indent(); this.write('show '); this.pairedTail(this.printImspec(ast.imspec)); this.atlTail(ast); }
  showLayer(ast) {
    this.indent(); this.write(`show layer ${S(ast.layer ?? 'master')}`);
    if (items(ast.at_list).length) this.write(` at ${items(ast.at_list).map(S).join(', ')}`);
    this.atlTail(ast);
  }
  scene(ast) {
    this.indent(); this.write('scene');
    let needsSpace = true;
    if (ast.imspec === null || ast.imspec === undefined) { if (typeof ast.layer === 'string') this.write(` onlayer ${ast.layer}`); }
    else { this.write(' '); needsSpace = this.printImspec(ast.imspec); }
    this.pairedTail(needsSpace);
    this.atlTail(ast);
  }
  hide(ast) { this.indent(); this.write('hide '); this.pairedTail(this.printImspec(ast.imspec)); }
  with(ast) {
    if (ast.paired !== null && ast.paired !== undefined) { // first half of a "show x with y" pair: the With two nodes on closes it
      const closing = this.block[this.index + 2];
      if (is(closing, A + 'With') && S(closing.expr) === S(ast.paired)) { this.pairedWith = ast.paired; return; }
      this.shared.warnings.push(`line ${lineOf(ast)}: a paired "with" has no closing statement; written as its own statement`);
      this.advanceToLine(lineOf(ast)); this.indent(); this.write(`with ${S(ast.expr)}`);
    } else if (this.pairedWith) {
      if (this.pairedWith !== true) this.write(` with ${S(ast.expr)}`);
      this.pairedWith = false;
    } else { this.advanceToLine(lineOf(ast)); this.indent(); this.write(`with ${S(ast.expr)}`); this.pairedWith = false; }
  }
  camera(ast) {
    this.indent(); this.write('camera');
    const layer = ast.layer ?? 'master';
    if (layer !== 'master') this.write(` ${S(layer)}`);
    if (items(ast.at_list).length) this.write(` at ${items(ast.at_list).map(S).join(', ')}`);
    this.atlTail(ast);
  }

  // flow
  labelName(ast) { return ast.name !== undefined && typeof ast.name !== 'object' ? ast.name : ast._name ?? ast.name; }
  label(ast) {
    this.seenLabel = true;
    if (this.index && is(this.block[this.index - 1], A + 'Call')) return; // printed as the call's "from"
    if (!items(ast.block).length && (ast.parameters === null || ast.parameters === undefined)) {
      const remaining = this.block.length - this.index, next = this.block[this.index + 1];
      if (remaining > 1 && is(next, A + 'Menu') && next.linenumber === ast.linenumber) { this.labelInsideMenu = ast; return; }
      if (remaining > 2) {
        const nextNext = this.block[this.index + 2];
        if (is(next, A + 'Say') && is(nextNext, A + 'Menu') && nextNext.linenumber === ast.linenumber && this.sayBelongsToMenu(next, nextNext)) { this.labelInsideMenu = ast; return; }
      }
    }
    this.advanceToLine(lineOf(ast));
    this.indent();
    // An "init label" is only known once the children are printed, so they go to a side buffer first.
    const out = this.out, missingInit = this.missingInit;
    this.out = []; this.missingInit = false;
    try {
      this.write(`label ${S(this.labelName(ast))}${reconstructParaminfo(ast.parameters)}${ast.hide ? ' hide' : ''}:`);
      this.printNodes(ast.block, 1);
    } finally {
      if (this.missingInit) out.push('init ');
      this.missingInit = missingInit;
      out.push(...this.out);
      this.out = out;
    }
  }
  jump(ast) { this.indent(); this.write(`jump ${ast.expression ? 'expression ' : ''}${S(ast.target)}`); }
  call(ast) {
    this.indent();
    const words = new Words(false);
    words.append('call');
    if (ast.expression) words.append('expression');
    words.append(ast.label);
    if (ast.arguments !== null && ast.arguments !== undefined) { if (ast.expression) words.append('pass'); words.append(reconstructArginfo(ast.arguments)); }
    const next = this.block[this.index + 1];
    if (is(next, A + 'Label')) words.append(`from ${S(this.labelName(next))}`);
    this.write(words.join());
  }
  return(ast) {
    const prev = this.index ? this.block[this.index - 1] : null;
    // Ren'Py appends a return to every file; it is left out where it cannot have been written by hand.
    if ((ast.expression === null || ast.expression === undefined) && this.parent === null && this.index + 1 === this.block.length && this.index
      && (ast.linenumber === prev?.linenumber || is(prev, A + 'Return', A + 'Jump') || !this.seenLabel)) return;
    this.advanceToLine(lineOf(ast));
    this.indent();
    this.write('return');
    if (ast.expression !== null && ast.expression !== undefined) this.write(` ${S(ast.expression)}`);
  }
  if(ast) {
    const statement = first('if', 'elif');
    const list = items(ast.entries);
    list.forEach(([condition, block], i) => {
      if (i + 1 === list.length && !isPyExpr(condition)) { this.indent(); this.write('else:'); } // "else" is stored as the plain string "True"
      else { this.advanceToLine(lineOf(condition)); this.indent(); this.write(`${statement()} ${S(condition)}:`); }
      this.printNodes(block, 1);
    });
  }
  while(ast) { this.indent(); this.write(`while ${S(ast.condition)}:`); this.printNodes(ast.block, 1); }
  pass(ast) {
    if (this.index && is(this.block[this.index - 1], A + 'Call')) return;
    if (this.index > 1 && is(this.block[this.index - 2], A + 'Call') && is(this.block[this.index - 1], A + 'Label') && this.block[this.index - 2].linenumber === ast.linenumber) return;
    this.advanceToLine(lineOf(ast));
    this.indent();
    this.write('pass');
  }
  requireInit() { if (!this.inInit) this.missingInit = true; }
  setBestInitOffset(nodes) {
    const votes = new Map();
    for (const ast of nodes) {
      if (!is(ast, A + 'Init')) continue;
      let offset = ast.priority ?? 0;
      const block = items(ast.block);
      if (block.length === 1 && !before(ast, block[0])) {
        if (is(block[0], A + 'Screen')) offset -= -500;
        else if (is(block[0], A + 'Testcase')) offset -= 500;
        else if (is(block[0], A + 'Image')) offset -= 500;
      }
      votes.set(offset, (votes.get(offset) ?? 0) + 1);
    }
    if (!votes.size) return;
    let winner = null;
    for (const [k, v] of votes) if (winner === null || v > votes.get(winner)) winner = k;
    if ((votes.get(0) ?? 0) + 1 < votes.get(winner)) this.setInitOffset(winner);
  }
  setInitOffset(offset) {
    this.blankQueue.push(linenumber => {
      if (linenumber === null || linenumber - this.linenumber <= 1 || this.indentLevel) return true;
      if (offset !== this.initOffset) { this.indent(); this.write(`init offset = ${offset}`); this.initOffset = offset; }
      return false;
    });
  }
  init(ast) {
    const inInit = this.inInit;
    this.inInit = true;
    try {
      const block = items(ast.block), b0 = block[0], prio = ast.priority ?? 0, off = this.initOffset;
      // define, default, transform, screen, style, testcase, layeredimage and image carry an implicit init block
      if (block.length === 1 && (is(b0, A + 'Define', A + 'Default', A + 'Transform')
        || (prio === -500 + off && is(b0, A + 'Screen')) || (prio === off && is(b0, A + 'Style')) || (prio === 500 + off && is(b0, A + 'Testcase'))
        || (prio === off && is(b0, A + 'UserStatement') && S(b0.line).startsWith('layeredimage ')) || (prio === 500 + off && is(b0, A + 'Image')))
        && !before(ast, b0)) this.printNodes(block);
      else if (block.length > 0 && prio === off && block.every(i => is(i, A + 'TranslateString')) && block.every(i => i.language === b0.language)) this.printNodes(block);
      else {
        this.indent();
        this.write('init');
        if (prio !== off) this.write(` ${prio - off}`);
        if (block.length === 1 && !before(ast, b0)) { this.write(' '); this.skip = true; this.printNodes(block); }
        else { this.write(':'); this.printNodes(block, 1); }
      }
    } finally { this.inInit = inInit; }
  }

  // menus
  printSayInsideMenu() { this.say(this.sayInsideMenu, true); this.sayInsideMenu = null; }
  printMenuItem(label, condition, block, args) {
    this.indent();
    this.write(`"${stringEscape(label)}"`);
    if (args !== null && args !== undefined) this.write(reconstructArginfo(args));
    if (block !== null && block !== undefined) {
      if (isPyExpr(condition)) this.write(` if ${S(condition)}`); // no condition is stored as the plain string "True"
      this.write(':');
      this.printNodes(block, 1);
    }
  }
  menu(ast) {
    this.indent();
    this.write('menu');
    if (this.labelInsideMenu !== null) { this.write(` ${S(this.labelName(this.labelInsideMenu))}`); this.labelInsideMenu = null; }
    if (ast.arguments !== null && ast.arguments !== undefined) this.write(reconstructArginfo(ast.arguments));
    this.write(':');
    this.indented(() => {
      if (ast.with_ !== null && ast.with_ !== undefined) { this.indent(); this.write(`with ${S(ast.with_)}`); }
      if (ast.set !== null && ast.set !== undefined) { this.indent(); this.write(`set ${S(ast.set)}`); }
      const list = items(ast.items), itemArgs = ast.item_arguments !== null && ast.item_arguments !== undefined ? items(ast.item_arguments) : [];
      list.forEach(([label, condition, block], n) => {
        const args = itemArgs[n] ?? null;
        let state = null;
        if (isPyExpr(condition) && lineOf(condition) !== null) { // the condition tells the line of this choice
          if (this.sayInsideMenu !== null && condition.linenumber > this.linenumber + 1) this.printSayInsideMenu();
          this.advanceToLine(condition.linenumber);
        } else if (this.sayInsideMenu !== null) { // unknown line: try the caption here, take it back if it pushes later lines down
          state = this.saveState();
          this.mostLinesBehind = this.lastLinesBehind;
          this.printSayInsideMenu();
        }
        this.printMenuItem(label, condition, block, args);
        if (state !== null) {
          if (this.mostLinesBehind > state.lastLinesBehind) { this.rollbackState(state); this.printMenuItem(label, condition, block, args); }
          else { this.mostLinesBehind = Math.max(state.mostLinesBehind, this.mostLinesBehind); this.commitState(state); }
        }
      });
      if (this.sayInsideMenu !== null) this.printSayInsideMenu();
    });
  }

  // python
  python(ast, early = false) {
    this.indent();
    let code = source(ast.code);
    // before 8.4 a block is stored unindented with a leading newline; from 8.4 with its indentation and no leading newline
    const indented = code[0] === ' ', leadingNewline = code[0] === '\n';
    if (!indented && !leadingNewline) { this.write(`$ ${code}`); return; }
    if (leadingNewline) code = code.slice(1);
    this.write('python');
    if (early) this.write(' early');
    if (ast.hide) this.write(' hide');
    const store = ast.store ?? 'store';
    if (store !== 'store') this.write(` in ${S(store).slice(6)}`);
    this.write(':');
    if (indented) this.write(`\n${code}`);
    else this.indented(() => this.writeLines(splitLogicalLines(code)));
  }
  earlyPython(ast) { this.python(ast, true); }
  define(ast) {
    this.requireInit(); this.indent();
    const index = ast.index !== null && ast.index !== undefined ? `[${source(ast.index)}]` : '';
    const store = ast.store ?? 'store', name = store === 'store' ? S(ast.varname) : `${S(store).slice(6)}.${S(ast.varname)}`;
    this.write(`define${this.implicitPriority(ast)} ${name}${index} ${S(ast.operator ?? '=')} ${source(ast.code)}`);
  }
  default(ast) {
    this.requireInit(); this.indent();
    const store = ast.store ?? 'store', name = store === 'store' ? S(ast.varname) : `${S(store).slice(6)}.${S(ast.varname)}`;
    this.write(`default${this.implicitPriority(ast)} ${name} = ${source(ast.code)}`);
  }

  // say
  sayBelongsToMenu(say, menu) {
    return !(say.interact ?? true) && say.who !== null && say.who !== undefined && (say.with_ === null || say.with_ === undefined) && (say.attributes === null || say.attributes === undefined)
      && is(menu, A + 'Menu') && items(menu.items)[0]?.[2] !== null && items(menu.items)[0]?.[2] !== undefined && !before(say, menu);
  }
  handleSayPossiblyInsideMenu(ast) {
    if (this.index + 1 < this.block.length && this.sayBelongsToMenu(ast, this.block[this.index + 1])) { this.sayInsideMenu = ast; return true; }
    return false;
  }
  say(ast, inmenu = false) { this.indent(); this.write(sayGetCode(ast, inmenu)); }
  userStatement(ast) {
    this.indent();
    this.write(S(ast.line));
    if (ast.block !== null) this.indented(() => this.printLex(ast.block));
  }
  printLex(lex) {
    for (const entry of items(lex)) {
      const e = items(entry);
      const [, linenumber, content, block] = e.length === 4 ? e : [e[0], e[1], e[3], e[4]]; // (file, line, text, block) or with an indent column
      this.advanceToLine(linenumber);
      this.indent();
      this.write(S(content));
      if (items(block).length) this.indented(() => this.printLex(block));
    }
  }
  style(ast) {
    this.requireInit();
    const line0 = lineOf(ast) ?? 0;
    const keywords = new Map([[line0, new Words(false, true)]]);
    const at = n => { const k = typeof n === 'number' ? n : line0; if (!keywords.has(k)) keywords.set(k, new Words(false)); return keywords.get(k); };
    if (ast.parent !== null && ast.parent !== undefined) at(line0).append(`is ${S(ast.parent)}`);
    if (ast.clear) at(line0).append('clear');
    if (ast.take !== null && ast.take !== undefined) at(line0).append(`take ${S(ast.take)}`);
    for (const d of items(ast.delattr)) at(line0).append(`del ${S(d)}`);
    if (ast.variant !== null && ast.variant !== undefined) at(lineOf(ast.variant)).append(`variant ${S(ast.variant)}`);
    for (const [key, value] of entries(ast.properties)) at(lineOf(value)).append(`${S(key)} ${S(value)}`);
    const sorted = [...keywords].map(([k, v]) => [k, v.join()]).sort((a, b) => a[0] - b[0]);
    this.indent();
    this.write(`style ${S(ast.style_name)}`);
    if (sorted[0][1]) this.write(` ${sorted[0][1]}`);
    if (sorted.length > 1) { this.write(':'); this.indented(() => { for (const [line, text] of sorted.slice(1)) { this.advanceToLine(line); this.indent(); this.write(text); } }); }
  }

  // translations
  translate(ast) { this.indent(); this.write(`translate ${S(ast.language || 'None')} ${S(ast.identifier)}:`); this.printNodes(ast.block, 1); }
  endTranslate() { /* added by the compiler, has no text */ }
  translateString(ast) {
    this.requireInit();
    const prev = this.index ? this.block[this.index - 1] : null;
    if (!(is(prev, A + 'TranslateString') && prev.language === ast.language)) { this.indent(); this.write(`translate ${S(ast.language || 'None')} strings:`); }
    this.indented(() => {
      this.advanceToLine(lineOf(ast)); // the line of "old"
      this.indent();
      this.write(`old "${stringEscape(ast.old)}"`);
      if (Array.isArray(ast.newloc)) this.advanceToLine(ast.newloc[1]);
      this.indent();
      this.write(`new "${stringEscape(ast.new)}"`);
    });
  }
  translateBlock(ast) {
    this.indent();
    this.write(`translate ${S(ast.language || 'None')} `);
    this.skip = true;
    const inInit = this.inInit, block = items(ast.block);
    if (block.length === 1 && is(block[0], A + 'Python', A + 'Style')) this.inInit = true; // "translate x python/style" counts as init
    try { this.printNodes(block); } finally { this.inInit = inInit; }
  }
  translateSay(ast) {
    if (ast.language) { this.indent(); this.write(`translate ${S(ast.language)} ${S(ast.identifier)}:`); this.indented(() => this.say(ast, true)); }
    else this.say(ast);
  }

  // screens, testcases, rpy directives
  screenStmt(ast) {
    this.requireInit();
    if (is(ast.screen, 'renpy.sl2.slast.SLScreen')) this.sub(SlPrinter, ast.screen);
    else this.printUnknown(ast.screen, lineOf(ast)); // screen language 1 (renpy.screenlang.ScreenLangScreen) stores compiled Python, not statements
  }
  testcase(ast) {
    this.requireInit(); this.indent();
    this.write(`testcase ${S(ast.label)}:`);
    this.sub(TestPrinter, ast.test?.block, 'dump', this.indentLevel + 1);
  }
  rpy(ast) {
    const [command, arg] = items(ast.rest);
    this.rpyArgs.push(S(arg));
    const next = this.block[this.index + 1];
    if (is(next, A + 'RPY') && next.linenumber === ast.linenumber && items(next.rest)[0] === command) return; // "rpy python a, b" is one node per argument
    this.indent();
    this.write(`rpy ${S(command)} ${this.rpyArgs.join(', ')}`);
    this.rpyArgs = [];
  }
}

// ------------------------------------------------------------------------------------------------ entry points
/** Prints a statement list as .rpy text. Returns { source, statements, screenNodes, atlNodes, notDecompiled, notDecompiledClasses, warnings }. */
export function printRenpyAst(stmts, { indentation = '    ', initOffset = true } = {}) {
  const shared = { indentation, initOffset, warnings: [], stats: { statements: 0, screenNodes: 0, atl: 0, notDecompiled: 0, notDecompiledClasses: {}, customDisplayables: 0 } };
  const p = new ScriptPrinter(shared, []);
  p.dump(items(stmts));
  const st = shared.stats;
  return { source: p.out.join('') + '\n', statements: st.statements, screenNodes: st.screenNodes, atlNodes: st.atl, notDecompiled: st.notDecompiled, notDecompiledClasses: st.notDecompiledClasses, customDisplayables: st.customDisplayables, warnings: shared.warnings };
}

/** .rpyc/.rpymc bytes → { source, statements, notDecompiled, notDecompiledClasses, container, renpy: { scriptVersion, pickleProtocol, python, hints }, warnings }. */
export function decompileRpyc(buf, options = {}) {
  const file = readRpyc(buf);
  const printed = printRenpyAst(file.stmts, options);
  return { ...printed, container: file.container, renpy: renpyHints(file) };
}

export const isRpyc = rel => /\.rpym?c$/i.test(rel);
/** One file for re_decode: { text, destRel, info }. */
export function decodeRpycFile(buf, rel) {
  const r = decompileRpyc(buf);
  return {
    text: r.source, destRel: isRpyc(rel) ? rel.replace(/\.rpymc$/i, '.rpym').replace(/\.rpyc$/i, '.rpy') : `${rel}.rpy`,
    info: { engine: "Ren'Py", container: r.container, statements: r.statements, ...(r.screenNodes ? { screenNodes: r.screenNodes } : {}), ...(r.atlNodes ? { atlNodes: r.atlNodes } : {}),
      notDecompiled: r.notDecompiled, ...(r.notDecompiled ? { notDecompiledClasses: r.notDecompiledClasses } : {}), ...(r.customDisplayables ? { customDisplayables: r.customDisplayables } : {}),
      renpy: r.renpy, ...(r.warnings.length ? { warnings: r.warnings.slice(0, 5) } : {}) },
  };
}

/** Totals over the per-file infos of one re_decode run. */
export function summarizeRpyc(infos) {
  const classes = {}, hints = new Set();
  let statements = 0, notDecompiled = 0;
  for (const i of infos) {
    statements += i.statements; notDecompiled += i.notDecompiled;
    for (const [k, v] of Object.entries(i.notDecompiledClasses ?? {})) classes[k] = (classes[k] ?? 0) + v;
    for (const h of i.renpy?.hints ?? []) hints.add(h);
  }
  return { files: infos.length, statements, notDecompiled, notDecompiledClasses: classes, versionHints: [...hints] };
}
