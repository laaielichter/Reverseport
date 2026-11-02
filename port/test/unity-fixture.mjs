// Test fixtures for Unity data, built in memory: LZ4 and LZMA streams (literal-only encoders: valid streams the
// decoders must read like any other), serialized files with and without type trees, UnityFS bundles and a small
// player-build folder. No Unity, no downloads.
import fs from 'node:fs/promises';
import path from 'node:path';

// ---------------------------------------------------------------- compressors
/** One LZ4 block with a single literal run. */
export function lz4Literal(buf) {
  const len = buf.length, head = [Math.min(len, 15) << 4];
  if (len >= 15) { let n = len - 15; while (n >= 255) { head.push(255); n -= 255; } head.push(n); }
  return Buffer.concat([Buffer.from(head), buf]);
}

/** Raw LZMA (lc=3 lp=0 pb=2) with literals only: { props, data }. */
export function lzmaLiteral(buf) {
  const probs = new Uint16Array(0x300 * 8 + 16 * 12).fill(1024);
  const IS_MATCH = 0x300 * 8; // isMatch[state 0 << 4 + posState] after the literal table
  const out = [];
  let low = 0, range = 0xffffffff, cache = 0, cacheSize = 1;
  const shiftLow = () => {
    if (low < 0xff000000 || low >= 0x100000000) {
      const carry = low >= 0x100000000 ? 1 : 0;
      let temp = cache;
      do { out.push((temp + carry) & 0xff); temp = 0xff; } while (--cacheSize !== 0);
      cache = Math.floor(low / 0x1000000) & 0xff;
    }
    cacheSize++;
    low = (low % 0x1000000) * 256;
  };
  const bit = (i, b) => {
    const p = probs[i], bound = (range >>> 11) * p;
    if (b === 0) { range = bound; probs[i] = p + ((2048 - p) >> 5); }
    else { low += bound; range = (range - bound) >>> 0; probs[i] = p - (p >> 5); }
    while (range < 0x1000000) { range = (range * 256) >>> 0; shiftLow(); }
  };
  let prev = 0;
  for (let o = 0; o < buf.length; o++) {
    bit(IS_MATCH + (o & 3), 0);
    const base = 0x300 * (prev >> 5);
    let ctx = 1;
    for (let i = 7; i >= 0; i--) { const b = (buf[o] >> i) & 1; bit(base + ctx, b); ctx = (ctx << 1) | b; }
    prev = buf[o];
  }
  for (let i = 0; i < 5; i++) shiftLow();
  const props = Buffer.from([93, 0, 0, 1, 0]); // (pb*5+lp)*9+lc, 64 KiB dictionary
  return { props, data: Buffer.from(out) };
}

// ---------------------------------------------------------------- little writers
const le32 = n => { const b = Buffer.alloc(4); b.writeInt32LE(n); return b; };
const leU32 = n => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
const le64 = n => { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(n)); return b; };
const be32 = n => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
const be64 = n => { const b = Buffer.alloc(8); b.writeBigInt64BE(BigInt(n)); return b; };
const pad4 = b => Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4)]);

/** Object field writers (little-endian, Unity's aligned layout; objects start 8-aligned). */
export const W = {
  i32: le32, u32: leU32, i64: le64, f32: n => { const b = Buffer.alloc(4); b.writeFloatLE(n); return b; },
  u8: n => Buffer.from([n]),
  str: s => pad4(Buffer.concat([le32(Buffer.byteLength(s)), Buffer.from(s)])),
  bytes: b => pad4(Buffer.concat([le32(b.length), b])),
  pptr: (fileId, pathId) => Buffer.concat([le32(fileId), le64(pathId)]),
  bool: v => Buffer.from([v ? 1 : 0, 0, 0, 0]),
};

// ---------------------------------------------------------------- type trees
/**
 * A type-tree blob from [level, type, name, byteSize, meta] rows. Names listed in `common` use Unity's shared
 * string table (offset | 0x80000000), the rest go in the local string buffer.
 */
export function typeTree(rows, version, common = {}) {
  const strings = [];
  const local = s => { const at = Buffer.concat(strings).length; strings.push(Buffer.from(`${s}\0`)); return at; };
  const cache = new Map();
  const ref = s => { if (s in common) return (0x80000000 | common[s]) >>> 0; if (!cache.has(s)) cache.set(s, local(s)); return cache.get(s); };
  const nodes = rows.map(([level, type, name, byteSize, meta = 0], i) => {
    const b = Buffer.alloc(version >= 19 ? 32 : 24);
    b.writeUInt16LE(1, 0); b[2] = level; b[3] = 0; b.writeUInt32LE(ref(type), 4); b.writeUInt32LE(ref(name), 8);
    b.writeInt32LE(byteSize, 12); b.writeInt32LE(i, 16); b.writeInt32LE(meta, 20);
    return b;
  });
  const str = Buffer.concat(strings);
  return Buffer.concat([le32(rows.length), le32(str.length), ...nodes, str]);
}
const ALIGN = 0x4000;
/** Type-tree rows for an aligned string field at `level`. */
export const stringRows = (level, name) => [[level, 'string', name, -1, ALIGN], [level + 1, 'Array', 'Array', -1, ALIGN], [level + 2, 'int', 'size', 4], [level + 2, 'char', 'data', 1]];
export const pptrRows = (level, name, type) => [[level, `PPtr<${type}>`, name, 12], [level + 1, 'int', 'm_FileID', 4], [level + 1, 'SInt64', 'm_PathID', 8]];

// ---------------------------------------------------------------- serialized file
/**
 * Unity serialized file. types: [{ classId, tree? }]; objects: [{ pathId, type (index), data }]; externals: names.
 */
export function serializedFile({ version = 22, unityVersion = '2022.3.10f1', platform = 19, typeTree: withTrees = false, types, objects, externals = [] }) {
  const headerSize = version >= 22 ? 48 : 20;
  const meta = [];
  meta.push(Buffer.from(`${unityVersion}\0`), le32(platform), Buffer.from([withTrees ? 1 : 0]), le32(types.length));
  for (const t of types) {
    meta.push(le32(t.classId), Buffer.from([0]), Buffer.alloc(2, 0xff));
    if (t.classId === 114) meta.push(Buffer.alloc(16, 1));
    meta.push(Buffer.alloc(16, 2));
    if (withTrees) {
      if (version >= 23) meta.push(Buffer.alloc(16, 3), le32(t.tree ? 1 : 0));
      if (t.tree) meta.push(t.tree);
      if (version >= 21) meta.push(le32(0));
    }
  }
  const metaLen = () => meta.reduce((n, b) => n + b.length, 0);
  meta.push(le32(objects.length));
  // Object data, each 8-aligned after dataOffset (computed once the metadata size is known).
  const placed = []; let off = 0;
  for (const o of objects) { placed.push(off); off = Math.ceil((off + o.data.length) / 8) * 8; }
  const objectRows = [];
  for (let i = 0; i < objects.length; i++) {
    const at = headerSize + metaLen() + objectRows.reduce((n, b) => n + b.length, 0);
    const pad = Buffer.alloc((4 - (at % 4)) % 4);
    const row = [pad, le64(objects[i].pathId), version >= 22 ? le64(placed[i]) : leU32(placed[i]), leU32(objects[i].data.length), le32(objects[i].type)];
    objectRows.push(Buffer.concat(row));
  }
  meta.push(...objectRows, le32(0), le32(externals.length));
  for (const e of externals) meta.push(Buffer.from('\0'), Buffer.alloc(16), le32(0), Buffer.from(`${e}\0`));
  if (version >= 20) meta.push(le32(0));
  meta.push(Buffer.from('\0'));
  const metadata = Buffer.concat(meta);
  const dataOffset = Math.ceil((headerSize + metadata.length) / 16) * 16;
  const data = Buffer.alloc(off);
  objects.forEach((o, i) => o.data.copy(data, placed[i]));
  const fileSize = dataOffset + data.length;
  const header = version >= 22
    ? Buffer.concat([be32(0), be32(0), be32(version), be32(0), Buffer.from([0, 0, 0, 0]), be32(metadata.length), be64(fileSize), be64(dataOffset), be64(0)])
    : Buffer.concat([be32(metadata.length), be32(fileSize), be32(version), be32(dataOffset), Buffer.from([0, 0, 0, 0])]);
  return Buffer.concat([header, metadata, Buffer.alloc(dataOffset - headerSize - metadata.length), data]);
}

// ---------------------------------------------------------------- UnityFS bundle
/**
 * UnityFS bundle with the given files ([{ path, data, flags }]) in one block. compression: 'lz4' | 'lzma' | 'none';
 * infoAtEnd puts the block table at the end of the file.
 */
export function unityBundle(files, { compression = 'lz4', format = 7, revision = '2022.3.10f1', infoAtEnd = false, encrypted = false } = {}) {
  const payload = Buffer.concat(files.map(f => f.data));
  let block, kind;
  if (compression === 'lz4') { block = lz4Literal(payload); kind = 2; }
  else if (compression === 'lzma') { const { props, data } = lzmaLiteral(payload); block = Buffer.concat([props, data]); kind = 1; }
  else { block = payload; kind = 0; }
  let off = 0;
  const nodes = files.map(f => { const n = Buffer.concat([be64(off), be64(f.data.length), be32(f.flags ?? 0), Buffer.from(`${f.path}\0`)]); off += f.data.length; return n; });
  const blockRow = Buffer.alloc(10); blockRow.writeUInt32BE(payload.length, 0); blockRow.writeUInt32BE(block.length, 4); blockRow.writeUInt16BE(kind, 8);
  const info = Buffer.concat([Buffer.alloc(16), be32(1), blockRow, be32(files.length), ...nodes]);
  const infoPacked = lz4Literal(info);
  let flags = 2 | 0x40 | (infoAtEnd ? 0x80 : 0) | (encrypted ? 0x1000 : 0);
  const fixed = Buffer.concat([Buffer.from('UnityFS\0'), be32(format), Buffer.from('5.x.x\0'), Buffer.from(`${revision}\0`)]);
  const headLen = fixed.length + 8 + 12;
  const aligned = format >= 7 ? Math.ceil(headLen / 16) * 16 : headLen;
  const parts = [fixed];
  const total = aligned + infoPacked.length + block.length;
  parts.push(be64(total), be32(infoPacked.length), be32(info.length), be32(flags), Buffer.alloc(aligned - headLen));
  if (infoAtEnd) parts.push(block, infoPacked); else parts.push(infoPacked, block);
  return Buffer.concat(parts);
}

// ---------------------------------------------------------------- objects
export const obj = {
  gameObject: (name, components = []) => Buffer.concat([W.i32(components.length), ...components.map(([f, p]) => W.pptr(f, p)), W.u32(0), W.str(name)]),
  monoBehaviour: (go, script, name = '', extra = Buffer.alloc(0)) => Buffer.concat([W.pptr(0, go), W.bool(true), W.pptr(...script), W.str(name), extra]),
  monoScript: (name, className, namespace, assembly) => Buffer.concat([W.str(name), W.i32(0), Buffer.alloc(16, 9), W.str(className), W.str(namespace), W.str(assembly)]),
  textAsset: (name, content) => Buffer.concat([W.str(name), W.bytes(Buffer.from(content))]),
  assetBundle: (name, container) => Buffer.concat([W.str(name), W.i32(0), W.i32(container.length), ...container.map(([p, pathId]) => Buffer.concat([W.str(p), W.i32(0), W.i32(0), W.pptr(0, pathId)]))]),
  buildSettings: scenes => Buffer.concat([W.i32(scenes.length), ...scenes.map(W.str)]),
  /** Texture2D as Unity 2019 lays it out (no type tree): pixels inline or in a .resS. */
  texture2D: (name, { width, height, format, image = Buffer.alloc(0), stream = null }) => Buffer.concat([
    W.str(name), W.i32(-1), W.bool(false), W.i32(width), W.i32(height), W.i32(stream ? stream.size : image.length), W.i32(format), W.i32(1),
    W.bool(false), W.bool(false), W.i32(0), W.i32(1), W.i32(0), W.i32(0), W.i32(1), W.i32(1), W.i32(1), W.f32(0), W.f32(0), W.i32(0), W.i32(0), W.i32(0), W.i32(1),
    W.bytes(image), stream ? Buffer.concat([W.u32(stream.offset), W.u32(stream.size), W.str(stream.path)]) : Buffer.concat([W.u32(0), W.u32(0), W.str('')]),
  ]),
  /** AudioClip (Unity 5+) whose data is in a .resource file. */
  audioClip: (name, res) => Buffer.concat([W.str(name), W.i32(1), W.i32(1), W.i32(44100), W.i32(16), W.f32(1.5), W.bool(false), W.i32(0), W.bool(true), W.str(res.path), W.i64(res.offset), W.i64(res.size), W.i32(2)]),
};

/**
 * A small Windows player build: Game.exe, UnityPlayer.dll, Game_Data/{globalgamemanagers, globalgamemanagers.assets,
 * level0, sharedassets0.assets, sharedassets0.assets.resS, sharedassets0.resource}. Returns paths and the payloads.
 */
export async function playerBuild(dir) {
  const data = path.join(dir, 'Game_Data');
  await fs.mkdir(data, { recursive: true });
  await fs.writeFile(path.join(dir, 'Game.exe'), Buffer.from('MZ'));
  await fs.writeFile(path.join(dir, 'UnityPlayer.dll'), Buffer.from('MZ'));
  const v = { version: 17, unityVersion: '2019.4.40f1' };
  await fs.writeFile(path.join(data, 'globalgamemanagers'), serializedFile({ ...v, types: [{ classId: 141 }], objects: [{ pathId: 1, type: 0, data: obj.buildSettings(['Assets/Scenes/Menu.unity', 'Assets/Scenes/Level1.unity']) }] }));
  await fs.writeFile(path.join(data, 'globalgamemanagers.assets'), serializedFile({ ...v, types: [{ classId: 115 }], objects: [
    { pathId: 10, type: 0, data: obj.monoScript('Player', 'Player', 'Game', 'Assembly-CSharp.dll') },
    { pathId: 11, type: 0, data: obj.monoScript('Enemy', 'Enemy', 'Game.AI', 'Assembly-CSharp.dll') },
  ] }));
  await fs.writeFile(path.join(data, 'level0'), serializedFile({ ...v, types: [{ classId: 1 }, { classId: 114 }, { classId: 4 }], externals: ['globalgamemanagers.assets'], objects: [
    { pathId: 1, type: 0, data: obj.gameObject('Hero', [[0, 2], [0, 3]]) },
    { pathId: 2, type: 2, data: Buffer.concat([W.pptr(0, 1), Buffer.alloc(40)]) },
    { pathId: 3, type: 1, data: obj.monoBehaviour(1, [1, 10], '', W.f32(5)) },
    { pathId: 4, type: 0, data: obj.gameObject('Goblin', [[0, 5]]) },
    { pathId: 5, type: 1, data: obj.monoBehaviour(4, [1, 11]) },
    { pathId: 6, type: 0, data: obj.gameObject('Goblin', [[0, 7]]) },
    { pathId: 7, type: 1, data: obj.monoBehaviour(6, [1, 11]) },
  ] }));
  // 4x2 RGBA32 inline (rows bottom-up) and a 4x4 DXT1 block in the .resS; audio bytes in the .resource.
  const rgba = Buffer.from([...Array(8)].flatMap((_, i) => (i < 4 ? [255, 0, 0, 255] : [0, 0, 255, 255])));
  const dxt = Buffer.from([0x00, 0xf8, 0x1f, 0x00, 0, 0, 0, 0]); // color0 red, color1 blue, all pixels index 0
  const resS = Buffer.concat([Buffer.alloc(16), dxt]);
  const fsb = Buffer.concat([Buffer.from('FSB5'), Buffer.alloc(60)]);
  const resource = Buffer.concat([Buffer.alloc(32), fsb]);
  await fs.writeFile(path.join(data, 'sharedassets0.assets.resS'), resS);
  await fs.writeFile(path.join(data, 'sharedassets0.resource'), resource);
  await fs.writeFile(path.join(data, 'sharedassets0.assets'), serializedFile({ ...v, types: [{ classId: 49 }, { classId: 28 }, { classId: 83 }], objects: [
    { pathId: 1, type: 0, data: obj.textAsset('dialogue', '{"hello":"wereld"}') },
    { pathId: 2, type: 1, data: obj.texture2D('flag', { width: 4, height: 2, format: 4, image: rgba }) },
    { pathId: 3, type: 1, data: obj.texture2D('tile', { width: 4, height: 4, format: 10, stream: { offset: 16, size: 8, path: 'sharedassets0.assets.resS' } }) },
    { pathId: 4, type: 2, data: obj.audioClip('jump', { path: 'sharedassets0.resource', offset: 32, size: fsb.length }) },
  ] }));
  return { root: dir, data, rgba, fsb };
}
