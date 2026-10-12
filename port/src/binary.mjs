// Executable and bytecode inspection: PE (incl. .NET metadata), ELF, Mach-O, WebAssembly, Java class,
// Android dex. Headers, sections with entropy, imports/exports, debug info, strings and toolchain hints.
// It only reads and describes — it does not unpack, decrypt or patch anything.
import { entropy, readAt, readHead, sha256File, MiB, hex, RPError, requireFile, compileMatcher } from './util.mjs';
import { identify } from './formats.mjs';

const HEAD_LIMIT = 256 * MiB;

function cstr(buf, off, max = 4096) {
  if (off < 0 || off >= buf.length) return null;
  let end = off;
  const stop = Math.min(buf.length, off + max);
  while (end < stop && buf[end] !== 0) end++;
  return buf.toString('utf8', off, end);
}

// ---------------------------------------------------------------- PE / COFF
const PE_MACHINES = { 0x14c: 'x86', 0x8664: 'x86-64', 0xaa64: 'arm64', 0x1c0: 'arm', 0x1c4: 'arm (thumb-2)', 0x200: 'ia64', 0xa641: 'arm64ec' };
const PE_SUBSYSTEMS = { 1: 'native', 2: 'windows GUI', 3: 'console', 9: 'Windows CE', 10: 'EFI application', 14: 'Xbox' };

export function parsePE(buf) {
  const peOff = buf.readUInt32LE(0x3c);
  if (buf.toString('latin1', peOff, peOff + 4) !== 'PE\0\0') throw new RPError('BAD_FORMAT', 'MZ header without PE signature');
  const coff = peOff + 4;
  const machine = buf.readUInt16LE(coff);
  const nSections = buf.readUInt16LE(coff + 2);
  const timestamp = buf.readUInt32LE(coff + 4);
  const symPtr = buf.readUInt32LE(coff + 8), symCount = buf.readUInt32LE(coff + 12);
  const optSize = buf.readUInt16LE(coff + 16);
  const characteristics = buf.readUInt16LE(coff + 18);
  const opt = coff + 20;
  const magic = buf.readUInt16LE(opt);
  const pe64 = magic === 0x20b;
  if (!pe64 && magic !== 0x10b) throw new RPError('BAD_FORMAT', `Unknown PE optional header magic ${hex(magic)}`);
  const entry = buf.readUInt32LE(opt + 16);
  const imageBase = pe64 ? Number(buf.readBigUInt64LE(opt + 24)) : buf.readUInt32LE(opt + 28);
  const subsystem = buf.readUInt16LE(opt + 68);
  const nDirs = buf.readUInt32LE(opt + (pe64 ? 108 : 92));
  const dirBase = opt + (pe64 ? 112 : 96);
  const dirs = [];
  for (let i = 0; i < Math.min(nDirs, 16); i++) dirs.push({ rva: buf.readUInt32LE(dirBase + i * 8), size: buf.readUInt32LE(dirBase + i * 8 + 4) });

  const sections = [];
  const secBase = opt + optSize;
  for (let i = 0; i < nSections; i++) {
    const s = secBase + i * 40;
    const name = buf.toString('latin1', s, s + 8).replace(/\0+$/, '');
    sections.push({
      name, virtualSize: buf.readUInt32LE(s + 8), virtualAddress: buf.readUInt32LE(s + 12),
      rawSize: buf.readUInt32LE(s + 16), rawOffset: buf.readUInt32LE(s + 20), flags: buf.readUInt32LE(s + 36),
    });
  }
  const rvaToOff = rva => {
    for (const s of sections) {
      const span = Math.max(s.virtualSize, s.rawSize);
      if (rva >= s.virtualAddress && rva < s.virtualAddress + span) return rva - s.virtualAddress + s.rawOffset;
    }
    return rva < (sections[0]?.virtualAddress ?? 0x1000) ? rva : -1;
  };
  const rstr = rva => { const o = rvaToOff(rva); return o >= 0 ? cstr(buf, o, 512) : null; };
  const warnings = [];

  // Imports
  const imports = [];
  if (dirs[1]?.rva) {
    try {
      let d = rvaToOff(dirs[1].rva);
      for (let n = 0; d >= 0 && n < 4096; n++, d += 20) {
        const oft = buf.readUInt32LE(d), nameRva = buf.readUInt32LE(d + 12), ft = buf.readUInt32LE(d + 16);
        if (!oft && !nameRva && !ft) break;
        const dll = rstr(nameRva) ?? '?';
        const functions = [];
        let t = rvaToOff(oft || ft);
        const step = pe64 ? 8 : 4;
        for (let k = 0; t >= 0 && k < 20000; k++, t += step) {
          const v = pe64 ? buf.readBigUInt64LE(t) : BigInt(buf.readUInt32LE(t));
          if (v === 0n) break;
          const ordinal = pe64 ? (v >> 63n) === 1n : (v >> 31n) === 1n;
          if (ordinal) functions.push(`#${Number(v & 0xffffn)}`);
          else { const o = rvaToOff(Number(v & 0x7fffffffn)); functions.push(o >= 0 ? cstr(buf, o + 2, 512) : '?'); }
        }
        imports.push({ library: dll, functions });
      }
    } catch { warnings.push('import table is outside the read range or damaged'); }
  }
  // Delay-load imports (library names only)
  if (dirs[13]?.rva) {
    try {
      let d = rvaToOff(dirs[13].rva);
      for (let n = 0; d >= 0 && n < 1024; n++, d += 32) {
        const attrs = buf.readUInt32LE(d), nameRef = buf.readUInt32LE(d + 4);
        if (!attrs && !nameRef) break;
        const name = rstr(attrs & 1 ? nameRef : nameRef - imageBase);
        if (name) imports.push({ library: name, delayLoaded: true, functions: [] });
      }
    } catch { warnings.push('delay-import table damaged'); }
  }
  // Exports
  let exports = null;
  if (dirs[0]?.rva) {
    try {
      const e = rvaToOff(dirs[0].rva);
      const nNames = buf.readUInt32LE(e + 24), namesRva = buf.readUInt32LE(e + 32);
      const names = [];
      const base = rvaToOff(namesRva);
      for (let i = 0; i < Math.min(nNames, 20000); i++) names.push(rstr(buf.readUInt32LE(base + i * 4)));
      exports = { dllName: rstr(buf.readUInt32LE(e + 12)), functionCount: buf.readUInt32LE(e + 20), names };
    } catch { warnings.push('export table damaged'); }
  }
  // Debug directory → PDB path
  let pdb = null;
  if (dirs[6]?.rva) {
    try {
      const d = rvaToOff(dirs[6].rva);
      for (let i = 0; i < Math.min(dirs[6].size / 28, 16); i++) {
        const entryOff = d + i * 28;
        if (buf.readUInt32LE(entryOff + 12) !== 2) continue; // CODEVIEW
        const p = buf.readUInt32LE(entryOff + 24);
        if (buf.toString('latin1', p, p + 4) === 'RSDS') pdb = { path: cstr(buf, p + 24, 1024), age: buf.readUInt32LE(p + 20), guid: buf.subarray(p + 4, p + 20).toString('hex') };
      }
    } catch { /* optional */ }
  }
  // MSVC "Rich" header between the DOS stub and the PE header
  const richAt = buf.subarray(0x40, peOff).indexOf('Rich');
  const dotnet = dirs[14]?.rva ? parseDotNet(buf, rvaToOff, dirs[14].rva, warnings) : null;
  let lastRaw = sections.reduce((m, s) => Math.max(m, s.rawOffset + s.rawSize), 0);
  if (symPtr && symPtr >= lastRaw) { // MinGW keeps a COFF symbol table + string table after the sections
    const strTab = symPtr + symCount * 18;
    lastRaw = strTab + (strTab + 4 <= buf.length ? buf.readUInt32LE(strTab) : 0);
  }
  const certTable = dirs[4]?.rva ? { offset: dirs[4].rva, size: dirs[4].size } : null; // file offset, not an RVA

  return {
    format: 'pe', bits: pe64 ? 64 : 32, endian: 'little', arch: PE_MACHINES[machine] ?? hex(machine),
    kind: characteristics & 0x2000 ? 'dll' : 'exe', subsystem: PE_SUBSYSTEMS[subsystem] ?? subsystem,
    entryPoint: hex(entry), imageBase: hex(imageBase), timestamp: timestamp ? new Date(timestamp * 1000).toISOString() : null,
    sections, imports, exports, pdb, signed: !!certTable?.size, msvcRichHeader: richAt >= 0,
    dotnet, lastSectionEnd: lastRaw, certTable, warnings,
  };
}

// .NET (ECMA-335) metadata: runtime version, assembly name, type and method names.
const CODED = { typeDefOrRef: [[2, 1, 0x1b], 2], resolutionScope: [[0, 0x1a, 0x23, 1], 2] };
function parseDotNet(buf, rvaToOff, cliRva, warnings) {
  try {
    const cli = rvaToOff(cliRva);
    const mdRva = buf.readUInt32LE(cli + 8);
    const flags = buf.readUInt32LE(cli + 16);
    const md = rvaToOff(mdRva);
    if (buf.readUInt32LE(md) !== 0x424a5342) return { warning: 'CLI header without BSJB metadata' };
    const verLen = buf.readUInt32LE(md + 12);
    const runtime = cstr(buf, md + 16, verLen);
    let p = md + 16 + verLen;
    const nStreams = buf.readUInt16LE(p + 2);
    p += 4;
    const streams = {};
    for (let i = 0; i < nStreams; i++) {
      const off = buf.readUInt32LE(p), size = buf.readUInt32LE(p + 4);
      const name = cstr(buf, p + 8, 32);
      streams[name] = { off: md + off, size };
      p += 8 + ((name.length + 4) & ~3);
    }
    const tables = streams['#~'] ?? streams['#-'];
    const strings = streams['#Strings'];
    const result = { runtime, ilOnly: !!(flags & 1), streams: Object.keys(streams) };
    if (!tables || !strings) return result;
    const t = tables.off;
    const heapSizes = buf[t + 6];
    const valid = buf.readBigUInt64LE(t + 8);
    const rows = new Array(64).fill(0);
    let q = t + 24;
    for (let i = 0; i < 64; i++) if ((valid >> BigInt(i)) & 1n) { rows[i] = buf.readUInt32LE(q); q += 4; }
    if (heapSizes & 0x40) q += 4; // extra data
    const strIdx = heapSizes & 1 ? 4 : 2, guidIdx = heapSizes & 2 ? 4 : 2, blobIdx = heapSizes & 4 ? 4 : 2;
    const idx = table => (rows[table] < 0x10000 ? 2 : 4);
    const coded = ([tabs, bits]) => (Math.max(...tabs.map(x => rows[x])) < 1 << (16 - bits) ? 2 : 4);
    const sizes = {
      0: 2 + strIdx + guidIdx * 3, // Module
      1: coded(CODED.resolutionScope) + strIdx * 2, // TypeRef
      2: 4 + strIdx * 2 + coded(CODED.typeDefOrRef) + idx(4) + idx(6), // TypeDef
      3: idx(4), // FieldPtr
      4: 2 + strIdx + blobIdx, // Field
      5: idx(6), // MethodPtr
      6: 4 + 2 + 2 + strIdx + blobIdx + idx(8), // MethodDef
    };
    const tableStart = [];
    let cursor = q;
    for (let i = 0; i <= 6; i++) { tableStart[i] = cursor; cursor += rows[i] * sizes[i]; }
    const readIdx = (o, size) => (size === 2 ? buf.readUInt16LE(o) : buf.readUInt32LE(o));
    const str = i => cstr(buf, strings.off + i, 1024) ?? '';
    const assemblyName = rows[0] ? str(readIdx(tableStart[0] + 2, strIdx)) : null;
    const types = [];
    const methodNames = [];
    for (let m = 0; m < Math.min(rows[6], 200000); m++) methodNames.push(str(readIdx(tableStart[6] + m * sizes[6] + 8, strIdx)));
    const typeRows = [];
    for (let i = 0; i < rows[2]; i++) {
      const o = tableStart[2] + i * sizes[2];
      const nameOff = o + 4;
      const name = str(readIdx(nameOff, strIdx));
      const ns = str(readIdx(nameOff + strIdx, strIdx));
      const methodList = readIdx(o + 4 + strIdx * 2 + coded(CODED.typeDefOrRef) + idx(4), idx(6));
      typeRows.push({ name, namespace: ns, methodList });
    }
    for (let i = 0; i < typeRows.length && types.length < 5000; i++) {
      const r = typeRows[i];
      if (r.name === '<Module>') continue;
      const from = r.methodList - 1, to = (typeRows[i + 1]?.methodList ?? rows[6] + 1) - 1;
      types.push({ name: r.namespace ? `${r.namespace}.${r.name}` : r.name, methods: methodNames.slice(Math.max(0, from), Math.max(from, to)).slice(0, 400) });
    }
    return { ...result, module: assemblyName, typeCount: rows[2], methodCount: rows[6], types };
  } catch (e) {
    warnings.push(`.NET metadata could not be read completely (${e.message})`);
    return { warning: 'metadata damaged or outside the read range' };
  }
}

// ---------------------------------------------------------------- ELF
const ELF_MACHINES = { 3: 'x86', 62: 'x86-64', 40: 'arm', 183: 'arm64', 243: 'riscv', 8: 'mips', 20: 'powerpc', 21: 'powerpc64', 2: 'sparc', 43: 'sparc64', 22: 's390', 247: 'bpf', 258: 'loongarch' };
const ELF_TYPES = { 1: 'relocatable', 2: 'executable', 3: 'shared object / PIE', 4: 'core dump' };
const ELF_ABI = { 0: 'System V', 3: 'Linux', 6: 'Solaris', 9: 'FreeBSD', 12: 'OpenBSD', 97: 'ARM', 255: 'standalone' };

export function parseELF(buf) {
  const is64 = buf[4] === 2, le = buf[5] === 1;
  const u16 = o => (le ? buf.readUInt16LE(o) : buf.readUInt16BE(o));
  const u32 = o => (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o));
  const u64 = o => Number(le ? buf.readBigUInt64LE(o) : buf.readBigUInt64BE(o));
  const addr = o => (is64 ? u64(o) : u32(o));
  const type = u16(16), machine = u16(18);
  const entry = addr(24);
  const phoff = is64 ? u64(32) : u32(28), shoff = is64 ? u64(40) : u32(32);
  const phentsize = u16(is64 ? 54 : 42), phnum = u16(is64 ? 56 : 44);
  const shentsize = u16(is64 ? 58 : 46), shnum = u16(is64 ? 60 : 48), shstrndx = u16(is64 ? 62 : 50);
  const warnings = [];
  const sections = [];
  for (let i = 0; i < shnum && shoff; i++) {
    const s = shoff + i * shentsize;
    if (s + shentsize > buf.length) { warnings.push('section headers outside the read range'); break; }
    sections.push(is64
      ? { nameOff: u32(s), type: u32(s + 4), flags: u64(s + 8), addr: u64(s + 16), offset: u64(s + 24), size: u64(s + 32), link: u32(s + 40), entsize: u64(s + 56) }
      : { nameOff: u32(s), type: u32(s + 4), flags: u32(s + 8), addr: u32(s + 12), offset: u32(s + 16), size: u32(s + 20), link: u32(s + 24), entsize: u32(s + 36) });
  }
  const shstr = sections[shstrndx];
  for (const s of sections) s.name = shstr ? cstr(buf, shstr.offset + s.nameOff, 256) ?? '' : '';
  let interpreter = null;
  for (let i = 0; i < phnum && phoff; i++) {
    const p = phoff + i * phentsize;
    if (p + phentsize > buf.length) break;
    if (u32(p) === 3) { const off = is64 ? u64(p + 8) : u32(p + 4); interpreter = cstr(buf, off, 512); }
  }
  const strAt = (sec, off) => (sec ? cstr(buf, sec.offset + off, 1024) : null);
  const needed = [], rpath = [];
  let soname = null;
  const dyn = sections.find(s => s.type === 6);
  if (dyn) {
    const dynstr = sections[dyn.link];
    const ent = is64 ? 16 : 8;
    for (let o = dyn.offset; o + ent <= dyn.offset + dyn.size && o + ent <= buf.length; o += ent) {
      const tag = is64 ? u64(o) : u32(o), val = is64 ? u64(o + 8) : u32(o + 4);
      if (tag === 0) break;
      if (tag === 1) needed.push(strAt(dynstr, val));
      if (tag === 14) soname = strAt(dynstr, val);
      if (tag === 15 || tag === 29) rpath.push(strAt(dynstr, val));
    }
  }
  const readSyms = sec => {
    const out = [];
    if (!sec) return out;
    const str = sections[sec.link];
    const ent = is64 ? 24 : 16;
    for (let o = sec.offset + ent; o + ent <= sec.offset + sec.size && o + ent <= buf.length && out.length < 200000; o += ent) {
      const name = strAt(str, u32(o));
      const info = is64 ? buf[o + 4] : buf[o + 12];
      const shndx = is64 ? u16(o + 6) : u16(o + 14);
      const bind = info >> 4, stype = info & 15;
      if (!name) continue;
      out.push({ name, defined: shndx !== 0, global: bind === 1 || bind === 2, kind: stype === 2 ? 'function' : stype === 1 ? 'object' : 'other' });
    }
    return out;
  };
  const dynsym = readSyms(sections.find(s => s.type === 11));
  const symtab = sections.find(s => s.type === 2);
  const symbols = readSyms(symtab);
  const goBuildId = sections.find(s => s.name === '.note.go.buildid');
  return {
    format: 'elf', bits: is64 ? 64 : 32, endian: le ? 'little' : 'big', arch: ELF_MACHINES[machine] ?? `machine ${machine}`,
    kind: ELF_TYPES[type] ?? `type ${type}`, abi: ELF_ABI[buf[7]] ?? buf[7], entryPoint: hex(entry), interpreter,
    sections: sections.map(s => ({ name: s.name, type: s.type, offset: s.offset, size: s.type === 8 ? 0 : s.size, flags: s.flags })),
    imports: [{ library: '(dynamic)', libraries: needed, functions: dynsym.filter(s => !s.defined).map(s => s.name) }],
    exports: { names: dynsym.filter(s => s.defined && s.global).map(s => s.name) },
    soname, rpath, stripped: !symtab, functionSymbols: symbols.filter(s => s.kind === 'function' && s.defined).length,
    debugInfo: sections.some(s => s.name.startsWith('.debug_')), goBinary: !!goBuildId || sections.some(s => s.name === '.gopclntab'),
    pckSection: sections.find(s => s.name === 'pck') ? { offset: sections.find(s => s.name === 'pck').offset, size: sections.find(s => s.name === 'pck').size } : null,
    lastSectionEnd: Math.max(shoff + shnum * shentsize, phoff + phnum * phentsize, sections.reduce((m, s) => (s.type === 8 ? m : Math.max(m, s.offset + s.size)), 0)), warnings,
  };
}

// ---------------------------------------------------------------- Mach-O
const MACHO_CPU = { 7: 'x86', 0x01000007: 'x86-64', 12: 'arm', 0x0100000c: 'arm64', 0x0200000c: 'arm64_32', 18: 'powerpc' };
const MACHO_TYPES = { 1: 'object', 2: 'executable', 6: 'dylib', 7: 'dylinker', 8: 'bundle', 0xb: 'dSYM companion' };
const MACHO_PLATFORMS = { 1: 'macOS', 2: 'iOS', 3: 'tvOS', 4: 'watchOS', 6: 'Mac Catalyst', 7: 'iOS simulator', 11: 'visionOS' };
const ver = v => `${v >>> 16}.${(v >> 8) & 0xff}.${v & 0xff}`;

export function parseMachO(buf, base = 0) {
  const magicLE = buf.readUInt32LE(base);
  const le = magicLE === 0xfeedface || magicLE === 0xfeedfacf;
  const u32 = o => (le ? buf.readUInt32LE(base + o) : buf.readUInt32BE(base + o));
  const u64 = o => Number(le ? buf.readBigUInt64LE(base + o) : buf.readBigUInt64BE(base + o));
  const is64 = (le ? magicLE : buf.readUInt32BE(base)) === 0xfeedfacf;
  const cpu = u32(4), ftype = u32(12), ncmds = u32(16);
  let p = is64 ? 32 : 28;
  const segments = [], sections = [], libraries = [], rpaths = [];
  let entryOff = null, uuid = null, platform = null, signed = false, encrypted = false, symtab = null;
  for (let i = 0; i < ncmds && i < 4096; i++) {
    const cmd = u32(p), size = u32(p + 4);
    if (!size) break;
    if (cmd === 0x19 || cmd === 0x1) {
      const s64 = cmd === 0x19;
      const name = buf.toString('latin1', base + p + 8, base + p + 24).replace(/\0+$/, '');
      const fileoff = s64 ? u64(p + 40) : u32(p + 32), filesize = s64 ? u64(p + 48) : u32(p + 36);
      const nsects = u32(p + (s64 ? 64 : 48));
      const sects = [];
      let sp = p + (s64 ? 72 : 56);
      for (let k = 0; k < nsects && k < 256; k++, sp += s64 ? 80 : 68) {
        const sect = buf.toString('latin1', base + sp, base + sp + 16).replace(/\0+$/, '');
        const size = s64 ? u64(sp + 40) : u32(sp + 36), offset = u32(sp + (s64 ? 48 : 40));
        const type = u32(sp + (s64 ? 64 : 56)) & 0xff;
        sects.push(sect);
        sections.push({ name: `${name},${sect}`, offset: offset ? base + offset : 0, size: type === 1 || type === 12 ? 0 : size });
      }
      segments.push({ name, offset: fileoff, size: filesize, sections: sects });
    } else if ([0xc, 0x80000018, 0x8000001f, 0x80000023].includes(cmd)) {
      libraries.push(cstr(buf, base + p + u32(p + 8), 1024));
    } else if (cmd === 0x80000028) entryOff = u64(p + 8);
    else if (cmd === 0x1b) uuid = buf.subarray(base + p + 8, base + p + 24).toString('hex');
    else if (cmd === 0x32) platform = { platform: MACHO_PLATFORMS[u32(p + 8)] ?? u32(p + 8), minOS: ver(u32(p + 12)), sdk: ver(u32(p + 16)) };
    else if (cmd === 0x1d) signed = true;
    else if (cmd === 0x21 || cmd === 0x2c) encrypted = u32(p + 16) !== 0;
    else if (cmd === 0x8000001c) rpaths.push(cstr(buf, base + p + u32(p + 8), 1024));
    else if (cmd === 0x2) symtab = { symoff: u32(p + 8), nsyms: u32(p + 12), stroff: u32(p + 16) };
    p += size;
  }
  const imports = [], exports = [];
  if (symtab) {
    const ent = is64 ? 16 : 12;
    for (let i = 0; i < Math.min(symtab.nsyms, 200000); i++) {
      const o = symtab.symoff + i * ent;
      if (base + o + ent > buf.length) break;
      const strx = u32(o), type = buf[base + o + 4];
      if (type & 0xe0) continue; // stabs (debug)
      const name = cstr(buf, base + symtab.stroff + strx, 1024);
      if (!name || !(type & 1)) continue;
      ((type & 0x0e) === 0 ? imports : exports).push(name);
    }
  }
  return {
    format: 'macho', bits: is64 ? 64 : 32, endian: le ? 'little' : 'big', arch: MACHO_CPU[cpu] ?? hex(cpu), kind: MACHO_TYPES[ftype] ?? ftype,
    entryPoint: entryOff != null ? hex(entryOff) : null, uuid, platform, signed, encrypted,
    segments, sections, imports: [{ library: '(dylibs)', libraries, functions: imports }], exports: { names: exports }, rpath: rpaths,
    lastSectionEnd: segments.reduce((m, s) => Math.max(m, s.offset + s.size), 0), warnings: encrypted ? ['binary is encrypted (App Store FairPlay); ReversePort does not decrypt'] : [],
  };
}

export function parseFat(buf) {
  const magic = buf.readUInt32BE(0), n = buf.readUInt32BE(4), wide = magic === 0xcafebabf;
  const arches = [];
  for (let i = 0; i < Math.min(n, 16); i++) {
    const o = 8 + i * (wide ? 32 : 20);
    const cpu = buf.readUInt32BE(o);
    const offset = wide ? Number(buf.readBigUInt64BE(o + 8)) : buf.readUInt32BE(o + 8);
    const size = wide ? Number(buf.readBigUInt64BE(o + 16)) : buf.readUInt32BE(o + 12);
    const slice = { arch: MACHO_CPU[cpu] ?? hex(cpu), offset, size };
    try { if (offset + 32 < buf.length) slice.binary = parseMachO(buf, offset); } catch (e) { slice.error = e.message; }
    arches.push(slice);
  }
  return { format: 'macho-fat', arches };
}

// ---------------------------------------------------------------- WebAssembly
function leb(buf, o) { let r = 0, shift = 0, b; do { b = buf[o++]; r += (b & 0x7f) * 2 ** shift; shift += 7; } while (b & 0x80); return [r, o]; }
export function parseWasm(buf) {
  const SECT = { 0: 'custom', 1: 'type', 2: 'import', 3: 'function', 4: 'table', 5: 'memory', 6: 'global', 7: 'export', 8: 'start', 9: 'element', 10: 'code', 11: 'data', 12: 'datacount', 13: 'tag' };
  const KIND = ['function', 'table', 'memory', 'global', 'tag'];
  const sections = [], imports = [], exports = [];
  let p = 8;
  const name = o => { const [len, s] = leb(buf, o); return [buf.toString('utf8', s, s + len), s + len]; };
  const limits = o => { const flag = buf[o]; let [, q] = leb(buf, o + 1); if (flag & 1) [, q] = leb(buf, q); return q; };
  while (p < buf.length) {
    const id = buf[p];
    const [size, start] = leb(buf, p + 1);
    const sec = { id, name: SECT[id] ?? `unknown ${id}`, offset: start, size };
    if (id === 0) sec.customName = name(start)[0];
    if (id === 2) {
      let [n, q] = leb(buf, start);
      for (let i = 0; i < n && i < 100000; i++) {
        let mod, field; [mod, q] = name(q); [field, q] = name(q);
        const kind = buf[q++];
        if (kind === 0) [, q] = leb(buf, q);
        else if (kind === 1) q = limits(q + 1);
        else if (kind === 2) q = limits(q);
        else if (kind === 3) q += 2;
        else if (kind === 4) [, q] = leb(buf, q + 1);
        imports.push({ module: mod, name: field, kind: KIND[kind] ?? kind });
      }
    }
    if (id === 7) {
      let [n, q] = leb(buf, start);
      for (let i = 0; i < n && i < 100000; i++) { let nm; [nm, q] = name(q); const kind = buf[q++]; [, q] = leb(buf, q); exports.push({ name: nm, kind: KIND[kind] ?? kind }); }
    }
    sections.push(sec);
    p = start + size;
  }
  const modules = [...new Set(imports.map(i => i.module))];
  return { format: 'wasm', version: buf.readUInt32LE(4), sections, imports: modules.map(m => ({ library: m, functions: imports.filter(i => i.module === m).map(i => i.name) })), exports: { names: exports.map(e => e.name), detail: exports }, warnings: [] };
}

// ---------------------------------------------------------------- Java class
export function parseClass(buf) {
  const minor = buf.readUInt16BE(4), major = buf.readUInt16BE(6);
  const count = buf.readUInt16BE(8);
  const pool = new Array(count);
  let p = 10;
  for (let i = 1; i < count; i++) {
    const tag = buf[p];
    if (tag === 1) { const len = buf.readUInt16BE(p + 1); pool[i] = { tag, value: buf.toString('utf8', p + 3, p + 3 + len) }; p += 3 + len; }
    else if (tag === 7 || tag === 8 || tag === 16 || tag === 19 || tag === 20) { pool[i] = { tag, ref: buf.readUInt16BE(p + 1) }; p += 3; }
    else if (tag === 15) p += 4;
    else if ([3, 4, 9, 10, 11, 12, 17, 18].includes(tag)) p += 5;
    else if (tag === 5 || tag === 6) { p += 9; i++; }
    else throw new RPError('BAD_FORMAT', `Unknown constant pool tag ${tag}`);
  }
  const utf = i => pool[i]?.value ?? '';
  const cls = i => utf(pool[i]?.ref).replace(/\//g, '.');
  const access = buf.readUInt16BE(p), thisClass = cls(buf.readUInt16BE(p + 2)), superClass = cls(buf.readUInt16BE(p + 4));
  p += 6;
  const nIf = buf.readUInt16BE(p); p += 2;
  const interfaces = [];
  for (let i = 0; i < nIf; i++, p += 2) interfaces.push(cls(buf.readUInt16BE(p)));
  const members = () => {
    const n = buf.readUInt16BE(p); p += 2;
    const out = [];
    for (let i = 0; i < n; i++) {
      const name = utf(buf.readUInt16BE(p + 2)), desc = utf(buf.readUInt16BE(p + 4));
      const attrs = buf.readUInt16BE(p + 6); p += 8;
      for (let a = 0; a < attrs; a++) p += 6 + buf.readUInt32BE(p + 2);
      out.push({ name, descriptor: desc });
    }
    return out;
  };
  const fields = members(), methods = members();
  return {
    format: 'java-class', javaVersion: major >= 49 ? major - 44 : `1.${major - 44}`, classFileVersion: `${major}.${minor}`,
    className: thisClass, superClass, interfaces, isInterface: !!(access & 0x200), fields, methods, warnings: [],
  };
}

// ---------------------------------------------------------------- Android dex
export function parseDex(buf) {
  const version = buf.toString('latin1', 4, 7);
  const u32 = o => buf.readUInt32LE(o);
  const stringIdsOff = u32(60), typeIdsOff = u32(68), classDefsSize = u32(96), classDefsOff = u32(100);
  const string = i => { let [, o] = leb(buf, u32(stringIdsOff + i * 4)); return cstr(buf, o, 1024); };
  const classes = [];
  for (let i = 0; i < Math.min(classDefsSize, 5000); i++) {
    const typeIdx = u32(classDefsOff + i * 32);
    const desc = string(u32(typeIdsOff + typeIdx * 4));
    classes.push(desc?.replace(/^L/, '').replace(/;$/, '').replace(/\//g, '.'));
  }
  return { format: 'dex', version, counts: { strings: u32(56), types: u32(64), methods: u32(88), classes: classDefsSize }, classes, warnings: [] };
}

// ---------------------------------------------------------------- strings + hints
export function extractStrings(buf, { min = 6, max = 300, match, utf16 = true } = {}) {
  const test = compileMatcher(match);
  const out = [];
  let total = 0;
  const push = (offset, text, enc) => { total++; if (out.length < max && test(text)) out.push({ offset, text: text.length > 300 ? text.slice(0, 300) + '…' : text, encoding: enc }); };
  let start = -1;
  for (let i = 0; i <= buf.length; i++) {
    const b = i < buf.length ? buf[i] : 0;
    const printable = (b >= 0x20 && b < 0x7f) || b === 9;
    if (printable) { if (start < 0) start = i; }
    else { if (start >= 0 && i - start >= min) push(start, buf.toString('latin1', start, i), 'ascii'); start = -1; }
  }
  if (utf16) {
    for (const phase of [0, 1]) {
      start = -1;
      for (let i = phase; i + 1 <= buf.length; i += 2) {
        const ok = i + 1 < buf.length && buf[i + 1] === 0 && buf[i] >= 0x20 && buf[i] < 0x7f;
        if (ok) { if (start < 0) start = i; }
        else { if (start >= 0 && (i - start) / 2 >= min) push(start, buf.toString('utf16le', start, i), 'utf16le'); start = -1; }
      }
    }
  }
  out.sort((a, b) => a.offset - b.offset);
  return { total, items: out };
}

const HINTS = [
  [/(\d\.\d+(?:\.\d+)?)\.(?:stable|beta\d*|rc\d*|dev\d*)\.(mono\.)?(?:official|custom_build)/, m => ({ engine: 'Godot', version: m[1] + (m[2] ? ' (.NET)' : '') })],
  [/Godot Engine v?(\d+\.\d+(?:\.\d+)?)/, m => ({ engine: 'Godot', version: m[1] })],
  [/godot[_ ]?engine|GDScript|res:\/\/project\.godot/i, () => ({ engine: 'Godot' })],
  [/UnityPlayer\.dll|UnityEngine\.|il2cpp/i, () => ({ engine: 'Unity' })],
  [/(\d{4}\.\d+\.\d+[abfp]\d+)/, m => ({ unityVersion: m[1] })],
  [/UnrealEngine|UE4Game|UE5|FEngineLoop/, () => ({ engine: 'Unreal Engine' })],
  [/GameMaker Studio|YoYo Games|YoYoGames/, () => ({ engine: 'GameMaker' })],
  [/LÖVE|love\.graphics|liblove/, () => ({ engine: 'LÖVE (Love2D)' })],
  [/Electron\/\d+|electron\.asar/i, () => ({ framework: 'Electron' })],
  [/nw\.js|node-webkit/i, () => ({ framework: 'NW.js' })],
  [/GCC: \(([^)]*)\) ([\d.]+)/, m => ({ compiler: `GCC ${m[2]} (${m[1]})` })],
  [/clang version ([\d.]+)/, m => ({ compiler: `clang ${m[1]}` })],
  [/rustc version ([\d.]+)|\/rustc\/[0-9a-f]{40}/, m => ({ language: 'Rust', ...(m[1] ? { compiler: `rustc ${m[1]}` } : {}) })],
  [/Go build ID:|runtime\.gopanic|go1\.(\d+)/, () => ({ language: 'Go' })],
  [/Microsoft \(R\) C\/C\+\+|MSVCP\d+|VCRUNTIME\d+/i, () => ({ compiler: 'Microsoft Visual C++' })],
  [/mscoree\.dll|_CorExeMain|_CorDllMain/, () => ({ runtime: '.NET (CLR)' })],
  [/PyInstaller|_MEIPASS|pyi-runtime/, () => ({ packager: 'PyInstaller (Python)' })],
  [/Qt_\d|QApplication|Qt5Core|Qt6Core/, () => ({ framework: 'Qt' })],
  [/SDL2?\.dll|SDL_Init/, () => ({ library: 'SDL' })],
  [/steam_api(64)?\.dll|SteamAPI_Init/, () => ({ library: 'Steamworks' })],
  [/fmod(studio)?(_vc)?\.dll|FMOD Studio/i, () => ({ audio: 'FMOD' })],
  [/AkSoundEngine|Wwise/i, () => ({ audio: 'Wwise' })],
  [/vulkan-1\.dll|vkCreateInstance/, () => ({ graphics: 'Vulkan' })],
  [/d3d12\.dll|D3D12CreateDevice/i, () => ({ graphics: 'Direct3D 12' })],
  [/d3d11\.dll|D3D11CreateDevice/i, () => ({ graphics: 'Direct3D 11' })],
  [/opengl32\.dll|libGL\.so|glXCreateContext|wglCreateContext/i, () => ({ graphics: 'OpenGL' })],
  [/UPX!|UPX0/, () => ({ packer: 'UPX' })],
];

export function toolchainHints(text) {
  const hints = {};
  for (const [re, f] of HINTS) {
    const m = text.match(re);
    if (!m) continue;
    for (const [k, v] of Object.entries(f(m))) {
      if (!hints[k]) hints[k] = v;
      else if (hints[k] !== v && !String(hints[k]).split(', ').includes(v)) hints[k] += `, ${v}`;
    }
  }
  return hints;
}

// ---------------------------------------------------------------- entry point
export async function inspectBinary({ file, strings = {}, names = {}, maxTypes = 300 } = {}) {
  const { abs, size } = await requireFile(file);
  const buf = await readHead(abs, HEAD_LIMIT);
  const kind = identify(buf.subarray(0, 4096));
  const result = { file: abs, size, sha256: await sha256File(abs), identified: kind, partialRead: size > buf.length };
  const parsers = { pe: parsePE, elf: parseELF, macho: parseMachO, 'macho-fat': parseFat, wasm: parseWasm, 'java-class': parseClass, dex: parseDex };
  let info = null;
  if (parsers[kind.id]) {
    try { info = parsers[kind.id](buf); } catch (e) { info = { format: kind.id, error: `Could not parse fully: ${e.message}` }; }
  } else if (kind.id === 'lua-bytecode') info = { format: 'lua-bytecode', luaVersion: `${buf[4] >> 4}.${buf[4] & 15}` };
  else if (kind.id === 'pyc') {
    const magic = buf.readUInt16LE(0);
    const PY = [[3413, '3.8'], [3425, '3.9'], [3439, '3.10'], [3495, '3.11'], [3531, '3.12'], [3571, '3.13']];
    info = { format: 'pyc', magic, pythonVersion: PY.find(([m]) => m === magic)?.[1] ?? 'unknown (see importlib magic numbers)' };
  }
  if (info) {
    if (info.dotnet?.types) {
      info.dotnet.typesTruncated = info.dotnet.types.length > maxTypes;
      info.dotnet.types = info.dotnet.types.slice(0, maxTypes);
    }
    for (const s of info.sections ?? []) {
      const off = s.rawOffset ?? s.offset, len = s.rawSize ?? s.size;
      if (off != null && len > 0 && off < buf.length) s.entropy = entropy(buf.subarray(off, Math.min(off + len, off + 4 * MiB, buf.length)));
    }
    const nameLimit = Math.max(1, Math.min(5000, names.limit ?? 100));
    const wantName = compileMatcher(names.match);
    for (const imp of info.imports ?? []) {
      if (!imp.functions) continue;
      const kept = imp.functions.filter(f => wantName(typeof f === 'string' ? f : f?.name ?? String(f)));
      if (kept.length > nameLimit || kept.length !== imp.functions.length) { imp.functionCount = imp.functions.length; imp.functions = kept.slice(0, nameLimit); imp.truncated = kept.length > nameLimit || undefined; }
    }
    if (info.exports?.names) {
      const kept = info.exports.names.filter(n => wantName(typeof n === 'string' ? n : n?.name ?? String(n)));
      if (kept.length > nameLimit || kept.length !== info.exports.names.length) { info.exports.count = info.exports.names.length; info.exports.names = kept.slice(0, nameLimit); info.exports.truncated = kept.length > nameLimit || undefined; }
    }
    const lastEnd = info.lastSectionEnd;
    if (lastEnd && lastEnd < size && ['pe', 'elf'].includes(info.format)) {
      const head = await readAt(abs, lastEnd, 4096);
      const extra = size - lastEnd - (info.certTable && info.certTable.offset >= lastEnd ? info.certTable.size : 0);
      const startsWith = identify(head);
      if (extra > 1024 || !['unknown', 'text'].includes(startsWith.id)) info.overlay = { offset: lastEnd, size: size - lastEnd, startsWith };
    }
    const packed = (info.sections ?? []).filter(s => s.entropy >= 7.4 && (s.rawSize ?? s.size) > 4096).map(s => s.name);
    if (packed.length) info.highEntropySections = packed;
  }
  const strScan = buf.subarray(0, Math.min(buf.length, (strings.maxMB ?? 64) * MiB));
  const minLen = Math.max(3, Math.min(64, strings.min ?? 6));
  const all = extractStrings(strScan, { min: Math.min(5, minLen), max: 300000 });
  const want = compileMatcher(strings.match);
  // By default skip byte noise that only looks like text ("v@AY QI"); raw:true or a match shows everything.
  const meaningful = t => (t.match(/[A-Za-z0-9 ._\/:\\-]/g)?.length ?? 0) / t.length >= 0.75
    && (/[a-z]{5,}/.test(t) && /[aeiou][^aeiou\s]|[^aeiou\s][aeiou]/i.test(t) || /^[A-Z][A-Z0-9_]{2,}(?:[._][A-Za-z0-9_]+)+$/.test(t) || /\.(dll|so|dylib|exe|pck|json|png|wasm|js)\b/i.test(t));
  const shown = all.items.filter(s => s.text.length >= minLen && want(s.text) && (strings.raw || strings.match || meaningful(s.text)));
  const hintText = all.items.map(s => s.text).join('\n') + '\n' + (info?.imports ?? []).flatMap(i => [i.library, ...(i.libraries ?? [])]).join('\n');
  result.binary = info;
  result.hints = toolchainHints(hintText);
  if (info?.dotnet && !info.dotnet.warning) result.hints.runtime = '.NET (CLR)';
  if (info?.dotnet?.module === 'Assembly-CSharp.dll') result.hints.engine = 'Unity (Mono scripting backend)';
  if (result.hints.unityVersion && !/Unity/.test(result.hints.engine ?? '')) delete result.hints.unityVersion;
  const lim = Math.max(1, Math.min(5000, strings.limit ?? 120));
  result.strings = { total: all.total, matching: shown.length, shown: Math.min(lim, shown.length), ...(strings.raw || strings.match ? {} : { filtered: 'likely text only; strings.raw:true shows all' }), items: shown.slice(0, lim) };
  if (!info && kind.category === 'text') result.hint = /\.(tscn|tres|unity|prefab|asset)$/i.test(abs) ? 'This is a text scene: use re_scene.' : 'This is a text file, not a binary: use re_symbols for code or read it directly.';
  if (info?.exports?.truncated || (info?.imports ?? []).some(i => i.truncated)) result.next = 'More import/export names: re_binary {file, names: {match: "…", limit: 1000}}.';
  return result;
}
