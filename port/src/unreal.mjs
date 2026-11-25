// re_unreal: read the Unreal Engine files that are otherwise only identified by magic.
//   .uasset / .umap  package summary + name, import and export tables (no property bodies)
//   .utoc            IoStore table of contents: header + directory index (file list with sizes)
//   .locres          localisation resource: namespace / key / translated text
//   .sav (GVAS)      save game header + tagged property list (readGvas is also a layer for re_save)
// Read-only. Nothing is decrypted: AES-encrypted data is reported, never opened. Oodle-compressed data is
// reported as not readable here. Layouts follow the public engine serialisation order as mirrored by the
// open-source CUE4Parse (FPackageFileSummary, FObjectImport/FObjectExport, FIoStoreTocHeader/Resource,
// FTextLocalizationResource) and uesave-rs (GVAS). A version this reader does not know stops with `partial`
// and the reason rather than guessing.
import fs from 'node:fs/promises';
import path from 'node:path';
import { RPError, requireFile, readAt, compileMatcher } from './util.mjs';

// ------------------------------------------------------------------------------------------------ reader
class Short extends Error {
  constructor(message, offset) { super(message); this.offset = offset; }
}

class Reader {
  constructor(buf, pos = 0) { this.buf = buf; this.pos = pos; }
  need(n) { if (n < 0 || this.pos + n > this.buf.length) throw new Short(`needs ${n} bytes at ${this.pos}, file has ${this.buf.length}`, this.pos); }
  u8() { this.need(1); return this.buf[this.pos++]; }
  u16() { this.need(2); const v = this.buf.readUInt16LE(this.pos); this.pos += 2; return v; }
  i32() { this.need(4); const v = this.buf.readInt32LE(this.pos); this.pos += 4; return v; }
  u32() { this.need(4); const v = this.buf.readUInt32LE(this.pos); this.pos += 4; return v; }
  i64() { this.need(8); const v = this.buf.readBigInt64LE(this.pos); this.pos += 8; return v; }
  u64() { this.need(8); const v = this.buf.readBigUInt64LE(this.pos); this.pos += 8; return v; }
  f32() { this.need(4); const v = this.buf.readFloatLE(this.pos); this.pos += 4; return v; }
  f64() { this.need(8); const v = this.buf.readDoubleLE(this.pos); this.pos += 8; return v; }
  bytes(n) { this.need(n); const v = this.buf.subarray(this.pos, this.pos + n); this.pos += n; return v; }
  skip(n) { this.need(n); this.pos += n; }
  /** FGuid: four uint32 (A, B, C, D), printed the way the engine prints "Digits" with dashes. */
  guid() {
    const a = this.u32(), b = this.u32(), c = this.u32(), d = this.u32();
    const h = n => n.toString(16).padStart(8, '0').toUpperCase();
    return `${h(a)}-${h(b).slice(0, 4)}-${h(b).slice(4)}-${h(c).slice(0, 4)}-${h(c).slice(4)}${h(d)}`;
  }
  /** FString: int32 length including the terminator; negative means UTF-16LE code units. */
  fstring(max = 1 << 20) {
    const at = this.pos;
    const n = this.i32();
    if (n === 0) return '';
    if (n === -2147483648 || Math.abs(n) > max) throw new Short(`implausible string length ${n} at ${at}`, at);
    if (n < 0) { const raw = this.bytes(-n * 2); return raw.toString('utf16le', 0, raw.length - 2); }
    const raw = this.bytes(n);
    return raw.toString('latin1', 0, raw[n - 1] === 0 ? n - 1 : n);
  }
}

const num = big => (big >= BigInt(Number.MIN_SAFE_INTEGER) && big <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(big) : big.toString());
const hex32 = n => '0x' + (n >>> 0).toString(16).padStart(8, '0');

/** Counts first, capped list, `more` for what was left out. */
function cap(list, max, total = list.length) {
  const items = list.slice(0, max);
  const out = { total, shown: items.length, items };
  if (list.length > items.length) out.more = list.length - items.length;
  return out;
}
const clampLimit = (limit, dflt = 100) => Math.max(0, Math.min(5000, Number.isFinite(Number(limit)) && limit !== undefined && limit !== null ? Math.floor(Number(limit)) : dflt));
function flagNames(value, table) {
  const out = [];
  for (const [bit, name] of table) if ((value & bit) >>> 0) out.push(name);
  return out;
}

// ------------------------------------------------------------------------------------------------ .uasset / .umap
const PACKAGE_TAG = 0x9e2a83c1, PACKAGE_TAG_SWAPPED = 0xc1832a9e;
// EPackageFlags (CoreUObject ObjectMacros.h).
const PACKAGE_FLAGS = [
  [0x00000001, 'NewlyCreated'], [0x00000002, 'ClientOptional'], [0x00000004, 'ServerSideOnly'], [0x00000010, 'CompiledIn'],
  [0x00000020, 'ForDiffing'], [0x00000040, 'EditorOnly'], [0x00000080, 'Developer'], [0x00000100, 'UncookedOnly'],
  [0x00000200, 'Cooked'], [0x00000400, 'ContainsNoAsset'], [0x00002000, 'UnversionedProperties'], [0x00004000, 'ContainsMapData'],
  [0x00020000, 'ContainsMap'], [0x00040000, 'RequiresLocalizationGather'], [0x00100000, 'PlayInEditor'], [0x00200000, 'ContainsScript'],
  [0x00400000, 'DisallowExport'], [0x08000000, 'CookGenerated'], [0x10000000, 'DynamicImports'], [0x20000000, 'RuntimeGenerated'],
  [0x80000000, 'FilterEditorOnly'],
];
const OBJECT_FLAGS = [[0x1, 'Public'], [0x2, 'Standalone'], [0x8, 'Transactional'], [0x10, 'ClassDefaultObject'], [0x20, 'ArchetypeObject'], [0x40, 'Transient']];
const COMPRESSION_FLAGS = [[0x1, 'Zlib'], [0x2, 'Gzip'], [0x4, 'Custom']];
// Object versions the layout below is written for (EUnrealEngineObjectUE4Version / UE5Version).
const UE4_MIN = 214, UE4_MAX = 522, UE5_MIN = 1000, UE5_MAX = 1018;
const UE5_RELEASES = [[1004, '5.0'], [1008, '5.1'], [1009, '5.2/5.3'], [1012, '5.4'], [1013, '5.5'], [1017, '5.6'], [1018, '5.7']];

function readEngineVersion(r) {
  const major = r.u16(), minor = r.u16(), patch = r.u16(), changelist = r.u32(), branch = r.fstring(1024);
  return { major, minor, patch, changelist: changelist & 0x7fffffff, licensee: changelist >>> 31 === 1, branch, text: `${major}.${minor}.${patch}-${changelist & 0x7fffffff}${branch ? '+' + branch : ''}` };
}

function readCustomVersions(r, legacy) {
  const n = r.i32();
  if (n < 0 || n > 4096) throw new Short(`implausible custom version count ${n}`, r.pos - 4);
  const out = [];
  for (let i = 0; i < n; i++) {
    if (legacy === -2) { const tag = r.u32(); out.push({ key: hex32(tag), version: r.i32() }); } // enum-keyed (oldest)
    else if (legacy >= -5) { const key = r.guid(); const version = r.i32(); const name = r.fstring(1024); out.push({ key, version, name }); } // guid + friendly name
    else { const key = r.guid(); out.push({ key, version: r.i32() }); } // optimised: guid + version
  }
  return out;
}

/** Everything after the version block, in FPackageFileSummary order, for one (ue4, ue5) object version. */
function readSummaryBody(r, legacy, v, size) {
  const s = {};
  const sane = (count, offset, what) => { if (count < 0 || count > 50_000_000 || offset < 0 || offset > size) throw new Short(`${what} count/offset out of range (${count} at ${offset})`, r.pos); };
  if (v.ue5 >= 1017) { s.savedHash = r.bytes(20).toString('hex'); s.totalHeaderSize = r.i32(); }
  s.customVersions = readCustomVersions(r, legacy);
  if (v.ue5 < 1017) s.totalHeaderSize = r.i32();
  s.folderName = r.fstring(4096);
  s.packageFlags = r.u32();
  const filterEditorOnly = (s.packageFlags & 0x80000000) !== 0;
  s.nameCount = r.i32(); s.nameOffset = r.i32(); sane(s.nameCount, s.nameOffset, 'name');
  if (v.ue5 >= 1008) { s.softObjectPathsCount = r.i32(); s.softObjectPathsOffset = r.i32(); }
  if (!filterEditorOnly && v.ue4 >= 516) s.localizationId = r.fstring(4096);
  if (v.ue4 >= 459) { s.gatherableTextDataCount = r.i32(); s.gatherableTextDataOffset = r.i32(); }
  s.exportCount = r.i32(); s.exportOffset = r.i32(); sane(s.exportCount, s.exportOffset, 'export');
  s.importCount = r.i32(); s.importOffset = r.i32(); sane(s.importCount, s.importOffset, 'import');
  if (v.ue5 >= 1016) r.skip(16); // Verse cell export/import count+offset
  if (v.ue5 >= 1015) s.metaDataOffset = r.i32();
  s.dependsOffset = r.i32();
  if (v.ue4 >= 384) { s.softPackageReferencesCount = r.i32(); s.softPackageReferencesOffset = r.i32(); }
  if (v.ue4 >= 510) s.searchableNamesOffset = r.i32();
  s.thumbnailTableOffset = r.i32();
  if (v.ue5 >= 1018) r.skip(8); // import type hierarchies count+offset
  if (v.ue5 < 1017) s.guid = r.guid();
  if (!filterEditorOnly) {
    if (v.ue4 >= 518) s.persistentGuid = r.guid();
    if (v.ue4 >= 518 && v.ue4 < 520) r.skip(16); // owner persistent guid (two versions only)
  }
  const generations = r.i32();
  if (generations < 0 || generations > 4096) throw new Short(`implausible generation count ${generations}`, r.pos - 4);
  r.skip(generations * 8);
  s.generations = generations;
  if (v.ue4 >= 336) s.savedByEngineVersion = readEngineVersion(r);
  else { const cl = r.i32(); if (cl) s.savedByEngineVersion = { major: 4, minor: 0, patch: 0, changelist: cl, branch: '', text: `4.0.0-${cl}` }; }
  if (v.ue4 >= 444) s.compatibleWithEngineVersion = readEngineVersion(r);
  s.compressionFlags = r.u32();
  const chunks = r.i32();
  if (chunks < 0 || chunks > 1_000_000) throw new Short(`implausible compressed chunk count ${chunks}`, r.pos - 4);
  r.skip(chunks * 16);
  s.compressedChunks = chunks;
  s.packageSource = r.u32();
  const extra = r.i32();
  if (extra < 0 || extra > 100_000) throw new Short(`implausible additional-packages count ${extra}`, r.pos - 4);
  for (let i = 0; i < extra; i++) r.fstring(4096);
  if (legacy > -7) { const tex = r.i32(); if (tex !== 0) throw new Short('texture allocation table present (pre-4.x layout not read)', r.pos - 4); }
  if (v.ue4 >= 112) s.assetRegistryDataOffset = r.i32();
  if (v.ue4 >= 212) s.bulkDataStartOffset = num(r.i64());
  if (v.ue4 >= 224) s.worldTileInfoDataOffset = r.i32();
  if (v.ue4 >= 326) { const n = r.i32(); if (n < 0 || n > 100_000) throw new Short(`implausible chunk id count ${n}`, r.pos - 4); s.chunkIds = []; for (let i = 0; i < n; i++) s.chunkIds.push(r.i32()); }
  else if (v.ue4 >= 278) { const id = r.i32(); s.chunkIds = id < 0 ? [] : [id]; }
  if (v.ue4 >= 507) { s.preloadDependencyCount = r.i32(); s.preloadDependencyOffset = r.i32(); }
  if (v.ue5 >= 1001) s.namesReferencedFromExportDataCount = r.i32();
  if (v.ue5 >= 1002) s.payloadTocOffset = num(r.i64());
  if (v.ue5 >= 1009) s.dataResourceOffset = r.i32();
  s.summaryEnd = r.pos;
  if (s.totalHeaderSize < 0 || s.nameOffset < s.summaryEnd && s.nameCount > 0) throw new Short('name table offset lies inside the summary', r.pos);
  return s;
}

function readNameTable(buf, s, v) {
  const r = new Reader(buf, s.nameOffset);
  const names = [];
  for (let i = 0; i < s.nameCount; i++) {
    names.push(r.fstring(4096));
    if (v.ue4 >= 504) r.skip(4); // two uint16 hashes (non-case-preserving, case-preserving)
  }
  return { names, end: r.pos };
}

function readImports(buf, s, v, names) {
  const r = new Reader(buf, s.importOffset);
  const filterEditorOnly = (s.packageFlags & 0x80000000) !== 0;
  const fname = () => { const at = r.pos; const idx = r.i32(), number = r.i32(); if (idx < 0 || idx >= names.length || number < 0) throw new Short(`name index ${idx} outside the name table at ${at}`, at); return number ? `${names[idx]}_${number - 1}` : names[idx]; };
  const out = [];
  for (let i = 0; i < s.importCount; i++) {
    const classPackage = fname(), className = fname(), outerIndex = r.i32(), objectName = fname();
    const imp = { index: -(i + 1), classPackage, className, objectName, outerIndex };
    if (v.ue4 >= 520 && !filterEditorOnly) imp.packageName = fname();
    if (v.ue5 >= 1003) { const b = r.i32(); if (b !== 0 && b !== 1) throw new Short(`import ${i}: optional flag is ${b}, not a bool`, r.pos - 4); if (b) imp.optional = true; }
    if (outerIndex < -s.importCount || outerIndex > s.exportCount) throw new Short(`import ${i}: outer index ${outerIndex} out of range`, r.pos);
    out.push(imp);
  }
  return { imports: out, end: r.pos };
}

function readExports(buf, s, v, names) {
  const r = new Reader(buf, s.exportOffset);
  const unversionedProps = (s.packageFlags & 0x2000) !== 0;
  const fname = () => { const at = r.pos; const idx = r.i32(), number = r.i32(); if (idx < 0 || idx >= names.length || number < 0) throw new Short(`name index ${idx} outside the name table at ${at}`, at); return number ? `${names[idx]}_${number - 1}` : names[idx]; };
  const bool = what => { const b = r.i32(); if (b !== 0 && b !== 1) throw new Short(`export ${what} is ${b}, not a bool`, r.pos - 4); return b === 1; };
  const inRange = (i, what) => { if (i < -s.importCount || i > s.exportCount) throw new Short(`export ${what} index ${i} out of range`, r.pos - 4); return i; };
  const out = [];
  for (let i = 0; i < s.exportCount; i++) {
    const e = { index: i + 1 };
    e.classIndex = inRange(r.i32(), 'class');
    e.superIndex = inRange(r.i32(), 'super');
    if (v.ue4 >= 508) e.templateIndex = inRange(r.i32(), 'template');
    e.outerIndex = inRange(r.i32(), 'outer');
    e.objectName = fname();
    e.objectFlags = r.u32();
    if (v.ue4 < 511) { e.serialSize = r.i32(); e.serialOffset = r.i32(); }
    else { e.serialSize = num(r.i64()); e.serialOffset = num(r.i64()); }
    if (typeof e.serialSize !== 'number' || typeof e.serialOffset !== 'number' || e.serialSize < 0 || e.serialOffset < 0) throw new Short(`export ${i}: serial size/offset out of range`, r.pos);
    e.forcedExport = bool('forcedExport'); e.notForClient = bool('notForClient'); e.notForServer = bool('notForServer');
    if (v.ue5 < 1005) r.skip(16); // package guid
    if (v.ue5 >= 1006) e.inheritedInstance = bool('isInheritedInstance');
    e.packageFlags = r.u32();
    if (v.ue4 >= 365) e.notAlwaysLoadedForEditorGame = bool('notAlwaysLoadedForEditorGame');
    if (v.ue4 >= 485) e.isAsset = bool('isAsset');
    if (v.ue5 >= 1003) e.generatePublicHash = bool('generatePublicHash');
    if (v.ue4 >= 507) r.skip(20); // first export dependency + four dependency counts
    if (!unversionedProps && v.ue5 >= 1011) r.skip(16); // script serialization start/end offsets
    out.push(e);
  }
  return { exports: out, end: r.pos };
}

/** Read the three tables for one version; throws Short when the bytes do not fit that layout. */
function readTables(buf, s, v) {
  const { names, end: namesEnd } = readNameTable(buf, s, v);
  const { imports, end: importsEnd } = readImports(buf, s, v, names);
  const { exports, end: exportsEnd } = readExports(buf, s, v, names);
  return { names, imports, exports, namesEnd, importsEnd, exportsEnd };
}

function resolvePaths(imports, exports) {
  const importPath = new Map(), exportPath = new Map();
  const pathOf = (index, depth = 0) => {
    if (index === 0 || depth > 64) return '';
    if (index < 0) {
      if (importPath.has(index)) return importPath.get(index);
      const imp = imports[-index - 1]; if (!imp) return `<import ${index}>`;
      const outer = pathOf(imp.outerIndex, depth + 1);
      const p = outer ? `${outer}.${imp.objectName}` : imp.objectName;
      importPath.set(index, p); return p;
    }
    if (exportPath.has(index)) return exportPath.get(index);
    const exp = exports[index - 1]; if (!exp) return `<export ${index}>`;
    const outer = pathOf(exp.outerIndex, depth + 1);
    const p = outer ? `${outer}.${exp.objectName}` : exp.objectName;
    exportPath.set(index, p); return p;
  };
  const nameOf = index => (index === 0 ? null : index < 0 ? imports[-index - 1]?.objectName ?? `<import ${index}>` : exports[index - 1]?.objectName ?? `<export ${index}>`);
  const rootPackage = index => { let i = index, guard = 0; while (i < 0 && imports[-i - 1] && imports[-i - 1].outerIndex < 0 && guard++ < 64) i = imports[-i - 1].outerIndex; return i < 0 ? imports[-i - 1]?.objectName : null; };
  return { pathOf, nameOf, rootPackage };
}

function describeSummary(s, legacy, ue3, v, licensee, unversioned, assumed) {
  const flags = s.packageFlags >>> 0;
  const out = {
    legacyFileVersion: legacy,
    ...(ue3 !== null ? { ue3Version: ue3 } : {}),
    ue4Version: unversioned ? 0 : v.ue4, ue5Version: unversioned ? 0 : v.ue5, licenseeVersion: licensee,
    unversioned,
    ...(assumed ? { assumedLayout: assumed } : {}),
    customVersions: s.customVersions.length,
    totalHeaderSize: s.totalHeaderSize,
    folderName: s.folderName,
    packageFlags: { value: hex32(flags), names: flagNames(flags, PACKAGE_FLAGS), cooked: (flags & 0x200) !== 0, unversionedProperties: (flags & 0x2000) !== 0, filterEditorOnly: (flags & 0x80000000) !== 0 },
    nameCount: s.nameCount, nameOffset: s.nameOffset,
    exportCount: s.exportCount, exportOffset: s.exportOffset,
    importCount: s.importCount, importOffset: s.importOffset,
    dependsOffset: s.dependsOffset,
    ...(s.savedByEngineVersion ? { savedByEngineVersion: s.savedByEngineVersion.text } : {}),
    ...(s.compatibleWithEngineVersion ? { compatibleWithEngineVersion: s.compatibleWithEngineVersion.text } : {}),
    compressionFlags: { value: hex32(s.compressionFlags), names: flagNames(s.compressionFlags, COMPRESSION_FLAGS), compressedChunks: s.compressedChunks },
    ...(s.guid ? { guid: s.guid } : {}),
    ...(s.persistentGuid ? { persistentGuid: s.persistentGuid } : {}),
    ...(s.savedHash ? { savedHash: s.savedHash } : {}),
    ...(s.bulkDataStartOffset !== undefined ? { bulkDataStartOffset: s.bulkDataStartOffset } : {}),
  };
  return out;
}

export function readPackage(buf, { limit, match, name = '' } = {}) {
  const max = clampLimit(limit);
  const matches = compileMatcher(match);
  const result = { format: 'unreal-package', counts: { names: 0, imports: 0, exports: 0 } };
  const stop = (reason, offset) => { result.partial = { reason, ...(offset !== undefined ? { offset } : {}) }; return result; };
  if (buf.length < 28) return stop('file is shorter than a package summary', 0);
  const r = new Reader(buf);
  const tag = r.u32();
  if (tag === PACKAGE_TAG_SWAPPED) { result.byteSwapped = true; return stop('byte-swapped (big-endian) package: identified, the summary is not read in this byte order', 4); }
  if (tag !== PACKAGE_TAG) throw new RPError('BAD_FORMAT', 'Not an Unreal package: the first four bytes are not 0x9E2A83C1.');
  const legacy = r.i32();
  result.package = { legacyFileVersion: legacy };
  if (legacy >= 0) return stop(`legacy file version ${legacy & 0xffff} is an Unreal Engine 3 era package; only UE4/UE5 summaries are read`, 8);
  if (legacy < -9 || legacy === -1) return stop(`legacy file version ${legacy} is not one this reader knows (-2..-9)`, 8);
  const ue3 = legacy !== -4 ? r.i32() : null;
  const ue4 = r.i32();
  const ue5 = legacy <= -8 ? r.i32() : 0;
  const licensee = r.i32();
  Object.assign(result.package, { ...(ue3 !== null ? { ue3Version: ue3 } : {}), ue4Version: ue4, ue5Version: ue5, licenseeVersion: licensee });
  const unversioned = ue4 === 0 && ue5 === 0 && licensee === 0;
  result.package.unversioned = unversioned;
  const bodyStart = r.pos;

  let chosen = null, assumed = null;
  if (!unversioned) {
    if (ue4 < UE4_MIN || ue4 > UE4_MAX) return stop(`UE4 object version ${ue4} is outside the range this reader handles (${UE4_MIN}-${UE4_MAX})`, bodyStart);
    if (ue5 !== 0 && (ue5 < UE5_MIN || ue5 > UE5_MAX)) return stop(`UE5 object version ${ue5} is outside the range this reader handles (${UE5_MIN}-${UE5_MAX})`, bodyStart);
    const v = { ue4, ue5 };
    let s;
    try { s = readSummaryBody(new Reader(buf, bodyStart), legacy, v, buf.length); } catch (e) { if (!(e instanceof Short)) throw e; return stop(`summary: ${e.message}`, e.offset); }
    chosen = { v, s };
    try { chosen.tables = readTables(buf, s, v); } catch (e) { if (!(e instanceof Short)) throw e; chosen.error = e; }
  } else {
    // Unversioned (cooked) packages carry no object version: the layout is fixed by the engine release. Try the
    // release layouts and accept one only when summary and all three tables fit it; ambiguous or none -> partial.
    const candidates = legacy <= -8
      ? [...UE5_RELEASES].reverse().map(([n, rel]) => ({ ue4: 522, ue5: n, label: `UE ${rel} (object version 522/${n})` }))
      : [{ ue4: 522, ue5: 0, label: 'UE 4.16-4.27 / UE5 early access (object version 511-522)' }, { ue4: 510, ue5: 0, label: 'UE 4.15 (510)' }, { ue4: 508, ue5: 0, label: 'UE 4.14 (508)' }, { ue4: 505, ue5: 0, label: 'UE 4.13 (505)' }];
    const fits = [];
    let firstSummary = null;
    for (const v of candidates) {
      try {
        const s = readSummaryBody(new Reader(buf, bodyStart), legacy, v, buf.length);
        firstSummary ??= { v, s };
        const tables = readTables(buf, s, v);
        // The linker writes names, imports, exports, then the depends map: a fitting layout ends each table where the next starts.
        const tight = (s.importCount === 0 || s.exportCount === 0 || tables.importsEnd === s.exportOffset) && (s.exportCount === 0 || s.dependsOffset === 0 || tables.exportsEnd === s.dependsOffset);
        fits.push({ v, s, tables, tight });
      } catch (e) { if (!(e instanceof Short)) throw e; }
    }
    const tight = fits.filter(f => f.tight);
    const pick = tight.length ? tight : fits;
    // Layouts that read the same bytes the same way (same table sizes) are one answer, not an ambiguity.
    const same = pick.length > 0 && pick.every(f => f.tables.exportsEnd === pick[0].tables.exportsEnd && f.tables.importsEnd === pick[0].tables.importsEnd && f.s.exportCount === pick[0].s.exportCount && f.s.nameCount === pick[0].s.nameCount);
    if (pick.length && same) {
      // Names normally start right after the summary: when that singles out layouts, name only those.
      const exact = pick.filter(f => f.s.nameOffset === f.s.summaryEnd);
      if (exact.length) pick.splice(0, pick.length, ...exact);
    }
    if (pick.length && same) { chosen = pick[0]; assumed = pick.map(f => f.v.label).join(' or ') + (tight.length ? '' : ' (table ends not contiguous: lower confidence)'); }
    else if (pick.length) { result.package.candidates = pick.map(f => f.v.label); return stop('unversioned package fits more than one engine layout differently; not guessing', bodyStart); }
    else {
      if (firstSummary) result.package = { ...result.package, ...describeSummary(firstSummary.s, legacy, ue3, firstSummary.v, licensee, true, null), note: 'summary fields read with the newest candidate layout; unconfirmed' };
      return stop('unversioned package does not fit any engine layout this reader knows (UE 4.13-4.27, UE 5.0-5.7); summary fields after the version block are unconfirmed', bodyStart);
    }
  }

  const { s, v } = chosen;
  result.package = describeSummary(s, legacy, ue3, v, licensee, unversioned, assumed);
  if (chosen.error) return stop(`tables: ${chosen.error.message}`, chosen.error.offset);
  const { names, imports, exports } = chosen.tables;
  const { pathOf, nameOf, rootPackage } = resolvePaths(imports, exports);
  result.counts = { names: names.length, imports: imports.length, exports: exports.length };

  const importRows = imports.map(i => ({ index: i.index, classPackage: i.classPackage, className: i.className, objectName: i.objectName, outer: pathOf(i.outerIndex) || null, path: pathOf(i.index), ...(i.packageName ? { packageName: i.packageName } : {}), ...(i.optional ? { optional: true } : {}) }));
  const exportRows = exports.map(e => ({
    index: e.index, objectName: e.objectName, class: e.classIndex === 0 ? 'Class' : nameOf(e.classIndex),
    ...(e.classIndex < 0 ? { classPath: pathOf(e.classIndex) } : {}),
    ...(e.superIndex ? { super: nameOf(e.superIndex) } : {}),
    outer: pathOf(e.outerIndex) || null, serialSize: e.serialSize, serialOffset: e.serialOffset,
    flags: flagNames(e.objectFlags, OBJECT_FLAGS), objectFlags: hex32(e.objectFlags),
    ...(e.isAsset ? { isAsset: true } : {}), ...(e.forcedExport ? { forcedExport: true } : {}), ...(e.notForClient ? { notForClient: true } : {}), ...(e.notForServer ? { notForServer: true } : {}),
  }));

  // Summary: main asset, referenced packages, export classes.
  const base = path.basename(name).replace(/\.[^.]+$/, '');
  const top = exportRows.filter((e, i) => exports[i].outerIndex === 0);
  const main = exportRows.find(e => e.isAsset) ?? top.find(e => base && e.objectName.toLowerCase() === base.toLowerCase()) ?? top[0] ?? exportRows[0];
  const refs = new Map();
  for (const i of imports) { const pkg = i.className === 'Package' && i.outerIndex === 0 ? i.objectName : rootPackage(i.index); if (pkg) refs.set(pkg, (refs.get(pkg) ?? 0) + (i.className === 'Package' && i.outerIndex === 0 ? 0 : 1)); }
  const ranked = [...refs.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([pkg, objects]) => ({ package: pkg, objects }));
  const classes = new Map();
  for (const e of exportRows) classes.set(e.class, (classes.get(e.class) ?? 0) + 1);
  const script = ranked.filter(p => p.package.startsWith('/Script/')), content = ranked.filter(p => !p.package.startsWith('/Script/'));
  result.summary = {
    ...(main ? { mainAsset: { name: main.objectName, class: main.class } } : {}),
    referencedPackages: { total: ranked.length, content: content.slice(0, 10), script: script.slice(0, 10), ...(content.length > 10 || script.length > 10 ? { more: Math.max(0, content.length - 10) + Math.max(0, script.length - 10) } : {}) },
    exportClasses: Object.fromEntries([...classes.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 20)),
  };

  const nameRows = names.map((n, i) => ({ i, n })).filter(x => matches(x.n));
  const imp = importRows.filter(i => matches(i.path) || matches(i.className));
  const exp = exportRows.filter(e => matches(e.objectName) || matches(e.class) || (e.outer ? matches(e.outer) : false));
  result.names = cap(nameRows.map(x => x.n), max);
  result.imports = cap(imp, max);
  result.exports = cap(exp, max);
  if (match) result.match = match;
  const dataEnd = exports.reduce((m, e) => Math.max(m, e.serialOffset + e.serialSize), 0);
  const notes = [];
  if (dataEnd > buf.length) notes.push(`Export data runs past this file (to offset ${dataEnd}): it lives in the .uexp beside it${s.bulkDataStartOffset ? ' (bulk data in .ubulk)' : ''}.`);
  if ((s.packageFlags & 0x2000) !== 0) notes.push('Properties are unversioned (schema-driven, no tags): export bodies need the game\'s type mappings (.usmap) and are not read here.');
  else notes.push('Export bodies (tagged properties, Blueprint bytecode, mesh/texture payloads) are not read here: this is the package\'s table of contents.');
  if (s.compressedChunks > 0) notes.push('The package itself is stored in compressed chunks (pre-4.x style): the table offsets refer to the uncompressed package.');
  result.note = notes.join(' ');
  return result;
}

// ------------------------------------------------------------------------------------------------ IoStore .utoc
const UTOC_MAGIC = Buffer.from('-==--==--==--==-', 'latin1');
const UTOC_VERSIONS = ['Invalid', 'Initial', 'DirectoryIndex', 'PartitionSize', 'PerfectHash', 'PerfectHashWithOverflow', 'OnDemandMetaData', 'RemovedOnDemandMetaData', 'ReplaceIoChunkHashWithIoHash', 'AddedSourceHashes', 'ContainerEncryptionMethod'];
const UTOC_FLAGS = [[1, 'Compressed'], [2, 'Encrypted'], [4, 'Signed'], [8, 'Indexed'], [16, 'OnDemand']];
const UTOC_BODY_MAX_VERSION = 8; // the table order after the header is known up to ReplaceIoChunkHashWithIoHash

export function readUtoc(buf, { limit, match } = {}) {
  const max = clampLimit(limit);
  const matches = compileMatcher(match);
  if (buf.length < 144 || !buf.subarray(0, 16).equals(UTOC_MAGIC)) throw new RPError('BAD_FORMAT', 'Not an IoStore .utoc: the magic "-==--==--==--==-" is missing.');
  const r = new Reader(buf, 16);
  const version = r.u8(); r.skip(3);
  const headerSize = r.u32(), entryCount = r.u32(), blockCount = r.u32(), blockEntrySize = r.u32();
  const methodCount = r.u32(), methodLength = r.u32(), compressionBlockSize = r.u32(), directoryIndexSize = r.u32();
  let partitionCount = r.u32();
  const containerId = r.u64();
  const encryptionKeyGuid = r.guid();
  const flags = r.u8(); r.skip(3);
  const perfectHashSeeds = r.u32();
  let partitionSize = r.u64();
  const chunksWithoutPerfectHash = r.u32();
  if (version < 3) { partitionCount = 1; partitionSize = null; }
  const encrypted = (flags & 2) !== 0, signed = (flags & 4) !== 0, indexed = (flags & 8) !== 0;
  const result = {
    format: 'unreal-iostore-toc',
    counts: { chunks: entryCount, compressedBlocks: blockCount, files: null },
    toc: {
      version, versionName: UTOC_VERSIONS[version] ?? 'unknown', headerSize, entryCount, compressedBlockCount: blockCount,
      compressionBlockSize, compressionMethods: [], partitionCount, partitionSize: partitionSize === null ? null : num(partitionSize),
      containerId: '0x' + containerId.toString(16).padStart(16, '0'),
      ...(!/^[0-]+$/.test(encryptionKeyGuid) ? { encryptionKeyGuid } : {}),
      flags: { value: flags, names: flagNames(flags, UTOC_FLAGS), compressed: (flags & 1) !== 0, encrypted, signed, indexed },
      directoryIndexSize,
    },
  };
  const stop = (reason, offset) => { result.partial = { reason, ...(offset !== undefined ? { offset } : {}) }; return result; };
  if (version < 1 || version > UTOC_BODY_MAX_VERSION) return stop(`toc version ${version} (${UTOC_VERSIONS[version] ?? 'unknown'}): only the header is read; the table order after it is known for versions 1-${UTOC_BODY_MAX_VERSION}`, 144);
  if (headerSize !== 144 || blockEntrySize !== 12 || methodLength > 256 || methodCount > 64) return stop(`unexpected header values (header size ${headerSize}, block entry size ${blockEntrySize}, method name length ${methodLength})`, 20);
  try {
    const b = new Reader(buf, headerSize);
    b.skip(entryCount * 12); // FIoChunkId
    const offLenAt = b.pos;
    b.skip(entryCount * 10); // FIoOffsetAndLength: 5-byte big-endian offset, 5-byte big-endian length
    if (version >= 4) b.skip(perfectHashSeeds * 4);
    if (version >= 5) b.skip(chunksWithoutPerfectHash * 4);
    b.skip(blockCount * blockEntrySize);
    const methods = [];
    for (let i = 0; i < methodCount; i++) { const raw = b.bytes(methodLength); const z = raw.indexOf(0); const name = raw.toString('latin1', 0, z < 0 ? raw.length : z); if (name) methods.push(name); }
    result.toc.compressionMethods = methods;
    const notes = [];
    if (methods.some(m => /^oodle$/i.test(m))) notes.push('Chunks in the .ucas are Oodle-compressed: Oodle is proprietary and not readable here.');
    else if (methods.length) notes.push(`Chunks in the .ucas use ${methods.join(', ')} compression; chunk data is not read by this tool.`);
    if (encrypted) notes.push('The container is AES-encrypted: chunk data and the directory index are reported, never decrypted.');
    if (signed) { const hashSize = b.i32(); if (hashSize < 0 || hashSize > 4096) throw new Short(`implausible signature size ${hashSize}`, b.pos - 4); b.skip(hashSize * 2 + 20 * blockCount); }
    if (version >= 2 && indexed && directoryIndexSize > 0) {
      const dirAt = b.pos;
      result.toc.directoryIndexOffset = dirAt;
      if (encrypted) { result.counts.files = null; notes.push('File names are in the encrypted directory index, so they are not listed.'); }
      else {
        const d = new Reader(buf.subarray(dirAt, dirAt + directoryIndexSize));
        if (d.buf.length < directoryIndexSize) throw new Short('directory index runs past the end of the file', dirAt);
        const mountPoint = d.fstring(4096);
        const dirCount = d.i32(); if (dirCount < 0 || dirCount > 10_000_000) throw new Short(`implausible directory count ${dirCount}`, dirAt + d.pos - 4);
        const dirs = []; for (let i = 0; i < dirCount; i++) dirs.push({ name: d.u32(), child: d.u32(), sibling: d.u32(), file: d.u32() });
        const fileCount = d.i32(); if (fileCount < 0 || fileCount > 50_000_000) throw new Short(`implausible file count ${fileCount}`, dirAt + d.pos - 4);
        const files = []; for (let i = 0; i < fileCount; i++) files.push({ name: d.u32(), next: d.u32(), userData: d.u32() });
        const stringCount = d.i32(); if (stringCount < 0 || stringCount > 50_000_000) throw new Short(`implausible string count ${stringCount}`, dirAt + d.pos - 4);
        const strings = []; for (let i = 0; i < stringCount; i++) strings.push(d.fstring(4096));
        const NONE = 0xffffffff;
        const sizeOf = chunk => { if (chunk >= entryCount) return null; const o = offLenAt + chunk * 10; return buf.readUIntBE(o + 5, 5); };
        const list = [];
        const seenDir = new Set();
        const stack = dirs.length ? [[0, '']] : [];
        while (stack.length) {
          const [index, prefix] = stack.pop();
          if (index === NONE || index >= dirs.length || seenDir.has(index)) continue;
          seenDir.add(index);
          const dir = dirs[index];
          const here = dir.name === NONE ? prefix : `${prefix}${strings[dir.name] ?? `<name ${dir.name}>`}/`;
          let f = dir.file, guard = 0;
          while (f !== NONE && f < files.length && guard++ <= files.length) { const fe = files[f]; list.push({ path: here + (strings[fe.name] ?? `<name ${fe.name}>`), size: sizeOf(fe.userData), chunk: fe.userData }); f = fe.next; }
          if (dir.sibling !== NONE) stack.push([dir.sibling, prefix]);
          if (dir.child !== NONE) stack.push([dir.child, here]);
        }
        list.sort((a, b2) => (a.path < b2.path ? -1 : a.path > b2.path ? 1 : 0));
        result.mountPoint = mountPoint;
        result.counts.files = list.length;
        const shown = list.filter(f => matches(f.path));
        result.files = cap(shown, max);
        if (match) result.match = match;
        const ext = {};
        for (const f of list) { const e = path.extname(f.path).toLowerCase() || '(none)'; ext[e] = (ext[e] ?? 0) + 1; }
        result.extensions = Object.fromEntries(Object.entries(ext).sort((a, b2) => b2[1] - a[1]).slice(0, 12));
      }
    } else notes.push('This container has no directory index: chunks are addressed by id only, so there are no file names to list.');
    notes.push('Sizes are uncompressed chunk lengths from the toc. Packages inside IoStore are in the Zen layout (no 0x9E2A83C1 summary), which this tool does not read.');
    result.note = notes.join(' ');
  } catch (e) { if (!(e instanceof Short)) throw e; return stop(`toc body: ${e.message}`, e.offset); }
  return result;
}

// ------------------------------------------------------------------------------------------------ .locres
const LOCRES_MAGIC = Buffer.from([0x0e, 0x14, 0x74, 0x75, 0x67, 0x4a, 0x03, 0xfc, 0x4a, 0x15, 0x90, 0x9d, 0xc3, 0x37, 0x7f, 0x1b]);
const LOCRES_VERSIONS = ['Legacy', 'Compact', 'Optimized_CRC32', 'Optimized_CityHash64_UTF16'];

/** Parse a .locres into flat entries { namespace, key, text, sourceHash }. Throws RPError when it is not one. */
export function parseLocres(buf) {
  let version = 0, r;
  const hasMagic = buf.length >= 17 && buf.subarray(0, 16).equals(LOCRES_MAGIC);
  if (hasMagic) { version = buf[16]; r = new Reader(buf, 17); } else r = new Reader(buf, 0);
  const out = { version, versionName: LOCRES_VERSIONS[version] ?? 'unknown', hasMagic, namespaces: [], entries: [] };
  if (version > 3) { out.partial = { reason: `locres version ${version} is newer than this reader (0-3)`, offset: 16 }; return out; }
  try {
    let strings = null;
    if (version >= 1) {
      const arrayOffset = r.i64();
      strings = [];
      if (arrayOffset !== -1n) {
        if (arrayOffset < 0n || arrayOffset > BigInt(buf.length)) throw new Short(`string table offset ${arrayOffset} outside the file`, r.pos - 8);
        const t = new Reader(buf, Number(arrayOffset));
        const n = t.i32(); if (n < 0 || n > 50_000_000) throw new Short(`implausible string count ${n}`, t.pos - 4);
        for (let i = 0; i < n; i++) { const text = t.fstring(1 << 24); if (version >= 2) t.skip(4); /* ref count */ strings.push(text); }
      }
    }
    if (version >= 2) out.entriesCount = r.u32();
    const namespaceCount = r.u32();
    if (namespaceCount > 10_000_000) throw new Short(`implausible namespace count ${namespaceCount}`, r.pos - 4);
    for (let i = 0; i < namespaceCount; i++) {
      if (version >= 2) r.skip(4); // namespace hash
      const namespace = r.fstring(1 << 16);
      const keyCount = r.u32();
      if (keyCount > 50_000_000) throw new Short(`implausible key count ${keyCount}`, r.pos - 4);
      out.namespaces.push({ name: namespace, keys: keyCount });
      for (let j = 0; j < keyCount; j++) {
        if (version >= 2) r.skip(4); // key hash
        const key = r.fstring(1 << 16);
        const sourceHash = r.u32();
        let text;
        if (version >= 1) { const index = r.i32(); text = index >= 0 && index < strings.length ? strings[index] : null; }
        else text = r.fstring(1 << 24);
        out.entries.push({ namespace, key, text, sourceHash: hex32(sourceHash) });
      }
    }
    if (!hasMagic && r.pos !== buf.length) throw new Short('legacy layout does not end at the end of the file', r.pos);
  } catch (e) {
    if (!(e instanceof Short)) throw e;
    if (!hasMagic) throw new RPError('BAD_FORMAT', `Not a .locres this reader knows: no magic GUID and the legacy layout does not fit (${e.message}).`);
    out.partial = { reason: e.message, offset: e.offset };
  }
  return out;
}

function readLocres(buf, { limit, match, name = '' } = {}) {
  const max = clampLimit(limit);
  const matches = compileMatcher(match);
  const p = parseLocres(buf);
  const file = path.basename(name);
  // Same fields re_strings entries carry (id, file, where, prop, text, kind, chars), plus namespace and key.
  const rows = p.entries.filter(e => matches(e.key) || matches(e.namespace) || (e.text !== null && matches(e.text)))
    .map(e => ({ namespace: e.namespace, key: e.key, text: e.text, id: `${file}#${e.namespace}#${e.key}`, file, where: e.namespace, prop: e.key, kind: 'unreal-locres', chars: e.text?.length ?? 0, sourceHash: e.sourceHash }));
  const result = {
    format: 'unreal-locres',
    counts: { namespaces: p.namespaces.length, entries: p.entries.length, words: p.entries.reduce((n, e) => n + (e.text ? e.text.split(/\s+/).filter(Boolean).length : 0), 0) },
    locres: { version: p.version, versionName: p.versionName, magic: p.hasMagic },
    namespaces: cap(p.namespaces, Math.min(max, 50)),
    entries: cap(rows, max),
    ...(match ? { match } : {}),
    ...(p.partial ? { partial: p.partial } : {}),
    note: 'key is the text key in its namespace; sourceHash is the hash of the source-language string the translation was made for. The culture is the folder name (…/Localization/<target>/<culture>/<target>.locres).',
  };
  return result;
}

// ------------------------------------------------------------------------------------------------ GVAS save games
const GVAS_NEW_TAG_UE5 = 1012; // PROPERTY_TAG_COMPLETE_TYPE_NAME: the tag layout changes, not read here
const scalarReaders = {
  IntProperty: r => r.i32(), Int8Property: r => (r.u8() << 24) >> 24, Int16Property: r => (r.u16() << 16) >> 16, Int64Property: r => num(r.i64()),
  UInt16Property: r => r.u16(), UInt32Property: r => r.u32(), UInt64Property: r => num(r.u64()),
  FloatProperty: r => r.f32(), DoubleProperty: r => r.f64(),
  StrProperty: r => r.fstring(1 << 24), NameProperty: r => r.fstring(1 << 16), ObjectProperty: r => r.fstring(1 << 16), EnumProperty: r => r.fstring(1 << 16),
};
const TICKS_AT_UNIX_EPOCH = 621355968000000000n;

function readKnownStruct(r, name, size) {
  const fp = (n, keys) => { if (size === n * 4) return Object.fromEntries(keys.map(k => [k, r.f32()])); if (size === n * 8) return Object.fromEntries(keys.map(k => [k, r.f64()])); return undefined; };
  switch (name) {
    case 'Vector': return fp(3, ['x', 'y', 'z']);
    case 'Vector2D': return fp(2, ['x', 'y']);
    case 'Rotator': return fp(3, ['pitch', 'yaw', 'roll']);
    case 'Quat': return fp(4, ['x', 'y', 'z', 'w']);
    case 'LinearColor': return size === 16 ? { r: r.f32(), g: r.f32(), b: r.f32(), a: r.f32() } : undefined;
    case 'Color': return size === 4 ? { b: r.u8(), g: r.u8(), r: r.u8(), a: r.u8() } : undefined;
    case 'IntPoint': return size === 8 ? { x: r.i32(), y: r.i32() } : undefined;
    case 'IntVector': return size === 12 ? { x: r.i32(), y: r.i32(), z: r.i32() } : undefined;
    case 'Guid': return size === 16 ? r.guid() : undefined;
    case 'DateTime': {
      if (size !== 8) return undefined;
      const ticks = r.i64();
      const ms = Number((ticks - TICKS_AT_UNIX_EPOCH) / 10000n);
      const d = new Date(ms);
      return { ticks: ticks.toString(), ...(Number.isNaN(d.getTime()) ? {} : { iso: d.toISOString() }) };
    }
    case 'Timespan': return size === 8 ? { ticks: r.i64().toString() } : undefined;
    default: return undefined;
  }
}
const KNOWN_STRUCT_SIZE = { Guid: 16, DateTime: 8, Timespan: 8, LinearColor: 16, Color: 4, IntPoint: 8, IntVector: 12 };

/** FText, simple histories only (None with an optional culture-invariant string, Base with namespace/key/source). */
function readText(r, size) {
  const start = r.pos;
  try {
    const flags = r.u32();
    const history = (r.u8() << 24) >> 24;
    let value;
    if (history === -1) { const has = r.u32(); value = { flags, text: has ? r.fstring(1 << 24) : '' }; }
    else if (history === 0) { const namespace = r.fstring(1 << 16), key = r.fstring(1 << 16), text = r.fstring(1 << 24); value = { flags, namespace, key, text }; }
    if (value && r.pos === start + size) return value;
  } catch (e) { if (!(e instanceof Short)) throw e; }
  r.pos = start + size;
  return { $raw: size, type: 'TextProperty', note: 'complex text history, not decoded' };
}

function readGvasProperties(r, ctx, depth, end = r.buf.length) {
  const props = {}, types = {};
  if (depth > 48) throw new Short('property nesting too deep', r.pos);
  for (;;) {
    const at = r.pos;
    let name, type, size, arrayIndex, bodyAt;
    const tag = {};
    try {
      if (at >= end) throw new Short('property list ends without a "None" terminator', at);
      name = r.fstring(1 << 12);
      if (name === 'None') break;
      if (!name || /[\0-\x1f]/.test(name)) throw new Short(`property name is not readable at ${at}`, at);
      type = r.fstring(256);
      if (!/^[A-Za-z0-9_]+Property$/.test(type)) throw new Short(`"${type.slice(0, 40)}" at ${at} is not a property type`, at);
      size = r.i32(); arrayIndex = r.i32();
      if (size < 0) throw new Short(`negative property size at ${at}`, at);
      tag.type = type;
      if (type === 'StructProperty') { tag.struct = r.fstring(1 << 12); r.skip(16); }
      else if (type === 'BoolProperty') tag.bool = r.u8() !== 0;
      else if (type === 'ByteProperty' || type === 'EnumProperty') tag.enum = r.fstring(1 << 12);
      else if (type === 'ArrayProperty' || type === 'SetProperty') tag.inner = r.fstring(256);
      else if (type === 'MapProperty') { tag.key = r.fstring(256); tag.value = r.fstring(256); }
      const hasGuid = r.u8();
      if (hasGuid > 1) throw new Short(`property guid flag is ${hasGuid} at ${r.pos - 1}`, r.pos - 1);
      if (hasGuid) r.skip(16);
      bodyAt = r.pos;
      r.need(size);
    } catch (e) {
      // A broken tag ends the list. At the top level keep what was read and say where it stopped.
      if (!(e instanceof Short) || depth > 0) throw e;
      ctx.stopped = { offset: at, reason: e.message };
      break;
    }
    let value;
    try {
      value = readGvasValue(r, tag, size, ctx, depth);
      if (r.pos !== bodyAt + size) throw new Short(`${type} body read ${r.pos - bodyAt} of ${size} bytes`, bodyAt);
    } catch (e) {
      if (!(e instanceof Short)) throw e;
      // The tag gives the size, so the envelope is still known: keep the property as unread bytes and go on.
      ctx.unread.push({ property: name, type: describeType(tag), offset: bodyAt, size, reason: e.message });
      value = { $raw: size, type: describeType(tag) };
      r.pos = bodyAt + size;
    }
    const key = arrayIndex > 0 ? `${name}[${arrayIndex}]` : name in props ? `${name}@${at}` : name;
    props[key] = value;
    types[key] = describeType(tag);
  }
  return { props, types };
}

const describeType = tag => (tag.struct ? `StructProperty<${tag.struct}>` : tag.inner ? `${tag.type}<${tag.inner}${tag.innerStruct ? `<${tag.innerStruct}>` : ''}>` : tag.key ? `MapProperty<${tag.key}${tag.keyStruct ? `<${tag.keyStruct}>` : ''},${tag.value}>` : tag.enum && tag.enum !== 'None' ? `${tag.type}<${tag.enum}>` : tag.type);

function readStructBody(r, structName, size, ctx, depth) {
  const known = readKnownStruct(r, structName, size);
  if (known !== undefined) return known;
  const { props } = readGvasProperties(r, ctx, depth + 1, r.pos + size);
  return props;
}

/** One element inside an array, set or map (no tag of its own). */
function readElement(r, type, ctx, depth, structName) {
  if (scalarReaders[type]) return scalarReaders[type](r);
  if (type === 'BoolProperty') return r.u8() !== 0;
  if (type === 'ByteProperty') return r.u8();
  if (type === 'StructProperty') {
    if (structName && KNOWN_STRUCT_SIZE[structName]) return readKnownStruct(r, structName, KNOWN_STRUCT_SIZE[structName]);
    if (structName === undefined) throw new Short('struct element whose type the save does not name', r.pos);
    const { props } = readGvasProperties(r, ctx, depth + 1);
    return props;
  }
  throw new Short(`${type} elements are not read`, r.pos);
}

function readGvasValue(r, tag, size, ctx, depth) {
  const { type } = tag;
  if (type === 'BoolProperty') return tag.bool;
  if (scalarReaders[type]) return scalarReaders[type](r);
  if (type === 'ByteProperty') return tag.enum && tag.enum !== 'None' ? r.fstring(1 << 12) : r.u8();
  if (type === 'TextProperty') return readText(r, size);
  if (type === 'StructProperty') return readStructBody(r, tag.struct, size, ctx, depth);
  if (type === 'ArrayProperty') {
    const start = r.pos;
    const count = r.i32();
    if (count < 0 || count > size) throw new Short(`implausible array count ${count}`, start);
    if (tag.inner === 'StructProperty') {
      // An inner property tag names the struct type once, then the elements follow.
      r.fstring(1 << 12); // repeats the array's name
      const innerType = r.fstring(256);
      if (innerType !== 'StructProperty') throw new Short(`array inner tag is ${innerType}`, r.pos);
      const innerSize = r.i32(); r.i32();
      const structName = r.fstring(1 << 12); r.skip(16);
      const g = r.u8(); if (g > 1) throw new Short('array inner tag guid flag is not a bool', r.pos - 1); if (g) r.skip(16);
      tag.innerStruct = structName;
      const out = [];
      const each = count ? innerSize / count : 0;
      for (let i = 0; i < count; i++) {
        const fixed = readKnownStruct(r, structName, Number.isInteger(each) ? each : -1);
        out.push(fixed !== undefined ? fixed : readGvasProperties(r, ctx, depth + 1).props);
      }
      return out;
    }
    if (tag.inner === 'ByteProperty') {
      // Raw bytes when the size says one byte each; otherwise enum names as strings.
      if (size - 4 === count) { const b = r.bytes(count); return count <= 64 ? [...b] : { $bytes: count, head: b.subarray(0, 16).toString('hex') }; }
      const out = []; for (let i = 0; i < count; i++) out.push(r.fstring(1 << 12)); return out;
    }
    const out = [];
    for (let i = 0; i < count; i++) out.push(readElement(r, tag.inner, ctx, depth));
    return out;
  }
  if (type === 'SetProperty') {
    const removed = r.i32();
    if (removed !== 0) throw new Short('set with elements-to-remove is not read', r.pos - 4);
    const count = r.i32();
    if (count < 0 || count > size) throw new Short(`implausible set count ${count}`, r.pos - 4);
    const structName = tag.inner === 'StructProperty' && count > 0 && (size - 8) / count === 16 ? 'Guid' : undefined;
    const out = [];
    for (let i = 0; i < count; i++) out.push(readElement(r, tag.inner, ctx, depth, structName));
    return out;
  }
  if (type === 'MapProperty') {
    const removed = r.i32();
    if (removed !== 0) throw new Short('map with keys-to-remove is not read', r.pos - 4);
    const count = r.i32();
    if (count < 0 || count > size) throw new Short(`implausible map count ${count}`, r.pos - 4);
    // Struct keys carry no type name. A 16-byte key (FGuid) is by far the usual case: assume it, marked with "?",
    // and let the caller's exact-size check reject the property when the assumption does not fit.
    let keyStruct;
    if (tag.key === 'StructProperty') {
      const fixed = { IntProperty: 4, FloatProperty: 4, UInt32Property: 4, Int64Property: 8, DoubleProperty: 8, BoolProperty: 1, ByteProperty: 1 }[tag.value];
      if (fixed !== undefined && size - 8 !== count * (16 + fixed)) throw new Short('map with struct keys that are not 16 bytes: the key type is not named in the save', r.pos);
      keyStruct = 'Guid'; tag.keyStruct = 'Guid?';
    }
    const out = [];
    // Struct values are property lists (the save does not name their type either, but a list is self-describing).
    for (let i = 0; i < count; i++) { const key = readElement(r, tag.key, ctx, depth, keyStruct); const value = readElement(r, tag.value, ctx, depth, tag.value === 'StructProperty' ? '' : undefined); out.push({ key, value }); }
    return out;
  }
  throw new Short(`${type} is not read`, r.pos);
}

/**
 * GVAS save game → { header, properties, types, partial? }. `properties` is a plain object (name → value) so a
 * save layer can flatten it; `types` gives each top-level property's Unreal type. Never throws on a truncated or
 * unknown body: `partial` says where reading stopped and why.
 */
export function readGvas(buf) {
  if (buf.length < 22 || buf.toString('latin1', 0, 4) !== 'GVAS') throw new RPError('BAD_FORMAT', 'Not a GVAS save: the magic "GVAS" is missing.');
  const r = new Reader(buf, 4);
  const header = {};
  const out = { header, properties: {}, types: {} };
  try {
    header.saveGameVersion = r.i32();
    header.packageVersionUE4 = r.i32();
    if (header.saveGameVersion >= 3) header.packageVersionUE5 = r.i32();
    const major = r.u16(), minor = r.u16(), patch = r.u16(), changelist = r.u32();
    header.engineVersion = `${major}.${minor}.${patch}`;
    header.engineChangelist = changelist;
    header.engineBranch = r.fstring(1024);
    header.customVersions = [];
    if (major > 4 || (major === 4 && minor >= 12)) {
      header.customVersionFormat = r.i32();
      const n = r.i32();
      if (n < 0 || n > 4096) throw new Short(`implausible custom version count ${n}`, r.pos - 4);
      for (let i = 0; i < n; i++) { const key = r.guid(); header.customVersions.push({ key, version: r.i32() }); }
    }
    header.saveGameClassName = r.fstring(1 << 12);
  } catch (e) { if (!(e instanceof Short)) throw e; out.partial = { offset: e.offset, reason: `header: ${e.message}` }; return out; }
  if ((header.packageVersionUE5 ?? 0) >= GVAS_NEW_TAG_UE5) {
    out.partial = { offset: r.pos, reason: `package version ${header.packageVersionUE5} (UE 5.4+) uses the complete-type-name property tag, which this reader does not decode; header only` };
    return out;
  }
  const ctx = { unread: [] };
  const { props, types } = readGvasProperties(r, ctx, 0);
  out.properties = props; out.types = types;
  if (ctx.stopped) out.partial = ctx.stopped; else out.propertiesEnd = r.pos;
  if (ctx.unread.length) {
    out.unread = ctx.unread;
    out.partial ??= { offset: ctx.unread[0].offset, reason: `${ctx.unread.length} propert${ctx.unread.length === 1 ? 'y' : 'ies'} kept as unread bytes (first: ${ctx.unread[0].property}, ${ctx.unread[0].type}: ${ctx.unread[0].reason})` };
  }
  return out;
}

/** Compact preview of a decoded value for tool output: long arrays and strings are cut with a count. */
function preview(value, depth = 0) {
  if (typeof value === 'string') return value.length > 240 ? `${value.slice(0, 240)}… (+${value.length - 240} chars)` : value;
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    const keep = depth === 0 ? 8 : 3;
    if (depth >= 4) return `[${value.length} items]`;
    const items = value.slice(0, keep).map(v => preview(v, depth + 1));
    return value.length > keep ? { count: value.length, items, more: value.length - keep } : items;
  }
  if (depth >= 4) return `{${Object.keys(value).length} fields}`;
  const keys = Object.keys(value), keep = depth === 0 ? 40 : 12;
  const out = {};
  for (const k of keys.slice(0, keep)) out[k] = preview(value[k], depth + 1);
  if (keys.length > keep) out.$more = keys.length - keep;
  return out;
}

function gvasResult(buf, { limit, match } = {}) {
  const max = clampLimit(limit);
  const matches = compileMatcher(match);
  const g = readGvas(buf);
  const names = Object.keys(g.properties);
  const rows = names.filter(n => matches(n) || matches(g.types[n])).map(n => ({ name: n, type: g.types[n], value: preview(g.properties[n]) }));
  const byType = {};
  for (const n of names) { const t = g.types[n].replace(/<.*$/, ''); byType[t] = (byType[t] ?? 0) + 1; }
  return {
    format: 'unreal-gvas',
    counts: { properties: names.length, customVersions: g.header.customVersions?.length ?? 0, ...(g.unread ? { unread: g.unread.length } : {}) },
    header: { ...g.header, customVersions: cap(g.header.customVersions ?? [], Math.min(max, 12)) },
    propertyTypes: byType,
    properties: cap(rows, max),
    ...(match ? { match } : {}),
    ...(g.unread ? { unread: cap(g.unread, 12) } : {}),
    ...(g.partial ? { partial: g.partial } : {}),
    note: 'Values are previews (long arrays and strings are cut with a count); readGvas returns them whole. Object references are stored as path strings.',
  };
}

// ------------------------------------------------------------------------------------------------ tool
const MAX_WHOLE = 512 * 1024 * 1024;
const NEXT = {
  'unreal-package': 'imports are what this asset needs (/Script/… = C++ classes in the game binary, /Game/… = other assets); exports are the objects it defines. Use match to find a class or name; re_archive lists the .pak this file came from, re_binary reads the executable for the /Script classes.',
  'unreal-iostore-toc': 'The file list is the container\'s content map: use match (e.g. "*.umap", "/Maps/") to find levels and assets. The data is in the .ucas beside this file.',
  'unreal-locres': 'Entries are (namespace, key, text): feed them to a translation table for the port; the same keys appear in other cultures\' .locres files.',
  'unreal-gvas': 'Property names and types are the save\'s schema; compare two saves of the same game to see which field an action changes.',
};

export async function unrealTool({ file, limit, match } = {}) {
  if (!file) throw new RPError('INVALID_ARGUMENT', 'file is required: a .uasset, .umap, .utoc, .locres or GVAS .sav file.');
  const { abs, size } = await requireFile(file);
  const ext = path.extname(abs).toLowerCase();
  const head = await readAt(abs, 0, 20);
  const magic = head.length >= 4 ? head.readUInt32LE(0) : 0;
  let kind = null;
  if (magic === PACKAGE_TAG || magic === PACKAGE_TAG_SWAPPED) kind = 'package';
  else if (head.length >= 16 && head.subarray(0, 16).equals(UTOC_MAGIC)) kind = 'utoc';
  else if (head.length >= 16 && head.subarray(0, 16).equals(LOCRES_MAGIC)) kind = 'locres';
  else if (head.toString('latin1', 0, 4) === 'GVAS') kind = 'gvas';
  else if (ext === '.locres') kind = 'locres'; // legacy .locres has no magic
  if (!kind) {
    if (ext === '.ucas') throw new RPError('BAD_FORMAT', 'A .ucas holds the chunk data only; give the .utoc beside it for the header and file list.');
    if (ext === '.uexp' || ext === '.ubulk' || ext === '.uptnl') throw new RPError('BAD_FORMAT', `${ext} is the data half of a split package; give the .uasset/.umap beside it for the summary and tables.`);
    if (ext === '.uasset' || ext === '.umap') throw new RPError('BAD_FORMAT', 'No 0x9E2A83C1 package magic: this is probably a Zen (IoStore) package or an encrypted/compressed pak entry, which this tool does not read.');
    throw new RPError('BAD_FORMAT', 'Not an Unreal file this tool reads (.uasset/.umap package, IoStore .utoc, .locres, GVAS save).');
  }
  if (size > MAX_WHOLE) throw new RPError('TOO_LARGE', 'Files over 512 MB are not read whole.');
  let buf;
  if (kind === 'package') {
    // Only the header (summary + tables) is needed: read the start, then as far as TotalHeaderSize asks.
    buf = await readAt(abs, 0, Math.min(size, 4 * 1024 * 1024));
    if (size > buf.length) buf = await fs.readFile(abs);
  } else buf = await fs.readFile(abs);
  const opts = { limit, match, name: abs };
  const body = kind === 'package' ? readPackage(buf, opts) : kind === 'utoc' ? readUtoc(buf, opts) : kind === 'locres' ? readLocres(buf, opts) : gvasResult(buf, opts);
  const { format, counts, ...rest } = body;
  return { file: abs, size, format, counts, ...rest, next: NEXT[format] };
}
