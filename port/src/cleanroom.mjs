// re_cleanroom: does a rebuild contain material copied from the original? A clean-room rebuild recreates mechanics
// and feel, not the original's code, text, art or audio. This compares a rebuild folder with the original (a project,
// an extracted pack or decoded output) and reports, per rebuild file: byte-identical files, code passages that match
// after normalising identifiers and literals (copied or lightly renamed code), copied strings (dialogue, UI text),
// and distinctive original identifiers reused. It is a screening aid, not a legal opinion: short common snippets
// and engine API names are expected and filtered out.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { RPError, requireDir, walk, limit, isText } from './util.mjs';
import { languageOf, stripComments, CODE_LANGUAGES } from './symbols.mjs';

const MAX_FILE = 2 * 1024 * 1024;
const K = 12; // shingle length in normalised tokens
const STOP = new Set('if else for while return var let const func function def class extends new this self true false null nil none and or not in is int float bool string void public private static protected override async await import from export use using namespace package match switch case break continue pass try catch finally throw raise print len range Vector2 Vector3 Node Node2D Node3D get set signal emit connect queue_free delta position velocity transform Update Start Awake GetComponent Time deltaTime Mathf Debug Log'.split(' '));

function tokens(text, lang) {
  const code = lang ? stripComments(text, lang) : text;
  return code.match(/[A-Za-z_]\w*|\d+(?:\.\d+)?|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|[^\s\w]/g) ?? [];
}
/** Normalise: identifiers → I (keywords kept), numbers → N, strings → S; renaming does not hide a copy. */
const norm = t => (/^\d/.test(t) ? 'N' : /^["']/.test(t) ? 'S' : /^[A-Za-z_]/.test(t) ? (STOP.has(t) ? t : 'I') : t);
function shingles(toks) {
  const n = toks.map(norm);
  const out = new Map();
  for (let i = 0; i + K <= n.length; i++) {
    const h = crypto.createHash('md5').update(n.slice(i, i + K).join(' ')).digest('hex').slice(0, 16);
    if (!out.has(h)) out.set(h, i);
  }
  return out;
}
function strings(text) {
  const out = new Set();
  for (const m of text.matchAll(/"((?:[^"\\\n]|\\.){12,400})"|'((?:[^'\\\n]|\\.){12,400})'/g)) {
    const s = (m[1] ?? m[2]).trim();
    if (/\s/.test(s) && /[a-z]{3,}/i.test(s) && !/^(res|https?|user):\/\//.test(s) && !/[{}<>]{2}/.test(s)) out.add(s);
  }
  return out;
}
function identifiers(toks) { const out = new Map(); for (const t of toks) if (/^[A-Za-z_]\w{5,}$/.test(t) && !STOP.has(t) && /[a-z][A-Z]|_[a-z]/.test(t)) out.set(t, (out.get(t) ?? 0) + 1); return out; }

async function index(root, label) {
  const { files } = await walk(root, { maxFiles: 50000 });
  const out = { root, files: [], hashes: new Map(), shingleMap: new Map(), strings: new Map(), idents: new Map() };
  for (const f of files) {
    if (f.size > MAX_FILE || f.size === 0) continue;
    const buf = await fs.readFile(f.abs).catch(() => null);
    if (!buf) continue;
    const hash = crypto.createHash('sha256').update(buf).digest('hex');
    const rel = f.rel.split(path.sep).join('/');
    out.hashes.set(hash, [...(out.hashes.get(hash) ?? []), rel]);
    const entry = { rel, hash, size: f.size };
    if (isText(buf.subarray(0, 4096))) {
      const text = buf.toString('utf8');
      const lang = languageOf(rel);
      entry.text = text;
      entry.lang = lang;
      if (lang && CODE_LANGUAGES.has(lang)) {
        const toks = tokens(text, lang);
        entry.tokens = toks;
        if (label === 'original') { for (const [h, pos] of shingles(toks)) if (!out.shingleMap.has(h)) out.shingleMap.set(h, { rel, pos }); for (const [id] of identifiers(toks)) out.idents.set(id, rel); }
      }
      if (label === 'original') for (const s of strings(text)) if (!out.strings.has(s)) out.strings.set(s, rel);
    }
    out.files.push(entry);
  }
  return out;
}

function lineAt(text, tokenIndex, toks) {
  // Approximate line of the n-th token by searching the token sequence prefix in the text.
  let pos = 0;
  for (let i = 0; i < tokenIndex && i < toks.length; i++) { const j = text.indexOf(toks[i], pos); if (j < 0) break; pos = j + toks[i].length; }
  return text.slice(0, pos).split('\n').length;
}

export async function cleanroomTool({ original, rebuild, minTokens = 40, limit: max = 200 } = {}) {
  if (!original || !rebuild) throw new RPError('INVALID_ARGUMENT', 'Give original (the original project or extracted files) and rebuild (your clean-room project).');
  const o = await index(await requireDir(original, 'original'), 'original');
  const r = await index(await requireDir(rebuild, 'rebuild'), 'rebuild');
  const identical = [], codeMatches = [], copiedStrings = [], reusedNames = new Map();
  for (const f of r.files) {
    const same = o.hashes.get(f.hash);
    if (same && f.size >= 64) identical.push({ file: f.rel, original: same.slice(0, 3), size: f.size, kind: f.text ? 'text' : 'binary (asset?)' });
    if (f.tokens) {
      const sh = shingles(f.tokens);
      // Merge consecutive matching shingles into runs.
      const hits = [];
      for (const [h, pos] of sh) { const m = o.shingleMap.get(h); if (m) hits.push({ pos, ...m }); }
      hits.sort((a, b) => a.pos - b.pos);
      const runs = [];
      for (const h of hits) { const last = runs.at(-1); if (last && h.pos <= last.end + 2 && h.rel === last.rel) last.end = h.pos + K; else runs.push({ start: h.pos, end: h.pos + K, rel: h.rel, opos: h.pos }); }
      for (const run of runs) {
        const len = run.end - run.start;
        if (len < minTokens) continue;
        codeMatches.push({ file: f.rel, line: lineAt(f.text, run.start, f.tokens), tokens: len, original: run.rel, excerpt: f.tokens.slice(run.start, Math.min(run.end, run.start + 30)).join(' ') });
      }
      const covered = runs.filter(x => x.end - x.start >= minTokens).reduce((s, x) => s + (x.end - x.start), 0);
      if (covered) f.copiedShare = Math.round((100 * covered) / Math.max(1, f.tokens.length));
      for (const [id] of identifiers(f.tokens)) if (o.idents.has(id)) reusedNames.set(id, { name: id, file: f.rel, original: o.idents.get(id) });
    }
    if (f.text) for (const s of strings(f.text)) if (o.strings.has(s)) copiedStrings.push({ file: f.rel, text: s.length > 120 ? s.slice(0, 117) + '…' : s, original: o.strings.get(s) });
  }
  codeMatches.sort((a, b) => b.tokens - a.tokens);
  const files = r.files.filter(f => f.copiedShare).map(f => ({ file: f.rel, copiedShare: `${f.copiedShare}%` })).sort((a, b) => parseInt(b.copiedShare) - parseInt(a.copiedShare));
  const binaryCopies = identical.filter(x => x.kind !== 'text');
  const findings = identical.length + codeMatches.length + copiedStrings.length;
  return {
    original: o.root, rebuild: r.root, filesCompared: { original: o.files.length, rebuild: r.files.length },
    clean: findings === 0,
    identicalFiles: limit(identical, max), codeMatches: limit(codeMatches, max), filesWithCopiedCode: limit(files, max), copiedStrings: limit(copiedStrings, max),
    reusedNames: limit([...reusedNames.values()], max),
    summary: `${identical.length} identical file(s) (${binaryCopies.length} binary), ${codeMatches.length} code passage(s) of ${minTokens}+ tokens matching after normalisation, ${copiedStrings.length} copied string(s), ${reusedNames.size} distinctive original name(s) reused.`,
    next: findings ? 'Replace identical assets with your own, rewrite matching code from the behaviour spec (re_blueprint) instead of the original, write your own text. Reused names are allowed for compatibility but say why in the proof case (re_case decision). Record this report as evidence: re_case {action:"evidence", content:<this result>, kind:"tool-result"}.' : 'No copied files, code or text found at this threshold. Record this report in the proof case as evidence of a clean-room rebuild.',
    note: 'Screening aid, not legal advice. Matching is token-based with identifiers, numbers and strings normalised, so renamed copies are found; short common patterns (under minTokens) are ignored.',
  };
}
