// re_il2cpp: names out of a Unity IL2CPP global-metadata.dat — assemblies, namespaces, types, methods and string
// literals — so a Unity game without its C# source still yields a class map to port or rebuild from.
// The header is a list of (offset, size) section pairs whose order differs between metadata versions (24–31+),
// so sections are recognised by validating their records against the identifier string table instead of trusting
// fixed indices. Only names are read; no code is decompiled (the code lives in GameAssembly/libil2cpp/.wasm as
// native code: re_binary). Encrypted or obfuscated metadata (wrong magic, unreadable string table) is reported.
import fs from 'node:fs/promises';
import path from 'node:path';
import { RPError, requireFile, limit } from './util.mjs';
import { workspaceDir } from './workspace.mjs';

const MAGIC = 0xfab11baf;

export function parseMetadata(buf) {
  if (buf.length < 64) throw new RPError('BAD_FORMAT', 'File too small for IL2CPP metadata.');
  const magic = buf.readUInt32LE(0);
  if (magic !== MAGIC) throw new RPError('BAD_FORMAT', `Not IL2CPP metadata (magic 0x${magic.toString(16)}); the game may encrypt or obfuscate it. Reported, not decrypted.`);
  const version = buf.readInt32LE(4);
  // Header: pairs of (int32 offset, int32 size) until the first section starts.
  const pairs = [];
  let firstData = buf.length;
  for (let p = 8; p + 8 <= Math.min(buf.length, firstData); p += 8) {
    const off = buf.readInt32LE(p), size = buf.readInt32LE(p + 4);
    if (off < 0 || size < 0 || off + size > buf.length) break;
    pairs.push({ index: pairs.length, offset: off, size });
    if (off > 0 && off < firstData) firstData = off;
  }
  // String table: the section of NUL-terminated identifiers. It is pair 2 in every known version; verify.
  const isIdentTable = s => { if (!s || s.size < 4) return false; const b = buf.subarray(s.offset, s.offset + Math.min(s.size, 4096)); let printable = 0, nul = 0; for (const c of b) { if (c === 0) nul++; else if (c >= 0x20 && c < 0x7f) printable++; } return nul > 4 && printable + nul > b.length * 0.97; };
  const strSec = isIdentTable(pairs[2]) ? pairs[2] : pairs.find(isIdentTable);
  if (!strSec) throw new RPError('BAD_FORMAT', 'No readable identifier table: metadata is probably encrypted or obfuscated. Reported, not decrypted.');
  const str = idx => { if (idx < 0 || idx >= strSec.size) return null; const s = strSec.offset + idx; const e = buf.indexOf(0, s); return e < 0 || e - s > 1024 ? null : buf.toString('utf8', s, e); };
  const validName = idx => { const s = str(idx); return s != null && /^[\w<>`.$|=@-]*$/.test(s); };

  // Images (40 bytes in v24.1+): nameIndex, assemblyIndex, typeStart, typeCount, … ; names end in .dll.
  let images = null;
  for (const s of pairs) {
    if (s === strSec || s.size === 0 || s.size % 40) continue;
    const n = s.size / 40;
    const out = [];
    let ok = true, expect = 0;
    for (let i = 0; i < n && ok; i++) {
      const r = s.offset + i * 40;
      const name = str(buf.readInt32LE(r)), typeStart = buf.readInt32LE(r + 8), typeCount = buf.readUInt32LE(r + 12);
      if (!name || !/\.dll$/i.test(name) || typeStart !== expect) ok = false; else { out.push({ name, typeStart, typeCount }); expect += typeCount; }
    }
    if (ok && out.length) { images = { section: s.index, list: out, typeTotal: expect }; break; }
  }
  if (!images) throw new RPError('BAD_FORMAT', 'Could not find the image (assembly) table; this metadata version or layout is not recognised.');

  // Methods: records with nameIndex at 0 and declaringType at 4 (a type index); record size 24–40 depending on version.
  let methods = null;
  for (const s of pairs) {
    if (s === strSec || s.index === images.section || s.size < 24) continue;
    for (const rec of [32, 36, 28, 24, 40]) {
      if (s.size % rec) continue;
      const n = s.size / rec, sample = Math.min(n, 80);
      let good = 0, lastDecl = -1, monotone = true;
      for (let i = 0; i < sample; i++) { const r = s.offset + i * rec; const nm = buf.readInt32LE(r), decl = buf.readInt32LE(r + 4); if (validName(nm) && str(nm) && decl >= 0 && decl < images.typeTotal) good++; if (decl < lastDecl) monotone = false; lastDecl = decl; }
      if (good >= sample * 0.95 && monotone) { methods = { section: s.index, rec, count: n }; break; }
    }
    if (methods) break;
  }
  // Type definitions: the section whose size divides by the type total and whose records start with name/namespace indices.
  let types = null;
  for (const s of pairs) {
    if (s === strSec || s.index === methods?.section || s.index === images.section || !images.typeTotal || s.size % images.typeTotal) continue;
    const rec = s.size / images.typeTotal;
    if (rec < 48 || rec > 160) continue;
    const sample = Math.min(images.typeTotal, 64);
    let good = 0;
    for (let i = 0; i < sample; i++) { const r = s.offset + i * rec; if (validName(buf.readInt32LE(r)) && validName(buf.readInt32LE(r + 4)) && str(buf.readInt32LE(r))) good++; }
    if (good >= sample * 0.95) { types = { section: s.index, rec }; break; }
  }
  if (!types) throw new RPError('BAD_FORMAT', 'Could not find the type definition table for this metadata version.');
  const typeList = [];
  for (let i = 0; i < images.typeTotal; i++) {
    const r = pairs[types.section].offset + i * types.rec;
    typeList.push({ index: i, name: str(buf.readInt32LE(r)), namespace: str(buf.readInt32LE(r + 4)) || '', methods: [] });
  }
  for (const img of images.list) for (let i = img.typeStart; i < img.typeStart + img.typeCount; i++) typeList[i].assembly = img.name;

  let methodCount = 0;
  if (methods) for (let i = 0; i < methods.count; i++) { const r = pairs[methods.section].offset + i * methods.rec; const name = str(buf.readInt32LE(r)); const decl = buf.readInt32LE(r + 4); if (name && typeList[decl]) { typeList[decl].methods.push(name); methodCount++; } }

  // String literals: (length, dataIndex) pairs into the literal data blob (pair 0/1 in v24–v29).
  const literals = [];
  const litSec = pairs[0], litData = pairs[1];
  if (litSec && litData && litSec.size % 8 === 0 && litSec.size) {
    for (let i = 0; i < Math.min(litSec.size / 8, 200000); i++) { const len = buf.readUInt32LE(litSec.offset + i * 8), di = buf.readInt32LE(litSec.offset + i * 8 + 4); if (di < 0 || di + len > litData.size) { literals.length = 0; break; } literals.push(buf.toString('utf8', litData.offset + di, litData.offset + di + len)); }
  }
  return { version, sections: pairs.length, images: images.list, types: typeList, methodCount, literals, layout: { strings: strSec.index, images: images.section, types: types.section, typeRecord: types.rec, methods: methods?.section ?? null, methodRecord: methods?.rec ?? null } };
}

const SYSTEM_ASM = /^(mscorlib|System|Mono\.|Unity\.|UnityEngine|netstandard|Microsoft\.|DOTween|TextMeshPro|Newtonsoft)/;

/** C# skeleton per assembly: namespaces, classes and method names, for port_plan/re_blueprint to work from. */
export function skeleton(meta, { includeSystem = false } = {}) {
  const byAsm = new Map();
  for (const t of meta.types) {
    if (!t.name || t.name === '<Module>' || t.name.startsWith('<')) continue;
    if (!includeSystem && SYSTEM_ASM.test(t.assembly ?? '')) continue;
    if (!byAsm.has(t.assembly)) byAsm.set(t.assembly, []);
    byAsm.get(t.assembly).push(t);
  }
  const files = [];
  for (const [asm, list] of byAsm) {
    const lines = [`// ${asm}: names recovered by ReversePort re_il2cpp from global-metadata.dat. Bodies are not in the metadata.`, ''];
    const byNs = new Map();
    for (const t of list) { if (!byNs.has(t.namespace)) byNs.set(t.namespace, []); byNs.get(t.namespace).push(t); }
    for (const [ns, ts] of [...byNs].sort((a, b) => a[0].localeCompare(b[0]))) {
      const ind = ns ? '    ' : '';
      if (ns) lines.push(`namespace ${ns}`, '{');
      for (const t of ts) {
        const cls = t.name.replace(/`\d+$/, '');
        lines.push(`${ind}public class ${cls}`, `${ind}{`);
        for (const m of [...new Set(t.methods)]) if (!m.startsWith('<')) lines.push(`${ind}    // ${m}()`);
        lines.push(`${ind}}`, '');
      }
      if (ns) lines.push('}', '');
    }
    files.push({ name: `${asm.replace(/\.dll$/i, '')}.cs`, text: lines.join('\n'), types: list.length });
  }
  return files;
}

export async function il2cppTool({ file, out, match, includeSystem = false, limit: max = 400 } = {}) {
  if (!file) throw new RPError('INVALID_ARGUMENT', 'file is required: global-metadata.dat (in <Game>_Data/il2cpp_data/Metadata/ or Il2CppData/Metadata in WebGL).');
  const { abs } = await requireFile(file);
  const meta = parseMetadata(await fs.readFile(abs));
  const q = match ? String(match).toLowerCase() : null;
  const gameTypes = meta.types.filter(t => t.name && !t.name.startsWith('<') && (includeSystem || !SYSTEM_ASM.test(t.assembly ?? '')));
  const shown = gameTypes.filter(t => !q || `${t.namespace}.${t.name} ${t.methods.join(' ')}`.toLowerCase().includes(q));
  const unityCallbacks = ['Awake', 'Start', 'Update', 'FixedUpdate', 'LateUpdate', 'OnEnable', 'OnDisable', 'OnDestroy', 'OnTriggerEnter', 'OnCollisionEnter', 'OnTriggerEnter2D', 'OnCollisionEnter2D'];
  const behaviours = gameTypes.filter(t => t.methods.some(m => unityCallbacks.includes(m))).map(t => `${t.namespace ? t.namespace + '.' : ''}${t.name}`);
  const files = skeleton(meta, { includeSystem });
  const dir = out ? path.resolve(out) : path.join(await workspaceDir('il2cpp'), path.basename(path.dirname(path.dirname(abs))) || 'game');
  await fs.mkdir(dir, { recursive: true });
  const written = [];
  for (const f of files) { const p = path.join(dir, f.name); await fs.writeFile(p, f.text); written.push(p); }
  const lit = meta.literals.filter(s => s.length > 1 && s.length < 200);
  return {
    file: abs, metadataVersion: meta.version, assemblies: meta.images.map(i => ({ name: i.name, types: i.typeCount })), types: meta.types.length, gameTypes: gameTypes.length, methods: meta.methodCount,
    behaviours: limit(behaviours, 300), typesMatching: limit(shown.map(t => ({ name: `${t.namespace ? t.namespace + '.' : ''}${t.name}`, assembly: t.assembly, methods: [...new Set(t.methods)].slice(0, 40) })), max),
    stringLiterals: { count: meta.literals.length, sample: lit.slice(0, 80) }, written, layout: meta.layout,
    next: 'The skeleton lists every game class and method name; behaviours are MonoBehaviours (Unity callbacks). Port or rebuild from it with re_blueprint/port_plan; for method bodies, read the native code (GameAssembly.dll / libil2cpp.so / .wasm) with re_binary and the deep-analysis engine, matching names from here.',
  };
}
