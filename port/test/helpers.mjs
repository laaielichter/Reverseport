// Test helpers: build small but real binary fixtures in memory (Godot packs v1/v2/v3, embedded packs,
// a .NET assembly, IL2CPP metadata, ZIP, asar) so the tests need no downloads and no external tools.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';

export async function tempDir(prefix = 'rp-test-') { return fs.mkdtemp(path.join(os.tmpdir(), prefix)); }

const u32 = n => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
const u64 = n => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };

/** Godot pack. version 1 (Godot 3), 2 (Godot 4.0–4.3), 3 (Godot 4.4+: directory at dir_offset). */
export function buildPck(files, { version = 2, godot = [4, 3, 0], stripRes = false } = {}) {
  const entries = Object.entries(files).map(([p, content]) => ({ path: p, data: Buffer.from(content) }));
  const header = [Buffer.from('GDPC'), u32(version), u32(godot[0]), u32(godot[1]), u32(godot[2])];
  const dirEntry = (e, ofs) => {
    const raw = Buffer.from(stripRes ? e.path.replace(/^res:\/\//, '') : e.path);
    const pad = (4 - (raw.length % 4)) % 4;
    const parts = [u32(raw.length + pad), raw, Buffer.alloc(pad), u64(ofs), u64(e.data.length), crypto.createHash('md5').update(e.data).digest()];
    if (version >= 2) parts.push(u32(0));
    return Buffer.concat(parts);
  };
  if (version === 3) {
    // header | file data | directory
    const headerLen = 4 * 5 + 4 + 8 + 8 + 64;
    let ofs = 0;
    const offsets = entries.map(e => { const o = ofs; ofs += e.data.length; return o; });
    const data = Buffer.concat(entries.map(e => e.data));
    const dir = Buffer.concat([u32(entries.length), ...entries.map((e, i) => dirEntry(e, offsets[i]))]);
    return Buffer.concat([...header, u32(2), u64(headerLen), u64(headerLen + data.length), Buffer.alloc(64), data, dir]);
  }
  const fixed = 4 * 5 + (version >= 2 ? 4 + 8 : 0) + 64;
  const dirLen = 4 + entries.reduce((s, e) => s + dirEntry(e, 0).length, 0);
  const base = fixed + dirLen;
  let ofs = 0;
  const offsets = entries.map(e => { const o = ofs; ofs += e.data.length; return o; });
  const dir = Buffer.concat([u32(entries.length), ...entries.map((e, i) => dirEntry(e, (version >= 2 ? 0 : base) + offsets[i]))]);
  const head = version >= 2 ? [...header, u32(0), u64(base), Buffer.alloc(64)] : [...header, Buffer.alloc(64)];
  return Buffer.concat([...head, dir, ...entries.map(e => e.data)]);
}

/** Append a pack to an executable the way Godot exports with "embed PCK": data, uint64 size, "GDPC". */
export function embedPck(exe, pck) {
  return Buffer.concat([exe, pck, u64(pck.length), Buffer.from('GDPC')]);
}

/** Minimal PE32 DLL with a CLI header and ECMA-335 metadata: Module, TypeDef and MethodDef tables. */
export function buildDotNetDll({ module = 'Game.dll', ns = 'MiniHeli', types = { Player: ['Awake', 'Update'], Enemy: ['OnTriggerEnter'] } } = {}) {
  const strings = ['', '<Module>'];
  const strIndex = s => { let off = 0; for (const x of strings) { if (x === s) return off; off += Buffer.byteLength(x) + 1; } strings.push(s); return off; };
  const typeNames = Object.keys(types);
  const methodNames = typeNames.flatMap(t => types[t]);
  const moduleName = strIndex(module), nsIdx = strIndex(ns);
  const typeIdx = typeNames.map(strIndex);
  const methodIdx = methodNames.map(strIndex);
  const stringsHeap = Buffer.concat(strings.map(s => Buffer.from(s + '\0')));
  const u16 = n => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
  const valid = (1n << 0n) | (1n << 2n) | (1n << 6n);
  const validBuf = Buffer.alloc(8); validBuf.writeBigUInt64LE(valid);
  const rowsModule = [Buffer.concat([u16(0), u16(moduleName), u16(0), u16(0), u16(0)])];
  let methodList = 1;
  const rowsType = [Buffer.concat([u32(0), u16(strIndex('<Module>')), u16(0), u16(0), u16(1), u16(1)])];
  for (let i = 0; i < typeNames.length; i++) {
    rowsType.push(Buffer.concat([u32(0x100001), u16(typeIdx[i]), u16(nsIdx), u16(0), u16(1), u16(methodList)]));
    methodList += types[typeNames[i]].length;
  }
  const rowsMethod = methodIdx.map(n => Buffer.concat([u32(0), u16(0), u16(0x86), u16(n), u16(0), u16(1)]));
  const tables = Buffer.concat([u32(0), Buffer.from([2, 0, 0, 1]), validBuf, Buffer.alloc(8), u32(rowsModule.length), u32(rowsType.length), u32(rowsMethod.length), ...rowsModule, ...rowsType, ...rowsMethod]);
  const pad4 = b => Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4)]);
  const tablesP = pad4(tables), stringsP = pad4(stringsHeap);
  const version = Buffer.concat([Buffer.from('v4.0.30319'), Buffer.alloc(2)]);
  const streamHeaders = (offTables, offStrings) => Buffer.concat([u32(offTables), u32(tablesP.length), Buffer.from('#~\0\0'), u32(offStrings), u32(stringsP.length), Buffer.from('#Strings\0\0\0\0')]);
  const rootFixed = 16 + version.length + 4;
  const shLen = streamHeaders(0, 0).length;
  const metadata = Buffer.concat([u32(0x424a5342), u16(1), u16(1), u32(0), u32(version.length), version, u16(0), u16(2), streamHeaders(rootFixed + shLen, rootFixed + shLen + tablesP.length), tablesP, stringsP]);
  const textRva = 0x2000, cliSize = 72, mdRva = textRva + 0x50;
  const cli = Buffer.alloc(0x50);
  cli.writeUInt32LE(cliSize, 0); cli.writeUInt16LE(2, 4); cli.writeUInt16LE(5, 6); cli.writeUInt32LE(mdRva, 8); cli.writeUInt32LE(metadata.length, 12); cli.writeUInt32LE(1, 16);
  const section = Buffer.concat([cli, metadata]);
  const rawSize = Math.ceil(section.length / 0x200) * 0x200;
  const headers = Buffer.alloc(0x200);
  headers.write('MZ', 0); headers.writeUInt32LE(0x40, 0x3c); headers.write('PE\0\0', 0x40, 'latin1');
  const coff = 0x44;
  headers.writeUInt16LE(0x14c, coff); headers.writeUInt16LE(1, coff + 2); headers.writeUInt32LE(0x5f5e100, coff + 4); headers.writeUInt16LE(224, coff + 16); headers.writeUInt16LE(0x2102, coff + 18);
  const opt = coff + 20;
  headers.writeUInt16LE(0x10b, opt); headers.writeUInt32LE(0x400000, opt + 28); headers.writeUInt32LE(0x2000, opt + 32); headers.writeUInt32LE(0x200, opt + 36); headers.writeUInt16LE(3, opt + 68); headers.writeUInt32LE(16, opt + 92);
  headers.writeUInt32LE(textRva, opt + 96 + 14 * 8); headers.writeUInt32LE(cliSize, opt + 96 + 14 * 8 + 4);
  const sec = opt + 224;
  headers.write('.text', sec, 'latin1'); headers.writeUInt32LE(section.length, sec + 8); headers.writeUInt32LE(textRva, sec + 12); headers.writeUInt32LE(rawSize, sec + 16); headers.writeUInt32LE(0x200, sec + 20); headers.writeUInt32LE(0x60000020, sec + 36);
  return Buffer.concat([headers, section, Buffer.alloc(rawSize - section.length)]);
}

const DEFAULT_IL2CPP_TYPES = [
  ['mscorlib.dll', 'System', 'Object', ['ToString', 'GetHashCode']],
  ['Assembly-CSharp.dll', '', 'Player', ['Awake', 'Update', 'Jump', 'TakeDamage']],
  ['Assembly-CSharp.dll', 'Game.UI', 'HealthBar', ['SetValue']],
  ['Assembly-CSharp.dll', 'Game', 'SaveSystem', ['Save', 'Load']],
];

/** Version-29 global-metadata.dat. types: [assembly, namespace, name, methods]. */
export function buildIl2cppMetadata({ types = DEFAULT_IL2CPP_TYPES, literals = ['Game Over', 'Press start'] } = {}) {
  const ids = []; const idOf = new Map();
  const id = s => { if (!idOf.has(s)) { idOf.set(s, ids.reduce((n, x) => n + Buffer.byteLength(x) + 1, 0)); ids.push(s); } return idOf.get(s); };
  const i32 = n => { const b = Buffer.alloc(4); b.writeInt32LE(n); return b; };
  const groups = [];
  for (const t of types) {
    const last = groups.at(-1);
    if (!last || last[0] !== t[0]) groups.push([t[0], [t]]);
    else last[1].push(t);
  }
  const flat = groups.flatMap(([, list]) => list);
  const images = [];
  let start = 0;
  for (const [asm, list] of groups) { images.push([asm, start, list.length]); start += list.length; }
  const methodRecs = [], typeRecs = [];
  flat.forEach(([, ns, name, ms], ti) => {
    const r = Buffer.alloc(88); r.writeInt32LE(id(name), 0); r.writeInt32LE(id(ns), 4); typeRecs.push(r);
    for (const m of ms) { const mr = Buffer.alloc(32); mr.writeInt32LE(id(m), 0); mr.writeInt32LE(ti, 4); methodRecs.push(mr); }
  });
  const imageRecs = images.map(([n, st, count]) => { const r = Buffer.alloc(40); r.writeInt32LE(id(n), 0); r.writeInt32LE(st, 8); r.writeUInt32LE(count, 12); return r; });
  const strings = Buffer.concat(ids.map(s => Buffer.from(s + '\0')));
  // shortcut: a literal table whose size is a method record (24, 28, 32, 36, 40) is parsed as methods; repeat the first literal until the size is safe. Set diff hides the copies.
  const recs = [24, 28, 32, 36, 40];
  const lits = [...literals];
  if (lits.length) while (recs.some(r => (lits.length * 8) % r === 0)) lits.push(lits[0]);
  let at = 0; const litParts = [], litPairs = [];
  for (const s of lits) { const len = Buffer.byteLength(s); litParts.push(Buffer.from(s)); litPairs.push(i32(len), i32(at)); at += len; }
  const sections = [Buffer.concat(litPairs), Buffer.concat(litParts), strings, Buffer.alloc(0), Buffer.alloc(0), Buffer.concat(methodRecs), ...Array(13).fill(Buffer.alloc(0)), Buffer.concat(typeRecs), Buffer.concat(imageRecs)];
  const headerSize = 8 + sections.length * 8;
  let off = headerSize; const hdr = [Buffer.from([0xaf, 0x1b, 0xb1, 0xfa]), i32(29)];
  for (const s of sections) { hdr.push(i32(off), i32(s.length)); off += s.length; }
  return Buffer.concat([...hdr, ...sections]);
}

/** ZIP with deflated entries (no external tools). */
export function buildZip(files) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.from(content);
    const comp = zlib.deflateRawSync(data);
    const crc = zlib.crc32 ? zlib.crc32(data) : 0;
    const nameBuf = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6); local.writeUInt16LE(8, 8); local.writeUInt32LE(crc >>> 0, 14); local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x800, 8); central.writeUInt16LE(8, 10); central.writeUInt32LE(crc >>> 0, 16); central.writeUInt32LE(comp.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(nameBuf.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, comp);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

/** Electron asar archive. */
export function buildAsar(files) {
  const tree = { files: {} };
  const blobs = [];
  let offset = 0;
  for (const [p, content] of Object.entries(files)) {
    const parts = p.split('/');
    let node = tree;
    for (const dir of parts.slice(0, -1)) node = (node.files[dir] ??= { files: {} });
    const data = Buffer.from(content);
    node.files[parts.at(-1)] = { size: data.length, offset: String(offset) };
    blobs.push(data); offset += data.length;
  }
  const json = Buffer.from(JSON.stringify(tree));
  const pad = (4 - (json.length % 4)) % 4;
  const pickle = Buffer.concat([u32(json.length + 4 + pad), u32(json.length), json, Buffer.alloc(pad)]);
  return Buffer.concat([u32(4), u32(pickle.length), pickle, ...blobs]);
}

/** Minimal PNG (1×1 RGBA). */
export function buildPng() {
  return Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000' + '1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082', 'hex');
}

/** ustar archive (optionally gzipped). */
export function buildTar(files, { gzip = false } = {}) {
  const blocks = [];
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.from(content);
    const h = Buffer.alloc(512);
    h.write(name, 0, 100, 'utf8');
    h.write('0000644\0', 100); h.write('0000000\0', 108); h.write('0000000\0', 116);
    h.write(data.length.toString(8).padStart(11, '0') + '\0', 124);
    h.write('00000000000\0', 136);
    h.write('        ', 148);
    h.write('0', 156);
    h.write('ustar\0', 257); h.write('00', 263);
    let sum = 0;
    for (const b of h) sum += b;
    h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
    blocks.push(h, data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  const tar = Buffer.concat(blocks);
  return gzip ? zlib.gzipSync(tar) : tar;
}

/** Tiny WebAssembly module: imports env.log, exports main. */
export function buildWasm() {
  const sections = ['0108026001' + '7f00600000', '020b0103656e76036c6f670000', '03020101', '070801046d61696e0001', '0a040102000b'];
  return Buffer.from('0061736d01000000' + sections.join(''), 'hex');
}

// ---------------------------------------------------------------- mobile fixtures (Android binary XML, resources.arsc, bplist)
const u16 = n => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const pad4 = b => Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4)]);
const resChunk = (type, header, body) => Buffer.concat([u16(type), u16(8 + header.length), u32(8 + header.length + body.length), header, body]);

/** Android ResStringPool chunk, UTF-16 (default) or UTF-8. */
export function buildResStringPool(strings, { utf8 = false } = {}) {
  const len8 = n => (n > 0x7f ? Buffer.from([0x80 | (n >> 8), n & 0xff]) : Buffer.from([n]));
  const items = strings.map(s => {
    if (utf8) { const raw = Buffer.from(s, 'utf8'); return Buffer.concat([len8(s.length), len8(raw.length), raw, Buffer.from([0])]); }
    return Buffer.concat([s.length > 0x7fff ? Buffer.concat([u16(0x8000 | (s.length >> 16)), u16(s.length & 0xffff)]) : u16(s.length), Buffer.from(s, 'utf16le'), u16(0)]);
  });
  let at = 0;
  const offsets = items.map(b => { const o = at; at += b.length; return u32(o); });
  const header = Buffer.concat([u32(strings.length), u32(0), u32(utf8 ? 0x100 : 0), u32(28 + 4 * strings.length), u32(0)]);
  return resChunk(0x0001, header, pad4(Buffer.concat([...offsets, ...items])));
}

const resValue = v => {
  const [type, data] = 'ref' in v ? [0x01, v.ref] : 'int' in v ? [0x10, v.int] : 'hex' in v ? [0x11, v.hex] : 'bool' in v ? [0x12, v.bool ? 0xffffffff : 0] : 'float' in v ? [0x04, (() => { const b = Buffer.alloc(4); b.writeFloatLE(v.float); return b.readUInt32LE(0); })()] : [v.type, v.data];
  return Buffer.concat([u16(8), Buffer.from([0, type]), u32(data >>> 0)]);
};

export const ANDROID_NS = 'http://schemas.android.com/apk/res/android';
/**
 * Android binary XML. node: { name, attrs: [{ name, resId?, android?, string | ref | int | hex | bool | float | (type, data) }],
 * children }. Attributes with a resId go first in the string pool (that is how the resource map addresses them);
 * stripNames empties those name strings, as release builds do.
 */
export function buildAxml(root, { utf8 = false, stripNames = false } = {}) {
  const resIds = [];
  const walk = (n, fn) => { fn(n); for (const c of n.children ?? []) walk(c, fn); };
  walk(root, n => { for (const a of n.attrs ?? []) if (a.resId && !resIds.includes(a.resId)) resIds.push(a.resId); });
  const names = new Map(); // resId → attribute name
  walk(root, n => { for (const a of n.attrs ?? []) if (a.resId) names.set(a.resId, a.name); });
  const strings = resIds.map(id => (stripNames ? '' : names.get(id)));
  const sid = s => { let i = strings.indexOf(s, resIds.length); if (i < 0) { i = strings.length; strings.push(s); } return i; };
  const NONE = 0xffffffff;
  const nsPrefix = sid('android'), nsUri = sid(ANDROID_NS);
  const node = (type, body) => resChunk(type, Buffer.concat([u32(1), u32(NONE)]), body);
  const chunks = [node(0x0100, Buffer.concat([u32(nsPrefix), u32(nsUri)]))];
  const emit = n => {
    const attrs = (n.attrs ?? []).map(a => {
      const nameIdx = a.resId ? resIds.indexOf(a.resId) : sid(a.name);
      const isString = 'string' in a;
      const raw = isString ? sid(a.string) : NONE;
      return Buffer.concat([u32(a.resId || a.android ? nsUri : NONE), u32(nameIdx), u32(raw), isString ? Buffer.concat([u16(8), Buffer.from([0, 0x03]), u32(raw)]) : resValue(a)]);
    });
    chunks.push(node(0x0102, Buffer.concat([u32(NONE), u32(sid(n.name)), u16(20), u16(20), u16(attrs.length), u16(0), u16(0), u16(0), ...attrs])));
    for (const c of n.children ?? []) emit(c);
    chunks.push(node(0x0103, Buffer.concat([u32(NONE), u32(sid(n.name))])));
  };
  emit(root);
  chunks.push(node(0x0101, Buffer.concat([u32(nsPrefix), u32(nsUri)])));
  const body = Buffer.concat([buildResStringPool(strings, { utf8 }), resChunk(0x0180, Buffer.alloc(0), Buffer.concat(resIds.map(u32))), ...chunks]);
  return resChunk(0x0003, Buffer.alloc(0), body);
}

/**
 * resources.arsc with one package. types: [{ name, configs: [{ language?, entries: { <index>: { key, string | ref | int | bool } } }] }].
 * The first config without a language is the default one.
 */
export function buildArsc({ packageId = 0x7f, packageName = 'com.example.game', types = [], utf8 = true } = {}) {
  const globals = [], keys = [];
  const idx = (list, s) => { let i = list.indexOf(s); if (i < 0) { i = list.length; list.push(s); } return i; };
  const typeChunks = [];
  types.forEach((t, ti) => {
    const entryCount = 1 + Math.max(...t.configs.flatMap(c => Object.keys(c.entries).map(Number)));
    typeChunks.push(resChunk(0x0202, Buffer.concat([Buffer.from([ti + 1, 0, 0, 0]), u32(entryCount)]), Buffer.alloc(4 * entryCount)));
    for (const c of t.configs) {
      const config = Buffer.alloc(64); config.writeUInt32LE(64, 0); if (c.language) config.write(c.language, 8, 'latin1');
      const offsets = [], entries = [];
      let at = 0;
      for (let i = 0; i < entryCount; i++) {
        const e = c.entries[i];
        if (!e) { offsets.push(u32(0xffffffff)); continue; }
        const value = 'string' in e ? Buffer.concat([u16(8), Buffer.from([0, 0x03]), u32(idx(globals, e.string))]) : resValue(e);
        entries.push(Buffer.concat([u16(8), u16(0), u32(idx(keys, e.key)), value]));
        offsets.push(u32(at)); at += 16;
      }
      const header = Buffer.concat([Buffer.from([ti + 1, 0, 0, 0]), u32(entryCount), u32(8 + 12 + 64 + 4 * entryCount), config]);
      typeChunks.push(resChunk(0x0201, header, Buffer.concat([...offsets, ...entries])));
    }
  });
  const typePool = buildResStringPool(types.map(t => t.name)), keyPool = buildResStringPool(keys, { utf8 });
  const name = Buffer.alloc(256); name.write(packageName, 0, 'utf16le');
  const pkgHeader = Buffer.concat([u32(packageId), name, u32(288), u32(types.length), u32(288 + typePool.length), u32(keys.length), u32(0)]);
  const pkg = resChunk(0x0200, pkgHeader, Buffer.concat([typePool, keyPool, ...typeChunks]));
  return resChunk(0x0002, u32(1), Buffer.concat([buildResStringPool(globals, { utf8 }), pkg]));
}

/**
 * Apple binary property list. Values: null, booleans, integers (number or bigint), { real }, non-integer numbers,
 * Date, Buffer (data), strings (ASCII or UTF-16), { uid }, arrays, Set and plain objects (dict).
 */
export function buildBplist(value) {
  const objects = []; // { bytes } or { marker, refs }
  const be = (n, size) => { const b = Buffer.alloc(size); let v = BigInt.asUintN(size * 8, BigInt(n)); for (let i = size - 1; i >= 0; i--) { b[i] = Number(v & 0xffn); v >>= 8n; } return b; };
  const intObj = n => { const v = BigInt(n); const size = v < 0n ? 8 : v < 0x100n ? 1 : v < 0x10000n ? 2 : v < 0x100000000n ? 4 : 8; return Buffer.concat([Buffer.from([0x10 | Math.log2(size)]), be(v, size)]); };
  const head = (kind, len) => (len < 15 ? Buffer.from([kind | len]) : Buffer.concat([Buffer.from([kind | 15]), intObj(len)]));
  const add = v => {
    const id = objects.length; objects.push(null);
    if (v === null) objects[id] = { bytes: Buffer.from([0x00]) };
    else if (v === true || v === false) objects[id] = { bytes: Buffer.from([v ? 0x09 : 0x08]) };
    else if (typeof v === 'bigint' || (typeof v === 'number' && Number.isInteger(v))) objects[id] = { bytes: intObj(v) };
    else if (typeof v === 'number' || (v && typeof v.real === 'number')) { const b = Buffer.alloc(9); b[0] = 0x23; b.writeDoubleBE(typeof v === 'number' ? v : v.real, 1); objects[id] = { bytes: b }; }
    else if (v instanceof Date) { const b = Buffer.alloc(9); b[0] = 0x33; b.writeDoubleBE((v.getTime() - Date.UTC(2001, 0, 1)) / 1000, 1); objects[id] = { bytes: b }; }
    else if (Buffer.isBuffer(v)) objects[id] = { bytes: Buffer.concat([head(0x40, v.length), v]) };
    else if (typeof v === 'string') objects[id] = /^[\x00-\x7f]*$/.test(v) ? { bytes: Buffer.concat([head(0x50, v.length), Buffer.from(v, 'latin1')]) } : { bytes: Buffer.concat([head(0x60, v.length), Buffer.from(v, 'utf16le').swap16()]) };
    else if (typeof v.uid === 'number' && Object.keys(v).length === 1) objects[id] = { bytes: Buffer.concat([Buffer.from([0x80]), be(v.uid, 1)]) };
    else if (Array.isArray(v) || v instanceof Set) { const items = [...v]; objects[id] = { head: head(Array.isArray(v) ? 0xa0 : 0xc0, items.length), refs: items.map(add) }; }
    else { const ks = Object.keys(v); const keyRefs = ks.map(add); objects[id] = { head: head(0xd0, ks.length), refs: [...keyRefs, ...ks.map(k => add(v[k]))] }; }
    return id;
  };
  add(value);
  const refSize = objects.length < 256 ? 1 : 2;
  const blobs = objects.map(o => o.bytes ?? Buffer.concat([o.head, ...o.refs.map(r => be(r, refSize))]));
  const total = 8 + blobs.reduce((s, b) => s + b.length, 0);
  const offSize = total < 256 ? 1 : total < 65536 ? 2 : 4;
  let at = 8;
  const table = blobs.map(b => { const o = at; at += b.length; return be(o, offSize); });
  const trailer = Buffer.concat([Buffer.alloc(6), Buffer.from([offSize, refSize]), be(objects.length, 8), be(0, 8), be(total, 8)]);
  return Buffer.concat([Buffer.from('bplist00'), ...blobs, ...table, trailer]);
}

// ---------------------------------------------------------------- Godot imported resources (port/test/godot-import.test.mjs)
const gdPad4 = b => Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4)]);
const gdI32 = n => { const b = Buffer.alloc(4); b.writeInt32LE(n | 0); return b; };
const gdUstr = s => { const b = Buffer.from(s + '\0'); return Buffer.concat([u32(b.length), b]); };

/** Variants as ResourceFormatSaverBinary writes them (core/io/resource_format_binary.cpp). */
export const rv = {
  bool: v => Buffer.concat([u32(2), u32(v ? 1 : 0)]),
  int: v => Buffer.concat([u32(3), gdI32(v)]),
  float: v => { const b = Buffer.alloc(4); b.writeFloatLE(v); return Buffer.concat([u32(4), b]); },
  str: s => Buffer.concat([u32(5), gdUstr(s)]),
  bytes: b => Buffer.concat([u32(31), u32(b.length), gdPad4(Buffer.from(b))]),
  ints: a => Buffer.concat([u32(32), u32(a.length), ...a.map(gdI32)]),
  int64s: a => Buffer.concat([u32(48), u32(a.length), ...a.map(n => { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(n)); return b; })]),
  array: a => Buffer.concat([u32(30), u32(a.length), ...a]),
  dict: pairs => Buffer.concat([u32(26), u32(pairs.length), ...pairs.flat()]),
  sub: index => Buffer.concat([u32(24), u32(2), u32(index)]),
};

/** Binary resource (RSRC). resources: [{ type, props: { name: rv.* } }], sub-resources first and the main resource last. */
export function buildRsrc(resources, { major = 4, minor = 3 } = {}) {
  const type = resources.at(-1).type;
  const names = [...new Set(resources.flatMap(r => Object.keys(r.props)))];
  const head = Buffer.concat([Buffer.from('RSRC'), u32(0), u32(0), u32(major), u32(minor), u32(major >= 4 ? 5 : 3), gdUstr(type), u64(0),
    major >= 4 ? Buffer.concat([u32(0), u64(0), Buffer.alloc(11 * 4)]) : Buffer.alloc(14 * 4),
    u32(names.length), ...names.map(gdUstr), u32(0), u32(resources.length)]);
  const bodies = resources.map(r => Buffer.concat([gdUstr(r.type), u32(Object.keys(r.props).length), ...Object.entries(r.props).flatMap(([k, v]) => [u32(names.indexOf(k)), v])]));
  const paths = resources.map((r, i) => gdUstr(i === resources.length - 1 ? '' : `local://${i + 1}`));
  let offset = head.length + paths.reduce((a, p) => a + p.length + 8, 0);
  const table = [];
  bodies.forEach((b, i) => { table.push(paths[i], u64(offset)); offset += b.length; });
  return Buffer.concat([head, ...table, ...bodies, Buffer.from('RSRC')]);
}

/** One image as CompressedTexture2D stores it. dataFormat: 0 image, 1 png, 2 webp, 3 basis universal; payloads: one per mip level. */
export function buildGodotImage({ width, height, dataFormat, format = 5, payloads }) {
  const head = Buffer.alloc(16);
  head.writeUInt32LE(dataFormat, 0); head.writeUInt16LE(width, 4); head.writeUInt16LE(height, 6); head.writeUInt32LE(dataFormat === 3 ? 0 : payloads.length - 1, 8); head.writeUInt32LE(format, 12);
  return Buffer.concat([head, ...payloads.flatMap(p => (dataFormat === 0 ? [p] : [u32(p.length), p]))]);
}
/** Godot 4 .ctex (GST2). */
export function buildCtex(image, { flags = 0, mipmapLimit = 0 } = {}) {
  return Buffer.concat([Buffer.from('GST2'), u32(1), u32(image.width), u32(image.height), u32(flags), u32(mipmapLimit), Buffer.alloc(12), buildGodotImage(image)]);
}
/** Godot 4 .ctexarray (GSTL). */
export function buildCtexLayered(images) {
  return Buffer.concat([Buffer.from('GSTL'), u32(1), u32(images.length), u32(0), u32(0), u32(0), Buffer.alloc(12), ...images.map(buildGodotImage)]);
}
/** Godot 3 .stex (GDST). kind: 'png' | 'webp' | 'raw' (format = Godot 3 Image::Format). */
export function buildStex({ width, height, kind, format = 5, payload, flags = 7 }) {
  const head = Buffer.alloc(20);
  head.write('GDST'); head.writeUInt16LE(width, 4); head.writeUInt16LE(height, 8); head.writeUInt32LE(flags, 12);
  head.writeUInt32LE(kind === 'png' ? 1 << 20 : kind === 'webp' ? 1 << 21 : format, 16);
  return kind === 'raw' ? Buffer.concat([head, payload]) : Buffer.concat([head, u32(1), u32(payload.length), payload]);
}
/** The lossless payload Godot stores: "PNG " followed by the PNG file. */
export const godotPngPayload = png => Buffer.concat([Buffer.from('PNG '), png]);

/** .sample: AudioStreamWAV (Godot 3: AudioStreamSample). Defaults (format 0, mix_rate 44100, mono, no loop) are left out, as Godot does. */
export function buildSample({ data, format = 0, mixRate = 44100, stereo = false, loopMode = 0, loopBegin = 0, loopEnd = 0, major = 4 }) {
  const props = { data: rv.bytes(data) };
  if (format) props.format = rv.int(format);
  if (loopMode) { props.loop_mode = rv.int(loopMode); props.loop_begin = rv.int(loopBegin); props.loop_end = rv.int(loopEnd); }
  if (mixRate !== 44100) props.mix_rate = rv.int(mixRate);
  if (stereo) props.stereo = rv.bool(true);
  return buildRsrc([{ type: major >= 4 ? 'AudioStreamWAV' : 'AudioStreamSample', props }], { major, minor: major >= 4 ? 3 : 5 });
}
/** Godot 3 .oggstr: the whole .ogg file in the data property. */
export const buildOggStr3 = ogg => buildRsrc([{ type: 'AudioStreamOGGVorbis', props: { data: rv.bytes(ogg), loop: rv.bool(true) } }], { major: 3, minor: 5 });
/** Godot 4 .oggvorbisstr: packets per page in an OggPacketSequence sub-resource. pages: [[Buffer, ...], ...]. */
export const buildOggVorbisStr4 = (pages, granules) => buildRsrc([
  { type: 'OggPacketSequence', props: { packet_data: rv.array(pages.map(pg => rv.array(pg.map(rv.bytes)))), granule_positions: rv.int64s(granules), sampling_rate: rv.float(44100) } },
  { type: 'AudioStreamOggVorbis', props: { packet_sequence: rv.sub(1) } }]);
export const buildMp3Str = mp3 => buildRsrc([{ type: 'AudioStreamMP3', props: { data: rv.bytes(mp3) } }]);

/**
 * .translation as OptimizedTranslation::generate writes it (core/string/optimized_translation.cpp): keys are hashed
 * into buckets, each bucket gets the first d for which hash(d, key) is unique, texts go in `strings` with their
 * terminating NUL. smaz: { text: compressed bytes } stores those entries compressed (the others raw).
 */
export function buildTranslation(messages, { locale = 'en', major = 4, smaz = {} } = {}) {
  const hash = (d, s) => { let h = d === 0 ? 0x1000193 : d; for (const b of Buffer.from(s)) h = Math.imul(h, 0x1000193) ^ b; return h >>> 0; };
  const keys = Object.keys(messages);
  const size = [3, 5, 7, 11, 13, 17, 23, 29, 37, 53, 97, 193, 389].find(p => p > keys.length);
  const strings = [];
  let total = 0;
  const entries = keys.map(k => { const raw = Buffer.from(messages[k] + '\0'), stored = smaz[messages[k]] ?? raw; const e = { key: k, offset: total, comp: stored.length, uncomp: raw.length }; strings.push(stored); total += stored.length; return e; });
  const buckets = Array.from({ length: size }, () => []);
  for (const e of entries) buckets[hash(0, e.key) % size].push(e);
  const ht = [], bt = [];
  for (const b of buckets) {
    if (!b.length) { ht.push(-1); continue; }
    let d = 1;
    while (new Set(b.map(e => hash(d, e.key))).size !== b.length) d++;
    ht.push(bt.length);
    bt.push(b.length, d);
    for (const e of b) bt.push(hash(d, e.key), e.offset, e.comp, e.uncomp);
  }
  return buildRsrc([{ type: major >= 4 ? 'OptimizedTranslation' : 'PHashTranslation', props: { hash_table: rv.ints(ht), bucket_table: rv.ints(bt), strings: rv.bytes(Buffer.concat(strings)), ...(locale ? { locale: rv.str(locale) } : {}) } }], { major, minor: major >= 4 ? 3 : 5 });
}

/** A .import side file. remap: the imported file (res://.godot/imported/...); source: res://... or null (exports drop [deps]). */
export function buildImportFile({ remap, source = null, importer = 'texture', type = 'CompressedTexture2D' }) {
  return `[remap]\n\nimporter="${importer}"\ntype="${type}"\npath="${remap}"\n${source ? `\n[deps]\n\nsource_file="${source}"\ndest_files=["${remap}"]\n` : ''}`;
}
