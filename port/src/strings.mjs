// re_strings: extract user-facing text for localisation, and put translations back into a copy.
// Sources: Godot .tscn/.tres (text, tooltip_text, placeholder_text, title, dialog_text, item lists), Godot code
// (tr("…"), tr_n, .text = "…"), Unity YAML (m_Text, m_text for TextMeshPro, m_Name of UI), Unity C#
// (.text = "…"), RPG Maker MV/MZ (Show Text 401, choices 102, names), Ren'Py (say and menu statements) and
// web/JSON i18n files. Every string gets a stable id: file + node path/line + property.
// Output: a catalog (JSON) and optionally .po or CSV. `apply` writes translations into a COPY of the project.
import fs from 'node:fs/promises';
import path from 'node:path';
import { RPError, requireDir, walk, limit, toPosix } from './util.mjs';
import { workspaceDir, safeJoin } from './workspace.mjs';

const GODOT_PROPS = new Set(['text', 'tooltip_text', 'placeholder_text', 'title', 'dialog_text', 'ok_button_text', 'cancel_button_text', 'hint_tooltip', 'placeholder', 'window_title', 'name_text', 'popup/item_0/text']);
const UNITY_KEYS = new Set(['m_Text', 'm_text', 'm_Label', 'm_PlaceholderText']);
const MAX_LEN = 4000;

const unquote = s => s.replace(/^"(.*)"$/s, '$1').replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
const skip = s => !s.trim() || s.length > MAX_LEN || /^(res|uid|user):\/\//.test(s) || /^[\d\s.,:;+\-*/%=()[\]{}<>#$&|^~`!?@]*$/.test(s) || /^[a-z_][a-z0-9_]*$/.test(s) && !s.includes(' ');

function entry(file, where, prop, text, kind, line) {
  return { id: `${file}#${where}#${prop}`, file, where, prop, text, kind, line, chars: text.length, placeholders: [...text.matchAll(/%[sdif]|\{[^}]+\}|%\d+\$[sd]/g)].map(m => m[0]) };
}

function fromGodotScene(file, text) {
  const out = [];
  let node = '', nodeType = '';
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const n = l.match(/^\[(node|sub_resource|resource)\s*(.*)\]$/);
    if (n) { node = n[1] === 'node' ? `${(n[2].match(/parent="([^"]*)"/)?.[1] ?? '').replace(/^\.$/, '')}/${n[2].match(/name="([^"]*)"/)?.[1] ?? ''}`.replace(/^\/+/, '') || '.' : (n[2].match(/id="?([^" ]+)"?/)?.[1] ?? n[1]); nodeType = n[2].match(/type="([^"]*)"/)?.[1] ?? ''; continue; }
    const kv = l.match(/^([A-Za-z_][\w/]*)\s*=\s*"((?:[^"\\]|\\.)*)"\s*$/);
    if (kv && (GODOT_PROPS.has(kv[1]) || /\/text$/.test(kv[1]))) { const v = unquote(`"${kv[2]}"`); if (!skip(v)) out.push(entry(file, node, kv[1], v, nodeType || 'resource', i + 1)); continue; }
    const arr = l.match(/^(items|options|popup_items)\s*=\s*\[(.*)\]\s*$/);
    if (arr) for (const m of arr[2].matchAll(/"((?:[^"\\]|\\.)*)"/g)) { const v = unquote(`"${m[1]}"`); if (!skip(v)) out.push(entry(file, node, arr[1], v, nodeType, i + 1)); }
  }
  return out;
}

function fromCode(file, text, lang) {
  const out = [];
  const lines = text.split('\n');
  const patterns = lang === 'gd'
    ? [/\btr\(\s*"((?:[^"\\]|\\.)*)"/g, /\btr_n\(\s*"((?:[^"\\]|\\.)*)"\s*,\s*"((?:[^"\\]|\\.)*)"/g, /\.(?:text|tooltip_text|placeholder_text|title)\s*=\s*"((?:[^"\\]|\\.)*)"/g, /\b(?:add_item|add_icon_item|set_item_text|add_check_item|set_text|push_warning|push_error|print(?:_rich)?)\(\s*"((?:[^"\\]|\\.)*)"/g, /\$"((?:[^"\\]|\\.)*)"/g]
    : lang === 'cs'
      ? [/\.(?:text|Text|tooltip|Tooltip)\s*=\s*\$?"((?:[^"\\]|\\.)*)"/g, /\bSetText\(\s*"((?:[^"\\]|\\.)*)"/g, /\b(?:Localize|Translate|GetString|L|T)\(\s*"((?:[^"\\]|\\.)*)"/g, /\bDebug\.Log(?:Warning|Error)?\(\s*"((?:[^"\\]|\\.)*)"/g]
      : [/\b(?:t|i18n\.t|\$t|gettext|_)\(\s*["']((?:[^"'\\]|\\.)*)["']/g, /\.(?:textContent|innerText|title|placeholder)\s*=\s*["']((?:[^"'\\]|\\.)*)["']/g];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^\s*(#|\/\/)/.test(l)) continue;
    for (const re of patterns) for (const m of l.matchAll(re)) {
      const v = unquote(`"${m[1]}"`);
      if (skip(v) || /^[\w.]+$/.test(v)) continue;
      const prop = re.source.startsWith('\\btr_n') ? 'tr_n' : re.source.startsWith('\\btr\\(') ? 'tr' : re.source.includes('Log') || re.source.includes('push_') || re.source.includes('print') ? 'log' : 'code';
      out.push(entry(file, `L${i + 1}`, prop, v, 'code', i + 1));
      if (m[2]) out.push(entry(file, `L${i + 1}`, 'tr_n.plural', unquote(`"${m[2]}"`), 'code', i + 1));
    }
  }
  return out;
}

function fromUnityYaml(file, text) {
  const out = [];
  if (!text.startsWith('%YAML')) return out;
  const lines = text.split('\n');
  let objId = '', objType = '', objName = '';
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const h = l.match(/^--- !u!(\d+) &(-?\d+)/);
    if (h) { objId = h[2]; objType = ''; objName = ''; continue; }
    if (!objType && /^[A-Za-z]\w*:\s*$/.test(l)) { objType = l.slice(0, -1); continue; }
    const name = l.match(/^\s{2}m_Name:\s*(.+)$/);
    if (name && objType === 'GameObject') { objName = name[1].trim(); continue; }
    const kv = l.match(/^\s{2}(m_\w+):\s*(.+)$/);
    if (!kv || !UNITY_KEYS.has(kv[1])) continue;
    let v = kv[2].trim();
    if (/^['"]/.test(v)) v = v.slice(1, -1).replace(/''/g, "'").replace(/\\n/g, '\n');
    else if (v === '|' || v === '>') { const block = []; let j = i + 1; while (j < lines.length && /^\s{4,}/.test(lines[j])) block.push(lines[j].replace(/^\s{4}/, '')), j++; v = block.join('\n'); }
    if (!skip(v)) out.push(entry(file, `${objType}&${objId}${objName ? `(${objName})` : ''}`, kv[1], v, objType, i + 1));
  }
  return out;
}

function fromRpgMaker(file, text) {
  const out = [];
  let data;
  try { data = JSON.parse(text); } catch { return out; }
  const base = path.basename(file);
  const walkCommands = (list, where) => {
    let buf = [], start = 0;
    const flush = () => { if (buf.length) { const v = buf.join('\n'); if (!skip(v)) out.push(entry(file, `${where}/cmd${start}`, 'ShowText', v, 'rpgmaker-event', null)); buf = []; } };
    (list ?? []).forEach((c, i) => {
      if (c.code === 401) { if (!buf.length) start = i; buf.push(String(c.parameters?.[0] ?? '')); return; }
      flush();
      if (c.code === 102) (c.parameters?.[0] ?? []).forEach((choice, k) => { if (!skip(choice)) out.push(entry(file, `${where}/cmd${i}/choice${k}`, 'Choice', choice, 'rpgmaker-event', null)); });
      if (c.code === 105 || c.code === 405) { const v = String(c.parameters?.[0] ?? ''); if (!skip(v)) out.push(entry(file, `${where}/cmd${i}`, 'Scroll', v, 'rpgmaker-event', null)); }
      if (c.code === 108 || c.code === 408) return; // comments
    });
    flush();
  };
  if (/^Map\d+\.json$/.test(base)) {
    if (data.displayName && !skip(data.displayName)) out.push(entry(file, 'map', 'displayName', data.displayName, 'rpgmaker-map', null));
    for (const ev of data.events ?? []) if (ev) ev.pages?.forEach((p, pi) => walkCommands(p.list, `event${ev.id}/page${pi}`));
  } else if (base === 'CommonEvents.json') {
    for (const ev of data) if (ev) walkCommands(ev.list, `common${ev.id}`);
  } else if (/^(Actors|Items|Weapons|Armors|Skills|Enemies|States|Classes)\.json$/.test(base)) {
    for (const it of data) if (it) for (const k of ['name', 'nickname', 'profile', 'description', 'message1', 'message2', 'message3', 'message4']) if (typeof it[k] === 'string' && !skip(it[k])) out.push(entry(file, `${base.replace('.json', '').toLowerCase()}${it.id}`, k, it[k], 'rpgmaker-db', null));
  } else if (base === 'System.json') {
    if (data.gameTitle && !skip(data.gameTitle)) out.push(entry(file, 'system', 'gameTitle', data.gameTitle, 'rpgmaker-db', null));
    for (const [group, list] of Object.entries(data.terms ?? {})) {
      if (Array.isArray(list)) list.forEach((v, i) => { if (typeof v === 'string' && !skip(v)) out.push(entry(file, `terms/${group}/${i}`, 'term', v, 'rpgmaker-db', null)); });
      else if (list && typeof list === 'object') for (const [k, v] of Object.entries(list)) if (typeof v === 'string' && !skip(v)) out.push(entry(file, `terms/${group}/${k}`, 'term', v, 'rpgmaker-db', null));
    }
  }
  return out;
}

function fromRenpy(file, text) {
  const out = [];
  const lines = text.split('\n');
  let label = '';
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const lb = l.match(/^label\s+([\w.]+)/);
    if (lb) { label = lb[1]; continue; }
    if (/^\s*(#|\$|python|init|define|default|image|transform|screen|style)\b/.test(l)) continue;
    const say = l.match(/^\s*(?:(\w+)\s+)?"((?:[^"\\]|\\.)*)"(?:\s+(?:with|nointeract).*)?\s*$/);
    if (say) { const v = unquote(`"${say[2]}"`); if (!skip(v)) out.push(entry(file, `${label || 'top'}/L${i + 1}`, say[1] ? `say:${say[1]}` : 'narrator', v, 'renpy', i + 1)); continue; }
    const choice = l.match(/^\s+"((?:[^"\\]|\\.)*)"\s*(?:if\s+.+)?:\s*$/);
    if (choice) { const v = unquote(`"${choice[1]}"`); if (!skip(v)) out.push(entry(file, `${label || 'top'}/L${i + 1}`, 'menu', v, 'renpy', i + 1)); }
  }
  return out;
}

function fromJsonI18n(file, text) {
  const out = [];
  let data;
  try { data = JSON.parse(text); } catch { return out; }
  const visit = (v, p) => {
    if (typeof v === 'string') { if (!skip(v)) out.push(entry(file, p, 'value', v, 'i18n-json', null)); }
    else if (Array.isArray(v)) v.forEach((x, i) => visit(x, `${p}[${i}]`));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) visit(x, p ? `${p}.${k}` : k);
  };
  visit(data, '');
  return out;
}

function fromGodotCsv(file, text) {
  // Godot translation CSV: keys,en,nl,...
  const out = [];
  const rows = text.split('\n').filter(Boolean).map(r => r.split(','));
  if (rows.length < 2 || rows[0][0]?.toLowerCase() !== 'keys') return out;
  const langs = rows[0].slice(1);
  for (const r of rows.slice(1)) langs.forEach((lang, i) => { const v = (r[i + 1] ?? '').replace(/^"|"$/g, ''); if (v && !skip(v)) out.push(entry(file, r[0], lang, v, 'godot-csv', null)); });
  return out;
}

const EXTRACTORS = [
  { test: f => /\.(tscn|tres)$/.test(f), fn: fromGodotScene },
  { test: f => f.endsWith('.gd'), fn: (f, t) => fromCode(f, t, 'gd') },
  { test: f => f.endsWith('.cs'), fn: (f, t) => fromCode(f, t, 'cs') },
  { test: f => /\.(js|ts|jsx|tsx|mjs|vue|svelte)$/.test(f) && !/\.(min|bundle)\./.test(f), fn: (f, t) => fromCode(f, t, 'js') },
  { test: f => /\.(unity|prefab|asset)$/.test(f), fn: fromUnityYaml },
  { test: f => /(^|\/)data\/(Map\d+|CommonEvents|Actors|Items|Weapons|Armors|Skills|Enemies|States|Classes|System)\.json$/.test(f), fn: fromRpgMaker },
  { test: f => f.endsWith('.rpy'), fn: fromRenpy },
  { test: f => /(^|\/)(i18n|locales?|lang|translations?)\/[^/]+\.json$/i.test(f), fn: fromJsonI18n },
  { test: f => f.endsWith('.csv'), fn: fromGodotCsv },
];

export async function extractStrings(root, { maxFiles = 50000, match } = {}) {
  const { files, truncated } = await walk(root, { maxFiles });
  const entries = [];
  const perKind = {};
  const seen = new Map();
  for (const f of files) {
    if (match && !f.rel.includes(match)) continue;
    const ex = EXTRACTORS.find(e => e.test(f.rel));
    if (!ex || f.size > 32 * 1024 * 1024) continue;
    const text = await fs.readFile(f.abs, 'utf8').catch(() => null);
    if (text === null) continue;
    for (const e of ex.fn(f.rel, text)) {
      entries.push(e);
      perKind[e.kind] = (perKind[e.kind] ?? 0) + 1;
      seen.set(e.text, (seen.get(e.text) ?? 0) + 1);
    }
  }
  const duplicates = [...seen.entries()].filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]).map(([text, n]) => ({ text, occurrences: n }));
  const words = entries.reduce((s, e) => s + e.text.split(/\s+/).filter(Boolean).length, 0);
  return { entries, perKind, duplicates, words, files: files.length, truncated };
}

export function toPo(entries, { lang = '', project = 'reverseport' } = {}) {
  const esc = s => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
  const header = `msgid ""\nmsgstr ""\n"Project-Id-Version: ${project}\\n"\n"Language: ${lang}\\n"\n"MIME-Version: 1.0\\n"\n"Content-Type: text/plain; charset=UTF-8\\n"\n"Content-Transfer-Encoding: 8bit\\n"\n"X-Generator: ReversePort re_strings\\n"\n`;
  const byText = new Map();
  for (const e of entries) (byText.get(e.text) ?? byText.set(e.text, []).get(e.text)).push(e);
  const blocks = [...byText.entries()].map(([text, es]) => {
    const refs = es.map(e => e.line ? `${e.file}:${e.line}` : e.file).join(' ');
    const ctx = es.map(e => `${e.where} ${e.prop}`).slice(0, 3).join('; ');
    return `#: ${refs}\n#. ${ctx}${es[0].placeholders.length ? `\n#, c-format` : ''}\nmsgid "${esc(text)}"\nmsgstr ""\n`;
  });
  return header + '\n' + blocks.join('\n');
}

export function toCsv(entries) {
  const q = s => `"${String(s).replace(/"/g, '""')}"`;
  return ['id,file,where,prop,kind,chars,source,translation', ...entries.map(e => [e.id, e.file, e.where, e.prop, e.kind, e.chars, e.text, ''].map(q).join(','))].join('\n') + '\n';
}

/** Parse translations from .po (msgid→msgstr), CSV (id or source → translation) or JSON ({id|source: translation}). */
export async function readTranslations(file) {
  const text = await fs.readFile(file, 'utf8');
  const map = new Map();
  if (file.endsWith('.po')) {
    const un = s => s.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    for (const m of text.matchAll(/msgid\s+"((?:[^"\\]|\\.)*)"((?:\s*\n\s*"(?:[^"\\]|\\.)*")*)\s*\nmsgstr\s+"((?:[^"\\]|\\.)*)"((?:\s*\n\s*"(?:[^"\\]|\\.)*")*)/g)) {
      const id = un(m[1] + m[2].replace(/\s*\n\s*"/g, '').replace(/"$/g, '').replace(/"(?=\n|$)/g, ''));
      const str = un(m[3] + m[4].replace(/\s*\n\s*"/g, '').replace(/"$/g, '').replace(/"(?=\n|$)/g, ''));
      if (id && str) map.set(id, str);
    }
  } else if (file.endsWith('.csv')) {
    const rows = parseCsv(text);
    const head = rows[0].map(h => h.toLowerCase());
    const iId = head.indexOf('id'), iSrc = head.indexOf('source'), iTr = head.indexOf('translation');
    if (iTr < 0) throw new RPError('INVALID_ARGUMENT', 'CSV needs a "translation" column (and "id" or "source").');
    for (const r of rows.slice(1)) { const t = r[iTr]; if (!t) continue; if (iId >= 0 && r[iId]) map.set(r[iId], t); if (iSrc >= 0 && r[iSrc]) map.set(r[iSrc], t); }
  } else {
    const data = JSON.parse(text);
    for (const [k, v] of Object.entries(data)) if (typeof v === 'string' && v) map.set(k, v);
  }
  return map;
}

function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.length > 1 || r[0]);
}

/** Write translations into a copy of the project at `out`. Returns what changed and what did not fit. */
export async function applyTranslations(root, translations, out, entries) {
  const { files } = await walk(root, { maxFiles: 200000 });
  const byFile = new Map();
  for (const e of entries) (byFile.get(e.file) ?? byFile.set(e.file, []).get(e.file)).push(e);
  let changed = 0, copied = 0;
  const problems = [];
  const applied = [];
  await fs.mkdir(out, { recursive: true });
  for (const f of files) {
    const dest = safeJoin(out, f.rel);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    const es = byFile.get(f.rel);
    if (!es) { await fs.copyFile(f.abs, dest); copied++; continue; }
    let text = await fs.readFile(f.abs, 'utf8');
    const lines = text.split('\n');
    let n = 0;
    for (const e of es) {
      const t = translations.get(e.id) ?? translations.get(e.text);
      if (!t || t === e.text) continue;
      const srcPh = e.placeholders.join(','), dstPh = [...t.matchAll(/%[sdif]|\{[^}]+\}|%\d+\$[sd]/g)].map(m => m[0]).join(',');
      if (srcPh !== dstPh) { problems.push({ id: e.id, problem: `placeholders differ: "${srcPh}" vs "${dstPh}"` }); continue; }
      if (t.length > Math.max(40, e.text.length * 2.5)) problems.push({ id: e.id, problem: `translation is ${t.length} chars for a ${e.text.length}-char source; check the layout` });
      if (e.line && e.kind !== 'rpgmaker-event') {
        const idx = e.line - 1;
        const esc = v => v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
        const before = lines[idx];
        const after = before.includes(`"${esc(e.text)}"`) ? before.replace(`"${esc(e.text)}"`, `"${esc(t)}"`) : before.replace(e.text, t);
        if (after === before) { problems.push({ id: e.id, problem: 'source text not found at its line (file changed since extraction?)' }); continue; }
        lines[idx] = after; n++;
      } else if (f.rel.endsWith('.json')) {
        // JSON-based (RPG Maker, i18n): replace the exact string value.
        const json = JSON.stringify(e.text).slice(1, -1), rep = JSON.stringify(t).slice(1, -1);
        const joined = lines.join('\n');
        if (!joined.includes(`"${json}"`)) { problems.push({ id: e.id, problem: 'source text not found' }); continue; }
        const replaced = joined.replace(`"${json}"`, `"${rep}"`);
        lines.length = 0; lines.push(...replaced.split('\n')); n++;
      } else problems.push({ id: e.id, problem: 'cannot write this kind back yet' });
      applied.push(e.id);
    }
    text = lines.join('\n');
    await fs.writeFile(dest, text);
    changed += n ? 1 : 0;
    if (!n) copied++;
  }
  return { out, filesChanged: changed, filesCopied: copied, applied: applied.length, problems };
}

export async function stringsTool({ path: target, action = 'extract', format = 'json', out, translations, lang, match, limit: max = 500 }) {
  const root = await requireDir(target, 'project folder');
  const result = await extractStrings(root, { match });
  if (action === 'extract') {
    const outDir = out ? path.resolve(out) : await workspaceDir('strings');
    const name = path.basename(root).replace(/[^A-Za-z0-9._-]+/g, '_') || 'project';
    const written = [];
    if (format === 'po' || format === 'all') { const f = path.join(outDir, `${name}.pot`); await fs.mkdir(outDir, { recursive: true }); await fs.writeFile(f, toPo(result.entries, { project: name })); written.push(f); }
    if (format === 'csv' || format === 'all') { const f = path.join(outDir, `${name}.csv`); await fs.mkdir(outDir, { recursive: true }); await fs.writeFile(f, toCsv(result.entries)); written.push(f); }
    const catalog = path.join(outDir, `${name}.strings.json`);
    await fs.mkdir(outDir, { recursive: true });
    await fs.writeFile(catalog, JSON.stringify({ project: toPosix(root), extracted: new Date().toISOString(), entries: result.entries }, null, 2));
    written.push(catalog);
    return {
      project: root, strings: result.entries.length, words: result.words, perKind: result.perKind, duplicates: limit(result.duplicates, 50), entries: limit(result.entries, max),
      written, truncated: result.truncated,
      next: `Translate ${written.find(w => w.endsWith('.pot')) ?? written.find(w => w.endsWith('.csv')) ?? catalog} (fill msgstr / the translation column, keep placeholders like %d and {name}), then re_strings action:"apply" with translations:<that file> and out:<new folder>. The catalog ${catalog} holds the ids.`,
    };
  }
  if (action === 'apply') {
    if (!translations) throw new RPError('INVALID_ARGUMENT', 'apply needs translations: a .po, .csv (id|source,translation) or .json file.');
    if (!out) throw new RPError('INVALID_ARGUMENT', 'apply needs out: a new or empty folder for the translated copy (the source is never modified).');
    const outAbs = path.resolve(out);
    if (outAbs === root || outAbs.startsWith(root + path.sep) || root.startsWith(outAbs + path.sep)) throw new RPError('INVALID_ARGUMENT', 'out must be outside the source project.');
    const existing = await fs.readdir(outAbs).catch(() => []);
    if (existing.length) throw new RPError('OUTPUT_NOT_EMPTY', `out is not empty: ${outAbs}`);
    const map = await readTranslations(path.resolve(translations));
    const r = await applyTranslations(root, map, outAbs, result.entries);
    return { ...r, lang: lang ?? null, strings: result.entries.length, translated: r.applied, untranslated: result.entries.length - r.applied, next: r.problems.length ? 'Fix the listed problems in the translation file and run apply again into an empty folder.' : `Open ${outAbs} in the engine and check layouts for long strings.` };
  }
  throw new RPError('INVALID_ARGUMENT', 'action must be extract or apply.');
}
