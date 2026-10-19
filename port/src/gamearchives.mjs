// Game-specific containers: Ren'Py RPA, GameMaker data.win (FORM), FMOD Studio banks (RIFF FEV + FSB5),
// Wwise sound banks (BKHD), Unreal .pak (v1–v11) and Flash SWF. Each reader returns the same shape openArchive
// uses: { format, entries: [{ path, size, offset, ... }], ...facts }. Entries that are stored in the clear get an
// offset/size (and optionally a prefix or zlib flag) so archiveTool can extract them; encrypted content is
// described and never decrypted (project rule).
import fs from 'node:fs/promises';
import zlib from 'node:zlib';
import path from 'node:path';
import { RPError, readAt } from './util.mjs';

// ------------------------------------------------------------------------------------------------ Ren'Py RPA
/** Minimal Python pickle reader for the shapes Ren'Py's index uses (dict of str → list of tuples of int/bytes). */
export function unpickle(buf) {
  const stack = [], memo = new Map();
  let marks = [];
  let p = 0;
  const u8 = () => buf[p++], i32 = () => { const v = buf.readInt32LE(p); p += 4; return v; }, u32 = () => { const v = buf.readUInt32LE(p); p += 4; return v; };
  const bytesN = n => { const b = buf.subarray(p, p + n); p += n; return b; };
  const mark = () => { marks.push(stack.length); };
  const popMark = () => { const i = marks.pop(); const items = stack.splice(i); return items; };
  for (let guard = 0; guard < 50_000_000; guard++) {
    if (p >= buf.length) throw new RPError('BAD_FORMAT', 'pickle ended early');
    const op = u8();
    switch (op) {
      case 0x80: p++; break; // PROTO
      case 0x2e: return stack.pop(); // STOP
      case 0x7d: stack.push({}); break; // EMPTY_DICT
      case 0x5d: stack.push([]); break; // EMPTY_LIST
      case 0x29: stack.push([]); break; // EMPTY_TUPLE
      case 0x28: mark(); break; // MARK
      case 0x4e: stack.push(null); break; // NONE
      case 0x88: stack.push(true); break; case 0x89: stack.push(false); break;
      case 0x4a: stack.push(i32()); break; // BININT
      case 0x4b: stack.push(u8()); break; // BININT1
      case 0x4d: { stack.push(buf.readUInt16LE(p)); p += 2; break; } // BININT2
      case 0x8a: { const n = u8(); const b = bytesN(n); let v = 0n; for (let i = n - 1; i >= 0; i--) v = (v << 8n) | BigInt(b[i]); if (n && b[n - 1] & 0x80) v -= 1n << BigInt(8 * n); stack.push(Number(v)); break; } // LONG1
      case 0x8b: { const n = u32(); const b = bytesN(n); let v = 0n; for (let i = n - 1; i >= 0; i--) v = (v << 8n) | BigInt(b[i]); stack.push(Number(v)); break; } // LONG4
      case 0x4c: { const e = buf.indexOf(0x0a, p); stack.push(Number(buf.toString('latin1', p, e).replace(/L$/, ''))); p = e + 1; break; } // LONG
      case 0x49: { const e = buf.indexOf(0x0a, p); stack.push(Number(buf.toString('latin1', p, e))); p = e + 1; break; } // INT
      case 0x47: { stack.push(buf.readDoubleBE(p)); p += 8; break; } // BINFLOAT
      case 0x58: { const n = u32(); stack.push(bytesN(n).toString('utf8')); break; } // BINUNICODE
      case 0x8c: { const n = u8(); stack.push(bytesN(n).toString('utf8')); break; } // SHORT_BINUNICODE
      case 0x8d: { const n = Number(buf.readBigUInt64LE(p)); p += 8; stack.push(bytesN(n).toString('utf8')); break; } // BINUNICODE8
      case 0x54: { const n = u32(); stack.push(bytesN(n)); break; } // BINSTRING (bytes)
      case 0x55: { const n = u8(); stack.push(bytesN(n)); break; } // SHORT_BINSTRING
      case 0x42: { const n = u32(); stack.push(bytesN(n)); break; } // BINBYTES
      case 0x43: { const n = u8(); stack.push(bytesN(n)); break; } // SHORT_BINBYTES
      case 0x8e: { const n = Number(buf.readBigUInt64LE(p)); p += 8; stack.push(bytesN(n)); break; } // BINBYTES8
      case 0x53: { const e = buf.indexOf(0x0a, p); const s = buf.toString('latin1', p, e); p = e + 1; stack.push(Buffer.from(s.replace(/^['"]|['"]$/g, ''), 'latin1')); break; } // STRING
      case 0x56: { const e = buf.indexOf(0x0a, p); stack.push(buf.toString('latin1', p, e)); p = e + 1; break; } // UNICODE
      case 0x71: memo.set(u8(), stack.at(-1)); break; // BINPUT
      case 0x72: memo.set(u32(), stack.at(-1)); break; // LONG_BINPUT
      case 0x94: memo.set(memo.size, stack.at(-1)); break; // MEMOIZE
      case 0x70: { const e = buf.indexOf(0x0a, p); memo.set(Number(buf.toString('latin1', p, e)), stack.at(-1)); p = e + 1; break; } // PUT
      case 0x68: stack.push(memo.get(u8())); break; // BINGET
      case 0x6a: stack.push(memo.get(u32())); break; // LONG_BINGET
      case 0x67: { const e = buf.indexOf(0x0a, p); stack.push(memo.get(Number(buf.toString('latin1', p, e)))); p = e + 1; break; } // GET
      case 0x74: stack.push(popMark()); break; // TUPLE
      case 0x85: stack.push([stack.pop()]); break; // TUPLE1
      case 0x86: { const b = stack.pop(), a = stack.pop(); stack.push([a, b]); break; } // TUPLE2
      case 0x87: { const c = stack.pop(), b = stack.pop(), a = stack.pop(); stack.push([a, b, c]); break; } // TUPLE3
      case 0x6c: stack.push(popMark()); break; // LIST
      case 0x61: { const v = stack.pop(); stack.at(-1).push(v); break; } // APPEND
      case 0x65: { const items = popMark(); stack.at(-1).push(...items); break; } // APPENDS
      case 0x64: { const items = popMark(); const d = {}; for (let i = 0; i < items.length; i += 2) d[String(items[i])] = items[i + 1]; stack.push(d); break; } // DICT
      case 0x73: { const v = stack.pop(), k = stack.pop(); stack.at(-1)[String(k)] = v; break; } // SETITEM
      case 0x75: { const items = popMark(); const d = stack.at(-1); for (let i = 0; i < items.length; i += 2) d[String(items[i])] = items[i + 1]; break; } // SETITEMS
      case 0x30: stack.pop(); break; // POP
      case 0x31: popMark(); break; // POP_MARK
      case 0x32: stack.push(stack.at(-1)); break; // DUP
      case 0x95: p += 8; break; // FRAME
      case 0x8f: stack.push(new Set()); break; // EMPTY_SET
      case 0x90: { const items = popMark(); for (const it of items) stack.at(-1).add(it); break; } // ADDITEMS
      case 0x91: stack.push(new Set(popMark())); break; // FROZENSET
      case 0x63: { const e1 = buf.indexOf(0x0a, p); const e2 = buf.indexOf(0x0a, e1 + 1); stack.push({ __global__: `${buf.toString('latin1', p, e1)}.${buf.toString('latin1', e1 + 1, e2)}` }); p = e2 + 1; break; } // GLOBAL
      case 0x93: { const n = stack.pop(), m = stack.pop(); stack.push({ __global__: `${m}.${n}` }); break; } // STACK_GLOBAL
      case 0x52: case 0x81: case 0x62: case 0x4f: { const arg = stack.pop(); const cls = stack.pop(); stack.push({ __object__: cls?.__global__ ?? cls, args: arg }); break; } // REDUCE / NEWOBJ / BUILD / OBJ (approximate)
      default: throw new RPError('BAD_FORMAT', `pickle opcode 0x${op.toString(16)} not supported at ${p - 1}`);
    }
  }
  throw new RPError('BAD_FORMAT', 'pickle too long');
}

export async function readRpa(abs, size) {
  const head = await readAt(abs, 0, 64);
  const line = head.toString('latin1', 0, head.indexOf(0x0a) < 0 ? 64 : head.indexOf(0x0a));
  const m = line.match(/^RPA-(\d\.\d) ([0-9a-fA-F]+)(?: ([0-9a-fA-F]+))?/);
  if (!m) throw new RPError('BAD_FORMAT', 'Not an RPA-2.0/3.0 archive.');
  const version = m[1], indexOffset = parseInt(m[2], 16), key = m[3] ? parseInt(m[3], 16) : 0;
  if (indexOffset <= 0 || indexOffset >= size) throw new RPError('BAD_FORMAT', 'RPA index offset outside the file.');
  const raw = await readAt(abs, indexOffset, size - indexOffset);
  let idx;
  try { idx = unpickle(zlib.inflateSync(raw)); } catch (e) { throw new RPError('BAD_FORMAT', `RPA index unreadable: ${e.message}`); }
  const entries = [];
  for (const [name, parts] of Object.entries(idx)) {
    if (!Array.isArray(parts)) continue;
    let total = 0, first = null, pieces = 0;
    for (const part of parts) {
      if (!Array.isArray(part)) continue;
      const [off, len, prefix] = part;
      const offset = (Number(off) ^ key) >>> 0, length = (Number(len) ^ key) >>> 0;
      const pre = prefix instanceof Uint8Array ? Buffer.from(prefix) : typeof prefix === 'string' ? Buffer.from(prefix, 'latin1') : Buffer.alloc(0);
      total += length + pre.length;
      if (!first) first = { offset, length, prefix: pre };
      pieces++;
    }
    if (!first) continue;
    entries.push({ path: name, size: total, offset: first.offset, ...(first.prefix.length ? { prefix: first.prefix } : {}), ...(pieces > 1 ? { multipart: pieces, note: 'only the first piece is extracted' } : {}), ...(pieces > 1 ? { size: first.length + first.prefix.length } : {}) });
  }
  entries.sort((a, b) => a.path.localeCompare(b.path));
  const rpyc = entries.filter(e => /\.rpyc$/i.test(e.path)).length, rpy = entries.filter(e => /\.rpy$/i.test(e.path)).length;
  return { format: 'renpy-rpa', rpaVersion: version, keyed: !!key, entries, renpy: { compiledScripts: rpyc, sourceScripts: rpy, note: rpyc && !rpy ? '.rpyc files are compiled Ren\'Py AST (RPYC2 slots of pickled nodes); the original .rpy source is not inside. Dialogue and menu text can still be pulled with re_strings on extracted .rpyc (string scan) or from the game\'s tl/ folder.' : rpy ? 'source .rpy scripts are inside: extract them and run re_strings/re_graph on the folder.' : 'no scripts in this archive (images/audio/fonts).' } };
}

// ------------------------------------------------------------------------------------------------ GameMaker data.win
const GM_CHUNK_NAMES = { GEN8: 'general info', OPTN: 'options', LANG: 'languages', EXTN: 'extensions', SOND: 'sounds', AGRP: 'audio groups', SPRT: 'sprites', BGND: 'backgrounds/tilesets', PATH: 'paths', SCPT: 'scripts', GLOB: 'global init', SHDR: 'shaders', FONT: 'fonts', TMLN: 'timelines', OBJT: 'objects', ROOM: 'rooms', DAFL: 'data files', TPAG: 'texture pages (sprite frames)', CODE: 'GML bytecode', VARI: 'variables', FUNC: 'functions', STRG: 'strings', TXTR: 'texture sheets', AUDO: 'audio data', EMBI: 'embedded images', TGIN: 'texture group info', ACRV: 'animation curves', SEQN: 'sequences', TAGS: 'tags', FEDS: 'filter effects', PSEM: 'particle emitters', PSYS: 'particle systems', UILR: 'UI layers' };

export async function readGameMaker(abs, size) {
  const head = await readAt(abs, 0, 8);
  if (head.toString('latin1', 0, 4) !== 'FORM') throw new RPError('BAD_FORMAT', 'Not a GameMaker FORM file.');
  const formLen = head.readUInt32LE(4);
  const chunks = [];
  let p = 8;
  const chunkIndex = new Map();
  while (p + 8 <= Math.min(size, 8 + formLen)) {
    const h = await readAt(abs, p, 8);
    const name = h.toString('latin1', 0, 4), len = h.readUInt32LE(4);
    if (!/^[A-Z0-9]{4}$/.test(name)) break;
    chunks.push({ name, meaning: GM_CHUNK_NAMES[name] ?? '?', offset: p + 8, size: len });
    chunkIndex.set(name, { offset: p + 8, size: len });
    p += 8 + len;
  }
  const strgAt = new Map();
  const readString = async ptr => { if (!ptr || ptr + 4 > size) return null; if (strgAt.has(ptr)) return strgAt.get(ptr); const b = await readAt(abs, ptr - 4, 4); const n = b.readUInt32LE(0); if (n > 4096) return null; const s = (await readAt(abs, ptr, n)).toString('utf8'); strgAt.set(ptr, s); return s; };
  const listOf = async name => { const c = chunkIndex.get(name); if (!c || c.size < 4) return []; const b = await readAt(abs, c.offset, Math.min(c.size, 4 + 4 * 200000)); const n = b.readUInt32LE(0); const out = []; for (let i = 0; i < Math.min(n, 200000) && 4 + 4 * i + 4 <= b.length; i++) out.push(b.readUInt32LE(4 + 4 * i)); return out; };
  const namesOf = async (chunk, nameOffsetInRecord = 0) => { const ptrs = await listOf(chunk); const names = []; for (const ptr of ptrs.slice(0, 5000)) { if (!ptr || ptr + nameOffsetInRecord + 4 > size) continue; const rec = await readAt(abs, ptr + nameOffsetInRecord, 4); const s = await readString(rec.readUInt32LE(0)); if (s) names.push(s); } return names; };
  const info = {};
  const gen8 = chunkIndex.get('GEN8');
  if (gen8) {
    const g = await readAt(abs, gen8.offset, Math.min(gen8.size, 128));
    info.bytecodeVersion = g[1];
    info.name = await readString(g.readUInt32LE(4));
    info.displayName = await readString(g.readUInt32LE(0x2c));
    info.version = `${g.readUInt32LE(0x30)}.${g.readUInt32LE(0x34)}.${g.readUInt32LE(0x38)}.${g.readUInt32LE(0x3c)}`;
    info.windowSize = [g.readUInt32LE(0x40), g.readUInt32LE(0x44)];
    info.gameMakerFamily = info.bytecodeVersion >= 17 ? 'GameMaker Studio 2.3+ / GameMaker 2022+' : info.bytecodeVersion >= 15 ? 'GameMaker Studio 2' : 'GameMaker: Studio 1.x';
  }
  const entries = [];
  // Texture sheets: each TXTR record points at an embedded PNG (or QOI/BZ2 in newer runtimes).
  const txtr = chunkIndex.get('TXTR');
  if (txtr) {
    const ptrs = await listOf('TXTR');
    for (let i = 0; i < ptrs.length; i++) {
      const rec = await readAt(abs, ptrs[i], 16);
      let dataPtr = null;
      for (const cand of [rec.readUInt32LE(8), rec.readUInt32LE(12), rec.readUInt32LE(4)]) { if (cand > 0 && cand < size) { const sig = await readAt(abs, cand, 8); if (sig[0] === 0x89 && sig.toString('latin1', 1, 4) === 'PNG') { dataPtr = cand; break; } if (sig.toString('latin1', 0, 4) === 'qoif' || sig.toString('latin1', 0, 4) === '2zoq') { dataPtr = cand; break; } } }
      if (dataPtr == null) continue;
      const sig = await readAt(abs, dataPtr, 4);
      const isPng = sig[0] === 0x89;
      let len = 0;
      if (isPng) { // walk PNG chunks to IEND
        let q = dataPtr + 8;
        for (let guard = 0; guard < 100000 && q + 8 <= size; guard++) { const ch = await readAt(abs, q, 8); const l = ch.readUInt32BE(0), t = ch.toString('latin1', 4, 8); q += 12 + l; if (t === 'IEND') break; }
        len = q - dataPtr;
      } else { const next = ptrs[i + 1] ? (await readAt(abs, ptrs[i + 1], 16)).readUInt32LE(8) : null; len = (next && next > dataPtr ? next : (txtr.offset + txtr.size)) - dataPtr; }
      entries.push({ path: `textures/texture_${i}.${isPng ? 'png' : 'qoi'}`, offset: dataPtr, size: len });
    }
  }
  const audo = chunkIndex.get('AUDO');
  if (audo) {
    const ptrs = await listOf('AUDO');
    const soundNames = await namesOf('SOND', 0);
    for (let i = 0; i < ptrs.length; i++) {
      const h = await readAt(abs, ptrs[i], 8);
      const len = h.readUInt32LE(0);
      const sig = h.toString('latin1', 4, 8);
      const ext = sig === 'RIFF' ? 'wav' : sig === 'OggS' ? 'ogg' : 'bin';
      entries.push({ path: `audio/${soundNames[i] ?? `audio_${i}`}.${ext}`, offset: ptrs[i] + 4, size: len });
    }
  }
  const names = {};
  for (const [chunk, key] of [['SPRT', 'sprites'], ['OBJT', 'objects'], ['ROOM', 'rooms'], ['SCPT', 'scripts'], ['SOND', 'sounds'], ['FONT', 'fonts'], ['SHDR', 'shaders'], ['BGND', 'backgrounds'], ['PATH', 'paths'], ['TMLN', 'timelines'], ['SEQN', 'sequences']]) { const list = await namesOf(chunk, 0).catch(() => []); if (list.length) names[key] = list; }
  const strg = chunkIndex.get('STRG');
  let stringCount = 0;
  if (strg) stringCount = (await readAt(abs, strg.offset, 4)).readUInt32LE(0);
  const code = chunkIndex.get('CODE');
  const codeEntries = code ? (await readAt(abs, code.offset, 4)).readUInt32LE(0) : 0;
  return {
    format: 'gamemaker-data', entries, chunks: chunks.map(c => ({ name: c.name, meaning: c.meaning, size: c.size })), game: info, counts: { strings: stringCount, codeEntries, ...Object.fromEntries(Object.entries(names).map(([k, v]) => [k, v.length])) }, names: Object.fromEntries(Object.entries(names).map(([k, v]) => [k, v.slice(0, 300)])),
    note: 'Textures and audio are stored in the clear and extract as PNG/QOI and WAV/OGG (names from SOND). GML is VM bytecode in CODE; the strings, object, script and room names above are the map for a rebuild (re_blueprint) — port behaviour from them, not from decompiled code.',
  };
}

// ------------------------------------------------------------------------------------------------ FMOD / Wwise
const FSB_CODECS = { 1: 'PCM8', 2: 'PCM16', 3: 'PCM24', 4: 'PCM32', 5: 'PCMFLOAT', 6: 'GCADPCM', 7: 'IMAADPCM', 8: 'VAG', 9: 'HEVAG', 10: 'XMA', 11: 'MPEG', 12: 'CELT', 13: 'AT9', 14: 'XWMA', 15: 'VORBIS', 16: 'FADPCM', 17: 'OPUS' };
export async function readFsb5(abs, base, maxLen) {
  const h = await readAt(abs, base, 64);
  if (h.toString('latin1', 0, 4) !== 'FSB5') return null;
  const version = h.readUInt32LE(4), numSamples = h.readUInt32LE(8), headersSize = h.readUInt32LE(12), namesSize = h.readUInt32LE(16), dataSize = h.readUInt32LE(20), mode = h.readUInt32LE(24);
  const headerLen = version === 0 ? 64 : 60;
  const hdr = await readAt(abs, base + headerLen, headersSize);
  const names = namesSize ? await readAt(abs, base + headerLen + headersSize, namesSize) : null;
  const dataBase = base + headerLen + headersSize + namesSize;
  const samples = [];
  let p = 0;
  const RATES = { 0: 4000, 1: 8000, 2: 11000, 3: 11025, 4: 16000, 5: 22050, 6: 24000, 7: 32000, 8: 44100, 9: 48000, 10: 96000 };
  for (let i = 0; i < numSamples && p + 8 <= hdr.length; i++) {
    const raw = hdr.readBigUInt64LE(p); p += 8;
    let next = Number(raw & 1n);
    const freqIdx = Number((raw >> 1n) & 0xfn), channels = Number((raw >> 5n) & 1n) + 1, dataOffset = Number((raw >> 6n) & 0xfffffffn) * 32, sampleCount = Number(raw >> 34n);
    let frequency = RATES[freqIdx] ?? 0;
    while (next && p + 4 <= hdr.length) { const c = hdr.readUInt32LE(p); p += 4; next = c & 1; const chunkSize = (c >> 1) & 0xffffff, type = (c >> 25) & 0x7f; if (type === 1 && chunkSize >= 1) channels; if (type === 2 && chunkSize >= 4) frequency = hdr.readUInt32LE(p); p += chunkSize; }
    samples.push({ index: i, frequency, channels, dataOffset, samples: sampleCount });
  }
  for (let i = 0; i < samples.length; i++) samples[i].size = (i + 1 < samples.length ? samples[i + 1].dataOffset : dataSize) - samples[i].dataOffset;
  if (names) { let q = 0; for (let i = 0; i < samples.length && q + 4 <= names.length; i++) { const off = names.readUInt32LE(4 * i); const e = names.indexOf(0, off); samples[i].name = names.toString('utf8', off, e < 0 ? names.length : e); q += 4; } }
  const codec = FSB_CODECS[mode] ?? `codec ${mode}`;
  const entries = samples.map(s => ({ path: `samples/${s.name ?? `sample_${s.index}`}.${codec === 'VORBIS' ? 'fsbvorbis' : codec === 'MPEG' ? 'mp3' : codec.startsWith('PCM') ? 'pcm' : codec.toLowerCase()}`, offset: dataBase + s.dataOffset, size: s.size, frequency: s.frequency, channels: s.channels, samples: s.samples, codec }));
  return { fsbVersion: version, codec, samples: samples.length, entries, totalDataSize: dataSize, note: codec === 'VORBIS' ? 'FSB5 Vorbis packets have no Ogg headers (FMOD keeps the setup tables keyed by CRC); extracted .fsbvorbis needs a tool with FMOD\'s header table (e.g. vgmstream) to become .ogg.' : codec.startsWith('PCM') ? 'raw PCM: wrap in a WAV header with the listed frequency/channels.' : `${codec} data as stored.` };
}

export async function readFmodBank(abs, size) {
  const head = await readAt(abs, 0, 12);
  if (head.toString('latin1', 0, 4) !== 'RIFF' || head.toString('latin1', 8, 12) !== 'FEV ') throw new RPError('BAD_FORMAT', 'Not an FMOD Studio bank (RIFF FEV).');
  const chunks = [];
  let p = 12;
  let fsb = null;
  const strings = [];
  while (p + 8 <= size) {
    const h = await readAt(abs, p, 8);
    const id = h.toString('latin1', 0, 4), len = h.readUInt32LE(4);
    chunks.push({ id, size: len });
    if (id === 'SND ') {
      // Sample data chunk: FSB5 sits at a 32-byte aligned offset inside.
      const scan = await readAt(abs, p + 8, Math.min(len, 64));
      const at = scan.indexOf('FSB5');
      if (at >= 0) fsb = await readFsb5(abs, p + 8 + at, len);
    }
    if (id === 'LIST' || id === 'PROJ' || id === 'BNKI') { const b = await readAt(abs, p + 8, Math.min(len, 65536)); for (const m of b.toString('latin1').matchAll(/[\x20-\x7e]{6,}/g)) if (/^[\w:/ .-]+$/.test(m[0])) strings.push(m[0]); }
    p += 8 + len + (len & 1);
  }
  const events = strings.filter(s => /^event:\//.test(s)), buses = strings.filter(s => /^bus:\//.test(s)), vcas = strings.filter(s => /^vca:\//.test(s));
  return { format: 'fmod-bank', chunks, entries: fsb?.entries ?? [], fsb: fsb ? { version: fsb.fsbVersion, codec: fsb.codec, samples: fsb.samples, note: fsb.note } : null, events: [...new Set(events)].slice(0, 500), buses: [...new Set(buses)], vcas: [...new Set(vcas)], note: events.length ? 'Event paths come from the bank\'s string table; the authoring project (.fspro) is needed for parameters and logic. Port by recreating events in the target engine\'s audio system with the same names.' : 'No event names in this bank (strings bank missing: Master.strings.bank holds the GUID→path table). Samples are listed from the embedded FSB5.' };
}

const HIRC_TYPES = { 1: 'settings', 2: 'sound', 3: 'action', 4: 'event', 5: 'random/sequence container', 6: 'switch container', 7: 'actor-mixer', 8: 'audio bus', 9: 'blend container', 10: 'music segment', 11: 'music track', 12: 'music switch', 13: 'music playlist', 14: 'attenuation', 15: 'dialogue event', 16: 'fx share set', 17: 'fx custom', 18: 'aux bus', 19: 'lfo', 20: 'envelope', 21: 'audio device', 22: 'time mod' };
export async function readWwiseBank(abs, size) {
  const head = await readAt(abs, 0, 8);
  if (head.toString('latin1', 0, 4) !== 'BKHD') throw new RPError('BAD_FORMAT', 'Not a Wwise sound bank (BKHD).');
  const chunks = [];
  let p = 0, bankVersion = null, bankId = null, didx = [], dataOffset = null, hirc = {}, hircCount = 0;
  while (p + 8 <= size) {
    const h = await readAt(abs, p, 8);
    const id = h.toString('latin1', 0, 4), len = h.readUInt32LE(4);
    chunks.push({ id, size: len });
    if (id === 'BKHD') { const b = await readAt(abs, p + 8, Math.min(len, 16)); bankVersion = b.readUInt32LE(0); bankId = b.readUInt32LE(4); }
    if (id === 'DIDX') { const b = await readAt(abs, p + 8, len); for (let q = 0; q + 12 <= b.length; q += 12) didx.push({ id: b.readUInt32LE(q), offset: b.readUInt32LE(q + 4), size: b.readUInt32LE(q + 8) }); }
    if (id === 'DATA') dataOffset = p + 8;
    if (id === 'HIRC') { const b = await readAt(abs, p + 8, Math.min(len, 4 * 1024 * 1024)); hircCount = b.readUInt32LE(0); let q = 4; for (let i = 0; i < hircCount && q + 9 <= b.length; i++) { const type = b[q], l = b.readUInt32LE(q + 1); const name = HIRC_TYPES[type] ?? `type ${type}`; hirc[name] = (hirc[name] ?? 0) + 1; q += 5 + l; } }
    p += 8 + len;
  }
  // SoundbanksInfo.xml next to the bank maps IDs to names when the project exported it.
  const names = new Map();
  for (const cand of ['SoundbanksInfo.xml', '../SoundbanksInfo.xml']) {
    const f = path.resolve(path.dirname(abs), cand);
    const xml = await fs.readFile(f, 'utf8').catch(() => null);
    if (!xml) continue;
    for (const m of xml.matchAll(/<(?:File|Event|Sound)\s+Id="(\d+)"[^>]*>\s*(?:<ShortName>([^<]*)<\/ShortName>|<Path>([^<]*)<\/Path>)?/g)) names.set(Number(m[1]), m[2] ?? m[3] ?? null);
    break;
  }
  const entries = dataOffset != null ? didx.map(d => ({ path: `media/${names.get(d.id) ? names.get(d.id).replace(/\.wav$/i, '') : d.id}.wem`, offset: dataOffset + d.offset, size: d.size, wemId: d.id })) : [];
  return { format: 'wwise-bank', bankVersion, bankId, chunks, entries, objects: hirc, objectCount: hircCount, namedIds: names.size, note: 'Embedded media are .wem (Wwise Vorbis/ADPCM/PCM/Opus): convert with vgmstream or ww2ogg+revorb. Events and sounds are hashed IDs; SoundbanksInfo.xml (when the project exported it) gives the names. Streamed media live as separate .wem files next to the bank.' };
}

// ------------------------------------------------------------------------------------------------ Unreal .pak
const PAK_MAGIC = Buffer.from([0xe1, 0x12, 0x6f, 0x5a]);
export async function readUnrealPak(abs, size) {
  const tailLen = Math.min(size, 1024);
  const tail = await readAt(abs, size - tailLen, tailLen);
  let m = -1;
  // The footer layout differs per version; the magic is 4 bytes before the version field.
  for (let i = tail.length - 4; i >= 0; i--) if (tail[i] === 0xe1 && tail[i + 1] === 0x12 && tail[i + 2] === 0x6f && tail[i + 3] === 0x5a) { const v = tail.readUInt32LE(i + 4); if (v >= 1 && v <= 12 && i + 28 <= tail.length) { m = i; break; } }
  if (m < 0) throw new RPError('BAD_FORMAT', 'No Unreal pak footer found.');
  const version = tail.readUInt32LE(m + 4);
  const indexOffset = Number(tail.readBigUInt64LE(m + 8)), indexSize = Number(tail.readBigUInt64LE(m + 16));
  const encryptedIndex = version >= 4 ? tail[m - 1] === 1 : false;
  const encryptionGuid = version >= 7 ? tail.subarray(m - 17, m - 1).toString('hex') : null;
  const compressionMethods = [];
  if (version >= 8) { const n = version >= 10 ? 5 : 4; const base = m + 8 + 8 + 8 + 20; for (let i = 0; i < n && base + 32 * (i + 1) <= tail.length; i++) { const s = tail.toString('latin1', base + 32 * i, base + 32 * (i + 1)).replace(/\0.*$/s, ''); if (s) compressionMethods.push(s); } }
  const methods = version >= 8 ? ['None', ...compressionMethods] : ['None', 'Zlib', 'Gzip', 'Custom', 'Oodle'];
  const base = { format: 'unreal-pak', pakVersion: version, indexOffset, indexSize, encryptedIndex, ...(encryptionGuid && !/^0+$/.test(encryptionGuid) ? { encryptionKeyGuid: encryptionGuid } : {}), compressionMethods: methods.slice(1) };
  if (encryptedIndex) return { ...base, entries: [], note: 'The pak index is AES-encrypted: entries cannot be listed and nothing is decrypted here. Port from the Unreal project source (Content/, Source/).' };
  if (indexOffset <= 0 || indexOffset + indexSize > size || indexSize > 512 * 1024 * 1024) throw new RPError('BAD_FORMAT', 'pak index outside the file.');
  const idx = await readAt(abs, indexOffset, indexSize);
  let p = 0;
  const fstring = () => { const n = idx.readInt32LE(p); p += 4; if (n < 0) { const s = idx.toString('utf16le', p, p + (-n) * 2 - 2); p += (-n) * 2; return s; } const s = idx.toString('utf8', p, p + Math.max(0, n - 1)); p += n; return s; };
  const mountPoint = fstring();
  const count = idx.readInt32LE(p); p += 4;
  const entries = [];
  const readEntry = (buf, q, ver) => {
    const e = {};
    e.offset = Number(buf.readBigUInt64LE(q)); q += 8;
    e.compressedSize = Number(buf.readBigUInt64LE(q)); q += 8;
    e.size = Number(buf.readBigUInt64LE(q)); q += 8;
    e.compression = ver >= 8 ? buf.readUInt32LE(q) : buf.readUInt32LE(q); q += 4;
    if (ver <= 1) { q += 8; } // timestamp
    q += 20; // sha1
    if (ver >= 3) {
      if (e.compression !== 0) { const blocks = buf.readUInt32LE(q); q += 4; e.blocks = []; for (let i = 0; i < blocks; i++) { e.blocks.push({ start: Number(buf.readBigUInt64LE(q)), end: Number(buf.readBigUInt64LE(q + 8)) }); q += 16; } }
      e.encrypted = buf[q] === 1; q += 1;
      e.blockSize = buf.readUInt32LE(q); q += 4;
    }
    return { entry: e, next: q };
  };
  if (version < 10) {
    for (let i = 0; i < count && p < idx.length; i++) {
      const name = fstring();
      const { entry, next } = readEntry(idx, p, version);
      p = next;
      entries.push({ path: (mountPoint.replace(/^\.\.\/\.\.\/\.\.\//, '') + name).replace(/^\/+/, ''), ...entry, compressionMethod: methods[entry.compression] ?? `method ${entry.compression}` });
    }
  } else {
    // v10/11: path hash index + full directory index with encoded entries.
    p += 8; // path hash seed
    const hasPathHash = idx.readInt32LE(p); p += 4;
    if (hasPathHash) p += 8 + 8 + 20;
    const hasFullDir = idx.readInt32LE(p); p += 4;
    let fdOffset = 0, fdSize = 0;
    if (hasFullDir) { fdOffset = Number(idx.readBigUInt64LE(p)); fdSize = Number(idx.readBigUInt64LE(p + 8)); p += 16 + 20; }
    const encodedSize = idx.readInt32LE(p); p += 4;
    const encoded = idx.subarray(p, p + encodedSize); p += encodedSize;
    const decode = off => {
      const flags = encoded.readUInt32LE(off); let q = off + 4;
      const compression = (flags >> 23) & 0x3f, encrypted = !!(flags & (1 << 22)), blockCount = (flags >> 6) & 0xffff, blockSizeBits = flags & 0x3f;
      const offset32 = !!(flags & (1 << 31)), size32 = !!(flags & (1 << 30)), csize32 = !!(flags & (1 << 29));
      const offset = offset32 ? encoded.readUInt32LE(q) : Number(encoded.readBigUInt64LE(q)); q += offset32 ? 4 : 8;
      const size = size32 ? encoded.readUInt32LE(q) : Number(encoded.readBigUInt64LE(q)); q += size32 ? 4 : 8;
      let compressedSize = size;
      if (compression !== 0) { compressedSize = csize32 ? encoded.readUInt32LE(q) : Number(encoded.readBigUInt64LE(q)); q += csize32 ? 4 : 8; }
      return { offset, size, compressedSize, compression, encrypted, blocks: blockCount, blockSize: blockSizeBits === 0x3f ? compressedSize : blockSizeBits << 11 };
    };
    if (hasFullDir && fdOffset >= indexOffset && fdOffset + fdSize <= size) {
      const fd = await readAt(abs, fdOffset, fdSize);
      let q = 0;
      const fstr = () => { const n = fd.readInt32LE(q); q += 4; if (n < 0) { const s = fd.toString('utf16le', q, q + (-n) * 2 - 2); q += (-n) * 2; return s; } const s = fd.toString('utf8', q, q + Math.max(0, n - 1)); q += n; return s; };
      const dirs = fd.readInt32LE(q); q += 4;
      for (let d = 0; d < dirs && q < fd.length; d++) {
        const dir = fstr();
        const files = fd.readInt32LE(q); q += 4;
        for (let f = 0; f < files && q < fd.length; f++) {
          const name = fstr();
          const encOff = fd.readInt32LE(q); q += 4;
          if (encOff < 0 || encOff + 4 > encoded.length) { entries.push({ path: `${mountPoint}${dir}${name}`.replace(/^\.\.\/\.\.\/\.\.\//, '').replace(/^\/+/, ''), size: null, note: 'entry not encoded (listed in the path hash index only)' }); continue; }
          const e = decode(encOff);
          entries.push({ path: `${mountPoint}${dir}${name}`.replace(/^\.\.\/\.\.\/\.\.\//, '').replace(/^\/+/, '').replace(/\/\.\//g, '/'), ...e, compressionMethod: methods[e.compression] ?? `method ${e.compression}` });
        }
      }
    } else base.note = 'No full directory index (pak built with -nodirectoryindex): only the count is known.';
    base.encodedEntries = count;
  }
  // Data position: each entry's data is preceded by a copy of its FPakEntry header.
  for (const e of entries) {
    if (e.size == null) continue;
    const headerLen = 8 + 8 + 8 + 4 + 20 + (version <= 1 ? 8 : 0) + (version >= 3 ? 1 + 4 + (e.compression ? 4 + 16 * (e.blocks?.length ?? e.blocks ?? 0) : 0) : 0);
    e.dataOffset = e.offset + headerLen;
    if (e.encrypted) { e.encryptedData = true; }
    e.extractable = !e.encrypted && (e.compression === 0 || /^(Zlib|Gzip)$/i.test(e.compressionMethod));
    if (e.extractable && e.compression === 0) { e.offset = e.dataOffset; }
    else if (e.extractable) { e.zlibBlocks = (Array.isArray(e.blocks) ? e.blocks : []).map(b => ({ start: e.offset + b.start - (version >= 5 ? e.offset : 0), end: e.offset + b.end - (version >= 5 ? e.offset : 0) })); if (!e.zlibBlocks.length) e.extractable = false; e.offset = e.dataOffset; }
    else e.offset = e.dataOffset;
  }
  const byExt = {};
  for (const e of entries) { const ext = path.extname(e.path).toLowerCase() || '(none)'; byExt[ext] = (byExt[ext] ?? 0) + 1; }
  const uassets = entries.filter(e => /\.uasset$/i.test(e.path)).length, umaps = entries.filter(e => /\.umap$/i.test(e.path)).length;
  return { ...base, mountPoint, entries, unreal: { uassets, umaps, note: `${uassets} .uasset (${umaps} maps). Cooked .uasset/.uexp hold serialized UObjects, not source: Blueprints are bytecode, C++ is compiled into the game binary. Port from the project (Content/*.uasset in the editor, Source/) when you have it; from a pak, re_binary on the executable plus asset names and this listing give the rebuild map.` }, note: entries.some(e => e.encrypted) ? 'Some entries are AES-encrypted: they are listed, never decrypted.' : entries.some(e => e.compression && !e.extractable) ? 'Oodle/LZ4-compressed entries are listed; only stored and Zlib entries extract here.' : undefined };
}

// ------------------------------------------------------------------------------------------------ Flash SWF
const SWF_TAGS = { 0: 'End', 1: 'ShowFrame', 2: 'DefineShape', 4: 'PlaceObject', 5: 'RemoveObject', 6: 'DefineBits', 7: 'DefineButton', 8: 'JPEGTables', 9: 'SetBackgroundColor', 10: 'DefineFont', 11: 'DefineText', 12: 'DoAction', 13: 'DefineFontInfo', 14: 'DefineSound', 15: 'StartSound', 17: 'DefineButtonSound', 18: 'SoundStreamHead', 19: 'SoundStreamBlock', 20: 'DefineBitsLossless', 21: 'DefineBitsJPEG2', 22: 'DefineShape2', 23: 'DefineButtonCxform', 24: 'Protect', 26: 'PlaceObject2', 28: 'RemoveObject2', 32: 'DefineShape3', 33: 'DefineText2', 34: 'DefineButton2', 35: 'DefineBitsJPEG3', 36: 'DefineBitsLossless2', 37: 'DefineEditText', 39: 'DefineSprite', 43: 'FrameLabel', 45: 'SoundStreamHead2', 46: 'DefineMorphShape', 48: 'DefineFont2', 56: 'ExportAssets', 57: 'ImportAssets', 58: 'EnableDebugger', 59: 'DoInitAction', 60: 'DefineVideoStream', 61: 'VideoFrame', 62: 'DefineFontInfo2', 64: 'EnableDebugger2', 65: 'ScriptLimits', 66: 'SetTabIndex', 69: 'FileAttributes', 70: 'PlaceObject3', 71: 'ImportAssets2', 73: 'DefineFontAlignZones', 74: 'CSMTextSettings', 75: 'DefineFont3', 76: 'SymbolClass', 77: 'Metadata', 78: 'DefineScalingGrid', 82: 'DoABC', 83: 'DefineShape4', 84: 'DefineMorphShape2', 86: 'DefineSceneAndFrameLabelData', 87: 'DefineBinaryData', 88: 'DefineFontName', 89: 'StartSound2', 90: 'DefineBitsJPEG4', 91: 'DefineFont4' };

function abcStrings(abc) {
  // abcFile: minor u16, major u16, cpool: int_count + ints (u30), uint, double (u64), string_count + strings (u30 len + utf8)
  let p = 4;
  const u30 = () => { let r = 0, s = 0; for (let i = 0; i < 5; i++) { const b = abc[p++]; r |= (b & 0x7f) << s; s += 7; if (!(b & 0x80)) break; } return r >>> 0; };
  const skipArr = (count, each) => { for (let i = 0; i < Math.max(0, count - 1); i++) each(); };
  skipArr(u30(), u30); skipArr(u30(), u30); const dc = u30(); p += Math.max(0, dc - 1) * 8;
  const sc = u30(); const out = [];
  for (let i = 0; i < sc - 1 && p < abc.length; i++) { const n = u30(); out.push(abc.toString('utf8', p, p + n)); p += n; }
  return out;
}

export async function readSwf(abs, size) {
  const head = await readAt(abs, 0, 8);
  const sig = head.toString('latin1', 0, 3);
  if (!['FWS', 'CWS', 'ZWS'].includes(sig)) throw new RPError('BAD_FORMAT', 'Not a SWF file.');
  const version = head[3], fileLength = head.readUInt32LE(4);
  let body;
  if (sig === 'FWS') body = await readAt(abs, 8, Math.min(size - 8, 256 * 1024 * 1024));
  else if (sig === 'CWS') { try { body = zlib.inflateSync(await readAt(abs, 8, size - 8)); } catch { throw new RPError('BAD_FORMAT', 'SWF zlib body did not inflate.'); } }
  else return { format: 'swf', swfVersion: version, compression: 'LZMA', fileLength, entries: [], note: 'ZWS (LZMA-compressed) SWF: Node has no LZMA decoder; decompress with 7-Zip/xz into FWS first (header: FWS + version + length, then the raw body), then run re_archive again.' };
  // Header: RECT (nbits), frame rate (fixed 8.8), frame count.
  let p = 0;
  const nbits = body[0] >> 3;
  p = Math.ceil((5 + nbits * 4) / 8);
  const twips = (() => { let bit = 5; const read = () => { let v = 0; for (let i = 0; i < nbits; i++) { const b = (body[bit >> 3] >> (7 - (bit & 7))) & 1; v = (v << 1) | b; bit++; } return v; }; return [read(), read(), read(), read()]; })();
  const frameRate = body.readUInt16LE(p) / 256; p += 2;
  const frameCount = body.readUInt16LE(p); p += 2;
  const tags = {}, entries = [], symbols = [], labels = [], classes = new Set(), strings = new Set();
  let as3 = false, as2 = 0;
  for (let guard = 0; guard < 1_000_000 && p + 2 <= body.length; guard++) {
    const h = body.readUInt16LE(p); p += 2;
    const code = h >> 6; let len = h & 0x3f;
    if (len === 0x3f) { len = body.readUInt32LE(p); p += 4; }
    const name = SWF_TAGS[code] ?? `tag${code}`;
    tags[name] = (tags[name] ?? 0) + 1;
    const data = body.subarray(p, p + len);
    if (code === 0) break;
    if (code === 82) { as3 = true; const flags = data.readUInt32LE(0); void flags; const e = data.indexOf(0, 4); const abcName = data.toString('utf8', 4, e); const abc = data.subarray(e + 1); try { for (const s of abcStrings(abc)) if (/^[A-Za-z_$][\w$]*(?:[.:][A-Za-z_$][\w$]*)*$/.test(s) && s.length > 2) { strings.add(s); if (/^[A-Z]/.test(s.split(/[.:]/).at(-1)) && s.length < 80) classes.add(s); } } catch { /* partial abc */ } entries.push({ path: `abc/${abcName || `script_${entries.length}`}.abc`, offset: sig === 'FWS' ? 8 + p + e + 1 : null, size: abc.length, inflated: sig !== 'FWS' }); }
    if (code === 12 || code === 59) as2++;
    if (code === 76 || code === 56) { let q = 0; const n = data.readUInt16LE(q); q += 2; for (let i = 0; i < n && q < data.length; i++) { const id = data.readUInt16LE(q); q += 2; const e = data.indexOf(0, q); symbols.push({ id, name: data.toString('utf8', q, e) }); q = e + 1; } }
    if (code === 43) labels.push(data.toString('utf8', 0, data.indexOf(0) < 0 ? data.length : data.indexOf(0)));
    if (code === 21 || code === 35 || code === 90) { const id = data.readUInt16LE(0); let off = 2; if (code === 35 || code === 90) off += 4; const img = data.subarray(off); const isPng = img[0] === 0x89, isGif = img.toString('latin1', 0, 3) === 'GIF'; entries.push({ path: `images/image_${id}.${isPng ? 'png' : isGif ? 'gif' : 'jpg'}`, offset: sig === 'FWS' ? 8 + p + off : null, size: code === 21 ? img.length : data.readUInt32LE(2), inflated: sig !== 'FWS', characterId: id }); }
    if (code === 20 || code === 36) { const id = data.readUInt16LE(0); entries.push({ path: `images/lossless_${id}.zlib-bitmap`, offset: sig === 'FWS' ? 8 + p : null, size: len, inflated: sig !== 'FWS', characterId: id, note: `format ${data[2]} ${data.readUInt16LE(3)}x${data.readUInt16LE(5)}: zlib bitmap, convert by hand` }); }
    if (code === 14) { const id = data.readUInt16LE(0); const fmt = data[2] >> 4; const codec = ['PCM', 'ADPCM', 'MP3', 'PCM-LE', 'Nellymoser16', 'Nellymoser8', 'Nellymoser', null, null, null, null, 'Speex'][fmt] ?? `codec ${fmt}`; entries.push({ path: `sounds/sound_${id}.${codec === 'MP3' ? 'mp3' : 'raw'}`, offset: sig === 'FWS' ? 8 + p + 7 + (codec === 'MP3' ? 2 : 0) : null, size: len - 7 - (codec === 'MP3' ? 2 : 0), inflated: sig !== 'FWS', characterId: id, codec }); }
    if (code === 87) { const id = data.readUInt16LE(0); entries.push({ path: `binary/data_${id}.bin`, offset: sig === 'FWS' ? 8 + p + 6 : null, size: len - 6, inflated: sig !== 'FWS', characterId: id }); }
    p += len;
  }
  const symbolClasses = symbols.map(s => s.name);
  const documentClass = symbols.find(s => s.id === 0)?.name ?? null;
  return {
    format: 'swf', swfVersion: version, compression: sig === 'CWS' ? 'zlib' : 'none', fileLength, stage: { width: (twips[1] - twips[0]) / 20, height: (twips[3] - twips[2]) / 20, frameRate, frameCount }, tags, entries,
    actionScript: as3 ? 'AS3 (DoABC)' : as2 ? 'AS2 (DoAction)' : 'none', documentClass, symbolClasses: symbolClasses.slice(0, 300), frameLabels: labels.slice(0, 300), classes: [...classes].slice(0, 500), identifierStrings: strings.size,
    note: sig === 'CWS' ? 'Compressed SWF: entries are listed from the inflated body; to extract, save the inflated body as FWS (re_archive action:"extract" writes it) and extract from that.' : 'Images, sounds and ABC blocks extract as-is; shapes, sprites and timelines are vector/timeline data (rebuild from the symbol and class names with re_blueprint; Ruffle can run the original).',
  };
}

// ------------------------------------------------------------------------------------------------ web exports
/** Unity WebGL Build/*.data (UnityWebData1.0), also gzip/brotli-compressed (.data.gz, .data.br, .unityweb). */
export async function readUnityWebData(abs) {
  let buf = await fs.readFile(abs);
  const layers = [];
  if (buf[0] === 0x1f && buf[1] === 0x8b) { buf = zlib.gunzipSync(buf); layers.push('gzip'); }
  else if (!buf.subarray(0, 16).toString('latin1').startsWith('UnityWebData')) { try { const b = zlib.brotliDecompressSync(buf); if (b.subarray(0, 16).toString('latin1').startsWith('UnityWebData')) { buf = b; layers.push('brotli'); } } catch { /* not brotli */ } }
  if (!buf.subarray(0, 16).toString('latin1').startsWith('UnityWebData')) throw new RPError('BAD_FORMAT', 'Not a Unity WebGL data file (UnityWebData1.0).');
  const headerEnd = buf.indexOf(0, 0) + 1;
  const headerSize = buf.readUInt32LE(headerEnd);
  let p = headerEnd + 4;
  const entries = [];
  while (p < headerSize) {
    const offset = buf.readUInt32LE(p), size = buf.readUInt32LE(p + 4), nl = buf.readUInt32LE(p + 8);
    const name = buf.toString('utf8', p + 12, p + 12 + nl);
    p += 12 + nl;
    entries.push({ path: name, offset, size, ...(layers.length ? { inMemory: true } : {}) });
  }
  const meta = entries.find(e => /global-metadata\.dat$/.test(e.path));
  return { format: 'unity-webgl-data', compression: layers[0] ?? 'none', entries, data: layers.length ? buf : null,
    unity: { il2cpp: !!meta, note: meta ? 'IL2CPP build: Il2CppData/Metadata/global-metadata.dat holds type, method and field names (re_il2cpp); code is in the .wasm (re_binary).' : 'Mono/older build or no metadata entry.' },
    note: 'data.unity3d / level files / sharedassets are Unity serialized files (open them with an asset tool); Resources and StreamingAssets entries are plain files.' };
}

/** Emscripten file_packager output: the .data blob plus the loader .js that lists files with start/end offsets. */
export async function readEmscriptenData(abs) {
  const dir = path.dirname(abs), base = path.basename(abs).replace(/\.data$/i, '');
  const candidates = [`${base}.js`, `${base}.loader.js`, 'index.js', ...(await fs.readdir(dir).catch(() => [])).filter(f => f.endsWith('.js'))];
  for (const c of [...new Set(candidates)]) {
    const js = await fs.readFile(path.join(dir, c), 'utf8').catch(() => null);
    if (!js || !/loadPackage|remote_package_size|"files"\s*:\s*\[/.test(js)) continue;
    const m = js.match(/loadPackage\(\s*(\{[\s\S]*?"remote_package_size"\s*:\s*\d+[^}]*\})\s*\)/) ?? js.match(/(\{"files"\s*:\s*\[[\s\S]*?\][^}]*\})/);
    if (!m) continue;
    let meta; try { meta = JSON.parse(m[1]); } catch { continue; }
    const entries = (meta.files ?? []).map(f => ({ path: String(f.filename).replace(/^\/+/, ''), offset: f.start, size: f.end - f.start, ...(f.audio ? { audio: true } : {}) }));
    const engine = entries.some(e => /\.pck$/.test(e.path)) ? 'Godot (pack inside: re_archive it after extracting)' : entries.some(e => /love|main\.lua$/.test(e.path)) ? 'LÖVE' : entries.some(e => /\.rpa|renpy/.test(e.path)) ? "Ren'Py web" : entries.some(e => /\.py$/.test(e.path)) ? 'Python (Pyodide/pygbag)' : null;
    return { format: 'emscripten-data', loader: c, packageSize: meta.remote_package_size ?? null, entries, ...(engine ? { engine } : {}), note: meta.package_uuid ? `package ${meta.package_uuid}` : undefined };
  }
  throw new RPError('BAD_FORMAT', 'Emscripten .data needs its loader .js next to it (the file that calls loadPackage with the file list).');
}
