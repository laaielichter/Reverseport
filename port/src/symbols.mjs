// Source-code structure for many languages without compilers or dependencies: classes, functions, signals,
// exported fields and the raw dependencies each file names. Pattern-based (fast, tolerant of broken code);
// precise enough to plan a port and to check that nothing was forgotten.
import fs from 'node:fs/promises';
import path from 'node:path';
import { countLines, isText } from './util.mjs';

export const LANGUAGE_BY_EXT = {
  '.gd': 'gdscript', '.cs': 'csharp', '.c': 'c', '.h': 'c-header', '.cpp': 'cpp', '.cc': 'cpp', '.cxx': 'cpp', '.hpp': 'cpp', '.hh': 'cpp', '.hxx': 'cpp', '.inl': 'cpp',
  '.py': 'python', '.pyw': 'python', '.js': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript', '.jsx': 'javascript', '.ts': 'typescript', '.tsx': 'typescript', '.mts': 'typescript', '.cts': 'typescript',
  '.vue': 'javascript', '.svelte': 'javascript', '.lua': 'lua', '.java': 'java', '.kt': 'kotlin', '.kts': 'kotlin', '.go': 'go', '.rs': 'rust', '.swift': 'swift', '.rb': 'ruby', '.php': 'php',
  '.gdshader': 'shader', '.gdshaderinc': 'shader', '.shader': 'shader', '.hlsl': 'shader', '.glsl': 'shader', '.vert': 'shader', '.frag': 'shader', '.compute': 'shader', '.cginc': 'shader', '.usf': 'shader', '.ush': 'shader', '.wgsl': 'shader',
  '.tscn': 'godot-scene', '.tres': 'godot-resource', '.unity': 'unity-scene', '.prefab': 'unity-prefab', '.rpy': 'renpy', '.hx': 'haxe', '.dart': 'dart', '.m': 'objc', '.mm': 'objc', '.gml': 'gml',
  '.vb': 'vbnet', '.fs': 'fsharp', '.pas': 'pascal', '.as': 'actionscript', '.coffee': 'coffeescript', '.zig': 'zig', '.nim': 'nim', '.cr': 'crystal', '.scala': 'scala', '.ex': 'elixir', '.exs': 'elixir', '.erl': 'erlang', '.clj': 'clojure',
};
export const CODE_LANGUAGES = new Set(Object.values(LANGUAGE_BY_EXT).filter(l => !['godot-scene', 'godot-resource', 'unity-scene', 'unity-prefab'].includes(l)));
const C_STYLE = new Set(['csharp', 'c', 'c-header', 'cpp', 'javascript', 'typescript', 'java', 'kotlin', 'go', 'rust', 'swift', 'php', 'shader', 'haxe', 'dart', 'objc', 'gml', 'actionscript', 'zig', 'scala']);
const HASH_STYLE = new Set(['python', 'gdscript', 'ruby', 'renpy', 'coffeescript', 'nim', 'crystal', 'elixir']);
const KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'return', 'new', 'else', 'catch', 'using', 'lock', 'foreach', 'sizeof', 'typeof', 'nameof', 'do', 'try', 'case', 'throw', 'await', 'yield', 'delete', 'function', 'constructor', 'elif', 'match', 'when', 'in', 'is', 'as', 'default', 'static', 'super', 'this', 'base', 'operator', 'defined', 'decltype', 'alignof', 'static_assert', 'with', 'fixed', 'checked', 'unchecked', 'get', 'set']);

export function languageOf(file) { return LANGUAGE_BY_EXT[path.extname(file).toLowerCase()] ?? null; }

/** Blank out comments (keeping strings and line numbers). */
export function stripComments(text, language) {
  const cStyle = C_STYLE.has(language), hash = HASH_STYLE.has(language), lua = language === 'lua';
  if (!cStyle && !hash && !lua) return text;
  const out = text.split('');
  const n = text.length;
  const blank = (a, b) => { for (let k = a; k < b; k++) if (out[k] !== '\n') out[k] = ' '; };
  for (let i = 0; i < n; i++) {
    const c = text[i], d = text[i + 1];
    if (c === '"' || c === "'" || (c === '`' && cStyle)) {
      if (hash && text.startsWith(c.repeat(3), i)) { const end = text.indexOf(c.repeat(3), i + 3); i = end < 0 ? n : end + 2; continue; }
      if (cStyle && c === "'" && ['rust', 'c', 'cpp', 'c-header'].includes(language)) { const m = text.slice(i, i + 12).match(/^'(\\.|[^'\\\n]){1,4}'/); if (m) { i += m[0].length - 1; } continue; }
      for (i++; i < n && text[i] !== c; i++) { if (text[i] === '\\') i++; else if (text[i] === '\n' && c !== '`') break; }
      continue;
    }
    if (cStyle && c === '/' && d === '/') { const end = text.indexOf('\n', i); blank(i, end < 0 ? n : end); i = end < 0 ? n : end; continue; }
    if (cStyle && c === '/' && d === '*') { const end = text.indexOf('*/', i + 2); blank(i, end < 0 ? n : end + 2); i = end < 0 ? n : end + 1; continue; }
    if (hash && c === '#') { const end = text.indexOf('\n', i); blank(i, end < 0 ? n : end); i = end < 0 ? n : end; continue; }
    if (lua && c === '-' && d === '-') {
      const long = text.slice(i + 2).match(/^\[(=*)\[/);
      const end = long ? text.indexOf(`]${long[1]}]`, i) + long[1].length + 2 : text.indexOf('\n', i);
      blank(i, end < 0 ? n : end); i = end < 0 ? n : end; continue;
    }
  }
  return out.join('');
}

function lineIndex(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
  return idx => { let lo = 0, hi = starts.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= idx) lo = mid; else hi = mid - 1; } return lo + 1; };
}

const all = (re, text) => [...text.matchAll(re)];

/** `a::{b, c::{self, D}, *}` → `a::b`, `a::c`, `a::c::D`, `a`. Aliases (`as X`) and leading `::` are dropped. */
export function expandRustUse(spec) {
  const text = spec.replace(/\s+as\s+\w+/g, '').replace(/\s+/g, '').replace(/^::/, '');
  const out = [];
  const walk = (prefix, s) => {
    const open = s.indexOf('{');
    if (open < 0) { const p = `${prefix}${s}`.replace(/::(self|\*)$/, '').replace(/^(self|\*)$/, ''); if (p) out.push(p); return; }
    let depth = 0, close = open;
    for (; close < s.length; close++) { if (s[close] === '{') depth++; else if (s[close] === '}' && --depth === 0) break; }
    const items = [];
    let start = open + 1, level = 0;
    for (let i = open + 1; i < close; i++) { if (s[i] === '{') level++; else if (s[i] === '}') level--; else if (s[i] === ',' && !level) { items.push(s.slice(start, i)); start = i + 1; } }
    items.push(s.slice(start, close));
    for (const item of items) if (item) walk(prefix + s.slice(0, open), item);
  };
  walk('', text);
  return [...new Set(out)];
}

export function extractSymbols(text, language) {
  const code = stripComments(text, language);
  const line = lineIndex(code);
  const out = { classes: [], functions: [], deps: [] };
  const fn = (name, m, extra = {}) => { if (name && !KEYWORDS.has(name)) out.functions.push({ name, line: line(m.index), ...extra }); };
  const cls = (name, m, extra = {}) => { if (name && !KEYWORDS.has(name)) out.classes.push({ name, line: line(m.index), ...extra }); };
  const dep = (spec, kind = 'import') => { if (spec) out.deps.push({ spec, kind }); };
  switch (language) {
    case 'gdscript': {
      const cn = code.match(/^class_name\s+(\w+)/m); if (cn) out.className = cn[1];
      const ex = code.match(/^extends\s+("[^"]+"|[\w.]+)/m); if (ex) out.extends = ex[1].replace(/"/g, '');
      if (out.className || out.extends) out.classes.push({ name: out.className ?? null, extends: out.extends ?? null, line: 1, script: true });
      for (const m of all(/^class\s+(\w+)(?:\s+extends\s+([\w.]+))?\s*:/gm, code)) cls(m[1], m, { extends: m[2] ?? null, inner: true });
      for (const m of all(/^([ \t]*)(static\s+)?func\s+(\w+)\s*\(([^)]*)\)\s*(?:->\s*([\w[\].]+))?/gm, code)) fn(m[3], m, { params: m[4].trim(), ...(m[5] ? { returns: m[5] } : {}), ...(m[2] ? { static: true } : {}), ...(m[1] ? { indented: true } : {}) });
      out.signals = all(/^signal\s+(\w+)(?:\(([^)]*)\))?/gm, code).map(m => ({ name: m[1], params: (m[2] ?? '').trim(), line: line(m.index) }));
      out.exports = [...all(/^@export[^\n]*?\bvar\s+(\w+)/gm, code), ...all(/^export(?:\([^)]*\))?\s+var\s+(\w+)/gm, code)].map(m => m[1]);
      out.nodeRefs = [...new Set([...all(/\$("[^"]+"|%?[\w/]+)/g, code), ...all(/get_node(?:_or_null)?\(\s*"([^"]+)"/g, code)].map(m => m[1].replace(/"/g, '')))].slice(0, 100);
      for (const m of all(/\b(?:preload|load|ResourceLoader\.load)\(\s*"([^"]+)"/g, code)) dep(m[1], 'load');
      if (/^res:\/\//.test(out.extends ?? '')) dep(out.extends, 'extends');
      break;
    }
    case 'csharp': {
      const ns = code.match(/\bnamespace\s+([\w.]+)/); if (ns) out.namespace = ns[1];
      for (const m of all(/\b(class|struct|interface|enum|record)\s+(\w+)(?:<[^>{]*>)?(?:\s*\([^)]*\))?(?:\s*:\s*([^{\n;]+))?/g, code)) {
        if (/\bnew\s*$/.test(code.slice(Math.max(0, m.index - 8), m.index))) continue;
        cls(m[2], m, { kind: m[1], ...(m[3] ? { extends: m[3].split(',')[0].replace(/\bwhere\b.*$/, '').trim() } : {}) });
      }
      for (const m of all(/^[ \t]*(?:\[[^\]\n]*\]\s*)*((?:(?:public|private|protected|internal|static|virtual|override|abstract|async|sealed|extern|unsafe|new|partial|readonly)\s+)*)([\w<>[\],.?]+(?:<[^>\n]*>)?)\s+(\w+)\s*(?:<[^>\n]*>)?\s*\(([^)]*)\)\s*(?:where[^{\n]*)?(?:\{|=>|\n\s*\{)/gm, code)) {
        if (KEYWORDS.has(m[2]) || m[2] === 'else') continue;
        fn(m[3], m, { returns: m[2], ...(m[1].trim() ? { modifiers: m[1].trim() } : {}) });
      }
      for (const m of all(/^[ \t]*(?:public|private|protected|internal)\s+(?:static\s+)?(\w+)\s*\(([^)]*)\)\s*(?::\s*(?:base|this)\([^)]*\)\s*)?\{/gm, code)) fn(m[1], m, { constructor: true });
      for (const m of all(/^\s*using\s+(?:static\s+)?([\w.]+)\s*;/gm, code)) dep(m[1], 'namespace');
      out.exports = all(/\[(?:SerializeField|Export)[^\]]*\][^;=(]*?\s(\w+)\s*(?:=[^;]*)?;/g, code).map(m => m[1]);
      out.signals = all(/\[Signal\]\s*(?:public\s+)?delegate\s+\w+\s+(\w+)EventHandler/g, code).map(m => ({ name: m[1], line: line(m.index) }));
      break;
    }
    case 'c': case 'c-header': case 'cpp': case 'objc': {
      for (const m of all(/^\s*#\s*(?:include|import)\s*"([^"]+)"/gm, code)) dep(m[1], 'include');
      for (const m of all(/^\s*#\s*(?:include|import)\s*<([^>]+)>/gm, code)) dep(m[1], 'system');
      for (const m of all(/^\s*(?:template\s*<[^>]*>\s*)?(class|struct|union)\s+(?:[A-Z_][A-Z0-9_]*_API\s+|alignas\([^)]*\)\s+)?(\w+)(?:\s+final)?\s*(?::\s*([^{;]+))?\{/gm, code)) cls(m[2], m, { kind: m[1], ...(m[3] ? { extends: m[3].replace(/\b(public|private|protected|virtual)\b/g, '').split(',')[0].trim() } : {}) });
      for (const m of all(/^[ \t]*(?:[\w:<>,*&~]+[ \t*&]+)+?([\w:~]+)\s*\(([^;{}()]*(?:\([^)]*\)[^;{}()]*)*)\)\s*(?:const\s*)?(?:override\s*)?(?:noexcept\s*)?(?:->\s*[\w:<>*&]+\s*)?\{/gm, code)) {
        const name = m[1].split('::').pop();
        if (KEYWORDS.has(name)) continue;
        fn(name, m, { ...(m[1].includes('::') ? { qualified: m[1] } : {}) });
      }
      const ue = { uclass: (code.match(/\bUCLASS\s*\(/g) ?? []).length, ufunction: (code.match(/\bUFUNCTION\s*\(/g) ?? []).length, uproperty: (code.match(/\bUPROPERTY\s*\(/g) ?? []).length };
      if (ue.uclass + ue.ufunction + ue.uproperty) out.unreal = ue;
      break;
    }
    case 'python': {
      for (const m of all(/^([ \t]*)class\s+(\w+)(?:\(([^)]*)\))?\s*:/gm, code)) cls(m[2], m, { ...(m[3] ? { extends: m[3].split(',')[0].trim() } : {}), ...(m[1] ? { indented: true } : {}) });
      for (const m of all(/^([ \t]*)(?:async\s+)?def\s+(\w+)\s*\(/gm, code)) fn(m[2], m, m[1] ? { indented: true } : {});
      for (const m of all(/^\s*import\s+([\w.]+(?:\s+as\s+\w+)?(?:\s*,\s*[\w.]+(?:\s+as\s+\w+)?)*)/gm, code)) for (const part of m[1].split(',')) dep(part.trim().split(/\s+/)[0]);
      for (const m of all(/^\s*from\s+(\.*[\w.]*)\s+import\s+\(?([\w\s,*]+)/gm, code)) dep(m[1], m[1].startsWith('.') ? 'relative' : 'import');
      if (/^if\s+__name__\s*==\s*['"]__main__['"]/m.test(code)) out.entry = true;
      break;
    }
    case 'javascript': case 'typescript': case 'coffeescript': {
      for (const m of all(/(?:^|[^.\w])(?:import|export)\s+(?:type\s+)?(?:[^'"`;]*?\s+from\s+)?['"]([^'"]+)['"]/g, code)) dep(m[1]);
      for (const m of all(/\b(?:require|import)\(\s*['"]([^'"]+)['"]\s*\)/g, code)) dep(m[1], 'dynamic');
      for (const m of all(/\bclass\s+(\w+)(?:<[^>]*>)?(?:\s+extends\s+([\w.]+))?/g, code)) cls(m[1], m, m[2] ? { extends: m[2] } : {});
      for (const m of all(/\bfunction\s*\*?\s*(\w+)\s*\(/g, code)) fn(m[1], m);
      for (const m of all(/\b(?:const|let|var)\s+(\w+)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:\([^)]*\)|\w+)\s*(?::\s*[^=]+)?=>/g, code)) fn(m[1], m, { arrow: true });
      for (const m of all(/^[ \t]+(?:(?:static|async|get|set|public|private|protected|readonly|override)\s+)*\*?\s*(#?\w+)\s*\([^)\n]*\)\s*(?::\s*[^{\n]+)?\{/gm, code)) fn(m[1], m, { method: true });
      if (/\bexport\s+default\b/.test(code)) out.defaultExport = true;
      break;
    }
    case 'lua': {
      for (const m of all(/\bfunction\s+([\w.:]+)\s*\(/g, code)) fn(m[1].split(/[.:]/).pop(), m, { qualified: m[1] });
      for (const m of all(/\blocal\s+function\s+(\w+)/g, code)) fn(m[1], m, { local: true });
      for (const m of all(/([\w.:]+)\s*=\s*function\s*\(/g, code)) fn(m[1].split(/[.:]/).pop(), m, { qualified: m[1] });
      for (const m of all(/\brequire\s*\(?\s*['"]([^'"]+)['"]/g, code)) dep(m[1]);
      break;
    }
    case 'java': case 'kotlin': case 'scala': {
      const pkg = code.match(/^\s*package\s+([\w.]+)/m); if (pkg) out.namespace = pkg[1];
      for (const m of all(/^\s*import\s+(?:static\s+)?([\w.*]+)/gm, code)) dep(m[1], 'import');
      for (const m of all(/\b(class|interface|enum|record|object|trait)\s+(\w+)(?:<[^>{]*>)?(?:\s*(?:extends|:)\s*([\w.<>]+))?/g, code)) cls(m[2], m, { kind: m[1], ...(m[3] ? { extends: m[3] } : {}) });
      if (language === 'java') for (const m of all(/^[ \t]*(?:@\w+(?:\([^)]*\))?\s*)*(?:(?:public|private|protected|static|final|abstract|synchronized|native|default)\s+)*(?:<[^>]+>\s+)?([\w<>[\],.?]+)\s+(\w+)\s*\(([^)]*)\)\s*(?:throws[^{]*)?\{/gm, code)) { if (!KEYWORDS.has(m[1])) fn(m[2], m, { returns: m[1] }); }
      else for (const m of all(/\b(?:fun|def)\s+(?:<[^>]+>\s*)?(?:[\w.]+\.)?(\w+)\s*[([]/g, code)) fn(m[1], m);
      break;
    }
    case 'go': {
      const pkg = code.match(/^package\s+(\w+)/m); if (pkg) { out.namespace = pkg[1]; if (pkg[1] === 'main') out.entry = /^func\s+main\s*\(/m.test(code); }
      for (const m of all(/^func\s+(?:\(([^)]*)\)\s*)?(\w+)/gm, code)) fn(m[2], m, m[1] ? { receiver: m[1].trim().split(/\s+/).pop() } : {});
      for (const m of all(/^type\s+(\w+)\s+(struct|interface)/gm, code)) cls(m[1], m, { kind: m[2] });
      for (const m of all(/^import\s+(?:\w+\s+)?"([^"]+)"/gm, code)) dep(m[1]);
      for (const m of all(/^import\s*\(([\s\S]*?)\)/gm, code)) for (const im of m[1].matchAll(/"([^"]+)"/g)) dep(im[1]);
      break;
    }
    case 'rust': {
      for (const m of all(/\bfn\s+(\w+)/g, code)) fn(m[1], m);
      for (const m of all(/\b(struct|enum|trait|union)\s+(\w+)/g, code)) cls(m[2], m, { kind: m[1] });
      for (const m of all(/^\s*(?:pub(?:\([^)]*\))?\s+)?mod\s+(\w+)\s*;/gm, code)) dep(m[1], 'mod');
      // `use a::{b, c::{self, D}};` names every leaf; a `use super::…` that is indented sits in an inline
      // `mod tests { … }`, whose parent is this file, so one `super` becomes `self`.
      for (const m of all(/^([ \t]*)(?:pub(?:\([^)]*\))?\s+)?use\s+([^;]+);/gm, code)) for (const spec of expandRustUse(m[2])) dep(m[1] ? spec.replace(/^super(?=::|$)/, 'self') : spec, 'use');
      if (/\bfn\s+main\s*\(/.test(code)) out.entry = true;
      break;
    }
    case 'shader': {
      const st = code.match(/^\s*shader_type\s+(\w+)/m); if (st) out.shaderType = st[1];
      for (const m of all(/^[ \t]*(?:\w+[ \t]+)+(\w+)\s*\([^;{)]*\)\s*(?::\s*\w+\s*)?\{/gm, code)) fn(m[1], m);
      out.uniforms = all(/\buniform\s+(?:\w+\s+)?\w+\s+(\w+)/g, code).map(m => m[1]);
      for (const m of all(/#\s*include\s*["<]([^">]+)[">]/g, code)) dep(m[1], 'include');
      break;
    }
    case 'renpy': {
      for (const m of all(/^\s*label\s+([\w.]+)\s*:/gm, code)) fn(m[1], m, { label: true });
      for (const m of all(/^\s*screen\s+(\w+)/gm, code)) cls(m[1], m, { kind: 'screen' });
      break;
    }
    case 'gml': {
      for (const m of all(/\bfunction\s+(\w+)\s*\(/g, code)) fn(m[1], m);
      break;
    }
    default: {
      for (const m of all(/\b(?:function|func|fn|def|sub|procedure)\s+(\w+)/g, code)) fn(m[1], m);
      for (const m of all(/\b(?:class|struct|interface|module)\s+(\w+)/g, code)) cls(m[1], m);
    }
  }
  const seen = new Set();
  out.functions = out.functions.filter(f => { const k = `${f.name}:${f.line}`; if (seen.has(k)) return false; seen.add(k); return true; });
  return out;
}

const MAX_SOURCE = 4 * 1024 * 1024;

/** Read and analyse one source file. Returns null for non-code or oversized files. */
export async function fileSymbols(abs, language = languageOf(abs)) {
  if (!language || !CODE_LANGUAGES.has(language)) return null;
  const st = await fs.stat(abs);
  if (st.size > MAX_SOURCE) return { language, lines: null, skipped: 'larger than 4 MiB', classes: [], functions: [], deps: [] };
  const buf = await fs.readFile(abs);
  if (!isText(buf)) return null;
  const text = buf.toString('utf8');
  return { language, lines: countLines(text), ...extractSymbols(text, language) };
}

/** Identifiers used in a file (for type-index dependency resolution). */
export function identifiers(text) {
  const set = new Set();
  for (const m of text.matchAll(/\b[A-Z_][A-Za-z0-9_]{2,}\b/g)) set.add(m[0]);
  return set;
}
