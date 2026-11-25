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

// ---------------------------------------------------------------- executables for re_binary detection tests
const exeU16 = n => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const exePad4 = b => Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4)]);
const exeWide = s => Buffer.from(s, 'utf16le');
const exeRol32 = (v, n) => (n ? ((v << n) | (v >>> (32 - n))) >>> 0 : v >>> 0);

/** VS_VERSIONINFO resource data: fixed file info, a StringFileInfo table and a Translation entry. */
export function buildVersionResource({ fileVersion = [1, 2, 3, 4], productVersion = fileVersion, strings = {}, table = '040904B0' } = {}) {
  const node = (key, value, type, children = []) => {
    const b = Buffer.concat([exePad4(Buffer.concat([Buffer.alloc(6), exeWide(key + '\0')])), exePad4(value), ...children.map(exePad4)]);
    b.writeUInt16LE(b.length, 0); b.writeUInt16LE(type === 1 ? value.length / 2 : value.length, 2); b.writeUInt16LE(type, 4);
    return b;
  };
  const fixed = Buffer.alloc(52);
  fixed.writeUInt32LE(0xfeef04bd, 0); fixed.writeUInt32LE(0x10000, 4);
  fixed.writeUInt32LE(((fileVersion[0] << 16) | fileVersion[1]) >>> 0, 8); fixed.writeUInt32LE(((fileVersion[2] << 16) | fileVersion[3]) >>> 0, 12);
  fixed.writeUInt32LE(((productVersion[0] << 16) | productVersion[1]) >>> 0, 16); fixed.writeUInt32LE(((productVersion[2] << 16) | productVersion[3]) >>> 0, 20);
  fixed.writeUInt32LE(0x3f, 24); fixed.writeUInt32LE(0x40004, 32); fixed.writeUInt32LE(1, 36);
  const none = Buffer.alloc(0);
  const stringTable = node(table, none, 1, Object.entries(strings).map(([k, v]) => node(k, exeWide(v + '\0'), 1)));
  const translation = Buffer.concat([exeU16(0x409), exeU16(1200)]);
  return node('VS_VERSION_INFO', fixed, 0, [node('StringFileInfo', none, 1, [stringTable]), node('VarFileInfo', none, 1, [node('Translation', translation, 0)])]);
}

/** RT_GROUP_ICON data for images given as [width, height, bitCount, bytes]. */
export function buildGroupIcon(images) {
  const head = Buffer.alloc(6); head.writeUInt16LE(1, 2); head.writeUInt16LE(images.length, 4);
  return Buffer.concat([head, ...images.map(([w, h, bits, bytes], i) => { const e = Buffer.alloc(14); e[0] = w & 0xff; e[1] = h & 0xff; e.writeUInt16LE(1, 4); e.writeUInt16LE(bits, 6); e.writeUInt32LE(bytes, 8); e.writeUInt16LE(i + 1, 12); return e; })]);
}

/** RT_STRING block data: up to 16 strings (empty slots are a zero length). */
export function buildStringBlock(texts) {
  return Buffer.concat(Array.from({ length: 16 }, (_, i) => { const t = texts[i] ?? ''; return Buffer.concat([exeU16(t.length), exeWide(t)]); }));
}

/** .rsrc section: types = [{ type: 16 | 'NAME', items: [{ name: 1 | 'NAME', lang, data }] }]. */
function buildPeRsrc(types, rva) {
  const dirSize = n => 16 + n * 8;
  const named = v => typeof v === 'string';
  const sort = list => [...list].sort((a, b) => named(b.key) - named(a.key));
  const top = sort(types.map(t => ({ key: t.type, items: sort(t.items.map(i => ({ key: i.name, lang: i.lang ?? 1033, data: i.data }))) })));
  let off = dirSize(top.length);
  for (const t of top) { t.off = off; off += dirSize(t.items.length); }
  for (const t of top) for (const i of t.items) { i.off = off; off += dirSize(1); }
  for (const t of top) for (const i of t.items) { i.entry = off; off += 16; }
  const names = [], namesStart = off;
  const nameRef = key => { if (!named(key)) return key; const at = off; const b = Buffer.concat([exeU16(key.length), exeWide(key)]); names.push(b); off += b.length; return (0x80000000 | at) >>> 0; };
  const refs = new Map();
  for (const t of top) { refs.set(t, nameRef(t.key)); for (const i of t.items) refs.set(i, nameRef(i.key)); }
  off = (off + 3) & ~3;
  for (const t of top) for (const i of t.items) { i.dataOff = off; off += (i.data.length + 3) & ~3; }
  const out = Buffer.alloc(off);
  const dir = (at, entries) => {
    out.writeUInt16LE(entries.filter(e => e[0] & 0x80000000).length, at + 12); out.writeUInt16LE(entries.filter(e => !(e[0] & 0x80000000)).length, at + 14);
    entries.forEach(([name, target], k) => { out.writeUInt32LE(name >>> 0, at + 16 + k * 8); out.writeUInt32LE(target >>> 0, at + 20 + k * 8); });
  };
  dir(0, top.map(t => [refs.get(t), 0x80000000 | t.off]));
  for (const t of top) {
    dir(t.off, t.items.map(i => [refs.get(i), 0x80000000 | i.off]));
    for (const i of t.items) {
      dir(i.off, [[i.lang, i.entry]]);
      out.writeUInt32LE(rva + i.dataOff, i.entry); out.writeUInt32LE(i.data.length, i.entry + 4);
      i.data.copy(out, i.dataOff);
    }
  }
  Buffer.concat(names).copy(out, namesStart);
  return out;
}

/** Import directory for a PE32 file: { 'KERNEL32.dll': ['CreateFileW'] }. */
function buildPeIdata(imports, rva) {
  const dlls = Object.entries(imports);
  let off = (dlls.length + 1) * 20;
  const plan = dlls.map(([dll, fns]) => { const ilt = off; off += (fns.length + 1) * 4; return { dll, fns, ilt }; });
  for (const d of plan) { d.name = off; off += d.dll.length + 1; d.hints = d.fns.map(f => { const at = off; off += 2 + f.length + 1; return at; }); }
  const out = Buffer.alloc(off);
  plan.forEach((d, i) => {
    out.writeUInt32LE(rva + d.ilt, i * 20); out.writeUInt32LE(rva + d.name, i * 20 + 12); out.writeUInt32LE(rva + d.ilt, i * 20 + 16);
    out.write(d.dll, d.name, 'latin1');
    d.fns.forEach((f, k) => { out.writeUInt32LE(rva + d.hints[k], d.ilt + k * 4); out.write(f, d.hints[k] + 2, 'latin1'); });
  });
  return out;
}

/**
 * Small PE32 executable. sections: [{ name, data }]; imports: { dll: [functions] }; resources: see buildPeRsrc;
 * rich: [{ id, build, count }] writes a Rich header with a valid checksum (richTamper changes the stub afterwards);
 * headerTail: bytes placed in the header slack (inside the first 4 KiB); overlay: bytes appended after the sections.
 */
export function buildPe({ sections = [{ name: '.text', data: Buffer.alloc(64, 0x90) }], imports, resources, rich, richTamper = false, overlay, headerTail, stub = 'This program cannot be run in DOS mode.\r\r\n$', linker = [14, 29] } = {}) {
  const headerSize = 0x400;
  const headers = Buffer.alloc(headerSize);
  headers.write('MZ', 0);
  headers.write(stub, 0x4e, 'latin1');
  let peOff = 0x80;
  if (rich) {
    const records = rich.map(r => [((r.id << 16) | r.build) >>> 0, r.count >>> 0]);
    let key = 0x80;
    for (let i = 0; i < 0x80; i++) if (i < 0x3c || i > 0x3f) key = (key + exeRol32(headers[i], i & 31)) >>> 0;
    for (const [id, count] of records) key = (key + exeRol32(id, count & 31)) >>> 0;
    let o = 0x80;
    for (const v of [0x536e6144, 0, 0, 0, ...records.flat()]) { headers.writeUInt32LE((v ^ key) >>> 0, o); o += 4; }
    headers.write('Rich', o, 'latin1'); headers.writeUInt32LE(key, o + 4);
    peOff = (o + 8 + 7) & ~7;
    if (richTamper) headers[0x50] ^= 0x20;
  }
  headers.writeUInt32LE(peOff, 0x3c);
  const all = [...sections];
  if (imports) all.push({ name: '.idata', data: rva => buildPeIdata(imports, rva), dir: 1 });
  if (resources) all.push({ name: '.rsrc', data: rva => buildPeRsrc(resources, rva), dir: 2 });
  headers.write('PE\0\0', peOff, 'latin1');
  const coff = peOff + 4, opt = coff + 20, sec = opt + 224;
  headers.writeUInt16LE(0x14c, coff); headers.writeUInt16LE(all.length, coff + 2); headers.writeUInt32LE(0x5f5e100, coff + 4); headers.writeUInt16LE(224, coff + 16); headers.writeUInt16LE(0x0102, coff + 18);
  headers.writeUInt16LE(0x10b, opt); headers[opt + 2] = linker[0]; headers[opt + 3] = linker[1];
  headers.writeUInt32LE(0x1000, opt + 16); headers.writeUInt32LE(0x400000, opt + 28); headers.writeUInt32LE(0x1000, opt + 32); headers.writeUInt32LE(0x200, opt + 36); headers.writeUInt16LE(3, opt + 68); headers.writeUInt32LE(16, opt + 92);
  const bodies = [];
  let rva = 0x1000, raw = headerSize;
  all.forEach((s, i) => {
    const data = typeof s.data === 'function' ? s.data(rva) : Buffer.from(s.data ?? '');
    const rawSize = Math.ceil(data.length / 0x200) * 0x200;
    const h = sec + i * 40;
    headers.write(s.name, h, 'latin1'); headers.writeUInt32LE(data.length, h + 8); headers.writeUInt32LE(rva, h + 12); headers.writeUInt32LE(rawSize, h + 16); headers.writeUInt32LE(rawSize ? raw : 0, h + 20); headers.writeUInt32LE(s.flags ?? 0x60000020, h + 36);
    if (s.dir) { headers.writeUInt32LE(rva, opt + 96 + s.dir * 8); headers.writeUInt32LE(data.length, opt + 96 + s.dir * 8 + 4); }
    bodies.push(data, Buffer.alloc(rawSize - data.length));
    rva += Math.max(0x1000, Math.ceil(data.length / 0x1000) * 0x1000); raw += rawSize;
  });
  if (headerTail) Buffer.from(headerTail, 'latin1').copy(headers, headerSize - 0x20);
  return Buffer.concat([headers, ...bodies, ...(overlay ? [Buffer.from(overlay, 'latin1')] : [])]);
}

/** One ELF note record. */
export function elfNote(owner, type, desc) {
  const name = Buffer.from(owner + '\0');
  return Buffer.concat([u32(name.length), u32(desc.length), u32(type), exePad4(name), exePad4(Buffer.from(desc))]);
}

/** .dynstr + .dynamic + .dynsym sections: needed libraries, RPATH/RUNPATH and undefined (imported) functions. */
export function elfDynamicSections({ needed = [], rpath, runpath, imports = [] } = {}) {
  const parts = [Buffer.from('\0')];
  let len = 1;
  const add = s => { const at = len; const b = Buffer.from(s + '\0'); parts.push(b); len += b.length; return at; };
  const tags = [...needed.map(n => [1, add(n)]), ...(rpath ? [[15, add(rpath)]] : []), ...(runpath ? [[29, add(runpath)]] : []), [0, 0]];
  const syms = [Buffer.alloc(24), ...imports.map(f => { const s = Buffer.alloc(24); s.writeUInt32LE(add(f), 0); s[4] = 0x12; return s; })];
  return [
    { name: '.dynstr', type: 3, data: Buffer.concat(parts) },
    { name: '.dynamic', type: 6, link: '.dynstr', data: Buffer.concat(tags.flatMap(([t, v]) => [u64(t), u64(v)])) },
    { name: '.dynsym', type: 11, link: '.dynstr', data: Buffer.concat(syms) },
  ];
}

/** .symtab + .strtab with defined functions, so the file does not count as stripped. */
export function elfSymtabSections(functions = ['main']) {
  const parts = [Buffer.from('\0')];
  let len = 1;
  const syms = [Buffer.alloc(24), ...functions.map(f => { const s = Buffer.alloc(24); s.writeUInt32LE(len, 0); s[4] = 0x12; s.writeUInt16LE(1, 6); const b = Buffer.from(f + '\0'); parts.push(b); len += b.length; return s; })];
  return [{ name: '.strtab', type: 3, data: Buffer.concat(parts) }, { name: '.symtab', type: 2, link: '.strtab', data: Buffer.concat(syms) }];
}

/** Minimal DWARF 4: one compile unit whose DW_AT_producer points into .debug_str. */
export function elfDwarfSections(producer) {
  const abbrev = Buffer.from([1, 0x11, 0, 0x25, 0x0e, 0x13, 0x0b, 0, 0, 0]);
  const body = Buffer.concat([exeU16(4), u32(0), Buffer.from([8]), Buffer.from([1]), u32(0), Buffer.from([0x0c])]);
  return [{ name: '.debug_abbrev', data: abbrev }, { name: '.debug_info', data: Buffer.concat([u32(body.length), body]) }, { name: '.debug_str', data: Buffer.from(producer + '\0') }];
}

/** Small ELF64 little-endian file. sections: [{ name, type = 1 (PROGBITS), data, flags, link: 'section name' }]. */
export function buildElf({ sections = [{ name: '.text', data: Buffer.alloc(32, 0x90) }], interp, type = 3, machine = 62, sectionHeaders = true } = {}) {
  const all = [{ name: '', type: 0, data: Buffer.alloc(0) }, ...(interp ? [{ name: '.interp', data: Buffer.from(interp + '\0') }] : []), ...sections];
  const names = [];
  let nameLen = 0;
  const nameOff = n => { const at = nameLen; const b = Buffer.from(n + '\0'); names.push(b); nameLen += b.length; return at; };
  for (const s of all) s.nameOff = nameOff(s.name);
  const shstr = { name: '.shstrtab', type: 3, nameOff: nameOff('.shstrtab') };
  shstr.data = Buffer.concat(names);
  all.push(shstr);
  const phnum = interp ? 1 : 0;
  let off = 64 + phnum * 56;
  const blobs = [];
  for (const s of all) { s.data = Buffer.from(s.data ?? ''); s.offset = off; const padded = exePad4(s.data); blobs.push(padded); off += padded.length; }
  const head = Buffer.alloc(64 + phnum * 56);
  Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0]).copy(head);
  head.writeUInt16LE(type, 16); head.writeUInt16LE(machine, 18); head.writeUInt32LE(1, 20); head.writeBigUInt64LE(0x1000n, 24);
  head.writeBigUInt64LE(phnum ? 64n : 0n, 32); head.writeBigUInt64LE(sectionHeaders ? BigInt(off) : 0n, 40);
  head.writeUInt16LE(64, 52); head.writeUInt16LE(56, 54); head.writeUInt16LE(phnum, 56); head.writeUInt16LE(64, 58);
  head.writeUInt16LE(sectionHeaders ? all.length : 0, 60); head.writeUInt16LE(sectionHeaders ? all.length - 1 : 0, 62);
  if (interp) { const p = 64, s = all[1]; head.writeUInt32LE(3, p); head.writeUInt32LE(4, p + 4); head.writeBigUInt64LE(BigInt(s.offset), p + 8); head.writeBigUInt64LE(BigInt(s.data.length), p + 32); head.writeBigUInt64LE(BigInt(s.data.length), p + 40); }
  const table = Buffer.alloc(sectionHeaders ? all.length * 64 : 0);
  if (sectionHeaders) all.forEach((s, i) => {
    const h = i * 64;
    table.writeUInt32LE(s.nameOff, h); table.writeUInt32LE(s.type ?? 1, h + 4); table.writeBigUInt64LE(BigInt(s.flags ?? 0), h + 8);
    table.writeBigUInt64LE(BigInt(i ? s.offset : 0), h + 24); table.writeBigUInt64LE(BigInt(s.data.length), h + 32);
    table.writeUInt32LE(s.link ? all.findIndex(x => x.name === s.link) : 0, h + 40);
  });
  return Buffer.concat([head, ...blobs, table]);
}

/** Embedded code signature (SuperBlob): code directory, optional XML entitlements and CMS blob. */
function buildMachOSignature({ identifier = 'com.example.app', teamId, entitlements, cms = false, flags = 0 } = {}) {
  const be = n => { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0); return b; };
  const blob = (magic, body) => Buffer.concat([be(magic), be(body.length + 8), body]);
  const ident = Buffer.from(identifier + '\0'), team = teamId ? Buffer.from(teamId + '\0') : Buffer.alloc(0);
  const cd = Buffer.alloc(88 - 8);
  cd.writeUInt32BE(0x20400, 0); cd.writeUInt32BE(flags, 4); cd.writeUInt32BE(88, 12); if (teamId) cd.writeUInt32BE(88 + ident.length, 40);
  const blobs = [[0, blob(0xfade0c02, Buffer.concat([cd, ident, team]))]];
  if (entitlements) blobs.push([5, blob(0xfade7171, Buffer.from(entitlements))]);
  if (cms) blobs.push([0x10000, blob(0xfade0b01, Buffer.alloc(64, 0x30))]);
  let off = 12 + blobs.length * 8;
  const index = blobs.map(([slot, b]) => { const e = Buffer.concat([be(slot), be(off)]); off += b.length; return e; });
  return Buffer.concat([be(0xfade0cc0), be(off), be(blobs.length), ...index, ...blobs.map(([, b]) => b)]);
}

/**
 * Small Mach-O 64-bit little-endian executable. segments: [{ name, sections: ['__text'], data }];
 * build: { platform, minos: [11, 0, 0], sdk: [14, 2, 0], tools: [[3, [1053, 12, 0]]] }; versionMin: { cmd: 0x24, minos, sdk };
 * symbols: { imports: ['_socket'], locals: ['_helper'] }; signature: see buildMachOSignature.
 */
export function buildMachO({ uuid, build, versionMin, segments = [{ name: '__TEXT', sections: ['__text'], data: Buffer.alloc(32, 0x90) }], dylibs = [], symbols, signature, cpu = 0x0100000c } = {}) {
  const v = ([a, b, c]) => ((a << 16) | (b << 8) | c) >>> 0;
  const fixed = (s, n) => { const b = Buffer.alloc(n); b.write(s, 'latin1'); return b; };
  const cmd = (id, body) => Buffer.concat([u32(id), u32(body.length + 8), body]);
  const strtab = [Buffer.from('\0')];
  let strLen = 1;
  const nlist = (name, type) => { const e = Buffer.alloc(16); e.writeUInt32LE(strLen, 0); e[4] = type; if (type & 0x0e) e[5] = 1; const b = Buffer.from(name + '\0'); strtab.push(b); strLen += b.length; return e; };
  const syms = symbols ? [...(symbols.locals ?? []).map(n => nlist(n, 0x0e)), ...(symbols.exports ?? []).map(n => nlist(n, 0x0f)), ...(symbols.imports ?? []).map(n => nlist(n, 0x01))] : [];
  const symData = Buffer.concat(syms), strData = Buffer.concat(strtab);
  const sig = signature ? buildMachOSignature(signature) : null;
  const make = base => {
    const cmds = [];
    let off = base;
    for (const s of segments) {
      const data = Buffer.from(s.data ?? '');
      const sects = (s.sections ?? []).map(n => { const e = Buffer.alloc(80); fixed(n, 16).copy(e, 0); fixed(s.name, 16).copy(e, 16); e.writeBigUInt64LE(BigInt(data.length), 40); e.writeUInt32LE(off, 48); return e; });
      const seg = Buffer.alloc(64);
      fixed(s.name, 16).copy(seg, 0); seg.writeBigUInt64LE(BigInt(off), 32); seg.writeBigUInt64LE(BigInt(data.length), 40); seg.writeUInt32LE(sects.length, 56);
      cmds.push(cmd(0x19, Buffer.concat([seg, ...sects])));
      off += data.length;
    }
    if (uuid) cmds.push(cmd(0x1b, Buffer.from(uuid.replace(/-/g, ''), 'hex')));
    if (build) cmds.push(cmd(0x32, Buffer.concat([u32(build.platform ?? 1), u32(v(build.minos)), u32(v(build.sdk)), u32((build.tools ?? []).length), ...(build.tools ?? []).flatMap(([tool, version]) => [u32(tool), u32(v(version))])])));
    if (versionMin) cmds.push(cmd(versionMin.cmd ?? 0x24, Buffer.concat([u32(v(versionMin.minos)), u32(v(versionMin.sdk))])));
    for (const d of dylibs) cmds.push(cmd(0xc, Buffer.concat([u32(24), u32(0), u32(0x10000), u32(0x10000), exePad4(Buffer.concat([Buffer.from(d + '\0'), Buffer.alloc(4)]))])));
    if (symbols) { cmds.push(cmd(0x2, Buffer.concat([u32(off), u32(syms.length), u32(off + symData.length), u32(strData.length)]))); off += symData.length + strData.length; }
    if (sig) cmds.push(cmd(0x1d, Buffer.concat([u32(off), u32(sig.length)])));
    return cmds;
  };
  const size = make(0).reduce((n, c) => n + c.length, 0);
  const cmds = make(32 + size);
  const head = Buffer.concat([u32(0xfeedfacf), u32(cpu), u32(0), u32(2), u32(cmds.length), u32(size), u32(0), u32(0)]);
  return Buffer.concat([head, ...cmds, ...segments.map(s => Buffer.from(s.data ?? '')), ...(symbols ? [symData, strData] : []), ...(sig ? [sig] : [])]);
}

/** A WebAssembly custom section. */
export function wasmCustomSection(name, payload) {
  const body = Buffer.concat([Buffer.from([name.length]), Buffer.from(name), payload]);
  return Buffer.concat([Buffer.from([0, body.length]), body]);
}

/** buildWasm() plus a `name` section (module name and function names) and a `producers` section. */
export function buildWasmWithNames({ moduleName = 'demo', functions = { 0: 'host_log', 1: 'run_game' }, producers = { language: [['Rust', '']], 'processed-by': [['rustc', '1.75.0']] } } = {}) {
  const str = s => Buffer.concat([Buffer.from([Buffer.byteLength(s)]), Buffer.from(s)]);
  const sub = (id, body) => Buffer.concat([Buffer.from([id, body.length]), body]);
  const fnNames = Object.entries(functions);
  const names = Buffer.concat([sub(0, str(moduleName)), sub(1, Buffer.concat([Buffer.from([fnNames.length]), ...fnNames.map(([i, n]) => Buffer.concat([Buffer.from([Number(i)]), str(n)]))]))]);
  const fields = Object.entries(producers);
  const prod = Buffer.concat([Buffer.from([fields.length]), ...fields.map(([f, vals]) => Buffer.concat([str(f), Buffer.from([vals.length]), ...vals.map(([n, ver]) => Buffer.concat([str(n), str(ver)]))]))]);
  return Buffer.concat([buildWasm(), wasmCustomSection('name', names), wasmCustomSection('producers', prod)]);
}

// ---------------------------------------------------------------- Python pickle (protocol 2) and Ren'Py .rpyc, written by hand
// Stand-ins for what Python's pickle module writes, for node shapes no real test file covers. No memo, no shared references.
const pk = (...parts) => Buffer.concat(parts.map(p => (Buffer.isBuffer(p) ? p : Buffer.from(p))));
const pkU32 = n => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };
const PK = Symbol('pickle');
export const py = {
  /** Class instance: GLOBAL, EMPTY_TUPLE, NEWOBJ, state, BUILD. state is a plain object (dict) or any other value (__setstate__ argument). */
  obj: (cls, state = {}) => ({ [PK]: () => pk(py.global(cls)[PK](), [0x29, 0x81], pickleValue(state), [0x62]) }),
  /** cls(*args) through NEWOBJ, e.g. a str subclass. */
  newobj: (cls, args, state) => ({ [PK]: () => pk(py.global(cls)[PK](), pickleValue(py.tuple(args)), [0x81], ...(state === undefined ? [] : [pickleValue(state), [0x62]])) }),
  reduce: (fn, args) => ({ [PK]: () => pk(py.global(fn)[PK](), pickleValue(py.tuple(args)), [0x52]) }),
  global: name => ({ [PK]: () => { const i = name.lastIndexOf('.'); return pk([0x63], Buffer.from(`${name.slice(0, i)}\n${name.slice(i + 1)}\n`, 'latin1')); } }),
  tuple: items => ({ [PK]: () => pk([0x28], ...items.map(pickleValue), [0x74]) }),
  set: items => ({ [PK]: () => pk(py.global('__builtin__.set')[PK](), [0x5d, 0x28], ...items.map(pickleValue), [0x65, 0x85, 0x52]) }),
  /** Python 2 str (SHORT_BINSTRING / BINSTRING). */
  str2: s => ({ [PK]: () => { const b = Buffer.from(s, 'latin1'); return b.length < 256 ? pk([0x55, b.length], b) : pk([0x54], pkU32(b.length), b); } }),
  /** renpy.ast.PyExpr: a str subclass created with (text, filename, linenumber). */
  expr: (text, line = 1, cls = 'renpy.ast.PyExpr') => py.newobj(cls, [text, 'game/script.rpy', line]),
  /** renpy.ast.PyCode: __setstate__((1, source, (file, line), mode)). */
  code: (source, line = 1, mode = 'exec') => py.obj('renpy.ast.PyCode', py.tuple([1, source, py.tuple(['game/script.rpy', line]), mode])),
};
export function pickleValue(v) {
  if (v === null || v === undefined) return Buffer.from([0x4e]);
  if (v[PK]) return v[PK]();
  if (v === true) return Buffer.from([0x88]);
  if (v === false) return Buffer.from([0x89]);
  if (typeof v === 'number' && Number.isInteger(v) && v >= -0x80000000 && v <= 0x7fffffff) { const b = Buffer.alloc(5); b[0] = 0x4a; b.writeInt32LE(v, 1); return b; }
  if (typeof v === 'number') { const b = Buffer.alloc(9); b[0] = 0x47; b.writeDoubleBE(v, 1); return b; }
  if (typeof v === 'bigint') { const bytes = []; let x = v; for (;;) { const byte = Number(x & 0xffn); bytes.push(byte); x >>= 8n; if ((x === 0n && !(byte & 0x80)) || (x === -1n && byte & 0x80)) break; } return pk([0x8a, bytes.length], bytes); }
  if (typeof v === 'string') { const b = Buffer.from(v, 'utf8'); return pk([0x58], pkU32(b.length), b); }
  if (Buffer.isBuffer(v)) return pk([0x42], pkU32(v.length), v);
  if (Array.isArray(v)) return pk([0x5d, 0x28], ...v.map(pickleValue), [0x65]);
  const pairs = v instanceof Map ? [...v] : Object.entries(v);
  return pk([0x7d, 0x28], ...pairs.flatMap(([k, x]) => [pickleValue(k), pickleValue(x)]), [0x75]);
}
export const buildPickle = (value, protocol = 2) => pk([0x80, protocol], pickleValue(value), [0x2e]);
/** A Ren'Py compiled script: RPYC2 (slot 1 = zlib pickle of (data, stmts)), or the legacy file without header. */
export function buildRpyc(stmts, { data = { version: 5003000, key: 'unlocked' }, legacy = false, slot = 1 } = {}) {
  const blob = zlib.deflateSync(buildPickle(py.tuple([data, stmts])));
  if (legacy) return blob;
  const header = Buffer.alloc(10 + 24);
  header.write('RENPY RPC2', 0, 'latin1');
  header.writeUInt32LE(slot, 10); header.writeUInt32LE(header.length, 14); header.writeUInt32LE(blob.length, 18);
  return Buffer.concat([header, blob]);
}

// ---------------------------------------------------------------- GameMaker data.win with GML bytecode (self-built)
// A tiny assembler for GML assembly text in UndertaleModTool's notation, and a writer for the code-related chunks
// (GEN8, SCPT, GLOB, OBJT, ROOM, CODE, VARI, FUNC, STRG). No game file is involved: everything is built here.
const GML_T = { d: 0, f: 1, i: 2, l: 3, b: 4, v: 5, s: 6, e: 15 };
const GML_OPS = { conv: 0x07, mul: 0x08, div: 0x09, rem: 0x0a, mod: 0x0b, add: 0x0c, sub: 0x0d, and: 0x0e, or: 0x0f, xor: 0x10, neg: 0x11, not: 0x12, shl: 0x13, shr: 0x14, cmp: 0x15, pop: 0x45, pushi: 0x84, dup: 0x86, callv: 0x99, ret: 0x9c, exit: 0x9d, popz: 0x9e, b: 0xb6, bt: 0xb7, bf: 0xb8, pushenv: 0xba, popenv: 0xbb, push: 0xc0, pushloc: 0xc1, pushglb: 0xc2, pushbltn: 0xc3, call: 0xd9, break: 0xff };
const GML_OLD_OPS = { conv: 0x03, mul: 0x04, div: 0x05, rem: 0x06, mod: 0x07, add: 0x08, sub: 0x09, and: 0x0a, or: 0x0b, xor: 0x0c, neg: 0x0d, not: 0x0e, shl: 0x0f, shr: 0x10, pop: 0x41, dup: 0x82, ret: 0x9d, exit: 0x9e, popz: 0x9f, b: 0xb7, bt: 0xb8, bf: 0xb9, pushenv: 0xbb, popenv: 0xbc, push: 0xc0, pushi: 0xc0, pushloc: 0xc0, pushglb: 0xc0, pushbltn: 0xc0, call: 0xda, break: 0xff };
const GML_INST = { self: -1, other: -2, all: -3, noone: -4, global: -5, builtin: -6, local: -7, stacktop: -9, arg: -15, static: -16 };
const GML_REF = { array: 0x00, stacktop: 0x80, normal: 0xa0, instance: 0xe0, arraypushaf: 0x10, arraypopaf: 0x90 };
const GML_CMP = { LT: 1, LTE: 2, EQ: 3, NEQ: 4, GTE: 5, GT: 6 };
const GML_BREAK = { chkindex: -1, pushaf: -2, popaf: -3, pushac: -4, setowner: -5, isstaticok: -6, setstatic: -7, savearef: -8, restorearef: -9, chknullish: -10, pushref: -11 };
const GML_GOTO = new Set(['b', 'bt', 'bf', 'pushenv', 'popenv']);

/** Assembles GML assembly text. Returns { bytes, refs: [{ at, kind: 'var'|'func'|'str', name, inst, ref }], labels }. */
export function assembleGml(text, { bytecode = 16 } = {}) {
  const old = bytecode <= 14;
  const lines = text.split('\n').map(l => l.replace(/\s+;.*$/, '').trim()).filter(Boolean);
  const parsed = [], labels = {};
  let at = 0;
  for (const line of lines) {
    if (line.startsWith('>')) continue; // marks a function inside the entry in disassembly
    if (line.startsWith(':')) { labels[line.slice(1)] = at; continue; }
    const m = /^([a-z]+)((?:\.[a-z])*)\s*(.*)$/.exec(line);
    if (!m) throw new Error(`bad assembly line: ${line}`);
    const types = m[2].split('.').filter(Boolean);
    const ins = { op: m[1], t: types, arg: m[3], at };
    if (ins.op in GML_BREAK) { ins.ext = GML_BREAK[ins.op]; ins.op = 'break'; }
    if (ins.op === 'raw') ins.size = 4;
    else if (ins.op === 'pop') ins.size = types[0] === 'e' ? 4 : 8;
    else if (ins.op.startsWith('push') && ins.op !== 'pushenv') ins.size = { d: 12, l: 12, e: 4 }[types[0]] ?? 8;
    else if (ins.op === 'call' || (ins.op === 'break' && types[0] === 'i')) ins.size = 8;
    else ins.size = 4;
    parsed.push(ins);
    at += ins.size;
  }
  labels.end = labels['[end]'] = at;
  const bytes = Buffer.alloc(at), refs = [];
  const variable = (ins, operand) => {
    const v = /^(?:(-?\d+|self|other|all|noone|global|builtin|local|stacktop|arg|static)\.)?(?:\[(\w+)\](\w+)\.)?([\w$@]+)$/.exec(operand);
    if (!v) throw new Error(`bad variable operand: ${operand}`);
    const inst = v[1] == null ? 0 : v[1] in GML_INST ? GML_INST[v[1]] : Number(v[1]);
    refs.push({ at: ins.at, kind: 'var', name: v[4], inst: v[3] ? GML_INST[v[3]] : inst, ref: GML_REF[v[2] ?? 'normal'] });
    return inst & 0xffff;
  };
  for (const ins of parsed) {
    const p = ins.at, [a, b] = ins.t.map(t => GML_T[t]);
    if (ins.op === 'raw') { bytes.writeUInt32LE(Number(ins.arg) >>> 0, p); continue; }
    let kind = (old ? GML_OLD_OPS : GML_OPS)[ins.op];
    if (ins.op === 'cmp') kind = old ? 0x10 + GML_CMP[ins.arg] : 0x15;
    if (kind == null) throw new Error(`${ins.op} does not exist in bytecode ${bytecode}`);
    let word;
    if (GML_GOTO.has(ins.op)) {
      if (ins.arg === '<drop>') word = 0xf00000;
      else { if (!(ins.arg in labels)) throw new Error(`unknown label ${ins.arg}`); word = ((labels[ins.arg] - p) / 4) & (old ? 0xffffff : 0x7fffff); }
    } else if (ins.op === 'cmp') word = (b << 20) | (a << 16) | (old ? 0 : GML_CMP[ins.arg] << 8);
    else if (ins.op === 'pop') {
      if (ins.t[0] === 'e') word = (b << 20) | (a << 16) | Number(ins.arg);
      else word = (b << 20) | (a << 16) | variable(ins, ins.arg);
    } else if (ins.op.startsWith('push')) {
      word = a << 16;
      const t = ins.t[0];
      if (t === 'e') word |= Number(ins.arg) & 0xffff;
      else if (t === 'd') bytes.writeDoubleLE(Number(ins.arg), p + 4);
      else if (t === 'l') bytes.writeBigInt64LE(BigInt(ins.arg), p + 4);
      else if (t === 'v') word |= variable(ins, ins.arg);
      else if (t === 's') refs.push({ at: p, kind: 'str', name: JSON.parse(ins.arg.replace(/@\d+$/, '')) });
      else if (ins.arg.startsWith('[function]')) refs.push({ at: p, kind: 'func', name: ins.arg.slice(10) });
      else if (ins.arg.startsWith('[variable]')) refs.push({ at: p, kind: 'var', name: ins.arg.slice(10), inst: -1, ref: 0 });
      else bytes.writeInt32LE(Number(ins.arg), p + 4);
    } else if (ins.op === 'call') {
      const c = /^(.+)\(argc=(\d+)\)$/.exec(ins.arg);
      word = (a << 16) | Number(c[2]);
      refs.push({ at: p, kind: 'func', name: c[1] });
    } else if (ins.op === 'break') {
      word = (a << 16) | ((ins.ext ?? Number(ins.arg)) & 0xffff);
      if (ins.t[0] === 'i') { if (/^-?\d+$/.test(ins.arg)) bytes.writeInt32LE(Number(ins.arg), p + 4); else refs.push({ at: p, kind: 'func', name: ins.arg }); }
    } else word = ((b ?? 0) << 20) | (a << 16) | (ins.op === 'dup' || ins.op === 'callv' ? Number(ins.arg.split(' ')[0]) | (ins.arg.includes(' ') ? ((Number(ins.arg.split(' ')[1]) & 0x7f) | 0x80) << 8 : 0) : 0); // the second dup operand (swap size) is stored with bit 7 set
    bytes.writeUInt32LE(((kind << 24) | word) >>> 0, p);
  }
  return { bytes, refs, labels };
}

/**
 * A GameMaker data file (FORM) with GML bytecode. code: [{ name, asm, locals, args }] or, for a function inside
 * another entry (2.3+), { name, parent: <index>, label, args, locals }. scripts: [{ name, code, isConstructor }],
 * objects: [{ name, events: [{ type, subtype, code }] }], rooms: [{ name, code, instances: [{ id, code }] }],
 * globalInit: [code index]. yyc: 'empty' (CODE/VARI/FUNC present but empty) or 'missing'.
 */
export function buildGameMakerCodeData({ bytecode = 16, major = bytecode >= 17 ? 2 : 1, name = 'TinyGame', code = [], scripts = [], objects = [], rooms = [], globalInit = [], functionRefPlus4 = bytecode >= 17, managed = false, yyc = null } = {}) {
  const out = Buffer.alloc(1 << 18);
  let pos = 0;
  const u32 = v => { out.writeUInt32LE(v >>> 0, pos); pos += 4; };
  const f32 = v => { out.writeFloatLE(v, pos); pos += 4; };
  const strings = [], stringFix = [];
  const strId = s => { let i = strings.indexOf(s); if (i < 0) { i = strings.length; strings.push(s); } return i; };
  const str = s => { stringFix.push([pos, strId(s)]); u32(0); };
  const chunk = (id, body) => { out.write(id, pos, 'latin1'); pos += 4; const lenAt = pos; pos += 4; body(); out.writeUInt32LE(pos - lenAt - 4, lenAt); };
  const ptrList = (items, write) => { u32(items.length); const table = pos; pos += 4 * items.length; items.forEach((item, i) => { out.writeUInt32LE(pos, table + 4 * i); write(item); }); };
  out.write('FORM', 0, 'latin1'); pos = 8;
  chunk('GEN8', () => { const start = pos; out[pos + 1] = bytecode; pos += 4; str(`${name}.gmx`); str('Default'); u32(100000); u32(10000000); u32(1); pos += 16; str(name); u32(major); u32(bytecode >= 17 ? 3 : 4); u32(0); u32(1); u32(640); u32(480); pos = start + 0x64; str(name); pos = start + 0x84; });
  chunk('SCPT', () => ptrList(scripts, s => { str(s.name); u32(s.isConstructor ? (s.code | 0x80000000) >>> 0 : s.code); }));
  if (globalInit.length) chunk('GLOB', () => { u32(globalInit.length); globalInit.forEach(u32); });
  chunk('OBJT', () => ptrList(objects, o => {
    str(o.name); u32(-1); u32(1); if (managed) u32(0); u32(0); u32(0); u32(0); u32(-100); u32(-1); u32(0); u32(0); u32(0); f32(0.5); f32(0.1); u32(0); f32(0.1); f32(0.1); u32(0); f32(0.2); u32(1); u32(0);
    const byType = Array.from({ length: 12 }, (_, type) => (o.events ?? []).filter(e => e.type === type));
    ptrList(byType, list => ptrList(list, e => { u32(e.subtype ?? 0); ptrList([e], a => { u32(1); u32(603); u32(7); u32(0); u32(0); u32(1); u32(2); str(''); u32(a.code); u32(1); u32(-1); u32(0); u32(0); u32(0); }); }));
  }));
  chunk('ROOM', () => ptrList(rooms, r => {
    const start = pos;
    str(r.name); str(''); u32(640); u32(480); u32(30); u32(0); u32(0); u32(1); u32(r.code ?? -1); u32(0);
    const lists = pos; pos = start + 88;
    const empty = pos; u32(0);
    const instancesAt = pos;
    ptrList(r.instances ?? [], inst => { u32(0); u32(0); u32(0); u32(inst.id); u32(inst.code); f32(1); f32(1); u32(0xffffffff); f32(0); if (bytecode >= 16) u32(-1); });
    [empty, empty, instancesAt, empty].forEach((ptr, i) => out.writeUInt32LE(ptr, lists + 4 * i));
  }));
  const variables = new Map(), functions = new Map(), stringRefs = [];
  const note = (map, key, make, address) => { if (!map.has(key)) map.set(key, { ...make, uses: [] }); map.get(key).uses.push(address); };
  if (yyc === 'empty') for (const id of ['CODE', 'VARI', 'FUNC']) chunk(id, () => {});
  else if (yyc !== 'missing') {
    const roots = code.map(c => (c.parent == null ? assembleGml(c.asm, { bytecode }) : null));
    chunk('CODE', () => {
      const place = (asm, address) => { asm.bytes.copy(out, address); for (const r of asm.refs) { if (r.kind === 'str') stringRefs.push([address + r.at + 4, r.name]); else if (r.kind === 'var') note(variables, `${r.inst}.${r.name}`, { name: r.name, inst: r.inst }, { at: address + r.at, ref: r.ref }); else note(functions, r.name, { name: r.name }, { at: address + r.at, ref: 0 }); } };
      if (bytecode <= 14) ptrList(code, (c, i) => { const asm = roots[code.indexOf(c)]; str(c.name); u32(asm.bytes.length); place(asm, pos); pos += asm.bytes.length; });
      else {
        u32(code.length); const table = pos; pos += 4 * code.length;
        const blobs = roots.map(asm => { if (!asm) return null; const address = pos; place(asm, address); pos += asm.bytes.length; return address; });
        code.forEach((c, i) => {
          out.writeUInt32LE(pos, table + 4 * i);
          const root = c.parent ?? i, asm = roots[root];
          str(c.name); u32(asm.bytes.length); out.writeUInt16LE(c.locals ?? 0, pos); out.writeUInt16LE(c.args ?? 0, pos + 2); pos += 4;
          out.writeInt32LE(blobs[root] - pos, pos); pos += 4; u32(c.parent == null ? 0 : asm.labels[c.label]);
        });
      }
    });
    // reference chains: each use holds the distance to the next one; the last holds the name's string id
    const chain = (item, nameId) => item.uses.forEach((u, i) => { const next = item.uses[i + 1]; out.writeInt32LE(((next ? next.at - u.at : nameId) & 0x07ffffff) | (u.ref << 24), u.at + 4); });
    chunk('VARI', () => { if (bytecode >= 15) { u32(variables.size); u32(variables.size); u32(4); } for (const v of variables.values()) { chain(v, strId(v.name)); str(v.name); if (bytecode >= 15) { u32(v.inst); u32(0); } u32(v.uses.length); u32(v.uses[0].at); } });
    chunk('FUNC', () => { if (bytecode >= 15) u32(functions.size); for (const f of functions.values()) { chain(f, strId(f.name)); str(f.name); u32(f.uses.length); u32(f.uses[0].at + (functionRefPlus4 ? 4 : 0)); } if (bytecode >= 15) u32(0); });
  }
  for (const [, s] of stringRefs) strId(s);
  chunk('STRG', () => {
    const at = [];
    ptrList(strings, s => { const b = Buffer.from(s, 'utf8'); u32(b.length); at.push(pos); b.copy(out, pos); pos += b.length + 1; });
    for (const [where, id] of stringFix) out.writeUInt32LE(at[id], where);
    for (const [where, s] of stringRefs) out.writeUInt32LE(strings.indexOf(s), where);
  });
  out.writeUInt32LE(pos - 8, 4);
  return out.subarray(0, pos);
}
