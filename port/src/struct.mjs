// re_struct: works out the layout of an unknown binary format from several sample files of the same kind.
// One file says little: every byte could be a constant or a value. Several files of one format say a lot: bytes that
// are the same everywhere are the format, bytes that differ are the data, and a number that follows the file size, the
// number of records, a checksum of the rest or the length of the text behind it gives its own meaning away.
// The result is a hypothesis with the evidence per field, and a Kaitai Struct (.ksy) draft to refine.
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { RPError, requireFile, requireDir, readAt, walk, compileMatcher } from './util.mjs';

const MAX_SAMPLES = 32;
const MAX_FIELDS = 200;
const hex = b => [...b].map(x => x.toString(16).padStart(2, '0')).join(' ');
const printable = b => b.length > 0 && [...b].every(x => (x >= 0x20 && x < 0x7f) || x === 9 || x === 10 || x === 13);
const text = b => b.toString('latin1');
const same = list => list.every(v => v === list[0]);

const INTS = [
  { type: 'u4le', w: 4, read: (b, o) => b.readUInt32LE(o) },
  { type: 'u4be', w: 4, read: (b, o) => b.readUInt32BE(o) },
  { type: 'u8le', w: 8, read: (b, o) => Number(b.readBigUInt64LE(o)) },
  { type: 'u2le', w: 2, read: (b, o) => b.readUInt16LE(o) },
  { type: 'u2be', w: 2, read: (b, o) => b.readUInt16BE(o) },
];
const intOf = type => INTS.find(i => i.type === type);

function adler32(buf) {
  let a = 1, b = 0;
  for (let i = 0; i < buf.length; i++) { a = (a + buf[i]) % 65521; b = (b + a) % 65521; }
  return ((b << 16) | a) >>> 0;
}

/** A varying number that is explained by the file: its size, a record count, a checksum, a time or a place in it. */
function relation(samples, cur, int) {
  const { w, read } = int;
  if (samples.some((s, i) => cur[i] + w > s.buf.length)) return null;
  const vals = samples.map((s, i) => read(s.buf, cur[i]));
  if (same(vals)) return null;
  const sizes = samples.map(s => s.size);
  const whole = samples.every(s => s.buf.length === s.size);

  // value = size - k: the length of the file, or of what follows a header of k bytes
  const k = sizes[0] - vals[0];
  if (k >= 0 && sizes.every((sz, i) => sz - vals[i] === k)) {
    return { vals, role: 'length', note: k === 0 ? 'the size of the file' : `the size of the file minus ${k} (what follows a ${k}-byte header${samples.every((s, i) => cur[i] + w === k) ? ', which ends right after this field' : ''})` };
  }
  // The same against the bytes that follow the field: holds after a text of different lengths too.
  const rest = samples.map((s, i) => s.size - cur[i] - w);
  const kr = rest[0] - vals[0];
  if (kr >= 0 && rest.every((r, i) => r - vals[i] === kr)) {
    return { vals, role: 'length', note: kr === 0 ? 'the number of bytes after this field, to the end of the file' : `the number of bytes after this field minus ${kr}` };
  }
  // value * stride + c = what follows: a number of fixed-size records
  const j = vals.findIndex(v => v !== vals[0]);
  const stride = (rest[j] - rest[0]) / (vals[j] - vals[0]);
  if (samples.length >= 3 && Number.isInteger(stride) && stride > 1 && stride <= 65536) {
    const c = rest[0] - vals[0] * stride;
    if (c >= 0 && rest.every((r, i) => vals[i] * stride + c === r)) {
      return { vals, role: 'count', note: `a count of records of ${stride} bytes (count x ${stride}${c ? ` + ${c}` : ''} = the bytes after this field, in every sample)`, stride, extra: c };
    }
  }
  if (w === 4 && whole) {
    const sums = [
      ['CRC-32', b => zlib.crc32(b)],
      ['Adler-32', adler32],
    ];
    for (const [name, fn] of sums) {
      const spans = [
        ['the bytes after this field', (s, i) => s.buf.subarray(cur[i] + 4)],
        ['the bytes before this field', (s, i) => s.buf.subarray(0, cur[i])],
        ['the whole file with this field set to zero', (s, i) => { const c = Buffer.from(s.buf); c.fill(0, cur[i], cur[i] + 4); return c; }],
      ];
      for (const [what, span] of spans) {
        if (samples.every((s, i) => span(s, i).length > 0 && fn(span(s, i)) >>> 0 === vals[i])) return { vals, role: 'checksum', note: `${name} of ${what}` };
      }
    }
  }
  // 2000-01-01 … 2040-01-01, in seconds or milliseconds
  const asText = samples.every((s, i) => printable(s.buf.subarray(cur[i], cur[i] + w)));
  if (w === 4 && !asText && vals.every(v => v >= 946684800 && v < 2208988800)) return { vals, role: 'time', note: 'Unix time in seconds (every sample is a date between 2000 and 2040)' };
  if (w === 8 && vals.every(v => v >= 946684800000 && v < 2208988800000)) return { vals, role: 'time', note: 'Unix time in milliseconds (every sample is a date between 2000 and 2040)' };
  // a place in the file where every sample has the same bytes
  if (w >= 4 && vals.every((v, i) => v > cur[i] + w && v + 4 <= samples[i].buf.length)) {
    const at = samples.map((s, i) => s.buf.subarray(vals[i], vals[i] + 4));
    if (at.every(b => b.equals(at[0])) && at[0].some(x => x !== 0) && at[0].some(x => x !== 0xff)) {
      return { vals, role: 'offset', note: `an offset into the file: every sample has ${printable(at[0]) ? JSON.stringify(text(at[0])) : hex(at[0])} there` };
    }
  }
  return null;
}

/** Text with its length in front (u1, u2 or u4), with a different length in at least one sample. */
function prefixedString(samples, cur) {
  for (const cand of [...INTS.filter(i => i.w <= 4), { type: 'u1', w: 1, read: (b, o) => b[o] }]) {
    const { w, read } = cand;
    if (samples.some((s, i) => cur[i] + w > s.buf.length)) continue;
    const lens = samples.map((s, i) => read(s.buf, cur[i]));
    if (same(lens) || lens.some(n => n < 1 || n > 65535)) continue;
    if (samples.some((s, i) => cur[i] + w + lens[i] > s.buf.length)) continue;
    const bodies = samples.map((s, i) => s.buf.subarray(cur[i] + w, cur[i] + w + lens[i]));
    // Trailing NULs are padding some writers count in the length.
    const trimmed = bodies.map(b => { let e = b.length; while (e > 0 && b[e - 1] === 0) e--; return b.subarray(0, e); });
    if (!trimmed.every(printable)) continue;
    if (Math.max(...trimmed.map(b => b.length)) < (w === 1 ? 4 : 3)) continue;
    return { lenType: cand.type, w, lens, values: trimmed.map(text) };
  }
  return null;
}

/** NUL-terminated text of different lengths. */
function cString(samples, cur) {
  const ends = samples.map((s, i) => s.buf.indexOf(0, cur[i]));
  if (ends.some((e, i) => e < 0 || e - cur[i] < 2 || e - cur[i] > 1024)) return null;
  const bodies = samples.map((s, i) => s.buf.subarray(cur[i], ends[i]));
  if (!bodies.every(printable) || same(bodies.map(b => b.length)) || Math.max(...bodies.map(b => b.length)) < 4) return null;
  return { lens: bodies.map(b => b.length + 1), values: bodies.map(text) };
}

const byteAt = (samples, cur, d) => samples.map((s, i) => s.buf[cur[i] + d]);
const left = (samples, cur) => Math.min(...samples.map((s, i) => s.buf.length - cur[i]));

function entropy(buf) {
  if (!buf.length) return 0;
  const n = new Array(256).fill(0);
  for (const b of buf) n[b]++;
  let e = 0;
  for (const c of n) if (c) { const p = c / buf.length; e -= p * Math.log2(p); }
  return Math.round(e * 100) / 100;
}

/** A digest or checksum at the very end of the file, over everything before it. */
function trailer(samples) {
  if (samples.some(s => s.buf.length !== s.size)) return null;
  const tries = [
    ['CRC-32 (little-endian)', 4, b => { const o = Buffer.alloc(4); o.writeUInt32LE(zlib.crc32(b)); return o; }],
    ['CRC-32 (big-endian)', 4, b => { const o = Buffer.alloc(4); o.writeUInt32BE(zlib.crc32(b)); return o; }],
    ['Adler-32 (big-endian)', 4, b => { const o = Buffer.alloc(4); o.writeUInt32BE(adler32(b)); return o; }],
    ['MD5', 16, b => crypto.createHash('md5').update(b).digest()],
    ['SHA-1', 20, b => crypto.createHash('sha1').update(b).digest()],
    ['SHA-256', 32, b => crypto.createHash('sha256').update(b).digest()],
  ];
  for (const [name, w, fn] of tries) {
    if (samples.every(s => s.size > w && fn(s.buf.subarray(0, s.size - w)).equals(s.buf.subarray(s.size - w)))) return { bytes: w, note: `the last ${w} bytes are the ${name} of everything before them` };
  }
  return null;
}

/** The columns of a table of fixed-size records, from every record of every sample. */
function recordLayout(samples, cur, counts, stride) {
  const rows = [];
  const first = new Set(); // rows that start a sample: a value may start over there
  samples.forEach((s, i) => { first.add(rows.length); for (let r = 0; r < counts[i] && rows.length < 4096; r++) rows.push(s.buf.subarray(cur[i] + r * stride, cur[i] + (r + 1) * stride)); });
  const columns = [];
  let o = 0;
  while (o < stride) {
    const w = stride - o >= 4 ? 4 : 1;
    const cells = rows.map(r => r.subarray(o, o + w));
    if (cells.every(c => c.equals(cells[0]))) {
      let end = o + w;
      while (end < stride && rows.every(r => r[end] === rows[0][end])) end++;
      columns.push({ offset: o, size: end - o, type: 'constant', hex: hex(rows[0].subarray(o, Math.min(end, o + 16))) });
      o = end;
      continue;
    }
    if (w === 4) {
      const ints = cells.map(c => c.readUInt32LE(0));
      const floats = cells.map(c => c.readFloatLE(0));
      const smallInts = ints.filter(v => v < 1 << 24).length;
      const goodFloats = floats.filter(f => f === 0 || (Number.isFinite(f) && Math.abs(f) > 1e-4 && Math.abs(f) < 1e7)).length;
      const rising = ints.length > samples.length + 1 && ints.every((v, n) => first.has(n) || v > ints[n - 1]);
      let type = 'u4le', note = 'whole numbers';
      if (smallInts < rows.length * 0.9 && goodFloats === rows.length) { type = 'f4le'; note = 'every record reads as a sensible float here'; }
      else if (smallInts < rows.length * 0.9) { type = 'u4le'; note = 'large values: flags, a hash, an id, or not a little-endian number'; }
      else if (rising) note = 'whole numbers that rise from record to record (an id or an index)';
      columns.push({ offset: o, size: 4, type, note, values: (type === 'f4le' ? floats.map(f => Math.round(f * 1000) / 1000) : ints).slice(0, 4) });
    } else {
      columns.push({ offset: o, size: 1, type: 'u1', values: cells.slice(0, 4).map(c => c[0]) });
    }
    o += w;
  }
  return { size: stride, read: rows.length, columns };
}

/** Walks all samples side by side; each sample has its own cursor, so a text of a different length does not end the comparison. */
export function inferStruct(samples) {
  const cur = samples.map(() => 0);
  const fields = [];
  const offsetOf = () => (same(cur) ? cur[0] : [...cur]);
  const push = f => fields.push({ offset: offsetOf(), ...f });
  const advance = by => cur.forEach((_, i) => { cur[i] += Array.isArray(by) ? by[i] : by; });
  let stopped = null;
  let records = null;

  while (fields.length < MAX_FIELDS) {
    const room = left(samples, cur);
    if (room <= 0) break;

    // 1. bytes that are the same in every sample: the format itself
    let run = 0;
    while (run < room && same(byteAt(samples, cur, run))) run++;
    if (run > 0) {
      // A length in big-endian or a count starts with constant zero bytes: give those back when a field starts in them.
      let keep = run;
      if (run < room) {
        for (let back = Math.min(3, run); back >= 1; back--) {
          const at = cur.map(c => c + run - back);
          if (!byteAt(samples, at, 0).every(b => b === 0)) continue;
          if (prefixedString(samples, at) || INTS.some(int => int.type.endsWith('be') && int.w > back && relation(samples, at, int))) { keep = run - back; break; }
        }
      }
      if (keep > 0) {
        const bytes = samples[0].buf.subarray(cur[0], cur[0] + keep);
        const zero = bytes.every(b => b === 0);
        push({
          size: keep, type: 'constant', role: fields.length === 0 ? 'magic' : zero ? 'padding' : 'constant',
          ...(printable(bytes) ? { text: text(bytes.subarray(0, 64)) } : {}),
          hex: hex(bytes.subarray(0, 16)) + (keep > 16 ? ' …' : ''),
          note: zero ? 'zero in every sample (padding, or a value no sample uses)' : 'the same in every sample',
        });
        advance(keep);
        continue;
      }
    }

    // 2. text with its length in front, or ended by a NUL
    const ps = prefixedString(samples, cur);
    if (ps) {
      push({ size: same(ps.lens) ? ps.w + ps.lens[0] : 'varies', type: `${ps.lenType} length + text`, role: 'string', values: ps.values.slice(0, 4), note: `a ${ps.lenType} length (${ps.lens.slice(0, 4).join(', ')}) followed by that many bytes of text` });
      advance(ps.lens.map(n => n + ps.w));
      continue;
    }
    const cs = cString(samples, cur);
    if (cs) {
      push({ size: 'varies', type: 'text + NUL', role: 'string', values: cs.values.slice(0, 4), note: 'text that ends with a zero byte' });
      advance(cs.lens);
      continue;
    }

    // 3. a number the file explains
    let rel = null, relInt = null;
    for (const int of INTS) { rel = relation(samples, cur, int); if (rel) { relInt = int; break; } }
    if (rel) {
      const { vals, ...restRel } = rel;
      push({ size: relInt.w, type: relInt.type, values: vals.slice(0, 4), ...restRel });
      advance(relInt.w);
      if (rel.role === 'count' && samples.every(s => s.buf.length === s.size)) {
        records = recordLayout(samples, cur, vals, rel.stride);
        stopped = { offset: offsetOf(), note: `${rel.stride}-byte records start here (as many as the count says)${rel.extra ? `, with ${rel.extra} more bytes after them` : ' and run to the end of the file'}; see records for the columns.` };
        break;
      }
      continue;
    }
    // 4. bytes that differ and that nothing explains: a value, or the payload
    let vary = 0;
    while (vary < room && !same(byteAt(samples, cur, vary))) vary++;
    // Short constant gaps inside a block of data are chance, not structure.
    let span = vary;
    while (span < room) {
      let gap = 0;
      while (span + gap < room && same(byteAt(samples, cur, span + gap))) gap++;
      if (gap > 3 || span + gap >= room) break;
      let more = 0;
      while (span + gap + more < room && !same(byteAt(samples, cur, span + gap + more))) more++;
      if (vary < 9 && more < 9) break;
      span += gap + more;
    }
    if (span >= 9) {
      const reachesEnd = span >= room;
      const block = Buffer.concat(samples.map((s, i) => s.buf.subarray(cur[i], cur[i] + Math.min(span, 4096))));
      const e = entropy(block);
      // A short block cannot reach 8 bits per byte: compare with what its length allows.
      const dense = e >= 0.9 * Math.min(8, Math.log2(block.length));
      if (reachesEnd) {
        stopped = { offset: offsetOf(), entropy: e, note: `from here the samples differ to the end (${dense ? 'high entropy: compressed or encrypted data' : e < 5 ? 'low entropy: text or sparse records' : 'mixed data: records or media'}). Fields inside it need samples that differ in one known thing.` };
        break;
      }
      push({ size: span, type: 'bytes', role: dense ? 'data (compressed, encrypted or a hash)' : 'data', entropy: e, note: `${span} bytes that differ between samples` });
      advance(span);
      continue;
    }
    // Small values in little-endian leave constant zero bytes behind them: take those into the number.
    let w = vary <= 1 ? 1 : vary <= 2 ? 2 : vary <= 4 ? 4 : 8;
    if (w < 4) {
      const zeros = d => d < room && byteAt(samples, cur, d).every(b => b === 0);
      if (vary <= 2 && zeros(2) && zeros(3) && (vary === 2 || zeros(1))) w = 4;
      else if (vary === 1 && zeros(1)) w = 2;
    }
    w = Math.min(w, room);
    const int = intOf(`u${w}le`);
    const vals = int ? samples.map((s, i) => int.read(s.buf, cur[i])) : samples.map((s, i) => (w === 1 ? s.buf[cur[i]] : hex(s.buf.subarray(cur[i], cur[i] + w))));
    const small = int && vals.every(v => v < 65536);
    push({ size: w, type: w === 1 ? 'u1' : int ? (small || w === 8 ? `u${w}le` : `u${w}`) : 'bytes', role: 'value', values: vals.slice(0, 4), note: int && !small && w === 4 ? 'a value that differs per sample; the byte order is not clear from these samples (read here as little-endian)' : 'a value that differs per sample' });
    advance(w);
  }
  if (!stopped && fields.length >= MAX_FIELDS) stopped = { offset: offsetOf(), note: `stopped after ${MAX_FIELDS} fields` };
  if (!stopped && left(samples, cur) <= 0 && samples.some((s, i) => cur[i] < s.buf.length)) stopped = { offset: offsetOf(), note: 'the shortest sample ends here; the longer ones have more data that nothing can be compared with.' };
  return { fields, ...(records ? { records } : {}), rest: stopped, trailer: trailer(samples) };
}

const ksyType = t => (t === 'u2' ? 'u2le' : t === 'u4' ? 'u4le' : t);

/** A Kaitai Struct draft of the fields: a starting point to edit, in the format most tools for binary formats read. */
export function toKsy(id, result) {
  const out = ['meta:', `  id: ${id}`, '  endian: le', 'doc: |', '  Draft written by ReversePort re_struct from sample files. Every field is a hypothesis:', '  the doc of a field says what the samples showed. Rename the fields as you learn what they are.', 'seq:'];
  const names = new Map();
  const name = base => { const n = (names.get(base) ?? 0) + 1; names.set(base, n); return n === 1 ? base : `${base}_${n}`; };
  const doc = f => `    doc: ${JSON.stringify(f.note)}`;
  for (const f of result.fields) {
    if (f.type === 'constant') {
      const bytes = f.hex.endsWith('…') ? null : f.hex.split(' ').map(h => `0x${h}`);
      out.push(`  - id: ${name(f.role === 'magic' ? 'magic' : f.role === 'padding' ? 'reserved' : 'const')}`);
      if (bytes && f.role !== 'padding') out.push(`    contents: [${bytes.join(', ')}]`);
      else out.push(`    size: ${f.size}`);
      out.push(doc(f));
    } else if (f.role === 'string' && f.type.endsWith('length + text')) {
      const len = name('len_text');
      out.push(`  - id: ${len}`, `    type: ${f.type.split(' ')[0]}`, `  - id: ${name('text')}`, '    type: str', `    size: ${len}`, '    encoding: UTF-8', doc(f));
    } else if (f.role === 'string') {
      out.push(`  - id: ${name('text')}`, '    type: strz', '    encoding: UTF-8', doc(f));
    } else if (f.type === 'bytes') {
      out.push(`  - id: ${name('data')}`, `    size: ${f.size}`, doc(f));
    } else {
      const base = { length: 'len_body', count: 'num_records', checksum: 'checksum', time: 'timestamp', offset: 'ofs_section' }[f.role] ?? 'value';
      out.push(`  - id: ${name(base)}`, `    type: ${ksyType(f.type)}`, doc(f));
    }
  }
  if (result.records) {
    out.push('  - id: records', '    type: record', '    repeat: expr', `    repeat-expr: ${[...names.keys()].includes('num_records') ? (names.get('num_records') > 1 ? `num_records_${names.get('num_records')}` : 'num_records') : 0}`);
    out.push('types:', '  record:', '    seq:');
    result.records.columns.forEach((c, n) => {
      out.push(`      - id: ${c.type === 'constant' ? 'const' : 'col'}_${n}`);
      out.push(c.type === 'constant' ? `        size: ${c.size}` : `        type: ${c.type}`);
      if (c.note) out.push(`        doc: ${JSON.stringify(c.note)}`);
    });
  } else if (result.rest) out.push(`  - id: ${name('body')}`, '    size-eos: true', `    doc: ${JSON.stringify(result.rest.note)}`);
  return `${out.join('\n')}\n`;
}

export async function structTool({ files, path: folder, match, maxKB = 1024 } = {}) {
  let list = Array.isArray(files) ? [...files] : [];
  if (folder) {
    const root = await requireDir(folder, 'sample folder');
    const wanted = compileMatcher(match);
    const found = await walk(root, { maxFiles: 5000 });
    list.push(...found.files.filter(f => f.size > 0 && wanted(f.rel)).map(f => f.abs));
  }
  if (list.length < 2) throw new RPError('INVALID_ARGUMENT', 're_struct compares samples: give at least 2 files of the same format (files: [...], or path with match such as "*.sav"). Three or more that differ in size find counts and lengths.');
  const skipped = Math.max(0, list.length - MAX_SAMPLES);
  list = list.slice(0, MAX_SAMPLES);
  const limit = Math.max(1, Math.min(maxKB, 64 * 1024)) * 1024;
  const samples = [];
  for (const f of list) {
    const { abs, size } = await requireFile(f);
    if (size === 0) throw new RPError('INVALID_ARGUMENT', `${f} is empty.`);
    samples.push({ file: abs, size, buf: await readAt(abs, 0, Math.min(size, limit)) });
  }
  const result = inferStruct(samples);
  const partial = samples.some(s => s.buf.length < s.size);
  const named = result.fields.filter(f => ['length', 'count', 'checksum', 'time', 'offset', 'string'].includes(f.role)).length;
  const id = (path.extname(samples[0].file).slice(1) || path.basename(samples[0].file)).toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^(\d)/, '_$1') || 'format';
  return {
    samples: samples.map(s => ({ file: s.file, size: s.size })),
    ...(skipped ? { skippedSamples: skipped } : {}),
    summary: `${result.fields.length} fields before the data starts; ${named} with a meaning the samples prove (length, count, checksum, time, offset or text).`,
    fields: result.fields,
    ...(result.records ? { records: result.records } : {}),
    ...(result.rest ? { rest: result.rest } : {}),
    ...(result.trailer ? { trailer: result.trailer } : {}),
    ...(partial ? { partial: `only the first ${limit / 1024} KiB of each sample was read (maxKB); checksums over the whole file were not tried.` } : {}),
    ksy: toKsy(id, result),
    hint: 'A hypothesis from these samples only. A field marked constant may be a value no sample changes: add samples that differ in one known thing (one more item, another name) and run again. offset is a list when the samples are no longer aligned (after a text of different lengths). ksy is a Kaitai Struct draft; keep proof with re_case.',
  };
}
