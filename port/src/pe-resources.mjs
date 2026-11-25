// PE resources (.rsrc): the resource directory tree, version info (VS_VERSIONINFO), the application manifest,
// icon groups (sizes only, no pixel data) and string tables. Read-only; nothing is extracted or decoded further.

const RT = {
  1: 'RT_CURSOR', 2: 'RT_BITMAP', 3: 'RT_ICON', 4: 'RT_MENU', 5: 'RT_DIALOG', 6: 'RT_STRING', 7: 'RT_FONTDIR', 8: 'RT_FONT',
  9: 'RT_ACCELERATOR', 10: 'RT_RCDATA', 11: 'RT_MESSAGETABLE', 12: 'RT_GROUP_CURSOR', 14: 'RT_GROUP_ICON', 16: 'RT_VERSION',
  17: 'RT_DLGINCLUDE', 19: 'RT_PLUGPLAY', 20: 'RT_VXD', 21: 'RT_ANICURSOR', 22: 'RT_ANIICON', 23: 'RT_HTML', 24: 'RT_MANIFEST',
};
const MAX_ENTRIES = 20000;
const MANIFEST_TEXT_MAX = 4000;
const FILE_TYPES = { 1: 'application', 2: 'dll', 3: 'driver', 4: 'font', 5: 'vxd', 7: 'static library' };
const align4 = n => (n + 3) & ~3;

/** Walk the three levels (type, name, language) and return every data entry with its file offset. */
function walkTree(buf, base, size, rvaToOff, warnings) {
  const end = Math.min(buf.length, base + size);
  const entries = [];
  const seen = new Set();
  const label = v => {
    if (!(v & 0x80000000)) return v;
    const o = base + (v & 0x7fffffff);
    if (o + 2 > end) return '?';
    const len = buf.readUInt16LE(o);
    return buf.toString('utf16le', o + 2, Math.min(end, o + 2 + len * 2));
  };
  const dir = (off, path) => {
    const o = base + off;
    if (seen.has(off) || path.length > 3) return; // a loop, or deeper than type / name / language
    if (o + 16 > end) { warnings.push('resource directory points outside the resource section'); return; }
    seen.add(off);
    const n = buf.readUInt16LE(o + 12) + buf.readUInt16LE(o + 14);
    for (let i = 0; i < n && entries.length < MAX_ENTRIES; i++) {
      const e = o + 16 + i * 8;
      if (e + 8 > end) { warnings.push('resource directory is cut off'); return; }
      const name = label(buf.readUInt32LE(e)), target = buf.readUInt32LE(e + 4);
      if (target & 0x80000000) dir(target & 0x7fffffff, [...path, name]);
      else {
        const d = base + target;
        if (d + 16 > end) { warnings.push('resource data entry outside the resource section'); continue; }
        const [type, id, lang] = [...path, name];
        entries.push({ type, name: id ?? null, lang: lang ?? null, offset: rvaToOff(buf.readUInt32LE(d)), size: buf.readUInt32LE(d + 4), codePage: buf.readUInt32LE(d + 8) });
      }
    }
  };
  dir(0, []);
  return entries;
}

const dataOf = (buf, e) => (e.offset >= 0 && e.offset < buf.length ? buf.subarray(e.offset, Math.min(buf.length, e.offset + e.size)) : null);

/** One VS_VERSIONINFO node: wLength, wValueLength, wType, UTF-16 key, padding, value, padding, children. */
function versionNode(d, off, limit) {
  if (off + 6 > limit) return null;
  const length = d.readUInt16LE(off), valueLength = d.readUInt16LE(off + 2), type = d.readUInt16LE(off + 4);
  const end = Math.min(limit, off + length);
  if (length < 6 || end > d.length) return null;
  let k = off + 6;
  while (k + 1 < end && d.readUInt16LE(k) !== 0) k += 2;
  return { key: d.toString('utf16le', off + 6, k), type, valueLength, value: align4(k + 2), end };
}
function versionChildren(d, from, end) {
  const out = [];
  for (let o = align4(from); o + 6 <= end && out.length < 4096;) {
    const n = versionNode(d, o, end);
    if (!n) break;
    out.push(n);
    o = align4(n.end);
  }
  return out;
}
const utf16z = (d, from, end) => { let k = from; while (k + 1 < end && d.readUInt16LE(k) !== 0) k += 2; return d.toString('utf16le', from, k); };

export function parseVersionInfo(d) {
  const root = versionNode(d, 0, d.length);
  if (!root || root.key !== 'VS_VERSION_INFO') return null;
  const out = {};
  const v = root.value;
  if (root.valueLength >= 52 && v + 52 <= d.length && d.readUInt32LE(v) === 0xfeef04bd) {
    const quad = o => `${d.readUInt16LE(o + 2)}.${d.readUInt16LE(o)}.${d.readUInt16LE(o + 6)}.${d.readUInt16LE(o + 4)}`;
    out.fileVersion = quad(v + 8);
    out.productVersion = quad(v + 16);
    const flags = d.readUInt32LE(v + 28) & d.readUInt32LE(v + 24);
    const names = [[1, 'debug'], [2, 'prerelease'], [4, 'patched'], [8, 'private build'], [0x20, 'special build']].filter(([bit]) => flags & bit).map(([, n]) => n);
    if (names.length) out.flags = names;
    const ft = d.readUInt32LE(v + 36);
    if (FILE_TYPES[ft]) out.fileType = FILE_TYPES[ft];
  }
  out.strings = {};
  for (const child of versionChildren(d, root.value + root.valueLength, root.end)) {
    if (child.key === 'StringFileInfo') {
      for (const table of versionChildren(d, child.value, child.end)) {
        out.stringTable ??= table.key; // language + code page as 8 hex digits, e.g. 040904B0
        for (const s of versionChildren(d, table.value, table.end)) {
          if (s.key && out.strings[s.key] === undefined) out.strings[s.key] = utf16z(d, s.value, s.end).trim();
        }
      }
    } else if (child.key === 'VarFileInfo') {
      for (const va of versionChildren(d, child.value, child.end)) {
        if (va.key !== 'Translation') continue;
        out.translations = [];
        for (let o = va.value; o + 4 <= va.end && out.translations.length < 32; o += 4) out.translations.push({ language: d.readUInt16LE(o), codePage: d.readUInt16LE(o + 2) });
      }
    }
  }
  return out;
}

/** The manifest is small XML; pick the facts people ask for and keep the text. */
export function parseManifest(d) {
  let text = d[0] === 0xff && d[1] === 0xfe ? d.toString('utf16le', 2) : d.toString('utf8');
  text = text.replace(/^﻿/, '').replace(/\0+$/, '');
  const out = {};
  const attr = (tag, name) => new RegExp(`<(?:\\w+:)?${tag}\\b[^>]*?\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i').exec(text)?.[1];
  const element = tag => new RegExp(`<(?:\\w+:)?${tag}\\b[^>]*>\\s*([^<]*?)\\s*</`, 'i').exec(text)?.[1];
  const level = attr('requestedExecutionLevel', 'level');
  if (level) { out.requestedExecutionLevel = level; const ui = attr('requestedExecutionLevel', 'uiAccess'); if (ui) out.uiAccess = ui; }
  for (const tag of ['dpiAware', 'dpiAwareness', 'longPathAware', 'activeCodePage']) { const v = element(tag); if (v) out[tag] = v; }
  const identity = /<(?:\w+:)?assemblyIdentity\b([^>]*)>/i.exec(text.replace(/<(?:\w+:)?dependency\b[\s\S]*?<\/(?:\w+:)?dependency>/gi, ''));
  const attrs = s => Object.fromEntries([...s.matchAll(/([\w:.-]+)\s*=\s*["']([^"']*)["']/g)].map(m => [m[1], m[2]]));
  if (identity) { const a = attrs(identity[1]); out.identity = { name: a.name, version: a.version, ...(a.processorArchitecture ? { processorArchitecture: a.processorArchitecture } : {}) }; }
  const deps = [];
  for (const dep of text.matchAll(/<(?:\w+:)?dependency\b[\s\S]*?<\/(?:\w+:)?dependency>/gi)) {
    for (const id of dep[0].matchAll(/<(?:\w+:)?assemblyIdentity\b([^>]*)>/gi)) { const a = attrs(id[1]); deps.push({ name: a.name, version: a.version }); }
  }
  if (deps.length) out.dependencies = deps.slice(0, 32);
  const os = [...text.matchAll(/<(?:\w+:)?supportedOS\b[^>]*\bId\s*=\s*["']\{([0-9a-f-]+)\}["']/gi)].length;
  if (os) out.supportedOSCount = os;
  out.text = text.length > MANIFEST_TEXT_MAX ? text.slice(0, MANIFEST_TEXT_MAX) : text;
  if (text.length > MANIFEST_TEXT_MAX) out.textTruncated = text.length;
  return out;
}

function parseGroupIcon(d) {
  if (d.length < 6 || d.readUInt16LE(2) !== 1) return null;
  const n = Math.min(d.readUInt16LE(4), Math.floor((d.length - 6) / 14));
  const images = [];
  for (let i = 0; i < n; i++) {
    const o = 6 + i * 14;
    images.push({ width: d[o] || 256, height: d[o + 1] || 256, bitCount: d.readUInt16LE(o + 6), bytes: d.readUInt32LE(o + 8), id: d.readUInt16LE(o + 12) });
  }
  return images;
}

/** An RT_STRING block holds 16 strings; block n holds ids (n-1)*16 … (n-1)*16+15. */
function parseStringBlock(d, block, lang, out, max) {
  let o = 0, count = 0;
  for (let i = 0; i < 16 && o + 2 <= d.length; i++) {
    const len = d.readUInt16LE(o);
    o += 2;
    if (!len) continue;
    if (o + len * 2 > d.length) break;
    count++;
    if (out.length < max) { const text = d.toString('utf16le', o, o + len * 2); out.push({ id: (block - 1) * 16 + i, lang, text: text.length > 300 ? text.slice(0, 300) + '…' : text }); }
    o += len * 2;
  }
  return count;
}

/**
 * @param {Buffer} buf the file
 * @param {(rva: number) => number} rvaToOff
 * @param {{rva: number, size: number}} dir data directory 2
 * @param {{strings?: boolean, limit?: number}} [options]
 */
export function parsePeResources(buf, rvaToOff, dir, { strings = false, limit } = {}) {
  const base = rvaToOff(dir.rva);
  if (base < 0 || base + 16 > buf.length) return { warnings: ['resource directory is outside the read range'] };
  const lim = Math.max(1, Math.min(5000, limit ?? 50));
  const nameCap = limit ? lim : 8;
  const warnings = [];
  const entries = walkTree(buf, base, dir.size || buf.length - base, rvaToOff, warnings);
  const byType = new Map();
  for (const e of entries) {
    const key = typeof e.type === 'number' ? RT[e.type] ?? `type ${e.type}` : `"${e.type}"`;
    const t = byType.get(key) ?? { type: key, count: 0, bytes: 0, names: [] };
    t.count++; t.bytes += e.size;
    if (!t.names.includes(e.name)) t.names.push(e.name);
    byType.set(key, t);
  }
  const types = [...byType.values()].map(t => {
    const more = t.names.length - nameCap;
    return { type: t.type, count: t.count, bytes: t.bytes, names: t.names.slice(0, nameCap), ...(more > 0 ? { more } : {}) };
  });
  const out = { count: entries.length, types };
  const first = type => entries.filter(e => e.type === type);

  for (const e of first(16)) {
    const d = dataOf(buf, e);
    try { const v = d && parseVersionInfo(d); if (v) { out.version = v; break; } } catch { warnings.push('version resource is damaged'); }
  }
  for (const e of first(24)) {
    const d = dataOf(buf, e);
    if (!d?.length) continue;
    out.manifest = { resourceId: e.name, ...parseManifest(d) };
    break;
  }
  const groups = [];
  for (const e of first(14)) {
    const d = dataOf(buf, e);
    const images = d && parseGroupIcon(d);
    if (images) groups.push({ group: e.name, images });
  }
  if (groups.length) {
    out.icons = groups.slice(0, lim).map(g => ({ group: g.group, count: g.images.length, images: g.images.slice(0, 16).map(({ id, ...rest }) => rest) }));
    if (groups.length > lim) out.iconsMore = groups.length - lim;
  }
  const blocks = first(6);
  if (blocks.length) {
    const items = [];
    let count = 0;
    for (const e of blocks) {
      const d = dataOf(buf, e);
      if (d && typeof e.name === 'number') count += parseStringBlock(d, e.name, e.lang, items, strings ? lim : 0);
    }
    out.stringTables = { blocks: blocks.length, strings: count };
    if (strings) { out.stringTables.items = items; if (count > items.length) out.stringTables.more = count - items.length; }
    else if (count) out.stringTables.next = 'resources: {strings: true, limit: 200} lists them';
  }
  if (warnings.length) out.warnings = [...new Set(warnings)];
  // For detection rules: every (type, name) pair, not capped. Not enumerable, so it stays out of the JSON result.
  Object.defineProperty(out, 'entries', { value: entries, enumerable: false });
  return out;
}
