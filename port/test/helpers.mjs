// Test helpers: build small but real binary fixtures in memory (Godot packs v1/v2/v3, embedded packs,
// a .NET assembly, ZIP, asar) so the tests need no downloads and no external tools.
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
