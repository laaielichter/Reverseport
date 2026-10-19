// Archive and pack listing/extraction: Godot PCK (standalone or embedded in the game executable), ZIP
// (apk, jar, ipa, nupkg, docx…), tar / tar.gz (.unitypackage), Electron asar. Unity bundles and Unreal paks
// are identified (header only). Encrypted content is reported, never decrypted. Extraction writes only into
// the ReversePort workspace (or the chosen output folder) and refuses paths that would escape it.
import fs from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Transform, Readable } from 'node:stream';
import { RPError, readAt, requireFile, compileMatcher, sha256, MiB } from './util.mjs';
import { identify } from './formats.mjs';
import { parsePE, parseELF } from './binary.mjs';
import { safeJoin, workspaceDir, extractionName } from './workspace.mjs';
import { readRpa, readGameMaker, readFmodBank, readWwiseBank, readUnrealPak, readSwf } from './gamearchives.mjs';

const MAX_ENTRIES = 2_000_000;

/** Sequential reader over a file region, buffered. */
class Reader {
  constructor(fh, pos) { this.fh = fh; this.pos = pos; this.buf = Buffer.alloc(0); this.bufPos = pos; }
  async need(n) {
    const have = this.bufPos + this.buf.length - this.pos;
    if (have >= n) return;
    const start = this.pos;
    const chunk = Buffer.alloc(Math.max(n, MiB));
    const { bytesRead } = await this.fh.read(chunk, 0, chunk.length, start);
    if (bytesRead < n) throw new RPError('BAD_FORMAT', 'Unexpected end of file while reading the directory');
    this.buf = chunk.subarray(0, bytesRead); this.bufPos = start;
  }
  async bytes(n) { await this.need(n); const o = this.pos - this.bufPos; this.pos += n; return this.buf.subarray(o, o + n); }
  async u32() { return (await this.bytes(4)).readUInt32LE(0); }
  async u64() { return Number((await this.bytes(8)).readBigUInt64LE(0)); }
}

// ---------------------------------------------------------------- Godot PCK
/** Where does the Godot pack start? Standalone .pck, appended to the executable, or a "pck" section. */
export async function locatePck(abs, size) {
  if ((await readAt(abs, 0, 4)).toString('latin1') === 'GDPC') return { start: 0, embedded: false };
  if (size > 16) {
    const tail = await readAt(abs, size - 12, 12);
    if (tail.toString('latin1', 8, 12) === 'GDPC') {
      const ds = Number(tail.readBigUInt64LE(0));
      const start = size - ds - 12;
      if (start >= 0 && (await readAt(abs, start, 4)).toString('latin1') === 'GDPC') return { start, embedded: true, via: 'appended' };
    }
  }
  const head = await readAt(abs, 0, Math.min(size, 64 * MiB));
  const kind = identify(head.subarray(0, 4096)).id;
  try {
    if (kind === 'pe') {
      const sec = parsePE(head).sections.find(s => s.name === 'pck');
      if (sec) return { start: sec.rawOffset, embedded: true, via: 'pe section' };
    }
    if (kind === 'elf') {
      const sec = parseELF(head).pckSection;
      if (sec) return { start: sec.offset, embedded: true, via: 'elf section' };
    }
  } catch { /* not an executable we can read */ }
  return null;
}

export async function readPck(abs, size) {
  const where = await locatePck(abs, size);
  if (!where) throw new RPError('NOT_A_PCK', 'No Godot pack (GDPC) found in this file.');
  const fh = await fs.open(abs, 'r');
  try {
    const r = new Reader(fh, where.start + 4);
    const version = await r.u32();
    const godot = `${await r.u32()}.${await r.u32()}.${await r.u32()}`;
    if (version < 1 || version > 3) throw new RPError('UNSUPPORTED_VERSION', `Godot pack format version ${version} is not supported (1–3 are).`);
    let flags = 0, base = 0;
    if (version >= 2) {
      flags = await r.u32();
      base = await r.u64();
      if (version === 3) { const dir = await r.u64(); r.pos = where.start + dir; r.buf = Buffer.alloc(0); }
      else await r.bytes(64);
    } else await r.bytes(64);
    // Offsets are relative to the file base; whether that base counts from the pack start or from the
    // start of the containing file changed between Godot versions, so both readings are checked.
    const bases = version === 1 ? [where.start, 0] : version === 3 || flags & 2 ? [where.start + base] : [where.start + base, base];
    const info = { format: 'godot-pck', packVersion: version, godotVersion: godot, start: where.start, embedded: where.embedded, ...(where.via ? { embeddedVia: where.via } : {}), encryptedDirectory: !!(flags & 1), sparseBundle: !!(flags & 4) };
    if (flags & 1) return { ...info, entries: [], note: 'The file list is encrypted. ReversePort does not decrypt packs; use the project source or an unencrypted export.' };
    const count = await r.u32();
    if (count > MAX_ENTRIES) throw new RPError('BAD_FORMAT', `Implausible file count ${count}`);
    const raw = [];
    for (let i = 0; i < count; i++) {
      const len = await r.u32();
      if (len > 8192) throw new RPError('BAD_FORMAT', `Implausible path length ${len} at entry ${i}`);
      let p = (await r.bytes(len)).toString('utf8').replace(/\0+$/, '');
      if (!/^(res|user):\/\//.test(p)) p = `res://${p}`;
      const rel = await r.u64();
      const fsize = await r.u64();
      const md5 = (await r.bytes(16)).toString('hex');
      const eflags = version >= 2 ? await r.u32() : 0;
      raw.push({ path: p, rel, size: fsize, md5, eflags });
    }
    const fileBase = [...new Set(bases)].find(b => raw.every(e => b + e.rel + e.size <= size));
    if (fileBase === undefined) throw new RPError('BAD_FORMAT', 'Pack entries point outside the file (damaged or unsupported layout).');
    const entries = raw.map(e => ({ path: e.path, offset: fileBase + e.rel, size: e.size, md5: e.md5, ...(e.eflags & 1 ? { encrypted: true } : {}), ...(e.eflags & 2 ? { removal: true } : {}) }));
    return { ...info, entries };
  } finally { await fh.close(); }
}

// ---------------------------------------------------------------- ZIP
export async function readZip(abs, size) {
  const tailLen = Math.min(size, 65557 + 20);
  const tail = await readAt(abs, size - tailLen, tailLen);
  const eocd = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 5, 6]));
  if (eocd < 0) throw new RPError('BAD_FORMAT', 'ZIP end-of-central-directory not found');
  let count = tail.readUInt16LE(eocd + 10), cdSize = tail.readUInt32LE(eocd + 12), cdOff = tail.readUInt32LE(eocd + 16);
  const loc = eocd - 20;
  if (loc >= 0 && tail.readUInt32LE(loc) === 0x07064b50) { // ZIP64
    const z64 = Number(tail.readBigUInt64LE(loc + 8));
    const rec = await readAt(abs, z64, 56);
    if (rec.readUInt32LE(0) === 0x06064b50) { count = Number(rec.readBigUInt64LE(32)); cdSize = Number(rec.readBigUInt64LE(40)); cdOff = Number(rec.readBigUInt64LE(48)); }
  }
  if (count > MAX_ENTRIES || cdOff + cdSize > size) throw new RPError('BAD_FORMAT', 'ZIP central directory is damaged');
  const cd = await readAt(abs, cdOff, cdSize);
  const entries = [];
  for (let p = 0, i = 0; i < count && p + 46 <= cd.length; i++) {
    if (cd.readUInt32LE(p) !== 0x02014b50) throw new RPError('BAD_FORMAT', `Bad central directory entry ${i}`);
    const flags = cd.readUInt16LE(p + 8), method = cd.readUInt16LE(p + 10);
    let csize = cd.readUInt32LE(p + 20), usize = cd.readUInt32LE(p + 24);
    const nl = cd.readUInt16LE(p + 28), xl = cd.readUInt16LE(p + 30), cl = cd.readUInt16LE(p + 32);
    let local = cd.readUInt32LE(p + 42);
    const name = cd.toString(flags & 0x800 ? 'utf8' : 'latin1', p + 46, p + 46 + nl);
    let x = p + 46 + nl;
    const xend = x + xl;
    while (x + 4 <= xend) {
      const id = cd.readUInt16LE(x), len = cd.readUInt16LE(x + 2);
      if (id === 1) {
        let q = x + 4;
        if (usize === 0xffffffff) { usize = Number(cd.readBigUInt64LE(q)); q += 8; }
        if (csize === 0xffffffff) { csize = Number(cd.readBigUInt64LE(q)); q += 8; }
        if (local === 0xffffffff) { local = Number(cd.readBigUInt64LE(q)); }
      }
      x += 4 + len;
    }
    if (!name.endsWith('/')) entries.push({ path: name, size: usize, compressedSize: csize, method, localHeader: local, ...(flags & 1 ? { encrypted: true } : {}) });
    p = xend + cl;
  }
  return { format: 'zip', entries };
}

async function zipDataStart(abs, entry) {
  const h = await readAt(abs, entry.localHeader, 30);
  if (h.readUInt32LE(0) !== 0x04034b50) throw new RPError('BAD_FORMAT', `Bad local header for ${entry.path}`);
  return entry.localHeader + 30 + h.readUInt16LE(26) + h.readUInt16LE(28);
}

// ---------------------------------------------------------------- tar / tar.gz (streaming)
async function walkTar(abs, gz, onEntry) {
  let buf = Buffer.alloc(0), state = 'header', remaining = 0, pad = 0, current = null, longName = null, pax = null, sink = null, done = false;
  const handle = async () => {
    for (;;) {
      if (done) return;
      if (state === 'header') {
        if (buf.length < 512) return;
        const h = buf.subarray(0, 512); buf = buf.subarray(512);
        if (h.every(b => b === 0)) { done = true; return; }
        const name = h.toString('utf8', 0, 100).replace(/\0.*$/s, '');
        const prefix = h.toString('utf8', 345, 500).replace(/\0.*$/s, '');
        const sizeField = h.subarray(124, 136);
        const size = sizeField[0] & 0x80 ? Number(sizeField.readBigUInt64BE(4)) : parseInt(sizeField.toString('latin1').replace(/\0.*$/s, '').trim() || '0', 8);
        const type = String.fromCharCode(h[156] || 48);
        let full = longName ?? pax?.path ?? (prefix ? `${prefix}/${name}` : name);
        longName = null; pax = null;
        remaining = size; pad = (512 - (size % 512)) % 512;
        if (type === 'L' || type === 'x' || type === 'g') { current = { meta: type, chunks: [] }; }
        else { current = { path: full, size, type }; sink = (type === '0' || type === '7') ? await onEntry(current) : null; }
        state = 'data';
      } else if (state === 'data') {
        if (remaining > 0) {
          if (!buf.length) return;
          const take = buf.subarray(0, Math.min(remaining, buf.length));
          buf = buf.subarray(take.length); remaining -= take.length;
          if (current.meta) current.chunks.push(Buffer.from(take));
          else if (sink) await sink.write(take);
          if (remaining > 0) return;
        }
        if (current.meta === 'L') longName = Buffer.concat(current.chunks).toString('utf8').replace(/\0.*$/s, '');
        if (current.meta === 'x') {
          pax = {};
          for (const line of Buffer.concat(current.chunks).toString('utf8').split('\n')) { const m = line.match(/^\d+ ([^=]+)=(.*)$/); if (m) pax[m[1]] = m[2]; }
        }
        if (sink) { await sink.end(); sink = null; }
        state = 'pad';
      } else {
        if (buf.length < pad) { pad -= buf.length; buf = Buffer.alloc(0); return; }
        buf = buf.subarray(pad); pad = 0; state = 'header';
      }
    }
  };
  const source = createReadStream(abs);
  const stream = gz ? source.pipe(zlib.createGunzip()) : source;
  for await (const chunk of stream) {
    buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
    await handle();
    if (done) { source.destroy(); break; }
  }
}

// ---------------------------------------------------------------- Electron asar
export async function readAsar(abs) {
  const h = await readAt(abs, 0, 16);
  const headerSize = h.readUInt32LE(4), jsonLen = h.readUInt32LE(12);
  const json = JSON.parse((await readAt(abs, 16, jsonLen)).toString('utf8'));
  const base = 8 + headerSize;
  const entries = [];
  const visit = (node, prefix) => {
    for (const [name, v] of Object.entries(node.files ?? {})) {
      const p = prefix ? `${prefix}/${name}` : name;
      if (v.files) visit(v, p);
      else if (v.link) entries.push({ path: p, link: v.link, size: 0 });
      else entries.push({ path: p, size: v.size, ...(v.unpacked ? { unpacked: true } : { offset: base + Number(v.offset) }) });
      if (entries.length > MAX_ENTRIES) throw new RPError('BAD_FORMAT', 'Too many entries');
    }
  };
  visit(json, '');
  return { format: 'asar', entries };
}

// ---------------------------------------------------------------- header-only formats
async function describeOnly(abs, size, id) {
  const head = await readAt(abs, 0, 512);
  if (id === 'unityfs') {
    let p = 8;
    const fmt = head.readUInt32BE(p); p += 4;
    const cs = () => { const e = head.indexOf(0, p); const s = head.toString('latin1', p, e); p = e + 1; return s; };
    const unityVersion = cs(), revision = cs();
    p += 8 + 8; // total size, compressed+uncompressed block info sizes
    const flags = head.readUInt32BE(p);
    return { format: 'unityfs', bundleFormat: fmt, unityVersion: unityVersion === '5.x.x' ? `${revision} (player)` : unityVersion, unityRevision: revision, compression: ['none', 'LZMA', 'LZ4', 'LZ4HC'][flags & 0x3f] ?? flags & 0x3f, entries: [], note: 'Asset bundles are identified but not unpacked in this version. Port from the Unity project source when you can.' };
  }
  const tail = await readAt(abs, Math.max(0, size - 512), Math.min(512, size));
  const m = tail.lastIndexOf(Buffer.from([0xe1, 0x12, 0x6f, 0x5a]));
  if (m >= 0) return { format: 'unreal-pak', pakVersion: tail.readUInt32LE(m + 4), entries: [], note: 'Unreal paks are identified but not unpacked. Port from the Unreal project source (Content/, Source/).' };
  return null;
}

// ---------------------------------------------------------------- public: list / extract
export async function openArchive(file) {
  const { abs, size } = await requireFile(file, 'archive');
  const head = await readAt(abs, 0, 4096);
  const kind = identify(head).id;
  if (kind === 'zip') return { abs, size, ...(await readZip(abs, size)) };
  if (kind === 'asar') return { abs, size, ...(await readAsar(abs)) };
  if (kind === 'tar' || kind === 'gzip') {
    const gz = kind === 'gzip';
    const entries = [];
    await walkTar(abs, gz, e => { if (entries.length < MAX_ENTRIES) entries.push({ path: e.path, size: e.size }); return null; });
    return { abs, size, format: gz ? 'tar.gz' : 'tar', gz, entries };
  }
  if (kind === 'renpy-rpa') return { abs, size, ...(await readRpa(abs, size)) };
  if (kind === 'gamemaker-data') return { abs, size, ...(await readGameMaker(abs, size)) };
  if (kind === 'fmod-bank') return { abs, size, ...(await readFmodBank(abs, size)) };
  if (kind === 'wwise-bank') return { abs, size, ...(await readWwiseBank(abs, size)) };
  if (kind === 'swf') return { abs, size, ...(await readSwf(abs, size)) };
  if (/\.pak$/i.test(abs) && kind !== 'zip') { try { return { abs, size, ...(await readUnrealPak(abs, size)) }; } catch (e) { if (e.code !== 'BAD_FORMAT') throw e; } }
  if (kind === 'unityfs' || /\.pak$/i.test(abs)) { const d = await describeOnly(abs, size, kind); if (d) return { abs, size, ...d }; }
  try { return { abs, size, ...(await readPck(abs, size)) }; } catch (e) { if (e.code !== 'NOT_A_PCK') throw e; }
  throw new RPError('BAD_FORMAT', `Not a supported archive (${identify(head).name}). Supported: Godot .pck (also embedded in a game .exe/binary), zip/apk/jar/ipa, tar, tar.gz/.unitypackage, Electron .asar, Ren'Py .rpa, GameMaker data.win, FMOD .bank, Wwise .bnk, Unreal .pak, Flash .swf.`);
}

class Md5Pass extends Transform {
  constructor() { super(); this.hash = crypto.createHash('md5'); }
  _transform(chunk, _enc, cb) { this.hash.update(chunk); cb(null, chunk); }
}

export async function archiveTool({ file, action = 'list', match, limit = 500, out, maxBytes } = {}) {
  const arc = await openArchive(file);
  const want = compileMatcher(match);
  const selected = arc.entries.filter(e => want(e.path));
  const summary = { format: arc.format, file: arc.abs, size: arc.size };
  for (const k of ['packVersion', 'godotVersion', 'embedded', 'embeddedVia', 'start', 'encryptedDirectory', 'unityVersion', 'unityRevision', 'compression', 'pakVersion', 'bundleFormat', 'note', 'rpaVersion', 'keyed', 'renpy', 'chunks', 'game', 'counts', 'names', 'fsb', 'events', 'buses', 'vcas', 'bankVersion', 'bankId', 'objects', 'objectCount', 'namedIds', 'mountPoint', 'encryptedIndex', 'encryptionKeyGuid', 'compressionMethods', 'unreal', 'swfVersion', 'stage', 'tags', 'actionScript', 'documentClass', 'symbolClasses', 'frameLabels', 'classes', 'identifierStrings']) if (arc[k] !== undefined) summary[k] = arc[k];
  const byExt = {};
  for (const e of arc.entries) { const ext = path.extname(e.path).toLowerCase() || '(none)'; byExt[ext] = byExt[ext] ?? { files: 0, bytes: 0 }; byExt[ext].files++; byExt[ext].bytes += e.size ?? 0; }
  const topTypes = Object.entries(byExt).sort((a, b) => b[1].bytes - a[1].bytes).slice(0, 25).map(([ext, v]) => ({ ext, ...v }));
  const max = Math.max(1, Math.min(20000, limit));
  if (action === 'list') {
    return { ...summary, totalEntries: arc.entries.length, matching: selected.length, totalBytes: arc.entries.reduce((s, e) => s + (e.size ?? 0), 0), types: topTypes, entries: selected.slice(0, max).map(({ localHeader, method, ...e }) => e), truncated: selected.length > max };
  }
  if (action !== 'extract') throw new RPError('INVALID_ARGUMENT', 'action must be "list" or "extract".');
  if (arc.format === 'unityfs' || (arc.format === 'unreal-pak' && !arc.entries.length)) throw new RPError('UNSUPPORTED_ARCHIVE', summary.note ?? 'nothing to extract');
  const budget = Math.min(maxBytes ?? 4096 * MiB, 64 * 1024 * MiB);
  const root = out ? path.resolve(out) : await workspaceDir('extracted', extractionName(arc.abs, sha256(`${arc.abs}:${arc.size}`)));
  await fs.mkdir(root, { recursive: true });
  const files = [], skipped = [], mismatches = [];
  let written = 0;
  const plan = selected.slice(0, max);
  const allow = new Set(plan.map(e => e.path));
  const canWrite = e => {
    if (e.encrypted) { skipped.push({ path: e.path, reason: 'encrypted — not decrypted' }); return false; }
    if (e.extractable === false) { skipped.push({ path: e.path, reason: e.compressionMethod ? `${e.compressionMethod}-compressed entry: only stored and Zlib entries are extracted` : 'not extractable' }); return false; }
    if (e.size == null) { skipped.push({ path: e.path, reason: 'size unknown (not in the directory index)' }); return false; }
    if (e.inflated) { skipped.push({ path: e.path, reason: 'inside a compressed SWF body: extract from the inflated FWS copy (written as swf-inflated.swf)' }); return false; }
    if (e.unpacked) { skipped.push({ path: e.path, reason: 'stored outside the asar (app.asar.unpacked)' }); return false; }
    if (e.link) { skipped.push({ path: e.path, reason: 'symbolic link' }); return false; }
    if (written + (e.size ?? 0) > budget) { skipped.push({ path: e.path, reason: `over the ${Math.round(budget / MiB)} MiB extraction budget (raise maxBytes)` }); return false; }
    return true;
  };
  if (arc.format === 'swf' && arc.compression === 'zlib') {
    const whole = await fs.readFile(arc.abs);
    const body = zlib.inflateSync(whole.subarray(8));
    const header = Buffer.from(whole.subarray(0, 8)); header.write('FWS', 0, 'latin1');
    const dest = path.join(root, 'swf-inflated.swf');
    await fs.writeFile(dest, Buffer.concat([header, body]));
    files.push({ path: 'swf-inflated.swf', file: dest, size: 8 + body.length });
    written += 8 + body.length;
  }
  if (arc.format === 'tar' || arc.format === 'tar.gz') {
    await walkTar(arc.abs, arc.gz, async e => {
      if (!allow.has(e.path) || !canWrite(e)) return null;
      const dest = safeJoin(root, e.path);
      await fs.mkdir(path.dirname(dest), { recursive: true });
      const ws = createWriteStream(dest);
      written += e.size; files.push({ path: e.path, file: dest, size: e.size });
      return { write: chunk => new Promise((res, rej) => ws.write(chunk, err => (err ? rej(err) : res()))), end: () => new Promise((res, rej) => { ws.once('error', rej); ws.end(res); }) };
    });
  } else {
    for (const e of plan) {
      if (!canWrite(e)) continue;
      const dest = safeJoin(root, e.path);
      await fs.mkdir(path.dirname(dest), { recursive: true });
      if (arc.format === 'zip') {
        if (![0, 8].includes(e.method)) { skipped.push({ path: e.path, reason: `compression method ${e.method} not supported` }); continue; }
        const start = await zipDataStart(arc.abs, e);
        const src = e.compressedSize ? createReadStream(arc.abs, { start, end: start + e.compressedSize - 1 }) : Readable.from([]);
        await (e.method === 8 ? pipeline(src, zlib.createInflateRaw(), createWriteStream(dest)) : pipeline(src, createWriteStream(dest)));
      } else if (e.zlibBlocks) {
        const ws = createWriteStream(dest);
        for (const b of e.zlibBlocks) { const chunk = await readAt(arc.abs, b.start, b.end - b.start); await new Promise((res, rej) => ws.write(zlib.inflateSync(chunk), err => (err ? rej(err) : res()))); }
        await new Promise((res, rej) => { ws.once('error', rej); ws.end(res); });
      } else {
        const parts = [];
        if (e.prefix?.length) parts.push(Readable.from([Buffer.from(e.prefix)]));
        const body = e.size ? createReadStream(arc.abs, { start: e.offset, end: e.offset + Math.max(0, e.size - (e.prefix?.length ?? 0)) - 1 }) : Readable.from([]);
        const src = parts.length ? Readable.from((async function* () { for (const s of parts) yield* s; yield* body; })()) : body;
        const md5 = new Md5Pass();
        await pipeline(src, md5, createWriteStream(dest));
        if (arc.format === 'godot-pck' && e.md5 && !/^0+$/.test(e.md5) && md5.hash.digest('hex') !== e.md5) mismatches.push(e.path);
      }
      written += e.size ?? 0;
      files.push({ path: e.path, file: dest, size: e.size });
    }
  }
  return { ...summary, action: 'extract', outputDir: root, extracted: files.length, bytes: written, files: files.slice(0, 2000), skipped, ...(mismatches.length ? { md5Mismatches: mismatches } : {}), notInSelection: Math.max(0, selected.length - plan.length) };
}
