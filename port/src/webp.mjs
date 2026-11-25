// WebP lossless (VP8L) decoder, written from RFC 9649 ("WebP Image Format", section 3: the lossless bitstream) and
// checked against libwebp's src/dec/vp8l_dec.c and src/dsp/lossless.c for the details the RFC leaves to the reference
// code (predictor modes 14 and 15, the colour map tail, the code-length repeat codes). Godot 4 stores "lossless"
// textures as VP8L WebP by default (rendering/textures/lossless_compression/force_png is off), so this is what turns
// a .ctex back into the PNG the project referenced. Lossy WebP (VP8) is not decoded here: decodeWebp returns null.
import { RPError } from './util.mjs';

const MAX_SIDE = 16384;
const CODE_LENGTH_ORDER = [17, 18, 0, 1, 2, 3, 4, 5, 16, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
// The 120 short distance codes: (yoffset << 4) | (8 - xoffset), as libwebp's kCodeToPlane.
const CODE_TO_PLANE = [
  0x18, 0x07, 0x17, 0x19, 0x28, 0x06, 0x27, 0x29, 0x16, 0x1a, 0x26, 0x2a, 0x38, 0x05, 0x37, 0x39, 0x15, 0x1b, 0x36, 0x3a,
  0x25, 0x2b, 0x48, 0x04, 0x47, 0x49, 0x14, 0x1c, 0x35, 0x3b, 0x46, 0x4a, 0x24, 0x2c, 0x58, 0x45, 0x4b, 0x34, 0x3c, 0x03,
  0x57, 0x59, 0x13, 0x1d, 0x56, 0x5a, 0x23, 0x2d, 0x44, 0x4c, 0x55, 0x5b, 0x33, 0x3d, 0x68, 0x02, 0x67, 0x69, 0x12, 0x1e,
  0x66, 0x6a, 0x22, 0x2e, 0x54, 0x5c, 0x43, 0x4d, 0x65, 0x6b, 0x32, 0x3e, 0x78, 0x01, 0x77, 0x79, 0x53, 0x5d, 0x11, 0x1f,
  0x64, 0x6c, 0x42, 0x4e, 0x76, 0x7a, 0x21, 0x2f, 0x75, 0x7b, 0x31, 0x3f, 0x63, 0x6d, 0x52, 0x5e, 0x00, 0x74, 0x7c, 0x41,
  0x4f, 0x10, 0x20, 0x62, 0x6e, 0x30, 0x73, 0x7d, 0x51, 0x5f, 0x40, 0x72, 0x7e, 0x61, 0x6f, 0x50, 0x71, 0x7f, 0x60, 0x70,
];

const bad = msg => new RPError('BAD_FORMAT', `WebP lossless: ${msg}`);
const subSample = (size, bits) => (size + (1 << bits) - 1) >> bits;

class BitReader {
  constructor(buf, pos) { this.buf = buf; this.pos = pos; this.bit = 0; }
  read(n) {
    let v = 0;
    for (let i = 0; i < n; i++) {
      if (this.pos >= this.buf.length) throw bad('the bitstream ends early');
      v |= ((this.buf[this.pos] >> this.bit) & 1) << i;
      if (++this.bit === 8) { this.bit = 0; this.pos++; }
    }
    return v >>> 0;
  }
}

/** A canonical prefix code from code lengths. Bits arrive first-bit-is-most-significant, as in DEFLATE. */
class Huffman {
  constructor(lengths) {
    const used = [];
    for (let s = 0; s < lengths.length; s++) if (lengths[s]) used.push(s);
    if (!used.length) throw bad('a prefix code has no symbols');
    if (used.length === 1) { this.single = used[0]; return; } // one symbol: zero bits per symbol
    let max = 0;
    for (const s of used) max = Math.max(max, lengths[s]);
    if (max > 15) throw bad('a code length is over 15');
    this.count = new Uint16Array(max + 1);
    for (const s of used) this.count[lengths[s]]++;
    const offs = new Uint16Array(max + 2);
    for (let l = 1; l <= max; l++) offs[l + 1] = offs[l] + this.count[l];
    this.symbols = new Uint16Array(used.length);
    for (let s = 0; s < lengths.length; s++) if (lengths[s]) this.symbols[offs[lengths[s]]++] = s;
    this.max = max;
  }
  read(br) {
    if (this.single !== undefined) return this.single;
    let code = 0, first = 0, index = 0;
    for (let len = 1; len <= this.max; len++) {
      code |= br.read(1);
      const count = this.count[len];
      if (code - first < count) return this.symbols[index + code - first];
      index += count; first = (first + count) << 1; code <<= 1;
    }
    throw bad('an invalid prefix code');
  }
}

function readCodeLengths(br, clLengths, size) {
  const table = new Huffman(clLengths);
  let max = size;
  if (br.read(1)) { const nbits = 2 + 2 * br.read(3); max = 2 + br.read(nbits); if (max > size) throw bad('max_symbol is larger than the alphabet'); }
  const lengths = new Uint8Array(size);
  let prev = 8;
  for (let s = 0; s < size;) {
    if (max-- === 0) break;
    const len = table.read(br);
    if (len < 16) { lengths[s++] = len; if (len) prev = len; continue; }
    const slot = len - 16;
    const repeat = br.read([2, 3, 7][slot]) + [3, 3, 11][slot];
    if (s + repeat > size) throw bad('a repeated code length runs past the alphabet');
    const v = slot === 0 ? prev : 0;
    for (let i = 0; i < repeat; i++) lengths[s++] = v;
  }
  return lengths;
}

function readCode(br, size) {
  if (br.read(1)) { // simple code: one or two symbols
    const lengths = new Uint8Array(Math.max(size, 256));
    const two = br.read(1);
    lengths[br.read(br.read(1) ? 8 : 1)] = 1;
    if (two) lengths[br.read(8)] = 1;
    return new Huffman(lengths.subarray(0, Math.max(size, 256)));
  }
  const cl = new Uint8Array(19);
  const n = br.read(4) + 4;
  for (let i = 0; i < n; i++) cl[CODE_LENGTH_ORDER[i]] = br.read(3);
  return new Huffman(readCodeLengths(br, cl, size));
}

const prefixValue = (br, sym) => {
  if (sym < 4) return sym + 1;
  const extra = (sym - 2) >> 1;
  return ((2 + (sym & 1)) << extra) + br.read(extra) + 1;
};

/** One entropy-coded image: colour cache, (level 0 only) meta prefix codes, the codes, the LZ77-coded pixels. */
function decodeImageStream(br, w, h, level0) {
  let cacheBits = 0;
  if (br.read(1)) { cacheBits = br.read(4); if (cacheBits < 1 || cacheBits > 11) throw bad(`colour cache bits ${cacheBits}`); }
  let metaBits = 0, meta = null, metaW = 0, groupsMax = 1;
  if (level0 && br.read(1)) {
    metaBits = br.read(3) + 2; metaW = subSample(w, metaBits);
    meta = decodeImageStream(br, metaW, subSample(h, metaBits), false);
    for (let i = 0; i < meta.length; i++) { meta[i] = (meta[i] >>> 8) & 0xffff; if (meta[i] + 1 > groupsMax) groupsMax = meta[i] + 1; }
  }
  const cacheSize = cacheBits ? 1 << cacheBits : 0;
  const groups = [];
  for (let g = 0; g < groupsMax; g++) groups.push([readCode(br, 256 + 24 + cacheSize), readCode(br, 256), readCode(br, 256), readCode(br, 256), readCode(br, 40)]);
  const cache = cacheSize ? new Uint32Array(cacheSize) : null;
  const out = new Uint32Array(w * h);
  const total = w * h;
  let pos = 0, cached = 0;
  const groupAt = p => (meta ? groups[meta[((Math.floor(p / w)) >> metaBits) * metaW + ((p % w) >> metaBits)]] : groups[0]);
  while (pos < total) {
    const [green, red, blue, alpha, dist] = groupAt(pos);
    const s = green.read(br);
    if (s < 256) {
      const r = red.read(br), b = blue.read(br), a = alpha.read(br); // green, red, blue, alpha (RFC 9649 5.2.2)
      out[pos++] = ((a << 24) | (r << 16) | (s << 8) | b) >>> 0;
    } else if (s < 280) {
      const length = prefixValue(br, s - 256);
      const code = prefixValue(br, dist.read(br));
      let d;
      if (code > 120) d = code - 120;
      else { const c = CODE_TO_PLANE[code - 1]; d = (c >> 4) * w + 8 - (c & 0xf); if (d < 1) d = 1; }
      if (d > pos || pos + length > total) throw bad('a backward reference points outside the image');
      for (let i = 0; i < length; i++, pos++) out[pos] = out[pos - d];
    } else {
      if (!cache) throw bad('a colour cache code without a colour cache');
      while (cached < pos) { const c = out[cached++]; cache[Math.imul(0x1e35a7bd, c) >>> (32 - cacheBits)] = c; }
      out[pos++] = cache[s - 280];
    }
    if (cache) while (cached < pos) { const c = out[cached++]; cache[Math.imul(0x1e35a7bd, c) >>> (32 - cacheBits)] = c; }
  }
  return out;
}

// ---- inverse transforms (lossless.c)
const average2 = (a, b) => ((((a ^ b) & 0xfefefefe) >>> 1) + (a & b)) >>> 0;
const clip = v => (v < 0 ? 0 : v > 255 ? 255 : v);
const ch = (c, s) => (c >>> s) & 0xff;
function addSubFull(a, b, c) {
  let r = 0;
  for (const s of [24, 16, 8, 0]) r |= clip(ch(a, s) + ch(b, s) - ch(c, s)) << s;
  return r >>> 0;
}
function addSubHalf(a, b, c) {
  const ave = average2(a, b);
  let r = 0;
  for (const s of [24, 16, 8, 0]) { const x = ch(ave, s); r |= clip(x + Math.trunc((x - ch(c, s)) / 2)) << s; }
  return r >>> 0;
}
function select(t, l, tl) {
  let d = 0;
  for (const s of [24, 16, 8, 0]) d += Math.abs(ch(l, s) - ch(tl, s)) - Math.abs(ch(t, s) - ch(tl, s));
  return d <= 0 ? t : l;
}
function predict(mode, L, T, TR, TL) {
  switch (mode) {
    case 1: return L; case 2: return T; case 3: return TR; case 4: return TL;
    case 5: return average2(average2(L, TR), T);
    case 6: return average2(L, TL); case 7: return average2(L, T); case 8: return average2(TL, T); case 9: return average2(T, TR);
    case 10: return average2(average2(L, TL), average2(T, TR));
    case 11: return select(T, L, TL); case 12: return addSubFull(L, T, TL); case 13: return addSubHalf(L, T, TL);
    default: return 0xff000000; // 0, and 14/15 as libwebp: black
  }
}
const addPixels = (a, b) => ((((a & 0xff00ff00) + (b & 0xff00ff00)) & 0xff00ff00) | (((a & 0x00ff00ff) + (b & 0x00ff00ff)) & 0x00ff00ff)) >>> 0;

function inversePredictor(px, w, h, bits, data) {
  const tiles = subSample(w, bits);
  px[0] = addPixels(px[0], 0xff000000);
  for (let x = 1; x < w; x++) px[x] = addPixels(px[x], px[x - 1]);
  for (let y = 1; y < h; y++) {
    const row = y * w;
    px[row] = addPixels(px[row], px[row - w]);
    for (let x = 1; x < w; x++) {
      const mode = (data[(y >> bits) * tiles + (x >> bits)] >>> 8) & 0xf;
      const i = row + x;
      px[i] = addPixels(px[i], predict(mode, px[i - 1], px[i - w], px[i - w + 1], px[i - w - 1]));
    }
  }
}
const s8 = v => (v << 24) >> 24;
function inverseColor(px, w, h, bits, data) {
  const tiles = subSample(w, bits);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const code = data[(y >> bits) * tiles + (x >> bits)];
    const g2r = s8(code & 0xff), g2b = s8((code >>> 8) & 0xff), r2b = s8((code >>> 16) & 0xff);
    const i = y * w + x, argb = px[i], green = s8((argb >>> 8) & 0xff);
    let red = (((argb >>> 16) & 0xff) + ((g2r * green) >> 5)) & 0xff;
    let blue = (argb & 0xff) + ((g2b * green) >> 5);
    blue = (blue + ((r2b * s8(red)) >> 5)) & 0xff;
    px[i] = ((argb & 0xff00ff00) | (red << 16) | blue) >>> 0;
  }
}
function inverseSubtractGreen(px) {
  for (let i = 0; i < px.length; i++) {
    const a = px[i], g = (a >>> 8) & 0xff;
    px[i] = ((a & 0xff00ff00) | ((((a & 0x00ff00ff) + ((g << 16) | g)) & 0x00ff00ff))) >>> 0;
  }
}
function inverseColorIndex(packed, packedW, w, h, bits, map) {
  const out = new Uint32Array(w * h);
  const bpp = 8 >> bits, mask = (1 << bpp) - 1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const idx = (packed[y * packedW + (x >> bits)] >>> 8) & 0xff;
    out[y * w + x] = map[bits ? (idx >> ((x & ((1 << bits) - 1)) * bpp)) & mask : idx];
  }
  return out;
}

/** The VP8L bitstream → { width, height, argb (Uint32Array) }. */
export function decodeVp8l(buf, start = 0) {
  if (buf[start] !== 0x2f) throw bad('no VP8L signature (0x2f)');
  const br = new BitReader(buf, start + 1);
  const width = br.read(14) + 1, height = br.read(14) + 1;
  br.read(1); // alpha_is_used: a hint only
  if (br.read(3) !== 0) throw bad('unknown version');
  if (width > MAX_SIDE || height > MAX_SIDE) throw bad(`${width}x${height} is larger than ReversePort decodes`);
  const transforms = [];
  let w = width;
  const seen = new Set();
  while (br.read(1)) {
    const type = br.read(2);
    if (seen.has(type)) throw bad('a transform appears twice');
    seen.add(type);
    if (type === 0 || type === 1) {
      const bits = br.read(3) + 2;
      transforms.push({ type, w, bits, data: decodeImageStream(br, subSample(w, bits), subSample(height, bits), false) });
    } else if (type === 3) {
      const n = br.read(8) + 1;
      const bits = n > 16 ? 0 : n > 4 ? 1 : n > 2 ? 2 : 3;
      const raw = decodeImageStream(br, n, 1, false);
      const map = new Uint32Array(1 << (8 >> bits));
      map[0] = raw[0];
      for (let i = 1; i < n; i++) map[i] = addPixels(raw[i], map[i - 1]);
      transforms.push({ type, w, bits, map });
      w = subSample(w, bits);
    } else transforms.push({ type });
  }
  let px = decodeImageStream(br, w, height, true);
  for (let t = transforms.length - 1; t >= 0; t--) {
    const tr = transforms[t];
    if (tr.type === 0) inversePredictor(px, tr.w, height, tr.bits, tr.data);
    else if (tr.type === 1) inverseColor(px, tr.w, height, tr.bits, tr.data);
    else if (tr.type === 2) inverseSubtractGreen(px);
    else { px = inverseColorIndex(px, w, tr.w, height, tr.bits, tr.map); w = tr.w; }
  }
  return { width, height, argb: px };
}

/**
 * A WebP file (RIFF "WEBP": simple VP8L, or extended VP8X with a VP8L chunk) → { width, height, rgba (Buffer) }.
 * Returns null for lossy WebP (a "VP8 " chunk) and animations: those are not decoded here.
 */
export function decodeWebp(buf) {
  if (buf.length < 20 || buf.toString('latin1', 0, 4) !== 'RIFF' || buf.toString('latin1', 8, 12) !== 'WEBP') throw bad('not a RIFF WEBP file');
  const end = Math.min(buf.length, 8 + buf.readUInt32LE(4));
  for (let p = 12; p + 8 <= end;) {
    const id = buf.toString('latin1', p, p + 4), size = buf.readUInt32LE(p + 4);
    if (id === 'VP8L') {
      const { width, height, argb } = decodeVp8l(buf.subarray(p + 8, Math.min(end, p + 8 + size)));
      const rgba = Buffer.alloc(width * height * 4);
      for (let i = 0; i < argb.length; i++) { const c = argb[i]; rgba[i * 4] = (c >>> 16) & 0xff; rgba[i * 4 + 1] = (c >>> 8) & 0xff; rgba[i * 4 + 2] = c & 0xff; rgba[i * 4 + 3] = c >>> 24; }
      return { width, height, rgba };
    }
    if (id === 'VP8 ' || id === 'ANMF') return null;
    p += 8 + size + (size & 1);
  }
  return null;
}
