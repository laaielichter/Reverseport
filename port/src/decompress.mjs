// Decoders Node does not ship: LZ4 block format and raw LZMA (LZMA1, as used by Unity asset bundles, ZWS Flash
// files and .lzma "alone" files). Hand-written to keep ReversePort free of runtime dependencies. Both decode into
// a buffer of a known size and fail with BAD_FORMAT on corrupt input instead of reading or writing out of bounds.
import { RPError } from './util.mjs';

const corrupt = what => new RPError('BAD_FORMAT', `Corrupt ${what} data.`);

/** Decode one LZ4 block (no frame header) into exactly `outSize` bytes. */
export function lz4Block(src, outSize) {
  const out = Buffer.alloc(outSize);
  let s = 0, o = 0;
  while (s < src.length) {
    const token = src[s++];
    let lit = token >> 4;
    if (lit === 15) { let b; do { if (s >= src.length) throw corrupt('LZ4'); b = src[s++]; lit += b; } while (b === 255); }
    if (s + lit > src.length || o + lit > outSize) throw corrupt('LZ4');
    src.copy(out, o, s, s + lit); s += lit; o += lit;
    if (s >= src.length) break; // the last sequence has literals only
    if (s + 2 > src.length) throw corrupt('LZ4');
    const off = src[s] | (src[s + 1] << 8); s += 2;
    if (off === 0 || off > o) throw corrupt('LZ4');
    let len = token & 15;
    if (len === 15) { let b; do { if (s >= src.length) throw corrupt('LZ4'); b = src[s++]; len += b; } while (b === 255); }
    len += 4;
    if (o + len > outSize) throw corrupt('LZ4');
    if (off >= len) out.copy(out, o, o - off, o - off + len);
    else for (let i = 0; i < len; i++) out[o + i] = out[o - off + i];
    o += len;
  }
  if (o !== outSize) throw corrupt('LZ4');
  return out;
}

// ---------------------------------------------------------------- LZMA
const PROB_INIT = 1024, STATES = 12, POS_STATES_MAX = 16, END_POS_MODEL = 14, FULL_DISTANCES = 128, ALIGN_BITS = 4;

class RangeDecoder {
  constructor(buf, pos) {
    this.buf = buf; this.pos = pos;
    if (buf[this.pos++] !== 0) throw corrupt('LZMA');
    this.range = 0xffffffff; this.code = 0;
    for (let i = 0; i < 4; i++) this.code = ((this.code << 8) | this.byte()) >>> 0;
    if (this.code === this.range) throw corrupt('LZMA');
  }
  byte() { if (this.pos >= this.buf.length) throw corrupt('LZMA'); return this.buf[this.pos++]; }
  normalize() { if (this.range < 0x1000000) { this.range = (this.range << 8) >>> 0; this.code = ((this.code << 8) | this.byte()) >>> 0; } }
  bit(probs, i) {
    const p = probs[i], bound = (this.range >>> 11) * p;
    let b;
    if (this.code < bound) { probs[i] = p + ((2048 - p) >> 5); this.range = bound; b = 0; }
    else { probs[i] = p - (p >> 5); this.code -= bound; this.range -= bound; b = 1; }
    this.normalize();
    return b;
  }
  direct(n) {
    let res = 0;
    for (let i = 0; i < n; i++) {
      this.range >>>= 1;
      let t = 0;
      if (this.code >= this.range) { this.code -= this.range; t = 1; }
      res = ((res << 1) | t) >>> 0;
      this.normalize();
    }
    return res;
  }
  tree(probs, base, bits) { let m = 1; for (let i = 0; i < bits; i++) m = (m << 1) + this.bit(probs, base + m); return m - (1 << bits); }
  reverse(probs, base, bits) { let m = 1, sym = 0; for (let i = 0; i < bits; i++) { const b = this.bit(probs, base + m); m = (m << 1) + b; sym |= b << i; } return sym; }
}

const probs = n => new Uint16Array(n).fill(PROB_INIT);

class LenDecoder {
  constructor() { this.choice = probs(2); this.low = probs(POS_STATES_MAX << 3); this.mid = probs(POS_STATES_MAX << 3); this.high = probs(256); }
  decode(rc, posState) {
    if (rc.bit(this.choice, 0) === 0) return rc.tree(this.low, posState << 3, 3);
    if (rc.bit(this.choice, 1) === 0) return 8 + rc.tree(this.mid, posState << 3, 3);
    return 16 + rc.tree(this.high, 0, 8);
  }
}

/**
 * Decode raw LZMA: `props` are the 5 property bytes (lc/lp/pb and dictionary size), `data` the range-coded stream,
 * `outSize` the uncompressed size (the stream may or may not end with an end marker).
 */
export function lzmaDecode(props, data, outSize, { endMarker = false } = {}) {
  let d = props[0];
  if (d >= 9 * 5 * 5) throw corrupt('LZMA');
  const lc = d % 9; d = Math.floor(d / 9);
  const lp = d % 5, pb = Math.floor(d / 5);
  const out = Buffer.alloc(outSize);
  const rc = new RangeDecoder(data, 0);
  const literal = probs(0x300 << (lc + lp));
  const isMatch = probs(STATES << 4), isRep = probs(STATES), isRepG0 = probs(STATES), isRepG1 = probs(STATES), isRepG2 = probs(STATES), isRep0Long = probs(STATES << 4);
  const posSlot = probs(4 << 6), posDecoders = probs(1 + FULL_DISTANCES - END_POS_MODEL), align = probs(1 << ALIGN_BITS);
  const lenDec = new LenDecoder(), repLenDec = new LenDecoder();
  const pbMask = (1 << pb) - 1, lpMask = (1 << lp) - 1;
  let state = 0, rep0 = 0, rep1 = 0, rep2 = 0, rep3 = 0, o = 0;
  const distance = len => {
    const slot = rc.tree(posSlot, Math.min(len, 3) << 6, 6);
    if (slot < 4) return slot;
    const direct = (slot >>> 1) - 1;
    let dist = ((2 | (slot & 1)) << direct) >>> 0;
    if (slot < END_POS_MODEL) return (dist + rc.reverse(posDecoders, dist - slot, direct)) >>> 0;
    dist = (dist + ((rc.direct(direct - ALIGN_BITS) << ALIGN_BITS) >>> 0)) >>> 0;
    return (dist + rc.reverse(align, 0, ALIGN_BITS)) >>> 0;
  };
  while (o < outSize) {
    const posState = o & pbMask;
    if (rc.bit(isMatch, (state << 4) + posState) === 0) {
      const prev = o > 0 ? out[o - 1] : 0;
      const base = 0x300 * (((o & lpMask) << lc) + (prev >> (8 - lc)));
      let sym = 1;
      if (state >= 7) {
        if (rep0 >= o) throw corrupt('LZMA');
        let matchByte = out[o - rep0 - 1];
        do {
          const matchBit = (matchByte >> 7) & 1; matchByte <<= 1;
          const b = rc.bit(literal, base + ((1 + matchBit) << 8) + sym);
          sym = (sym << 1) | b;
          if (matchBit !== b) break;
        } while (sym < 0x100);
      }
      while (sym < 0x100) sym = (sym << 1) | rc.bit(literal, base + sym);
      out[o++] = sym - 0x100;
      state = state < 4 ? 0 : state < 10 ? state - 3 : state - 6;
      continue;
    }
    let len;
    if (rc.bit(isRep, state) !== 0) {
      if (o === 0) throw corrupt('LZMA');
      if (rc.bit(isRepG0, state) === 0) {
        if (rc.bit(isRep0Long, (state << 4) + posState) === 0) {
          state = state < 7 ? 9 : 11;
          out[o] = out[o - rep0 - 1]; o++;
          continue;
        }
      } else {
        let dist;
        if (rc.bit(isRepG1, state) === 0) dist = rep1;
        else { if (rc.bit(isRepG2, state) === 0) dist = rep2; else { dist = rep3; rep3 = rep2; } rep2 = rep1; }
        rep1 = rep0; rep0 = dist;
      }
      len = repLenDec.decode(rc, posState);
      state = state < 7 ? 8 : 11;
    } else {
      rep3 = rep2; rep2 = rep1; rep1 = rep0;
      len = lenDec.decode(rc, posState);
      state = state < 7 ? 7 : 10;
      rep0 = distance(len);
      if (rep0 === 0xffffffff) break; // end marker
      if (rep0 >= o) throw corrupt('LZMA');
    }
    len += 2;
    if (o + len > outSize) throw corrupt('LZMA');
    for (let i = 0; i < len; i++, o++) out[o] = out[o - rep0 - 1];
  }
  if (o !== outSize) { if (endMarker) return out.subarray(0, o); throw corrupt('LZMA'); }
  return out;
}

/** A .lzma ("LZMA alone") file: 5 property bytes, a 64-bit uncompressed size (all ones: unknown), then the stream. */
export function lzmaAlone(buf, maxSize) {
  if (buf.length < 13) throw corrupt('LZMA');
  const size = buf.readBigUInt64LE(5);
  if (size === 0xffffffffffffffffn) return lzmaDecode(buf.subarray(0, 5), buf.subarray(13), maxSize, { endMarker: true }); // size unknown: ends with a marker
  if (size > BigInt(maxSize)) throw new RPError('TOO_LARGE', `The LZMA stream unpacks to ${size} bytes, over the ${maxSize}-byte limit.`);
  return lzmaDecode(buf.subarray(0, 5), buf.subarray(13), Number(size));
}
