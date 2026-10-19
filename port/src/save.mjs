// re_save: what is in a save file, how is it protected, and what would a port need to keep?
// Layers are peeled only where the format is open (gzip/zlib, base64, LZ-String as RPG Maker uses it, JSON, XML,
// INI/ConfigFile, Godot store_var). Encrypted or obfuscated content is reported, never decoded (project rule).
// Checksums are recognised by recomputing them over the obvious payloads. With two saves of the same game the
// tool lists the fields that changed, which is how an agent finds "the gold" or "the position" without guessing.
// action:"schema" writes a JSON schema plus GDScript and C# data classes to port the save format with.
import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { RPError, requireFile, limit, entropy, isText, toPosix } from './util.mjs';
import { workspaceDir } from './workspace.mjs';
import { identify, strideGuess } from './formats.mjs';
import { extractStrings } from './binary.mjs';

// ------------------------------------------------------------------------------------------------ small codecs
const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
export function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

/** LZ-String decompressFromBase64 (RPG Maker MV/MZ .rpgsave). Port of the public-domain-licensed (WTFPL/MIT) algorithm, written from the spec. */
export function lzStringFromBase64(input) {
  const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
  const rev = new Map([...ALPHA].map((c, i) => [c, i]));
  const getNextValue = i => rev.get(input.charAt(i)) ?? 0;
  const length = input.length, resetValue = 32;
  const dictionary = [];
  let enlargeIn = 4, dictSize = 4, numBits = 3, entry = '', result = [], w, c;
  const data = { val: getNextValue(0), position: resetValue, index: 1 };
  const readBits = n => { let bits = 0, maxpower = 1 << n, power = 1; while (power !== maxpower) { const resb = data.val & data.position; data.position >>= 1; if (data.position === 0) { data.position = resetValue; data.val = getNextValue(data.index++); } bits |= (resb > 0 ? 1 : 0) * power; power <<= 1; } return bits; };
  for (let i = 0; i < 3; i++) dictionary[i] = i;
  switch (readBits(2)) {
    case 0: c = String.fromCharCode(readBits(8)); break;
    case 1: c = String.fromCharCode(readBits(16)); break;
    case 2: return '';
  }
  dictionary[3] = c; w = c; result.push(c);
  for (;;) {
    if (data.index > length) return '';
    let cc = readBits(numBits);
    switch (cc) {
      case 0: dictionary[dictSize++] = String.fromCharCode(readBits(8)); cc = dictSize - 1; enlargeIn--; break;
      case 1: dictionary[dictSize++] = String.fromCharCode(readBits(16)); cc = dictSize - 1; enlargeIn--; break;
      case 2: return result.join('');
    }
    if (enlargeIn === 0) { enlargeIn = 1 << numBits; numBits++; }
    if (dictionary[cc] !== undefined) entry = dictionary[cc];
    else if (cc === dictSize) entry = w + w.charAt(0);
    else return null;
    result.push(entry);
    dictionary[dictSize++] = w + entry.charAt(0);
    enlargeIn--;
    w = entry;
    if (enlargeIn === 0) { enlargeIn = 1 << numBits; numBits++; }
    if (result.length > 4e6) return null;
  }
}

/** Godot store_var / var_to_bytes: enough of the Variant binary encoding to read dictionaries of plain values. */
export function godotVariant(buf, off = 0, depth = 0) {
  if (depth > 32 || off + 4 > buf.length) return null;
  const type = buf.readUInt32LE(off) & 0xffff, flags = buf.readUInt32LE(off) >>> 16;
  let p = off + 4;
  const str = () => { const n = buf.readUInt32LE(p); const s = buf.toString('utf8', p + 4, p + 4 + n); p += 4 + ((n + 3) & ~3); return s; };
  const f = () => { if (flags & 1) { const v = buf.readDoubleLE(p); p += 8; return v; } const v = buf.readFloatLE(p); p += 4; return v; };
  switch (type) {
    case 0: return { value: null, end: p };
    case 1: { const v = buf.readUInt32LE(p) !== 0; return { value: v, end: p + 4 }; }
    case 2: { if (flags & 1) { const v = Number(buf.readBigInt64LE(p)); return { value: v, end: p + 8 }; } return { value: buf.readInt32LE(p), end: p + 4 }; }
    case 3: { const v = f(); return { value: v, end: p }; }
    case 4: { const v = str(); return { value: v, end: p }; }
    case 5: { const v = [f(), f()]; return { value: v, end: p }; }
    case 9: { const v = [f(), f(), f()]; return { value: v, end: p }; }
    case 20: { const v = [f(), f(), f(), f()]; return { value: v, end: p }; }
    case 22: { const v = str(); return { value: v, end: p }; }
    case 27: { const n = buf.readUInt32LE(p) & 0x7fffffff; p += 4; const out = {}; for (let i = 0; i < n; i++) { const k = godotVariant(buf, p, depth + 1); if (!k) return null; const v = godotVariant(buf, k.end, depth + 1); if (!v) return null; out[String(k.value)] = v.value; p = v.end; } return { value: out, end: p }; }
    case 28: { const n = buf.readUInt32LE(p) & 0x7fffffff; p += 4; const out = []; for (let i = 0; i < n; i++) { const v = godotVariant(buf, p, depth + 1); if (!v) return null; out.push(v.value); p = v.end; } return { value: out, end: p }; }
    case 30: case 32: { const n = buf.readUInt32LE(p); p += 4; const out = []; for (let i = 0; i < n; i++) { out.push(type === 30 ? buf.readInt32LE(p) : buf.readFloatLE(p)); p += 4; } return { value: out, end: p }; }
    case 34: { const n = buf.readUInt32LE(p); p += 4; const out = []; for (let i = 0; i < n; i++) out.push(str()); return { value: out, end: p }; }
    default: return null;
  }
}

// ------------------------------------------------------------------------------------------------ peeling layers
function tryJson(text) { try { const v = JSON.parse(text); return typeof v === 'object' && v !== null ? v : undefined; } catch { return undefined; } }

function parseIni(text) {
  const out = {}; let section = out;
  for (const raw of text.split(/\r?\n/)) {
    const l = raw.trim();
    if (!l || l.startsWith(';') || l.startsWith('#')) continue;
    const sec = l.match(/^\[(.+)\]$/);
    if (sec) { section = out[sec[1]] = {}; continue; }
    const kv = l.match(/^([^=]+?)\s*=\s*(.*)$/);
    if (!kv) continue;
    let v = kv[2];
    const j = tryJson(v); if (j !== undefined) v = j; else if (/^-?\d+(\.\d+)?$/.test(v)) v = Number(v); else if (v === 'true' || v === 'false') v = v === 'true'; else v = v.replace(/^"(.*)"$/, '$1');
    section[kv[1]] = v;
  }
  return out;
}

function parseXml(text) {
  // Shallow: elements become keys, attributes and text become values. Enough to list fields.
  const out = {};
  for (const m of text.matchAll(/<([A-Za-z_][\w.-]*)((?:\s+[\w:.-]+="[^"]*")*)\s*(?:\/>|>([^<]*)<\/\1>)/g)) {
    const node = {};
    for (const a of m[2].matchAll(/([\w:.-]+)="([^"]*)"/g)) node[a[1]] = /^-?\d+(\.\d+)?$/.test(a[2]) ? Number(a[2]) : a[2];
    const txt = m[3]?.trim();
    const val = Object.keys(node).length ? (txt ? { ...node, _text: txt } : node) : (txt && /^-?\d+(\.\d+)?$/.test(txt) ? Number(txt) : txt ?? '');
    if (out[m[1]] === undefined) out[m[1]] = val; else if (Array.isArray(out[m[1]])) out[m[1]].push(val); else out[m[1]] = [out[m[1]], val];
  }
  return Object.keys(out).length ? out : undefined;
}

const XOR_NOTE = 'looks like single-byte XOR obfuscation (one byte dominates where JSON/text would have spaces, and the text has no structure). Reported, not decoded.';
/** Single-byte XOR leaves the shape of text (one dominant byte = key ^ space) but no readable structure. */
function looksXored(bytes) {
  const n = Math.min(bytes.length, 65536);
  if (n < 64) return false;
  const hist = new Uint32Array(256); for (let i = 0; i < n; i++) hist[bytes[i]]++;
  let topB = 0; for (let b = 1; b < 256; b++) if (hist[b] > hist[topB]) topB = b;
  if (topB === 0x20 || topB === 0x0a || topB === 0 || hist[topB] < n * 0.08) return false;
  const key = topB ^ 0x20;
  let printable = 0; for (let i = 0; i < n; i++) { const c = bytes[i] ^ key; if ((c >= 0x20 && c < 0x7f) || c === 0x0a || c === 0x0d || c === 0x09) printable++; }
  return printable > n * 0.97;
}

/** Peel container layers; returns { layers, data?, text?, bytes, stop } where stop explains why decoding ended. */
export function peel(buf, name = '') {
  const layers = [];
  let bytes = buf, text = null, data, stop = null;
  for (let round = 0; round < 6; round++) {
    const head = bytes.subarray(0, 4096);
    const kind = identify(head);
    if (kind.id === 'gzip' || (bytes[0] === 0x78 && [0x01, 0x5e, 0x9c, 0xda].includes(bytes[1]))) {
      try { bytes = kind.id === 'gzip' ? zlib.gunzipSync(bytes) : zlib.inflateSync(bytes); layers.push(kind.id === 'gzip' ? 'gzip' : 'zlib'); continue; } catch { stop = 'compressed data did not inflate'; break; }
    }
    if (kind.id === 'zip') { layers.push('zip'); stop = 'zip container: use re_archive to list and extract the entries, then re_save on each'; break; }
    if (!isText(head)) {
      const gv = (() => { try { return godotVariant(bytes, 0); } catch { return null; } })();
      if (gv && gv.end === bytes.length && typeof gv.value === 'object') { layers.push('godot-store_var'); data = gv.value; break; }
      if (bytes.length > 8 && bytes.readUInt32LE(0) + 4 === bytes.length) { const inner = (() => { try { return godotVariant(bytes, 4); } catch { return null; } })(); if (inner && inner.end === bytes.length && typeof inner.value === 'object') { layers.push('godot-store_var (length-prefixed)'); data = inner.value; break; } }
      if (bytes[0] === 0 && bytes[1] === 1 && bytes[2] === 0 && bytes[3] === 0 && bytes[4] === 0 && bytes[5] === 0xff) { layers.push('dotnet-binaryformatter'); stop = '.NET BinaryFormatter stream: the class names and field names are readable in strings; values follow the class layout. Unity games using BinaryFormatter: port by re-serializing from the game, not by parsing.'; break; }
      if (bytes[0] === 0x80 && bytes[1] <= 5 && /\.(save|pickle|pkl|dat)$/i.test(name)) { layers.push('python-pickle'); stop = 'Python pickle (Ren\'Py saves keep one in the zip entry "log"): field names are readable in strings; load it with Python to migrate.'; break; }
      const e = entropy(bytes.subarray(0, Math.min(bytes.length, 65536)));
      if (e > 7.5) { layers.push('encrypted-or-compressed'); stop = `high entropy (${e.toFixed(2)} bits/byte) without a known header: encrypted or an unknown compression. Reported, not decoded.`; break; }
      if (looksXored(bytes)) { layers.push('possibly-xor-obfuscated'); stop = XOR_NOTE; break; }
      stop = 'binary layout without a known header: see strides and strings below';
      break;
    }
    text = bytes.toString('utf8').replace(/^﻿/, '');
    const trimmed = text.trim();
    if (/^[A-Za-z0-9+/=\r\n]+$/.test(trimmed) && trimmed.length >= 16 && !/^\d+$/.test(trimmed)) {
      const dec = trimmed.replace(/\s+/g, '').length % 4 === 0 ? Buffer.from(trimmed.replace(/\s+/g, ''), 'base64') : Buffer.alloc(0);
      if (dec.length > 0) {
        if (isText(dec.subarray(0, 512)) && (tryJson(dec.toString('utf8')) !== undefined || /^[\[{<]/.test(dec.toString('utf8', 0, 1)))) { layers.push('base64'); bytes = dec; continue; }
        if (dec[0] === 0x1f && dec[1] === 0x8b || dec[0] === 0x78) { layers.push('base64'); bytes = dec; continue; }
      }
      const lzText = (() => { try { return lzStringFromBase64(trimmed.replace(/\s+/g, '')); } catch { return null; } })();
      if (lzText && tryJson(lzText) !== undefined) { layers.push('lz-string'); bytes = Buffer.from(lzText, 'utf8'); continue; }
    }
    const j = tryJson(trimmed);
    if (j !== undefined) { layers.push('json'); data = j; break; }
    if (/^\s*<\?xml|^\s*<[A-Za-z]/.test(trimmed)) { const x = parseXml(trimmed); if (x) { layers.push('xml'); data = x; break; } }
    if (/^\s*\[[^\]]+\]\s*$/m.test(trimmed) && /^[^=\n]+=/m.test(trimmed)) { layers.push('ini'); data = parseIni(trimmed); break; }
    if (/^[^=\n]+=[^\n]*$/m.test(trimmed) && trimmed.split('\n').filter(l => l.includes('=')).length >= 2) { layers.push('key=value'); data = parseIni(trimmed); break; }
    if (looksXored(bytes)) { layers.push('possibly-xor-obfuscated'); stop = XOR_NOTE; break; }
    stop = 'text without a recognised structure';
    break;
  }
  return { layers, data, text, bytes, stop };
}

// ------------------------------------------------------------------------------------------------ fields
const ROLE_RULES = [
  [/(^|[._])(hp|health|lives?|hearts?)$/i, 'health'], [/(gold|coins?|money|cash|currency|gems?|credits?)$/i, 'currency'], [/(score|points|high ?score|best)$/i, 'score'],
  [/(^|[._])(x|y|z|pos|position|location|coords?)$/i, 'position'], [/(level|stage|chapter|area|map|scene|room|world)$/i, 'progress'], [/(inventory|items|bag|equipment|weapons?|unlock(ed|s)?|achievements?|flags?|quests?)$/i, 'collection'],
  [/(time|timestamp|date|played|playtime|saved_?at|created)$/i, 'time'], [/(version|format|schema|build)$/i, 'version'], [/(name|player|profile|slot)$/i, 'identity'], [/(checksum|hash|crc|signature|digest|hmac|sig)$/i, 'integrity'],
  [/(seed|rng|random)$/i, 'rng'], [/(settings?|options?|volume|resolution|fullscreen|language|locale)$/i, 'settings'],
];
function roleOf(key) { for (const [re, role] of ROLE_RULES) if (re.test(key)) return role; return null; }

export function flatten(value, prefix = '', out = [], depth = 0) {
  if (depth > 12 || out.length > 5000) return out;
  if (Array.isArray(value)) {
    out.push({ path: prefix || '$', type: 'array', length: value.length, ...(value.length && typeof value[0] !== 'object' ? { sample: value.slice(0, 5) } : {}) });
    if (value.length && typeof value[0] === 'object' && value[0] !== null) flatten(value[0], `${prefix}[0]`, out, depth + 1);
    return out;
  }
  if (value && typeof value === 'object') { for (const [k, v] of Object.entries(value)) flatten(v, prefix ? `${prefix}.${k}` : k, out, depth + 1); return out; }
  const t = value === null ? 'null' : typeof value;
  const entry = { path: prefix || '$', type: t };
  if (t === 'string') { entry.sample = value.length > 60 ? value.slice(0, 57) + '…' : value; if (/^[A-Za-z0-9+/=]{24,}$/.test(value)) entry.looksLike = 'base64'; else if (/^[0-9a-f]{32}$/i.test(value)) entry.looksLike = 'md5/hex128'; else if (/^[0-9a-f]{40}$/i.test(value)) entry.looksLike = 'sha1'; else if (/^[0-9a-f]{64}$/i.test(value)) entry.looksLike = 'sha256'; else if (/^\d{4}-\d{2}-\d{2}T/.test(value)) entry.looksLike = 'iso-date'; }
  else if (t === 'number') { entry.sample = value; if (value > 1e9 && value < 2e9 && Number.isInteger(value)) entry.looksLike = 'unix-seconds'; else if (value > 1e12 && value < 2e12) entry.looksLike = 'unix-millis'; else if (value > 6e17 && value < 7e17) entry.looksLike = 'dotnet-ticks'; }
  else entry.sample = value;
  const role = roleOf(prefix.split(/[.[]/).filter(Boolean).at(-1) ?? '');
  if (role) entry.role = role;
  out.push(entry);
  return out;
}

/** Recognise checksums: a field that equals a hash of the payload with that field removed (or of other fields). */
export function findChecksums(data, text, bytes) {
  const out = [];
  const integrity = flatten(data).filter(f => f.role === 'integrity' && (f.type === 'string' || f.type === 'number'));
  const hashes = payload => ({ md5: crypto.createHash('md5').update(payload).digest('hex'), sha1: crypto.createHash('sha1').update(payload).digest('hex'), sha256: crypto.createHash('sha256').update(payload).digest('hex'), crc32: crc32(Buffer.from(payload)) });
  const without = (obj, pathStr) => { const copy = JSON.parse(JSON.stringify(obj)); const parts = pathStr.split('.'); let o = copy; for (const p of parts.slice(0, -1)) o = o?.[p]; if (o) delete o[parts.at(-1)]; return copy; };
  for (const f of integrity) {
    const rest = without(data, f.path);
    const candidates = [['json-compact', JSON.stringify(rest)], ['json-pretty-2', JSON.stringify(rest, null, 2)], ['json-pretty-4', JSON.stringify(rest, null, 4)]];
    if (rest && typeof rest === 'object' && !Array.isArray(rest)) candidates.push(['values-concat', Object.values(rest).filter(v => typeof v !== 'object').join('')], ['values-concat-|', Object.values(rest).filter(v => typeof v !== 'object').join('|')]);
    const sample = String(f.sample);
    let matched = null;
    for (const [how, payload] of candidates) {
      const h = hashes(payload);
      for (const [algo, val] of Object.entries(h)) if (String(val).toLowerCase() === sample.toLowerCase() || (algo === 'crc32' && (val === Number(sample) || val.toString(16) === sample.toLowerCase()))) matched = { algo, over: how };
      if (matched) break;
    }
    out.push({ field: f.path, value: f.sample, ...(matched ? { verified: true, ...matched, how: `${matched.algo} of the ${matched.over} serialisation of the save without this field` } : { verified: false, note: 'no plain hash of the rest of the file matched; it may use a secret (HMAC), a different serialisation or cover only some fields. Change one field and compare two saves to see whether the game rejects it.' }) });
  }
  if (bytes && bytes.length > 8 && !text) {
    const body = bytes.subarray(0, bytes.length - 4), tail = bytes.readUInt32LE(bytes.length - 4);
    if (crc32(body) === tail) out.push({ field: 'last 4 bytes', verified: true, algo: 'crc32', over: 'all bytes before it', how: 'CRC32 (LE) of everything before the trailer' });
    const headV = bytes.readUInt32LE(0);
    if (crc32(bytes.subarray(4)) === headV) out.push({ field: 'first 4 bytes', verified: true, algo: 'crc32', over: 'all bytes after it', how: 'CRC32 (LE) of everything after the header word' });
  }
  return out;
}

function diffData(a, b, prefix = '', out = []) {
  if (out.length > 2000) return out;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) out.push({ path: prefix || '$', before: `array[${a.length}]`, after: `array[${b.length}]` });
    for (let i = 0; i < Math.min(a.length, b.length, 200); i++) diffData(a[i], b[i], `${prefix}[${i}]`, out);
    return out;
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const p = prefix ? `${prefix}.${k}` : k;
      if (!(k in a)) out.push({ path: p, before: undefined, after: b[k] }); else if (!(k in b)) out.push({ path: p, before: a[k], after: undefined }); else diffData(a[k], b[k], p, out);
    }
    return out;
  }
  if (a !== b) out.push({ path: prefix || '$', before: a, after: b });
  return out;
}

// ------------------------------------------------------------------------------------------------ schema + classes
function schemaOf(value) {
  if (Array.isArray(value)) return { type: 'array', items: value.length ? schemaOf(value[0]) : {} };
  if (value && typeof value === 'object') { const props = {}; for (const [k, v] of Object.entries(value)) props[k] = schemaOf(v); return { type: 'object', properties: props, required: Object.keys(props) }; }
  if (value === null) return { type: 'null' };
  if (typeof value === 'number') return { type: Number.isInteger(value) ? 'integer' : 'number' };
  return { type: typeof value };
}
const gdType = s => s.type === 'integer' ? 'int' : s.type === 'number' ? 'float' : s.type === 'boolean' ? 'bool' : s.type === 'string' ? 'String' : s.type === 'array' ? `Array[${gdType(s.items ?? {})}]`.replace('Array[Variant]', 'Array') : s.type === 'object' ? 'Dictionary' : 'Variant';
const csType = s => s.type === 'integer' ? 'long' : s.type === 'number' ? 'double' : s.type === 'boolean' ? 'bool' : s.type === 'string' ? 'string' : s.type === 'array' ? `List<${csType(s.items ?? {})}>` : s.type === 'object' ? 'Dictionary<string, object>' : 'object';
const ident = k => k.replace(/[^A-Za-z0-9_]/g, '_').replace(/^(\d)/, '_$1');
function gdClass(schema, name = 'SaveData') {
  const lines = [`class_name ${name}`, 'extends RefCounted', '# Generated by ReversePort re_save from an existing save file. Field names kept so old saves still load.', ''];
  for (const [k, s] of Object.entries(schema.properties ?? {})) lines.push(`var ${ident(k)}: ${gdType(s)}`);
  lines.push('', 'func to_dict() -> Dictionary:', '\treturn {', ...Object.keys(schema.properties ?? {}).map(k => `\t\t"${k}": ${ident(k)},`), '\t}', '', 'static func from_dict(d: Dictionary) -> ' + name + ':', `\tvar s := ${name}.new()`);
  for (const [k, s] of Object.entries(schema.properties ?? {})) lines.push(`\tif d.has("${k}"): s.${ident(k)} = d["${k}"]`);
  lines.push('\treturn s', '', '# Save: FileAccess.open(path, FileAccess.WRITE).store_string(JSON.stringify(data.to_dict()))', '# Load: from_dict(JSON.parse_string(FileAccess.get_file_as_string(path)))', '');
  return lines.join('\n');
}
function csClass(schema, name = 'SaveData') {
  const lines = ['using System;', 'using System.Collections.Generic;', '', '// Generated by ReversePort re_save from an existing save file. Field names kept so old saves still load.', '[Serializable]', `public class ${name}`, '{'];
  for (const [k, s] of Object.entries(schema.properties ?? {})) lines.push(`    public ${csType(s)} ${ident(k)};`);
  lines.push('}', '', '// Unity: JsonUtility.ToJson(data) / JsonUtility.FromJson<' + name + '>(text) handle flat fields and lists of primitives;', '// nested dictionaries need a JSON library (e.g. Newtonsoft) or explicit classes.', '');
  return lines.join('\n');
}

// ------------------------------------------------------------------------------------------------ tool
export async function saveTool({ file, compare, action = 'inspect', out, limit: max = 400 } = {}) {
  if (!file) throw new RPError('INVALID_ARGUMENT', 'file is required: a save file.');
  const { abs, size } = await requireFile(file);
  if (size > 64 * 1024 * 1024) throw new RPError('TOO_LARGE', 'save files over 64 MB are not read whole; use re_probe.');
  const buf = await fs.readFile(abs);
  const peeled = peel(buf, path.basename(abs));
  const result = { file: abs, size, container: peeled.layers.length ? peeled.layers.join(' → ') : identify(buf.subarray(0, 4096)).name, layers: peeled.layers };
  if (peeled.stop) result.stopped = peeled.stop;
  if (peeled.data !== undefined) {
    const fields = flatten(peeled.data);
    const roles = {};
    for (const f of fields) if (f.role) (roles[f.role] ??= []).push(f.path);
    result.fields = limit(fields, max);
    result.roles = roles;
    result.checksums = findChecksums(peeled.data, peeled.text, null);
    const versions = fields.filter(f => f.role === 'version').map(f => `${f.path}=${f.sample}`);
    if (versions.length) result.version = versions;
  } else {
    const inner = peeled.bytes;
    result.checksums = findChecksums({}, null, inner);
    result.strides = strideGuess(inner.subarray(0, 65536));
    result.strings = extractStrings(inner, { min: 4, max: 100 });
    result.entropy = Math.round(entropy(inner.subarray(0, Math.min(inner.length, 65536))) * 100) / 100;
  }
  if (compare) {
    const other = await requireFile(compare);
    const ob = await fs.readFile(other.abs);
    const op = peel(ob, path.basename(other.abs));
    if (peeled.data !== undefined && op.data !== undefined) {
      const changes = diffData(peeled.data, op.data);
      result.compare = { file: other.abs, changed: limit(changes, max), hint: changes.length ? 'The fields that changed between the two saves are the ones the action between them touched. Integrity fields that changed too confirm a checksum covers them.' : 'No field differs.' };
    } else {
      const n = Math.min(buf.length, ob.length); const diffs = []; for (let i = 0; i < n && diffs.length < 200; i++) if (buf[i] !== ob[i]) diffs.push(i);
      result.compare = { file: other.abs, sizeDelta: ob.length - buf.length, firstDifferences: diffs.slice(0, 50), hint: 'Byte offsets that differ; group them by the strides above to find the record and field.' };
    }
  }
  if (action === 'schema') {
    if (peeled.data === undefined) throw new RPError('INVALID_ARGUMENT', 'schema needs a decodable save (JSON, XML, INI, Godot store_var, or those inside gzip/base64/LZ-String).');
    const schema = { $schema: 'https://json-schema.org/draft/2020-12/schema', title: path.basename(abs), ...schemaOf(peeled.data) };
    const dir = out ? path.resolve(out) : await workspaceDir('saves');
    await fs.mkdir(dir, { recursive: true });
    const base = path.basename(abs).replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9._-]+/g, '_') || 'save';
    const written = [];
    for (const [name, content] of [[`${base}.schema.json`, JSON.stringify(schema, null, 2)], ['SaveData.gd', gdClass(schema)], ['SaveData.cs', csClass(schema)]]) { const p = path.join(dir, name); await fs.writeFile(p, content); written.push(p); }
    result.written = written;
    result.layersToReproduce = peeled.layers;
  }
  result.next = peeled.data !== undefined
    ? `Fields with roles tell you what the save tracks; compare two saves (compare:<file>) to confirm which field is which. ${result.checksums?.some(c => c.verified) ? 'A checksum was verified: regenerate it the same way after editing. ' : ''}action:"schema" writes a JSON schema and SaveData.gd/.cs to port the format; keep the layer order (${peeled.layers.join(' → ')}) if old saves must keep loading.`
    : 'The structure is not decodable here. Use the strides and strings to map records, compare two saves to find the bytes that change, and re_binary on the game to find the code that writes this file.';
  return result;
}
