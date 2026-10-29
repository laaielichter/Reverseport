// File-format identification by content (magic bytes), embedded-file signatures for carving,
// entropy profiles and record-stride guesses for unknown formats.
import fs from 'node:fs/promises';
import { entropy, isText, MiB } from './util.mjs';

const B = s => Buffer.from(s, 'latin1');
const at = (buf, off, bytes) => off >= 0 && off + bytes.length <= buf.length && bytes.every((b, i) => buf[off + i] === b);
const str = (buf, off, s) => off >= 0 && off + s.length <= buf.length && buf.toString('latin1', off, off + s.length) === s;
const u32le = (buf, off) => (off + 4 <= buf.length ? buf.readUInt32LE(off) : -1);
const u32be = (buf, off) => (off + 4 <= buf.length ? buf.readUInt32BE(off) : -1);

/** Ordered: first match wins. category: executable | archive | engine | image | audio | video | model | font | data | document. */
export const FORMATS = [
  { id: 'elf', name: 'ELF executable/library', category: 'executable', test: (b, o) => at(b, o, [0x7f, 0x45, 0x4c, 0x46]) && [1, 2].includes(b[o + 4]) && [1, 2].includes(b[o + 5]) },
  { id: 'pe', name: 'Windows PE executable/library (MZ)', category: 'executable', test: (b, o) => str(b, o, 'MZ') && (() => { const e = u32le(b, o + 0x3c); return e > 0 && e < 0x10000 && str(b, o + e, 'PE\0\0'); })() },
  { id: 'macho', name: 'Mach-O executable/library', category: 'executable', test: (b, o) => [0xfeedface, 0xfeedfacf].includes(u32le(b, o)) || [0xfeedface, 0xfeedfacf].includes(u32be(b, o)) },
  { id: 'java-class', name: 'Java class file', category: 'executable', test: (b, o) => u32be(b, o) === 0xcafebabe && u32be(b, o + 4) >= 45 },
  { id: 'macho-fat', name: 'Mach-O universal (fat) binary', category: 'executable', test: (b, o) => (u32be(b, o) === 0xcafebabe || u32be(b, o) === 0xcafebabf) && u32be(b, o + 4) > 0 && u32be(b, o + 4) < 45 },
  { id: 'wasm', name: 'WebAssembly module', category: 'executable', test: (b, o) => at(b, o, [0, 0x61, 0x73, 0x6d]) && u32le(b, o + 4) === 1 },
  { id: 'dex', name: 'Android Dalvik bytecode (dex)', category: 'executable', test: (b, o) => str(b, o, 'dex\n') && b[o + 7] === 0 },
  { id: 'lua-bytecode', name: 'Lua bytecode', category: 'executable', test: (b, o) => at(b, o, [0x1b, 0x4c, 0x75, 0x61]) },
  { id: 'luajit-bytecode', name: 'LuaJIT bytecode', category: 'executable', test: (b, o) => at(b, o, [0x1b, 0x4c, 0x4a]) },
  { id: 'pyc', name: 'Python bytecode (.pyc)', category: 'executable', offsetZeroOnly: true, test: (b, o) => o === 0 && b.length > 16 && b[2] === 0x0d && b[3] === 0x0a && b.readUInt16LE(0) > 3000 && b.readUInt16LE(0) < 4000 },
  { id: 'godot-pck', name: 'Godot resource pack (GDPC)', category: 'engine', test: (b, o) => str(b, o, 'GDPC') && u32le(b, o + 4) >= 0 && u32le(b, o + 4) <= 3 },
  { id: 'godot-resource', name: 'Godot binary resource (RSRC)', category: 'engine', test: (b, o) => str(b, o, 'RSRC') },
  { id: 'godot-resource-compressed', name: 'Godot compressed resource (RSCC)', category: 'engine', test: (b, o) => str(b, o, 'RSCC') },
  { id: 'godot-ctex', name: 'Godot 4 compressed texture (GST2)', category: 'engine', test: (b, o) => str(b, o, 'GST2') },
  { id: 'godot-stex', name: 'Godot 3 stream texture (GDST)', category: 'engine', test: (b, o) => str(b, o, 'GDST') },
  { id: 'unityfs', name: 'Unity asset bundle (UnityFS)', category: 'engine', test: (b, o) => str(b, o, 'UnityFS\0') },
  { id: 'unity-web', name: 'Unity web/raw bundle', category: 'engine', test: (b, o) => str(b, o, 'UnityWeb\0') || str(b, o, 'UnityRaw\0') || str(b, o, 'UnityArchive') },
  { id: 'il2cpp-metadata', name: 'Unity IL2CPP global-metadata', category: 'engine', test: (b, o) => u32le(b, o) === 0xfab11baf },
  { id: 'unreal-asset', name: 'Unreal package (.uasset/.umap)', category: 'engine', test: (b, o) => u32le(b, o) === 0x9e2a83c1 },
  { id: 'gamemaker-data', name: 'GameMaker data (FORM/GEN8)', category: 'engine', test: (b, o) => str(b, o, 'FORM') && str(b, o + 8, 'GEN8') },
  { id: 'swf', name: 'Flash SWF', category: 'engine', offsetZeroOnly: true, test: (b, o) => o === 0 && ['FWS', 'CWS', 'ZWS'].includes(b.toString('latin1', o, o + 3)) && b[o + 3] >= 1 && b[o + 3] <= 60 },
  { id: 'pak', name: 'Quake PAK archive', category: 'archive', test: (b, o) => str(b, o, 'PACK') },
  { id: 'renpy-rpa', name: "Ren'Py archive (RPA)", category: 'archive', test: (b, o) => str(b, o, 'RPA-3.0 ') || str(b, o, 'RPA-2.0 ') },
  { id: 'asar', name: 'Electron archive (asar)', category: 'archive', offsetZeroOnly: true, test: (b, o) => o === 0 && u32le(b, 0) === 4 && str(b, 16, '{"files"') },
  { id: 'zip', name: 'ZIP archive (also apk/jar/ipa/docx/nupkg)', category: 'archive', test: (b, o) => at(b, o, [0x50, 0x4b, 3, 4]) || at(b, o, [0x50, 0x4b, 5, 6]) },
  { id: 'gzip', name: 'gzip', category: 'archive', test: (b, o) => at(b, o, [0x1f, 0x8b, 8]) && b[o + 3] < 0x20 },
  { id: '7z', name: '7-Zip archive', category: 'archive', test: (b, o) => at(b, o, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]) },
  { id: 'rar', name: 'RAR archive', category: 'archive', test: (b, o) => str(b, o, 'Rar!\x1a\x07') },
  { id: 'xz', name: 'xz', category: 'archive', test: (b, o) => at(b, o, [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0]) },
  { id: 'zstd', name: 'Zstandard frame', category: 'archive', test: (b, o) => at(b, o, [0x28, 0xb5, 0x2f, 0xfd]) },
  { id: 'lz4', name: 'LZ4 frame', category: 'archive', test: (b, o) => at(b, o, [0x04, 0x22, 0x4d, 0x18]) },
  { id: 'bzip2', name: 'bzip2', category: 'archive', test: (b, o) => str(b, o, 'BZh') && b[o + 3] >= 0x31 && b[o + 3] <= 0x39 },
  { id: 'tar', name: 'tar archive', category: 'archive', test: (b, o) => str(b, o + 257, 'ustar') },
  { id: 'ole', name: 'OLE compound file (msi/doc/xls)', category: 'archive', test: (b, o) => at(b, o, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]) },
  { id: 'sqlite', name: 'SQLite database', category: 'data', test: (b, o) => str(b, o, 'SQLite format 3\0') },
  { id: 'pdf', name: 'PDF document', category: 'document', test: (b, o) => str(b, o, '%PDF-') },
  { id: 'png', name: 'PNG image', category: 'image', test: (b, o) => at(b, o, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
  { id: 'jpeg', name: 'JPEG image', category: 'image', test: (b, o) => at(b, o, [0xff, 0xd8, 0xff]) && [0xe0, 0xe1, 0xe2, 0xe8, 0xed, 0xee, 0xdb, 0xc0, 0xc2, 0xc4, 0xfe].includes(b[o + 3]) },
  { id: 'gif', name: 'GIF image', category: 'image', test: (b, o) => str(b, o, 'GIF87a') || str(b, o, 'GIF89a') },
  { id: 'webp', name: 'WebP image', category: 'image', test: (b, o) => str(b, o, 'RIFF') && str(b, o + 8, 'WEBP') },
  { id: 'psd', name: 'Photoshop document', category: 'image', test: (b, o) => str(b, o, '8BPS') && b.length > o + 5 && b.readUInt16BE(o + 4) <= 2 },
  { id: 'dds', name: 'DirectDraw Surface texture', category: 'image', test: (b, o) => str(b, o, 'DDS ') && u32le(b, o + 4) === 124 },
  { id: 'ktx', name: 'KTX texture', category: 'image', test: (b, o) => at(b, o, [0xab, 0x4b, 0x54, 0x58, 0x20]) },
  { id: 'exr', name: 'OpenEXR image', category: 'image', test: (b, o) => at(b, o, [0x76, 0x2f, 0x31, 0x01]) },
  { id: 'hdr', name: 'Radiance HDR image', category: 'image', test: (b, o) => str(b, o, '#?RADIANCE') || str(b, o, '#?RGBE') },
  { id: 'bmp', name: 'BMP image', category: 'image', offsetZeroOnly: true, test: (b, o) => o === 0 && str(b, 0, 'BM') && u32le(b, 14) >= 12 && u32le(b, 14) <= 124 },
  { id: 'ico', name: 'Windows icon', category: 'image', offsetZeroOnly: true, test: (b, o) => o === 0 && at(b, 0, [0, 0, 1, 0]) && b.length > 6 && b.readUInt16LE(4) > 0 && b.readUInt16LE(4) < 64 },
  { id: 'wav', name: 'WAVE audio', category: 'audio', test: (b, o) => str(b, o, 'RIFF') && str(b, o + 8, 'WAVE') },
  { id: 'fmod-bank', name: 'FMOD Studio bank', category: 'audio', test: (b, o) => str(b, o, 'RIFF') && str(b, o + 8, 'FEV ') },
  { id: 'avi', name: 'AVI video', category: 'video', test: (b, o) => str(b, o, 'RIFF') && str(b, o + 8, 'AVI ') },
  { id: 'ogg', name: 'Ogg (Vorbis/Opus/Theora)', category: 'audio', test: (b, o) => str(b, o, 'OggS') && b[o + 4] === 0 },
  { id: 'flac', name: 'FLAC audio', category: 'audio', test: (b, o) => str(b, o, 'fLaC') },
  { id: 'mp3', name: 'MP3 audio (ID3)', category: 'audio', test: (b, o) => str(b, o, 'ID3') && b[o + 3] >= 2 && b[o + 3] <= 4 },
  { id: 'wwise-bank', name: 'Wwise sound bank', category: 'audio', test: (b, o) => str(b, o, 'BKHD') },
  { id: 'midi', name: 'MIDI', category: 'audio', test: (b, o) => str(b, o, 'MThd') && u32be(b, o + 4) === 6 },
  { id: 'mp4', name: 'MP4/MOV video (ISO BMFF)', category: 'video', test: (b, o) => str(b, o + 4, 'ftyp') && /^[ -~]{4}$/.test(b.toString('latin1', o + 8, o + 12)) },
  { id: 'matroska', name: 'Matroska/WebM video', category: 'video', test: (b, o) => at(b, o, [0x1a, 0x45, 0xdf, 0xa3]) },
  { id: 'bink', name: 'Bink video', category: 'video', test: (b, o) => (str(b, o, 'BIK') && 'bdfghi'.includes(String.fromCharCode(b[o + 3]))) || str(b, o, 'KB2') },
  { id: 'glb', name: 'glTF binary model (.glb)', category: 'model', test: (b, o) => str(b, o, 'glTF') && u32le(b, o + 4) === 2 },
  { id: 'fbx', name: 'FBX binary model', category: 'model', test: (b, o) => str(b, o, 'Kaydara FBX Binary') },
  { id: 'blend', name: 'Blender file', category: 'model', test: (b, o) => str(b, o, 'BLENDER') && '_-'.includes(String.fromCharCode(b[o + 7])) },
  { id: 'otf', name: 'OpenType font (CFF)', category: 'font', test: (b, o) => str(b, o, 'OTTO') },
  { id: 'woff', name: 'WOFF font', category: 'font', test: (b, o) => str(b, o, 'wOFF') },
  { id: 'woff2', name: 'WOFF2 font', category: 'font', test: (b, o) => str(b, o, 'wOF2') },
  { id: 'ttf', name: 'TrueType font', category: 'font', offsetZeroOnly: true, test: (b, o) => o === 0 && at(b, 0, [0, 1, 0, 0]) && b.length > 12 && b.readUInt16BE(4) > 0 && b.readUInt16BE(4) < 64 },
];

const TEXT_KINDS = [
  { id: 'godot-scene', name: 'Godot text scene (.tscn)', re: /^\[gd_scene\b/ },
  { id: 'godot-text-resource', name: 'Godot text resource (.tres)', re: /^\[gd_resource\b/ },
  { id: 'godot-project', name: 'Godot project settings', re: /^; Engine configuration file/ },
  { id: 'unity-yaml', name: 'Unity YAML asset (scene/prefab/asset)', re: /^%YAML[^\n]*\n%TAG !u! tag:unity3d\.com/ },
  { id: 'yaml', name: 'YAML', re: /^(%YAML|---\s*\n)/ },
  { id: 'xml', name: 'XML', re: /^\s*<\?xml/ },
  { id: 'html', name: 'HTML', re: /^\s*<!doctype html|^\s*<html/i },
  { id: 'json', name: 'JSON', re: /^\s*[[{]/ },
  { id: 'obj', name: 'Wavefront OBJ (text model)', re: /^(#[^\n]*\n)*\s*(mtllib|o |v -?\d)/m },
  { id: 'shebang-script', name: 'Script (shebang)', re: /^#!/ },
];

/** Identify a buffer that starts at the beginning of a file. */
export function identify(head) {
  for (const f of FORMATS) {
    try { if (f.test(head, 0)) return { id: f.id, name: f.name, category: f.category }; } catch { /* short buffer */ }
  }
  if (isText(head)) {
    const text = head.toString('utf8', 0, Math.min(head.length, 4096)).replace(/^﻿/, '');
    for (const k of TEXT_KINDS) if (k.re.test(text)) return { id: k.id, name: k.name, category: 'text' };
    return { id: 'text', name: 'Plain text', category: 'text' };
  }
  return { id: 'unknown', name: 'Unknown binary data', category: 'unknown' };
}

/** Signatures worth looking for inside other files (distinctive enough to carve). */
const CARVE = [
  ['png', B('\x89PNG\r\n\x1a\n'), 0], ['jpeg', Buffer.from([0xff, 0xd8, 0xff]), 0], ['gif', B('GIF8'), 0],
  ['ogg', B('OggS'), 0], ['wav', B('RIFF'), 0], ['flac', B('fLaC'), 0], ['mp4', B('ftyp'), 4], ['matroska', Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), 0],
  ['zip', Buffer.from([0x50, 0x4b, 3, 4]), 0], ['godot-pck', B('GDPC'), 0], ['godot-resource', B('RSRC'), 0], ['godot-ctex', B('GST2'), 0],
  ['unityfs', B('UnityFS\0'), 0], ['glb', B('glTF'), 0], ['dds', B('DDS |'), 0], ['fbx', B('Kaydara FBX Binary'), 0],
  ['sqlite', B('SQLite format 3\0'), 0], ['pdf', B('%PDF-'), 0], ['elf', B('\x7fELF'), 0], ['pe', B('MZ'), 0], ['wasm', B('\0asm'), 0],
  ['wwise-bank', B('BKHD'), 0], ['otf', B('OTTO'), 0], ['woff', B('wOFF'), 0], ['woff2', B('wOF2'), 0], ['midi', B('MThd'), 0],
  ['bink', B('BIK'), 0], ['psd', B('8BPS'), 0], ['blend', B('BLENDER'), 0], ['7z', Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]), 0],
  ['xz', Buffer.from([0xfd, 0x37, 0x7a, 0x58, 0x5a, 0]), 0], ['gzip', Buffer.from([0x1f, 0x8b, 8]), 0], ['lua-bytecode', Buffer.from([0x1b, 0x4c, 0x75, 0x61]), 0],
];
const FORMAT_BY_ID = new Map(FORMATS.map(f => [f.id, f]));

/** Size of an embedded object when its header says so (RIFF, glb, PNG up to IEND). */
function knownSize(id, buf, o) {
  if (['wav', 'webp', 'avi', 'fmod-bank'].includes(id)) return u32le(buf, o + 4) + 8;
  if (id === 'glb') return u32le(buf, o + 8);
  if (id === 'png') { const end = buf.indexOf(B('IEND'), o + 8); return end > 0 ? end + 8 - o : null; }
  return null;
}

/**
 * Scan a byte range for embedded files. Reads in chunks, so it works on multi-GB packs.
 * Returns [{offset, id, name, size?}] (offset 0 itself is skipped unless includeStart).
 */
export async function findSignatures(file, { start = 0, maxBytes = 512 * MiB, max = 200, includeStart = false } = {}) {
  const st = await fs.stat(file);
  const end = Math.min(st.size, start + maxBytes);
  const fh = await fs.open(file, 'r');
  const found = [];
  const CHUNK = 8 * MiB, OVER = 1024;
  try {
    for (let pos = start; pos < end && found.length < max; pos += CHUNK) {
      const len = Math.min(CHUNK + OVER, st.size - pos);
      const buf = Buffer.alloc(len);
      await fh.read(buf, 0, len, pos);
      const limitIdx = Math.min(CHUNK, end - pos);
      const hits = [];
      for (const [id, needle, back] of CARVE) {
        for (let i = buf.indexOf(needle, back); i !== -1 && i - back < limitIdx; i = buf.indexOf(needle, i + 1)) {
          const o = i - back;
          const abs = pos + o;
          if (abs === 0 && !includeStart) continue;
          let fmt = FORMAT_BY_ID.get(id);
          if (id === 'wav') fmt = ['wav', 'webp', 'avi', 'fmod-bank'].map(x => FORMAT_BY_ID.get(x)).find(f => f.test(buf, o));
          let ok = false;
          try { ok = !!fmt && fmt.test(buf, o); } catch { ok = false; }
          if (!ok) continue;
          const size = knownSize(fmt.id, buf, o);
          hits.push({ offset: abs, id: fmt.id, name: fmt.name, ...(size && size > 0 && abs + size <= st.size ? { size } : {}) });
          if (hits.length > max * 4) break;
        }
      }
      hits.sort((a, b) => a.offset - b.offset);
      for (const h of hits) { if (found.length >= max) break; found.push(h); }
    }
  } finally { await fh.close(); }
  return { scanned: end - start, fileSize: st.size, truncated: end < st.size || found.length >= max, hits: found };
}

/** Entropy per block, merged into readable segments. */
export async function entropyProfile(file, { start = 0, maxBytes = 512 * MiB, blocks = 256 } = {}) {
  const st = await fs.stat(file);
  const end = Math.min(st.size, start + maxBytes);
  const span = end - start;
  if (span <= 0) return { segments: [], average: 0 };
  const n = Math.max(1, Math.min(blocks, Math.ceil(span / 4096)));
  const blockSize = Math.ceil(span / n);
  const sample = Math.min(blockSize, 64 * 1024);
  const fh = await fs.open(file, 'r');
  const values = [];
  try {
    for (let i = 0; i < n; i++) {
      const off = start + i * blockSize;
      if (off >= end) break;
      const buf = Buffer.alloc(Math.min(sample, end - off));
      await fh.read(buf, 0, buf.length, off);
      values.push({ offset: off, length: Math.min(blockSize, end - off), entropy: entropy(buf) });
    }
  } finally { await fh.close(); }
  const cls = e => (e < 1 ? 'empty/padding' : e < 4.5 ? 'structured/text' : e < 6.5 ? 'code/mixed' : e < 7.5 ? 'dense data' : 'compressed/encrypted');
  const segments = [];
  for (const v of values) {
    const c = cls(v.entropy);
    const last = segments[segments.length - 1];
    if (last && last.class === c) { last.length += v.length; last.sum += v.entropy * v.length; }
    else segments.push({ offset: v.offset, length: v.length, class: c, sum: v.entropy * v.length });
  }
  const average = values.reduce((s, v) => s + v.entropy * v.length, 0) / values.reduce((s, v) => s + v.length, 0);
  return {
    blockSize,
    average: Math.round(average * 100) / 100,
    segments: segments.slice(0, 64).map(s => ({ offset: s.offset, length: s.length, class: s.class, entropy: Math.round((s.sum / s.length) * 100) / 100 })),
  };
}

/** Guess fixed-size record layouts: strides where bytes repeat far more often than chance. */
export function strideGuess(buf, { min = 2, max = 1024 } = {}) {
  const n = Math.min(buf.length, 65536);
  if (n < 64) return [];
  const counts = new Uint32Array(256);
  for (let i = 0; i < n; i++) counts[buf[i]]++;
  let baseline = 0;
  for (const c of counts) baseline += (c / n) ** 2;
  if (baseline > 0.5) return []; // mostly one value: padding, not records
  const scores = [];
  for (let s = min; s <= Math.min(max, n >> 2); s++) {
    let same = 0;
    for (let i = 0; i + s < n; i++) if (buf[i] === buf[i + s]) same++;
    const score = same / (n - s) / baseline;
    if (score > 1.6) scores.push({ stride: s, score: Math.round(score * 100) / 100 });
  }
  const byStride = new Map(scores.map(x => [x.stride, x]));
  // A table with record size 24 also repeats at 48, 72…: report the smallest stride that scores nearly as well.
  const base = x => { for (let d = min; d < x.stride; d++) if (x.stride % d === 0 && byStride.get(d)?.score >= x.score * 0.8) return byStride.get(d); return x; };
  scores.sort((a, b) => b.score - a.score);
  const picked = [];
  for (const s of scores) {
    const b = base(s);
    if (picked.some(p => p.stride === b.stride || (b.stride % p.stride === 0 && b.score < p.score * 1.15))) continue;
    picked.push(b);
    if (picked.length >= 5) break;
  }
  return picked;
}
