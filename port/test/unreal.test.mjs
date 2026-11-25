// Tests for port/src/unreal.mjs (.uasset/.umap summary + tables, IoStore .utoc, .locres, GVAS saves).
//
// IMPORTANT: every fixture here is built in memory by the small writers in this file, which were written from
// the same layout knowledge as the reader. They prove that reader and writer agree (internal consistency) and
// that the tool's output shape, caps, match and `partial` handling work. They do NOT prove the layouts match
// real engine output. That was cross-checked by hand, outside this suite, against public files (see the
// worker's report): packages from the UAssetAPI and retoc test assets, GVAS saves from uesave-rs, and the four
// .locres versions from UnrealLocres. No real .utoc was available: the .utoc layout rests on CUE4Parse's
// FIoStoreTocHeader/FIoStoreTocResource only.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { unrealTool, readPackage, readUtoc, parseLocres, readGvas } from '../src/unreal.mjs';

// ---------------------------------------------------------------- little-endian writers
const u8 = n => Buffer.from([n & 0xff]);
const u16 = n => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const i32 = n => { const b = Buffer.alloc(4); b.writeInt32LE(n); return b; };
const u32 = n => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };
const i64 = n => { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(n)); return b; };
const u64 = n => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
const f32 = n => { const b = Buffer.alloc(4); b.writeFloatLE(n); return b; };
const f64 = n => { const b = Buffer.alloc(8); b.writeDoubleLE(n); return b; };
const cat = (...parts) => Buffer.concat(parts.flat(Infinity));
const zeros = n => Buffer.alloc(n);
/** FString: ANSI with terminator, or UTF-16LE with a negative length when the text is not ASCII. */
const fstr = s => {
  if (s === '') return i32(0);
  if (/^[\x00-\x7f]*$/.test(s)) return cat(i32(s.length + 1), Buffer.from(s, 'latin1'), u8(0));
  return cat(i32(-(s.length + 1)), Buffer.from(s, 'utf16le'), u16(0));
};
const guid = (a, b, c, d) => cat(u32(a), u32(b), u32(c), u32(d));
const GUID0 = zeros(16);

// ---------------------------------------------------------------- package writer
const NAMES = ['/Script/CoreUObject', 'Package', '/Script/Engine', 'Class', 'StaticMesh', '/Game/Props/SM_Crate', 'SM_Crate', 'BodySetup', 'None'];
const N = Object.fromEntries(NAMES.map((n, i) => [n, i]));
const fname = (name, number = 0) => cat(i32(N[name]), i32(number));

/**
 * Build a package with 2 imports (/Script/Engine, its StaticMesh class) and 2 exports (SM_Crate: StaticMesh,
 * BodySetup_0 inside it, class by export... kept simple: also a StaticMesh import class).
 * v = { legacy, ue4, ue5, versioned, flags }.
 */
function buildPackage({ legacy = -7, ue4 = 522, ue5 = 0, versioned = false, flags = 0x80002200 >>> 0, customVersions = 0 } = {}) {
  const filterEditorOnly = (flags & 0x80000000) !== 0;
  const unversionedProps = (flags & 0x2000) !== 0;
  const nameTable = cat(NAMES.map(n => [fstr(n), ...(ue4 >= 504 ? [u16(0x1234), u16(0x5678)] : [])]));
  const imp = (classPackage, className, outer, objectName) => cat(fname(classPackage), fname(className), i32(outer), fname(objectName), ...(ue4 >= 520 && !filterEditorOnly ? [fname('None')] : []), ...(ue5 >= 1003 ? [i32(0)] : []));
  const imports = cat(imp('/Script/CoreUObject', 'Package', 0, '/Script/Engine'), imp('/Script/CoreUObject', 'Class', -1, 'StaticMesh'));
  const exp = ({ cls, sup = 0, outer, name, number = 0, objFlags, size, offset, isAsset }) => cat(
    i32(cls), i32(sup), ...(ue4 >= 508 ? [i32(0)] : []), i32(outer), fname(name, number), u32(objFlags),
    ...(ue4 < 511 ? [i32(size), i32(offset)] : [i64(size), i64(offset)]),
    i32(0), i32(0), i32(0), // forced export, not for client, not for server
    ...(ue5 < 1005 ? [GUID0] : []), ...(ue5 >= 1006 ? [i32(0)] : []),
    u32(0), // package flags
    ...(ue4 >= 365 ? [i32(0)] : []), ...(ue4 >= 485 ? [i32(isAsset ? 1 : 0)] : []), ...(ue5 >= 1003 ? [i32(0)] : []),
    ...(ue4 >= 507 ? [i32(-1), i32(0), i32(0), i32(0), i32(0)] : []),
    ...(!unversionedProps && ue5 >= 1011 ? [i64(0), i64(0)] : []),
  );
  const build = (o) => {
    const head = cat(u32(0x9e2a83c1), i32(legacy), ...(legacy !== -4 ? [i32(864)] : []), i32(versioned ? ue4 : 0), ...(legacy <= -8 ? [i32(versioned ? ue5 : 0)] : []), i32(0));
    const custom = cat(i32(customVersions), ...Array.from({ length: customVersions }, (_, i) => [guid(i + 1, 2, 3, 4), i32(7 + i)]));
    return cat(
      head,
      ...(ue5 >= 1017 ? [zeros(20), i32(o.total)] : []),
      custom,
      ...(ue5 < 1017 ? [i32(o.total)] : []),
      fstr('None'), u32(flags),
      i32(NAMES.length), i32(o.names),
      ...(ue5 >= 1008 ? [i32(0), i32(0)] : []),
      ...(!filterEditorOnly && ue4 >= 516 ? [fstr('LOCID')] : []),
      ...(ue4 >= 459 ? [i32(0), i32(0)] : []),
      i32(2), i32(o.exports), i32(2), i32(o.imports),
      ...(ue5 >= 1016 ? [zeros(16)] : []), ...(ue5 >= 1015 ? [i32(0)] : []),
      i32(o.depends),
      ...(ue4 >= 384 ? [i32(0), i32(0)] : []), ...(ue4 >= 510 ? [i32(0)] : []),
      i32(0), // thumbnail table
      ...(ue5 >= 1018 ? [zeros(8)] : []),
      ...(ue5 < 1017 ? [guid(0x11111111, 0x22222222, 0x33333333, 0x44444444)] : []),
      ...(!filterEditorOnly && ue4 >= 518 ? [guid(5, 6, 7, 8)] : []), ...(!filterEditorOnly && ue4 >= 518 && ue4 < 520 ? [GUID0] : []),
      i32(1), i32(2), i32(NAMES.length), // one generation
      ...(ue4 >= 336 ? [u16(ue5 ? 5 : 4), u16(ue5 ? 3 : 27), u16(2), u32(18319896), fstr(ue5 ? '++UE5+Release-5.3' : '++UE4+Release-4.27')] : [i32(0)]),
      ...(ue4 >= 444 ? [u16(ue5 ? 5 : 4), u16(ue5 ? 3 : 27), u16(0), u32(0), fstr('')] : []),
      u32(0), i32(0), // compression flags, compressed chunks
      u32(0), i32(0), // package source, additional packages to cook
      ...(legacy > -7 ? [i32(0)] : []),
      i32(0), i64(o.total + 300), i32(0), // asset registry offset, bulk data start, world tile info
      i32(0), // chunk ids
      ...(ue4 >= 507 ? [i32(0), i32(0)] : []),
      ...(ue5 >= 1001 ? [i32(NAMES.length)] : []), ...(ue5 >= 1002 ? [i64(-1)] : []), ...(ue5 >= 1009 ? [i32(-1)] : []),
    );
  };
  const summaryLength = build({ total: 0, names: 0, exports: 0, imports: 0, depends: 0 }).length;
  const exportSize = exp({ cls: -2, outer: 0, name: 'SM_Crate', objFlags: 0x3, size: 1, offset: 1 }).length;
  const o = { names: summaryLength };
  o.imports = o.names + nameTable.length;
  o.exports = o.imports + imports.length;
  o.depends = o.exports + exportSize * 2;
  o.total = o.depends + 8; // depends map: two empty arrays
  const exports = cat(
    exp({ cls: -2, outer: 0, name: 'SM_Crate', objFlags: 0x3, size: 200, offset: o.total, isAsset: true }),
    exp({ cls: -2, outer: 1, name: 'BodySetup', number: 1, objFlags: 0x8, size: 100, offset: o.total + 200 }),
  );
  return cat(build(o), nameTable, imports, exports, i32(0), i32(0));
}

// ---------------------------------------------------------------- packages
test('cooked UE4 package (unversioned): summary, names, imports, exports and summary block', () => {
  const buf = buildPackage();
  const r = readPackage(buf, { name: 'SM_Crate.uasset' });
  assert.equal(r.format, 'unreal-package');
  assert.equal(r.partial, undefined);
  assert.deepEqual(r.counts, { names: NAMES.length, imports: 2, exports: 2 });
  const p = r.package;
  assert.equal(p.legacyFileVersion, -7);
  assert.equal(p.unversioned, true);
  assert.match(p.assumedLayout, /4\.16-4\.27/);
  assert.equal(p.packageFlags.cooked, true);
  assert.equal(p.packageFlags.unversionedProperties, true);
  assert.equal(p.packageFlags.filterEditorOnly, true);
  assert.deepEqual(p.packageFlags.names, ['Cooked', 'UnversionedProperties', 'FilterEditorOnly']);
  assert.equal(p.totalHeaderSize, buf.length);
  assert.equal(p.folderName, 'None');
  assert.equal(p.nameCount, NAMES.length);
  assert.equal(p.importCount, 2);
  assert.equal(p.exportCount, 2);
  assert.equal(p.customVersions, 0);
  assert.equal(p.savedByEngineVersion, '4.27.2-18319896+++UE4+Release-4.27');
  assert.equal(p.guid, '11111111-2222-2222-3333-333344444444');
  assert.deepEqual(p.compressionFlags.names, []);
  assert.deepEqual(r.names.items, NAMES);
  assert.deepEqual(r.imports.items.map(i => [i.classPackage, i.className, i.objectName, i.outer, i.path]), [
    ['/Script/CoreUObject', 'Package', '/Script/Engine', null, '/Script/Engine'],
    ['/Script/CoreUObject', 'Class', 'StaticMesh', '/Script/Engine', '/Script/Engine.StaticMesh'],
  ]);
  const [a, b] = r.exports.items;
  assert.deepEqual([a.objectName, a.class, a.classPath, a.outer, a.serialSize, a.serialOffset, a.flags, a.isAsset], ['SM_Crate', 'StaticMesh', '/Script/Engine.StaticMesh', null, 200, buf.length, ['Public', 'Standalone'], true]);
  assert.deepEqual([b.objectName, b.class, b.outer, b.serialSize, b.serialOffset, b.flags], ['BodySetup_0', 'StaticMesh', 'SM_Crate', 100, buf.length + 200, ['Transactional']]);
  assert.deepEqual(r.summary.mainAsset, { name: 'SM_Crate', class: 'StaticMesh' });
  assert.deepEqual(r.summary.referencedPackages.script, [{ package: '/Script/Engine', objects: 1 }]);
  assert.deepEqual(r.summary.exportClasses, { StaticMesh: 2 });
  assert.match(r.note, /\.uexp/);
  assert.match(r.note, /unversioned/);
});

test('versioned packages: UE4 4.27 editor (522), UE4 4.13 (505), UE5.3 (1009), UE5.6+ saved hash (1017)', () => {
  for (const [opts, engine] of [
    [{ legacy: -7, ue4: 522, versioned: true, flags: 0, customVersions: 2 }, /^4\.27\.2/],
    [{ legacy: -7, ue4: 505, versioned: true, flags: 0x80000200 }, /^4\.27\.2/],
    [{ legacy: -8, ue4: 522, ue5: 1009, versioned: true, flags: 0x80000200 }, /^5\.3\.2/],
    [{ legacy: -9, ue4: 522, ue5: 1017, versioned: true, flags: 0 }, /^5\.3\.2/],
  ]) {
    const r = readPackage(buildPackage(opts), { name: 'SM_Crate.uasset' });
    assert.equal(r.partial, undefined, JSON.stringify(opts));
    assert.equal(r.package.unversioned, false);
    assert.equal(r.package.ue4Version, opts.ue4);
    assert.equal(r.package.ue5Version, opts.ue5 ?? 0);
    assert.equal(r.package.customVersions, opts.customVersions ?? 0);
    assert.match(r.package.savedByEngineVersion, engine);
    assert.deepEqual(r.counts, { names: NAMES.length, imports: 2, exports: 2 });
    assert.deepEqual(r.exports.items.map(e => e.objectName), ['SM_Crate', 'BodySetup_0']);
    assert.equal(r.exports.items[1].outer, 'SM_Crate');
    if (opts.ue5 === 1017) { assert.equal(r.package.guid, undefined); assert.equal(r.package.savedHash.length, 40); }
    if (opts.flags === 0) assert.equal(r.package.persistentGuid, '00000005-0000-0006-0000-000700000008');
    assert.equal(r.package.packageFlags.cooked, opts.flags !== 0);
  }
});

test('unversioned UE5 package picks the layout that fits (5.2-5.5 share one)', () => {
  const r = readPackage(buildPackage({ legacy: -8, ue5: 1009 }), { name: 'x.uasset' });
  assert.equal(r.partial, undefined);
  assert.match(r.package.assumedLayout, /5\.2\/5\.3/);
  assert.doesNotMatch(r.package.assumedLayout, /5\.1 /);
  assert.equal(r.counts.exports, 2);
  const r51 = readPackage(buildPackage({ legacy: -8, ue5: 1008 }), { name: 'x.uasset' });
  assert.match(r51.package.assumedLayout, /^UE 5\.1 /);
});

test('package: limit and match cap the lists and report more', () => {
  const buf = buildPackage();
  const r = readPackage(buf, { limit: 1 });
  assert.equal(r.names.shown, 1);
  assert.equal(r.names.more, NAMES.length - 1);
  assert.equal(r.imports.more, 1);
  assert.equal(r.exports.more, 1);
  const m = readPackage(buf, { match: 'BodySetup' });
  assert.deepEqual(m.names.items, ['BodySetup']);
  assert.deepEqual(m.exports.items.map(e => e.objectName), ['BodySetup_0']);
  assert.equal(m.imports.total, 0);
  assert.equal(m.counts.exports, 2);
});

test('package: unknown versions and damage stop with partial instead of misreading', () => {
  const tooNew = readPackage(buildPackage({ legacy: -9, ue4: 522, ue5: 1100, versioned: true }));
  assert.match(tooNew.partial.reason, /1100/);
  assert.equal(tooNew.package.ue5Version, 1100);
  assert.equal(tooNew.names, undefined);

  const ue3 = Buffer.concat([u32(0x9e2a83c1), i32(868 | (2 << 16)), zeros(64)]);
  assert.match(readPackage(ue3).partial.reason, /Unreal Engine 3/);

  const swapped = Buffer.concat([Buffer.from([0x9e, 0x2a, 0x83, 0xc1]), zeros(64)]);
  const s = readPackage(swapped);
  assert.equal(s.byteSwapped, true);
  assert.match(s.partial.reason, /byte-swapped/);

  // Truncated in the export table: the summary is still reported.
  const whole = buildPackage({ legacy: -7, ue4: 522, versioned: true, flags: 0x80000200 });
  const cut = readPackage(whole.subarray(0, whole.length - 60));
  assert.match(cut.partial.reason, /^tables:/);
  assert.equal(cut.package.exportCount, 2);

  // An unversioned package whose tables fit no known layout.
  const odd = Buffer.from(buildPackage());
  odd.writeInt32LE(7, odd.length - 8 - 104 + 4 + 4 + 4 + 4 + 8 + 4 + 16); // first bool of the last export
  const o = readPackage(odd);
  assert.match(o.partial.reason, /does not fit any engine layout/);

  assert.throws(() => readPackage(Buffer.concat([Buffer.from('PK\x03\x04'), zeros(64)])), /Not an Unreal package/);
});

// ---------------------------------------------------------------- IoStore .utoc
function buildUtoc({ version = 3, flags = 0x8 | 0x1, methods = ['Oodle'], signed = false } = {}) {
  const files = [
    { dir: ['Game', 'Content', 'Maps'], name: 'Arena.umap', size: 4096 },
    { dir: ['Game', 'Content', 'Maps'], name: 'Arena.uexp', size: 70000 },
    { dir: ['Game', 'Content'], name: 'Hero.uasset', size: 1234 },
    { dir: [], name: 'root.bin', size: 5 },
  ];
  const strings = [];
  const str = s => { let i = strings.indexOf(s); if (i < 0) { i = strings.length; strings.push(s); } return i; };
  const NONE = 0xffffffff;
  // directory entries: 0 root, 1 Game, 2 Content, 3 Maps
  const dirs = [{ name: NONE, child: 1, sibling: NONE, file: NONE }, { name: str('Game'), child: 2, sibling: NONE, file: NONE }, { name: str('Content'), child: 3, sibling: NONE, file: NONE }, { name: str('Maps'), child: NONE, sibling: NONE, file: NONE }];
  const fileEntries = [];
  const dirIndexOf = d => d.length; // by depth in this fixture
  files.forEach((f, i) => { const d = dirs[dirIndexOf(f.dir)]; fileEntries.push({ name: str(f.name), next: d.file, userData: i }); d.file = i; });
  const dirIndex = cat(
    fstr('../../../'),
    i32(dirs.length), dirs.map(d => [u32(d.name), u32(d.child), u32(d.sibling), u32(d.file)]),
    i32(fileEntries.length), fileEntries.map(f => [u32(f.name), u32(f.next), u32(f.userData)]),
    i32(strings.length), strings.map(fstr),
  );
  const n = files.length, blocks = 3, seeds = version >= 4 ? 2 : 0, overflow = version >= 5 ? 1 : 0;
  const header = cat(
    Buffer.from('-==--==--==--==-', 'latin1'), u8(version), u8(0), u16(0),
    u32(144), u32(n), u32(blocks), u32(12), u32(methods.length), u32(32), u32(65536), u32(dirIndex.length),
    u32(1), u64(0x1122334455667788n), guid(0, 0, 0, 0), u8(flags), u8(0), u16(0),
    u32(seeds), u64(0xffffffffffffffffn), u32(overflow), u32(0), zeros(40),
  );
  assert.equal(header.length, 144);
  const offLen = (off, len) => { const b = Buffer.alloc(10); b.writeUIntBE(off, 0, 5); b.writeUIntBE(len, 5, 5); return b; };
  let off = 0;
  const body = cat(
    files.map((_, i) => cat(u64(i + 1), u16(0), u8(0), u8(2))), // FIoChunkId (12 bytes)
    files.map(f => { const b = offLen(off, f.size); off += f.size; return b; }),
    zeros(seeds * 4), zeros(overflow * 4),
    zeros(blocks * 12),
    methods.map(m => { const b = Buffer.alloc(32); b.write(m, 'latin1'); return b; }),
    ...(signed ? [i32(64), zeros(64 * 2), zeros(20 * blocks)] : []),
    dirIndex,
    zeros(n * 33), // chunk metas (not read)
  );
  return cat(header, body);
}

test('utoc: header fields and the file list from the directory index', () => {
  const r = readUtoc(buildUtoc());
  assert.equal(r.format, 'unreal-iostore-toc');
  assert.deepEqual(r.counts, { chunks: 4, compressedBlocks: 3, files: 4 });
  assert.equal(r.toc.version, 3);
  assert.equal(r.toc.versionName, 'PartitionSize');
  assert.equal(r.toc.entryCount, 4);
  assert.equal(r.toc.compressedBlockCount, 3);
  assert.equal(r.toc.compressionBlockSize, 65536);
  assert.deepEqual(r.toc.compressionMethods, ['Oodle']);
  assert.equal(r.toc.partitionCount, 1);
  assert.equal(r.toc.containerId, '0x1122334455667788');
  assert.deepEqual(r.toc.flags, { value: 9, names: ['Compressed', 'Indexed'], compressed: true, encrypted: false, signed: false, indexed: true });
  assert.equal(r.mountPoint, '../../../');
  assert.deepEqual(r.files.items.map(f => [f.path, f.size]), [['Game/Content/Hero.uasset', 1234], ['Game/Content/Maps/Arena.uexp', 70000], ['Game/Content/Maps/Arena.umap', 4096], ['root.bin', 5]]);
  assert.equal(r.extensions['.umap'], 1);
  assert.match(r.note, /Oodle is proprietary and not readable here/);
  assert.equal(r.partial, undefined);
});

test('utoc: perfect-hash versions, signed containers, limit/match', () => {
  for (const version of [2, 4, 5, 8]) {
    const r = readUtoc(buildUtoc({ version, signed: version === 5, flags: version === 5 ? 0x8 | 0x4 : 0x8, methods: ['Zlib', 'LZ4'] }), { match: '*.umap', limit: 10 });
    assert.equal(r.partial, undefined, `version ${version}`);
    assert.deepEqual(r.files.items.map(f => f.path), ['Game/Content/Maps/Arena.umap']);
    assert.equal(r.counts.files, 4);
    assert.deepEqual(r.toc.compressionMethods, ['Zlib', 'LZ4']);
    assert.equal(r.toc.flags.signed, version === 5);
  }
  const capped = readUtoc(buildUtoc(), { limit: 1 });
  assert.equal(capped.files.shown, 1);
  assert.equal(capped.files.more, 3);
});

test('utoc: encrypted index is reported, never decrypted; unknown versions stop at the header', () => {
  const enc = readUtoc(buildUtoc({ flags: 0x8 | 0x2 }));
  assert.equal(enc.toc.flags.encrypted, true);
  assert.equal(enc.files, undefined);
  assert.equal(enc.counts.files, null);
  assert.match(enc.note, /never decrypted/);
  assert.match(enc.note, /not listed/);

  const noIndex = readUtoc(buildUtoc({ flags: 0x1 }));
  assert.equal(noIndex.files, undefined);
  assert.match(noIndex.note, /no directory index/);

  const future = readUtoc(buildUtoc({ version: 10 }));
  assert.match(future.partial.reason, /only the header is read/);
  assert.equal(future.toc.entryCount, 4);
  assert.equal(future.files, undefined);

  assert.throws(() => readUtoc(zeros(200)), /magic/);
});

// ---------------------------------------------------------------- .locres
const LOCRES_MAGIC = Buffer.from([0x0e, 0x14, 0x74, 0x75, 0x67, 0x4a, 0x03, 0xfc, 0x4a, 0x15, 0x90, 0x9d, 0xc3, 0x37, 0x7f, 0x1b]);
const LOC = [
  { namespace: '', keys: [['Greeting', 'Hello'], ['Farewell', 'Tot ziens, één — twee']] },
  { namespace: 'Menu', keys: [['Start', 'Start game'], ['Again', 'Hello']] },
];
function buildLocres(version) {
  if (version === 0) return cat(u32(LOC.length), LOC.map(ns => [fstr(ns.namespace), u32(ns.keys.length), ns.keys.map(([k, t], i) => [fstr(k), u32(0xabc00000 + i), fstr(t)])]));
  const strings = [];
  const index = t => { let i = strings.indexOf(t); if (i < 0) { i = strings.length; strings.push(t); } return i; };
  const hash = version >= 2 ? [u32(0xdeadbeef)] : [];
  const body = cat(
    ...(version >= 2 ? [u32(4)] : []),
    u32(LOC.length),
    LOC.map(ns => [...hash, fstr(ns.namespace), u32(ns.keys.length), ns.keys.map(([k, t], i) => [...hash, fstr(k), u32(0xabc00000 + i), i32(index(t))])]),
  );
  const tableOffset = 16 + 1 + 8 + body.length;
  const table = cat(i32(strings.length), strings.map(s => [fstr(s), ...(version >= 2 ? [i32(1)] : [])]));
  return cat(LOCRES_MAGIC, u8(version), i64(tableOffset), body, table);
}

test('locres: legacy, Compact, Optimized and Optimized_CityHash64_UTF16 give the same entries', () => {
  const expected = [['', 'Greeting', 'Hello'], ['', 'Farewell', 'Tot ziens, één — twee'], ['Menu', 'Start', 'Start game'], ['Menu', 'Again', 'Hello']];
  for (const [version, name] of [[0, 'Legacy'], [1, 'Compact'], [2, 'Optimized_CRC32'], [3, 'Optimized_CityHash64_UTF16']]) {
    const p = parseLocres(buildLocres(version));
    assert.equal(p.version, version);
    assert.equal(p.versionName, name);
    assert.equal(p.hasMagic, version > 0);
    assert.equal(p.partial, undefined);
    assert.deepEqual(p.namespaces, [{ name: '', keys: 2 }, { name: 'Menu', keys: 2 }]);
    assert.deepEqual(p.entries.map(e => [e.namespace, e.key, e.text]), expected, name);
    assert.equal(p.entries[1].sourceHash, '0xabc00001');
  }
  assert.match(parseLocres(cat(LOCRES_MAGIC, u8(9), zeros(40))).partial.reason, /newer/);
  assert.throws(() => parseLocres(Buffer.from('this is not a locres file at all')), /legacy layout does not fit/);
});

// ---------------------------------------------------------------- GVAS
const prop = (name, type, tagData, body, arrayIndex = 0) => cat(fstr(name), fstr(type), i32(body.length), i32(arrayIndex), tagData, u8(0), body);
const scalar = (name, type, body) => prop(name, type, [], body);
const struct = (name, structName, body) => prop(name, 'StructProperty', [fstr(structName), GUID0], body);
const NONE = fstr('None');
function gvasHeader({ saveGameVersion = 2, ue4 = 522, ue5, engine = [4, 27, 2], cls = '/Script/MyGame.MySaveGame' } = {}) {
  return cat(Buffer.from('GVAS'), i32(saveGameVersion), i32(ue4), ...(saveGameVersion >= 3 ? [i32(ue5)] : []),
    u16(engine[0]), u16(engine[1]), u16(engine[2]), u32(18319896), fstr('++UE4+Release-4.27'),
    i32(3), i32(2), guid(1, 2, 3, 4), i32(41), guid(5, 6, 7, 8), i32(7), fstr(cls));
}
function gvasProperties({ doubles = false } = {}) {
  const fp = doubles ? f64 : f32;
  const structArrayElems = cat(scalar('Id', 'IntProperty', i32(1)), scalar('Label', 'StrProperty', fstr('first')), NONE, scalar('Id', 'IntProperty', i32(2)), scalar('Label', 'StrProperty', fstr('second')), NONE);
  const vecElems = cat(fp(1), fp(2), fp(3), fp(4), fp(5), fp(6));
  return cat(
    prop('bHardMode', 'BoolProperty', [u8(1)], zeros(0)),
    prop('Slot', 'ByteProperty', [fstr('None')], u8(7)),
    prop('Difficulty', 'ByteProperty', [fstr('EDifficulty')], fstr('EDifficulty::Hard')),
    scalar('Gold', 'IntProperty', i32(-1250)),
    scalar('PlaySeconds', 'Int64Property', i64(9007199254740993n)),
    scalar('Seed', 'UInt32Property', u32(4000000000)),
    scalar('Health', 'FloatProperty', f32(87.5)),
    scalar('Precise', 'DoubleProperty', f64(Math.PI)),
    scalar('PlayerName', 'StrProperty', fstr('Röel ☃')),
    scalar('Checkpoint', 'NameProperty', fstr('Harbor_03')),
    scalar('Title', 'TextProperty', cat(u32(0), u8(0xff), u32(1), fstr('Chapter One'))),
    scalar('Fancy', 'TextProperty', cat(u32(0), u8(1), zeros(11))), // a history type that is kept raw
    prop('Stance', 'EnumProperty', [fstr('EStance')], fstr('EStance::Crouch')),
    scalar('Pawn', 'ObjectProperty', fstr('/Game/Blueprints/BP_Hero.BP_Hero_C')),
    struct('Position', 'Vector', cat(fp(1.5), fp(-2), fp(300))),
    struct('Facing', 'Rotator', cat(fp(0), fp(90), fp(0))),
    struct('Aim', 'Quat', cat(fp(0), fp(0), fp(0), fp(1))),
    struct('SaveId', 'Guid', guid(0xaabbccdd, 0x11223344, 0x55667788, 0x99aabbcc)),
    struct('SavedAt', 'DateTime', i64(638000000000000000n)),
    struct('Tint', 'LinearColor', cat(f32(1), f32(0.5), f32(0.25), f32(1))),
    struct('Stats', 'PlayerStats', cat(scalar('Kills', 'IntProperty', i32(12)), struct('Home', 'Vector', cat(fp(7), fp(8), fp(9))), NONE)),
    prop('Scores', 'ArrayProperty', [fstr('IntProperty')], cat(i32(3), i32(10), i32(20), i32(30))),
    prop('Tags', 'ArrayProperty', [fstr('StrProperty')], cat(i32(2), fstr('a'), fstr('bee'))),
    prop('Blob', 'ArrayProperty', [fstr('ByteProperty')], cat(i32(4), Buffer.from([1, 2, 3, 250]))),
    prop('Flags', 'ArrayProperty', [fstr('BoolProperty')], cat(i32(3), u8(1), u8(0), u8(1))),
    prop('Items', 'ArrayProperty', [fstr('StructProperty')], cat(i32(2), fstr('Items'), fstr('StructProperty'), i32(structArrayElems.length), i32(0), fstr('InventoryItem'), GUID0, u8(0), structArrayElems)),
    prop('Path', 'ArrayProperty', [fstr('StructProperty')], cat(i32(2), fstr('Path'), fstr('StructProperty'), i32(vecElems.length), i32(0), fstr('Vector'), GUID0, u8(0), vecElems)),
    prop('Ammo', 'MapProperty', [fstr('NameProperty'), fstr('IntProperty')], cat(i32(0), i32(2), fstr('Shells'), i32(8), fstr('Rockets'), i32(1))),
    prop('Quests', 'MapProperty', [fstr('StrProperty'), fstr('StructProperty')], cat(i32(0), i32(1), fstr('Intro'), scalar('Done', 'IntProperty', i32(1)), NONE)),
    prop('Kills', 'MapProperty', [fstr('StructProperty'), fstr('IntProperty')], cat(i32(0), i32(1), guid(1, 2, 3, 4), i32(99))),
    prop('Seen', 'SetProperty', [fstr('NameProperty')], cat(i32(0), i32(2), fstr('Cave'), fstr('Tower'))),
    prop('Extra', 'IntProperty', [], i32(5), 1),
    prop('OnChanged', 'MulticastInlineDelegateProperty', [], zeros(12)),
    scalar('Last', 'IntProperty', i32(42)),
    NONE, i32(0),
  );
}

test('GVAS: header and every supported property type', () => {
  const buf = cat(gvasHeader(), gvasProperties());
  const g = readGvas(buf);
  assert.deepEqual(g.header, {
    saveGameVersion: 2, packageVersionUE4: 522, engineVersion: '4.27.2', engineChangelist: 18319896, engineBranch: '++UE4+Release-4.27',
    customVersions: [{ key: '00000001-0000-0002-0000-000300000004', version: 41 }, { key: '00000005-0000-0006-0000-000700000008', version: 7 }],
    customVersionFormat: 3, saveGameClassName: '/Script/MyGame.MySaveGame',
  });
  const p = g.properties;
  assert.equal(p.bHardMode, true);
  assert.equal(p.Slot, 7);
  assert.equal(p.Difficulty, 'EDifficulty::Hard');
  assert.equal(p.Gold, -1250);
  assert.equal(p.PlaySeconds, '9007199254740993'); // beyond the safe integer range: kept exact as a string
  assert.equal(p.Seed, 4000000000);
  assert.equal(p.Health, 87.5);
  assert.equal(p.Precise, Math.PI);
  assert.equal(p.PlayerName, 'Röel ☃');
  assert.equal(p.Checkpoint, 'Harbor_03');
  assert.deepEqual(p.Title, { flags: 0, text: 'Chapter One' });
  assert.deepEqual(p.Fancy, { $raw: 16, type: 'TextProperty', note: 'complex text history, not decoded' });
  assert.equal(p.Stance, 'EStance::Crouch');
  assert.equal(p.Pawn, '/Game/Blueprints/BP_Hero.BP_Hero_C');
  assert.deepEqual(p.Position, { x: 1.5, y: -2, z: 300 });
  assert.deepEqual(p.Facing, { pitch: 0, yaw: 90, roll: 0 });
  assert.deepEqual(p.Aim, { x: 0, y: 0, z: 0, w: 1 });
  assert.equal(p.SaveId, 'AABBCCDD-1122-3344-5566-778899AABBCC');
  assert.equal(p.SavedAt.ticks, '638000000000000000');
  assert.match(p.SavedAt.iso, /^2022-09-/);
  assert.deepEqual(p.Tint, { r: 1, g: 0.5, b: 0.25, a: 1 });
  assert.deepEqual(p.Stats, { Kills: 12, Home: { x: 7, y: 8, z: 9 } });
  assert.deepEqual(p.Scores, [10, 20, 30]);
  assert.deepEqual(p.Tags, ['a', 'bee']);
  assert.deepEqual(p.Blob, [1, 2, 3, 250]);
  assert.deepEqual(p.Flags, [true, false, true]);
  assert.deepEqual(p.Items, [{ Id: 1, Label: 'first' }, { Id: 2, Label: 'second' }]);
  assert.deepEqual(p.Path, [{ x: 1, y: 2, z: 3 }, { x: 4, y: 5, z: 6 }]);
  assert.deepEqual(p.Ammo, [{ key: 'Shells', value: 8 }, { key: 'Rockets', value: 1 }]);
  assert.deepEqual(p.Quests, [{ key: 'Intro', value: { Done: 1 } }]);
  assert.deepEqual(p.Kills, [{ key: '00000001-0000-0002-0000-000300000004', value: 99 }]);
  assert.deepEqual(p.Seen, ['Cave', 'Tower']);
  assert.equal(p['Extra[1]'], 5);
  assert.equal(p.Last, 42);
  assert.equal(g.types.Position, 'StructProperty<Vector>');
  assert.equal(g.types.Items, 'ArrayProperty<StructProperty<InventoryItem>>');
  assert.equal(g.types.Ammo, 'MapProperty<NameProperty,IntProperty>');
  assert.equal(g.types.Kills, 'MapProperty<StructProperty<Guid?>,IntProperty>');
  assert.equal(g.types.Difficulty, 'ByteProperty<EDifficulty>');
  // The one type that is not understood is kept as unread bytes with its offset, and reading goes on after it.
  assert.deepEqual(p.OnChanged, { $raw: 12, type: 'MulticastInlineDelegateProperty' });
  assert.equal(g.unread.length, 1);
  assert.equal(g.unread[0].property, 'OnChanged');
  assert.equal(g.partial.offset, g.unread[0].offset);
  assert.match(g.partial.reason, /OnChanged/);
  assert.equal(g.propertiesEnd, buf.length - 4);
});

test('GVAS: UE5 header (save game version 3) with double-precision vectors; 5.4+ tags stop at the header', () => {
  const g = readGvas(cat(gvasHeader({ saveGameVersion: 3, ue5: 1009, engine: [5, 3, 2] }), gvasProperties({ doubles: true })));
  assert.equal(g.header.packageVersionUE5, 1009);
  assert.equal(g.header.engineVersion, '5.3.2');
  assert.deepEqual(g.properties.Position, { x: 1.5, y: -2, z: 300 });
  assert.deepEqual(g.properties.Path, [{ x: 1, y: 2, z: 3 }, { x: 4, y: 5, z: 6 }]);
  assert.deepEqual(g.properties.Stats, { Kills: 12, Home: { x: 7, y: 8, z: 9 } });
  assert.equal(g.properties.Last, 42);

  const newer = readGvas(cat(gvasHeader({ saveGameVersion: 3, ue5: 1012, engine: [5, 4, 0] }), gvasProperties()));
  assert.equal(newer.header.saveGameClassName, '/Script/MyGame.MySaveGame');
  assert.deepEqual(newer.properties, {});
  assert.match(newer.partial.reason, /5\.4\+/);
});

test('GVAS: a broken tag stops with partial and keeps what was read', () => {
  const good = cat(gvasHeader(), scalar('Gold', 'IntProperty', i32(5)), scalar('Name', 'StrProperty', fstr('x')));
  const at = good.length;
  const g = readGvas(cat(good, fstr('Broken'), fstr('not a type'), zeros(20)));
  assert.deepEqual(g.properties, { Gold: 5, Name: 'x' });
  assert.equal(g.partial.offset, at);
  assert.match(g.partial.reason, /not a property type/);

  const cutShort = readGvas(cat(good, fstr('Level'), fstr('IntProperty'), i32(4), i32(0), u8(0), u8(1)));
  assert.deepEqual(cutShort.properties, { Gold: 5, Name: 'x' });
  assert.equal(cutShort.partial.offset, at);

  // A struct whose body is not a property list is kept raw; the list goes on.
  const native = readGvas(cat(gvasHeader(), struct('Opaque', 'SomeNativeStruct', Buffer.from([1, 2, 3, 4, 5, 6, 7])), scalar('After', 'IntProperty', i32(3)), NONE));
  assert.deepEqual(native.properties, { Opaque: { $raw: 7, type: 'StructProperty<SomeNativeStruct>' }, After: 3 });
  assert.equal(native.unread[0].property, 'Opaque');

  assert.throws(() => readGvas(Buffer.from('NOPE' + '\0'.repeat(40))), /GVAS/);
});

// ---------------------------------------------------------------- the tool: picks the reader by magic / extension
test('unrealTool: dispatches by magic and extension, counts first, capped lists', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rp-unreal-')); // not helpers.mjs: this file stands alone
  try {
    const write = async (name, buf) => { const p = path.join(dir, name); await fs.writeFile(p, buf); return p; };
    const pkg = await unrealTool({ file: await write('SM_Crate.umap', buildPackage()), limit: 1 });
    assert.deepEqual(Object.keys(pkg).slice(0, 4), ['file', 'size', 'format', 'counts']);
    assert.equal(pkg.format, 'unreal-package');
    assert.equal(pkg.exports.more, 1);
    assert.equal(pkg.summary.mainAsset.name, 'SM_Crate');
    assert.ok(pkg.next);

    const toc = await unrealTool({ file: await write('pakchunk0-Windows.utoc', buildUtoc()), match: 'Hero' });
    assert.equal(toc.format, 'unreal-iostore-toc');
    assert.deepEqual(toc.files.items.map(f => f.path), ['Game/Content/Hero.uasset']);

    const loc = await unrealTool({ file: await write('Game.locres', buildLocres(3)), match: 'Menu' });
    assert.equal(loc.format, 'unreal-locres');
    assert.deepEqual(loc.counts, { namespaces: 2, entries: 4, words: 9 });
    assert.deepEqual(loc.locres, { version: 3, versionName: 'Optimized_CityHash64_UTF16', magic: true });
    assert.deepEqual(loc.entries.items.map(e => [e.namespace, e.key, e.text]), [['Menu', 'Start', 'Start game'], ['Menu', 'Again', 'Hello']]);
    // the fields re_strings entries carry
    assert.deepEqual(Object.keys(loc.entries.items[0]), ['namespace', 'key', 'text', 'id', 'file', 'where', 'prop', 'kind', 'chars', 'sourceHash']);
    assert.equal(loc.entries.items[0].id, 'Game.locres#Menu#Start');
    assert.equal(loc.entries.items[0].chars, 10);

    const legacy = await unrealTool({ file: await write('Old.locres', buildLocres(0)) });
    assert.equal(legacy.locres.magic, false);
    assert.equal(legacy.counts.entries, 4);

    const sav = await unrealTool({ file: await write('Slot1.sav', cat(gvasHeader(), gvasProperties())), limit: 3 });
    assert.equal(sav.format, 'unreal-gvas');
    assert.equal(sav.counts.properties, 34);
    assert.equal(sav.counts.customVersions, 2);
    assert.equal(sav.counts.unread, 1);
    assert.equal(sav.properties.shown, 3);
    assert.equal(sav.properties.more, 31);
    assert.deepEqual(sav.properties.items[0], { name: 'bHardMode', type: 'BoolProperty', value: true });
    assert.equal(sav.header.saveGameClassName, '/Script/MyGame.MySaveGame');
    const one = await unrealTool({ file: path.join(dir, 'Slot1.sav'), match: 'Position' });
    assert.deepEqual(one.properties.items, [{ name: 'Position', type: 'StructProperty<Vector>', value: { x: 1.5, y: -2, z: 300 } }]);

    await assert.rejects(unrealTool({ file: await write('chunk.ucas', zeros(64)) }), e => e.code === 'BAD_FORMAT' && /\.utoc/.test(e.message));
    await assert.rejects(unrealTool({ file: await write('Zen.uasset', zeros(64)) }), e => e.code === 'BAD_FORMAT' && /Zen/.test(e.message));
    await assert.rejects(unrealTool({ file: await write('notes.txt', Buffer.from('hello')) }), e => e.code === 'BAD_FORMAT');
    await assert.rejects(unrealTool({ file: path.join(dir, 'missing.uasset') }), e => e.code === 'NOT_FOUND');
    await assert.rejects(unrealTool({}), e => e.code === 'INVALID_ARGUMENT');
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('re_save reads a GVAS save as a layer and lists its fields', async () => {
  const { callTool } = await import('../src/tools.mjs');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rp-gvas-'));
  const file = path.join(dir, 'Slot1.sav');
  await fs.writeFile(file, cat(gvasHeader(), gvasProperties()));
  const r = await callTool('re_save', { file });
  assert.equal(r.layers.at(-1), 'gvas');
  const gold = r.fields.items.find(f => f.path === 'Gold');
  assert.deepEqual([gold.sample, gold.role], [-1250, 'currency']);
  const tool = await callTool('re_unreal', { file });
  assert.equal(tool.format, 'unreal-gvas');
});
