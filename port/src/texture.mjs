// Unity texture formats → RGBA pixels → PNG, hand-written (no dependencies). Decodes the formats games ship most:
// uncompressed 8-bit layouts, BC1/BC3/BC4/BC5 (DXT, desktop) and ETC1/ETC2/ETC2+EAC alpha (mobile). Formats it
// cannot decode (ASTC, BC6H/BC7, crunched, PVRTC) are written as a container another tool opens (.astc, .dds) or as
// raw bytes, and the result says which.
import zlib from 'node:zlib';

/** Unity TextureFormat ids → name. */
export const TEXTURE_FORMATS = {
  1: 'Alpha8', 2: 'ARGB4444', 3: 'RGB24', 4: 'RGBA32', 5: 'ARGB32', 6: 'ARGBFloat', 7: 'RGB565', 8: 'BGR24', 9: 'R16', 10: 'DXT1', 11: 'DXT3',
  12: 'DXT5', 13: 'RGBA4444', 14: 'BGRA32', 15: 'RHalf', 16: 'RGHalf', 17: 'RGBAHalf', 18: 'RFloat', 19: 'RGFloat', 20: 'RGBAFloat', 21: 'YUY2',
  22: 'RGB9e5Float', 24: 'BC6H', 25: 'BC7', 26: 'BC4', 27: 'BC5', 28: 'DXT1Crunched', 29: 'DXT5Crunched', 30: 'PVRTC_RGB2', 31: 'PVRTC_RGBA2',
  32: 'PVRTC_RGB4', 33: 'PVRTC_RGBA4', 34: 'ETC_RGB4', 35: 'ATC_RGB4', 36: 'ATC_RGBA8', 41: 'EAC_R', 42: 'EAC_R_SIGNED', 43: 'EAC_RG',
  44: 'EAC_RG_SIGNED', 45: 'ETC2_RGB', 46: 'ETC2_RGBA1', 47: 'ETC2_RGBA8', 48: 'ASTC_RGB_4x4', 49: 'ASTC_RGB_5x5', 50: 'ASTC_RGB_6x6',
  51: 'ASTC_RGB_8x8', 52: 'ASTC_RGB_10x10', 53: 'ASTC_RGB_12x12', 54: 'ASTC_RGBA_4x4', 55: 'ASTC_RGBA_5x5', 56: 'ASTC_RGBA_6x6',
  57: 'ASTC_RGBA_8x8', 58: 'ASTC_RGBA_10x10', 59: 'ASTC_RGBA_12x12', 62: 'RG16', 63: 'R8', 64: 'ETC_RGB4Crunched', 65: 'ETC2_RGBA8Crunched',
  66: 'ASTC_HDR_4x4', 67: 'ASTC_HDR_5x5', 68: 'ASTC_HDR_6x6', 69: 'ASTC_HDR_8x8', 70: 'ASTC_HDR_10x10', 71: 'ASTC_HDR_12x12', 72: 'RG32',
  73: 'RGB48', 74: 'RGBA64', 60: 'ETC_RGB4_3DS', 61: 'ETC_RGBA8_3DS', 75: 'R8_SIGNED', 76: 'RG16_SIGNED', 77: 'RGB24_SIGNED',
  78: 'RGBA32_SIGNED', 79: 'R16_SIGNED', 80: 'RG32_SIGNED', 81: 'RGB48_SIGNED', 82: 'RGBA64_SIGNED',
};

const RAW_BPP = { 1: 1, 2: 2, 3: 3, 4: 4, 5: 4, 6: 16, 7: 2, 8: 3, 9: 2, 13: 2, 14: 4, 15: 2, 16: 4, 17: 8, 18: 4, 19: 8, 20: 16, 21: 2, 22: 4, 62: 2, 63: 1, 72: 4, 73: 6, 74: 8, 75: 1, 76: 2, 77: 3, 78: 4, 79: 2, 80: 4, 81: 6, 82: 8 };
const BLOCK8 = new Set([10, 26, 34, 35, 41, 42, 45, 46, 60]);
const BLOCK16 = new Set([11, 12, 24, 25, 27, 36, 43, 44, 47, 61]);
const ASTC_DIM = id => {
  const n = id >= 66 ? id - 66 : id >= 54 ? id - 54 : id - 48;
  const d = [4, 5, 6, 8, 10, 12][n];
  return d;
};
const isAstc = id => (id >= 48 && id <= 59) || (id >= 66 && id <= 71);

/** Bytes of one mip level, or null when the format's size rule is unknown here. */
export function levelBytes(format, w, h) {
  if (RAW_BPP[format]) return w * h * RAW_BPP[format];
  if (BLOCK8.has(format)) return Math.ceil(w / 4) * Math.ceil(h / 4) * 8;
  if (BLOCK16.has(format)) return Math.ceil(w / 4) * Math.ceil(h / 4) * 16;
  if (isAstc(format)) { const d = ASTC_DIM(format); return Math.ceil(w / d) * Math.ceil(h / d) * 16; }
  if (format === 32 || format === 33) return (Math.max(w, 8) * Math.max(h, 8)) / 2; // PVRTC 4 bpp
  if (format === 30 || format === 31) return (Math.max(w, 16) * Math.max(h, 8)) / 4; // PVRTC 2 bpp
  return null;
}

/** Bytes of a whole mip chain of `mips` levels. */
export function chainBytes(format, w, h, mips) {
  let total = 0;
  for (let i = 0; i < Math.max(1, mips); i++) {
    const b = levelBytes(format, Math.max(1, w >> i), Math.max(1, h >> i));
    if (b == null) return null;
    total += b;
  }
  return total;
}

// ---------------------------------------------------------------- block decoders (write RGBA into a 4x4 tile)
const rgb565 = d => [(d >> 8 & 0xf8) | (d >> 13), (d >> 3 & 0xfc) | (d >> 9 & 3), (d << 3 & 0xf8) | (d >> 2 & 7)];

function bc1(src, o, tile, alpha) {
  const c0 = src.readUInt16LE(o), c1 = src.readUInt16LE(o + 2);
  const a = rgb565(c0), b = rgb565(c1);
  const pal = [[...a, 255], [...b, 255]];
  if (c0 > c1 || !alpha) {
    pal.push([0, 1, 2].map(i => Math.floor((a[i] * 2 + b[i]) / 3)).concat(255), [0, 1, 2].map(i => Math.floor((a[i] + b[i] * 2) / 3)).concat(255));
  } else {
    pal.push([0, 1, 2].map(i => Math.floor((a[i] + b[i]) / 2)).concat(255), [0, 0, 0, 0]);
  }
  const idx = src.readUInt32LE(o + 4);
  for (let i = 0; i < 16; i++) { const c = pal[(idx >>> (2 * i)) & 3]; tile.set(c, i * 4); }
}

function alphaBlock(src, o) {
  const a0 = src[o], a1 = src[o + 1];
  const pal = [a0, a1];
  if (a0 > a1) for (let i = 1; i < 7; i++) pal.push(Math.floor((a0 * (7 - i) + a1 * i) / 7));
  else { for (let i = 1; i < 5; i++) pal.push(Math.floor((a0 * (5 - i) + a1 * i) / 5)); pal.push(0, 255); }
  let bits = 0n;
  for (let i = 7; i >= 2; i--) bits = (bits << 8n) | BigInt(src[o + i]);
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i++) out[i] = pal[Number((bits >> BigInt(3 * i)) & 7n)];
  return out;
}

const clamp = v => (v < 0 ? 0 : v > 255 ? 255 : v);
const ETC1_MOD = [[2, 8], [5, 17], [9, 29], [13, 42], [18, 60], [24, 80], [33, 106], [47, 183]];
const ETC_SUB = [[0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1], [0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1]];
const ETC2_DIST = [3, 6, 11, 16, 23, 32, 41, 64];
const ORDER = [0, 4, 8, 12, 1, 5, 9, 13, 2, 6, 10, 14, 3, 7, 11, 15]; // column-major pixel i → row-major tile slot
const ORDER_REV = [15, 11, 7, 3, 14, 10, 6, 2, 13, 9, 5, 1, 12, 8, 4, 0];
const EAC_MOD = [[-3, -6, -9, -15, 2, 5, 8, 14], [-3, -7, -10, -13, 2, 6, 9, 12], [-2, -5, -8, -13, 1, 4, 7, 12], [-2, -4, -6, -13, 1, 3, 5, 12],
  [-3, -6, -8, -12, 2, 5, 7, 11], [-3, -7, -9, -11, 2, 6, 8, 10], [-4, -7, -8, -11, 3, 6, 7, 10], [-3, -5, -8, -11, 2, 4, 7, 10],
  [-2, -6, -8, -10, 1, 5, 7, 9], [-2, -5, -8, -10, 1, 4, 7, 9], [-2, -4, -8, -10, 1, 3, 7, 9], [-2, -5, -7, -10, 1, 4, 6, 9],
  [-3, -4, -7, -10, 2, 3, 6, 9], [-1, -2, -3, -10, 0, 1, 2, 9], [-4, -6, -8, -9, 3, 5, 7, 8], [-3, -5, -7, -9, 2, 4, 6, 8]];

/** ETC1 / ETC2 RGB block (8 bytes) into `tile` (16 RGBA pixels, row-major), alpha 255. */
function etc2(d, o, tile) {
  const b = i => d[o + i];
  let j = (b(6) << 8) | b(7), k = (b(4) << 8) | b(5);
  const put = (slot, r, g, bl) => { tile[slot * 4] = r; tile[slot * 4 + 1] = g; tile[slot * 4 + 2] = bl; tile[slot * 4 + 3] = 255; };
  const app = (c, m) => [clamp(c[0] + m), clamp(c[1] + m), clamp(c[2] + m)];
  const sub = (c, code, flip) => {
    const table = ETC_SUB[flip];
    for (let i = 0; i < 16; i++, j >>= 1, k >>= 1) { const s = table[i]; const m = ETC1_MOD[code[s]][j & 1]; put(ORDER[i], ...app(c[s], k & 1 ? -m : m)); }
  };
  const code = [b(3) >> 5, (b(3) >> 2) & 7], flip = b(3) & 1;
  if (!(b(3) & 2)) { // individual
    const c = [[(b(0) & 0xf0) | (b(0) >> 4), (b(1) & 0xf0) | (b(1) >> 4), (b(2) & 0xf0) | (b(2) >> 4)],
      [(b(0) & 0x0f) | ((b(0) << 4) & 0xf0), (b(1) & 0x0f) | ((b(1) << 4) & 0xf0), (b(2) & 0x0f) | ((b(2) << 4) & 0xf0)]];
    return sub(c, code, flip);
  }
  const r = b(0) & 0xf8, g = b(1) & 0xf8, bl = b(2) & 0xf8;
  const delta = x => ((x << 3) & 0x18) - ((x << 3) & 0x20);
  const dr = delta(b(0)), dg = delta(b(1)), db = delta(b(2));
  const set4 = colors => { k <<= 1; for (let i = 0; i < 16; i++, j >>= 1, k >>= 1) put(ORDER[i], ...colors[(k & 2) | (j & 1)]); };
  if (r + dr < 0 || r + dr > 255) { // T mode
    const c0 = [((b(0) << 3) & 0xc0) | ((b(0) << 4) & 0x30) | ((b(0) >> 1) & 0xc) | (b(0) & 3), (b(1) & 0xf0) | (b(1) >> 4), (b(1) & 0x0f) | ((b(1) << 4) & 0xf0)];
    const c1 = [(b(2) & 0xf0) | (b(2) >> 4), (b(2) & 0x0f) | ((b(2) << 4) & 0xf0), (b(3) & 0xf0) | (b(3) >> 4)];
    const dd = ETC2_DIST[((b(3) >> 1) & 6) | (b(3) & 1)];
    return set4([c0, app(c1, dd), c1, app(c1, -dd)]);
  }
  if (g + dg < 0 || g + dg > 255) { // H mode
    const c0 = [((b(0) << 1) & 0xf0) | ((b(0) >> 3) & 0xf), 0, 0], c1 = [((b(2) << 1) & 0xf0) | ((b(2) >> 3) & 0xf), 0, 0];
    c0[1] = ((b(0) << 5) & 0xe0) | (b(1) & 0x10); c0[1] |= c0[1] >> 4;
    c0[2] = (b(1) & 8) | ((b(1) << 1) & 6) | (b(2) >> 7); c0[2] |= (c0[2] << 4) & 0xf0;
    c1[1] = ((b(2) << 5) & 0xe0) | ((b(3) >> 3) & 0x10); c1[1] |= c1[1] >> 4;
    c1[2] = ((b(3) << 1) & 0xf0) | ((b(3) >> 3) & 0xf);
    let di = (b(3) & 4) | ((b(3) << 1) & 2);
    if (c0[0] > c1[0] || (c0[0] === c1[0] && (c0[1] > c1[1] || (c0[1] === c1[1] && c0[2] >= c1[2])))) di++;
    const dd = ETC2_DIST[di];
    return set4([app(c0, dd), app(c0, -dd), app(c1, dd), app(c1, -dd)]);
  }
  if (bl + db < 0 || bl + db > 255) { // planar
    const o0 = [((b(0) << 1) & 0xfc) | ((b(0) >> 5) & 3), ((b(0) << 7) & 0x80) | (b(1) & 0x7e) | (b(0) & 1), ((b(1) << 7) & 0x80) | ((b(2) << 2) & 0x60) | ((b(2) << 3) & 0x18) | ((b(3) >> 5) & 4)];
    o0[2] |= o0[2] >> 6;
    const h0 = [((b(3) << 1) & 0xf8) | ((b(3) << 2) & 4) | ((b(3) >> 5) & 3), (b(4) & 0xfe) | (b(4) >> 7), ((b(4) << 7) & 0x80) | ((b(5) >> 1) & 0x7c)];
    h0[2] |= h0[2] >> 6;
    const v0 = [((b(5) << 5) & 0xe0) | ((b(6) >> 3) & 0x1c) | ((b(5) >> 1) & 3), ((b(6) << 3) & 0xf8) | ((b(7) >> 5) & 0x6) | ((b(6) >> 4) & 1), ((b(7) << 2) & 0xfc) | ((b(7) >> 4) & 3)];
    for (let y = 0, i = 0; y < 4; y++) for (let x = 0; x < 4; x++, i++) {
      const ch = n => clamp((x * (h0[n] - o0[n]) + y * (v0[n] - o0[n]) + 4 * o0[n] + 2) >> 2);
      put(i, ch(0), ch(1), ch(2));
    }
    return;
  }
  const c = [[r | (r >> 5), g | (g >> 5), bl | (bl >> 5)], [r + dr, g + dg, bl + db]];
  c[1] = c[1].map(v => v | (v >> 5));
  sub(c, code, flip);
}

/** EAC alpha block (8 bytes) into the alpha channel of `tile`. */
function eacAlpha(d, o, tile) {
  const base = d[o], mult = d[o + 1] >> 4;
  if (!mult) { for (let i = 0; i < 16; i++) tile[i * 4 + 3] = base; return; }
  const table = EAC_MOD[d[o + 1] & 0xf];
  let l = d.readBigUInt64BE(o);
  for (let i = 0; i < 16; i++, l >>= 3n) tile[ORDER_REV[i] * 4 + 3] = clamp(base + mult * table[Number(l & 7n)]);
}

function blocks(data, w, h, bytes, decode) {
  const out = Buffer.alloc(w * h * 4);
  const tile = new Uint8Array(64);
  const bw = Math.ceil(w / 4), bh = Math.ceil(h / 4);
  for (let by = 0; by < bh; by++) for (let bx = 0; bx < bw; bx++) {
    decode((by * bw + bx) * bytes, tile);
    for (let y = 0; y < 4; y++) {
      const py = by * 4 + y; if (py >= h) break;
      for (let x = 0; x < 4; x++) {
        const px = bx * 4 + x; if (px >= w) break;
        const t = (y * 4 + x) * 4, p = (py * w + px) * 4;
        out[p] = tile[t]; out[p + 1] = tile[t + 1]; out[p + 2] = tile[t + 2]; out[p + 3] = tile[t + 3];
      }
    }
  }
  return out;
}

function raw(data, w, h, pick, bpp) {
  const out = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) out.set(pick(data, i * bpp), i * 4);
  return out;
}

const nib = v => (v & 15) * 17;
const DECODERS = {
  1: (d, w, h) => raw(d, w, h, (s, o) => [0, 0, 0, s[o]], 1),
  2: (d, w, h) => raw(d, w, h, (s, o) => { const v = s.readUInt16LE(o); return [nib(v >> 8), nib(v >> 4), nib(v), nib(v >> 12)]; }, 2),
  3: (d, w, h) => raw(d, w, h, (s, o) => [s[o], s[o + 1], s[o + 2], 255], 3),
  4: (d, w, h) => raw(d, w, h, (s, o) => [s[o], s[o + 1], s[o + 2], s[o + 3]], 4),
  5: (d, w, h) => raw(d, w, h, (s, o) => [s[o + 1], s[o + 2], s[o + 3], s[o]], 4),
  7: (d, w, h) => raw(d, w, h, (s, o) => [...rgb565(s.readUInt16LE(o)), 255], 2),
  8: (d, w, h) => raw(d, w, h, (s, o) => [s[o + 2], s[o + 1], s[o], 255], 3),
  9: (d, w, h) => raw(d, w, h, (s, o) => [s[o + 1], 0, 0, 255], 2),
  13: (d, w, h) => raw(d, w, h, (s, o) => { const v = s.readUInt16LE(o); return [nib(v >> 12), nib(v >> 8), nib(v >> 4), nib(v)]; }, 2),
  14: (d, w, h) => raw(d, w, h, (s, o) => [s[o + 2], s[o + 1], s[o], s[o + 3]], 4),
  62: (d, w, h) => raw(d, w, h, (s, o) => [s[o], s[o + 1], 0, 255], 2),
  63: (d, w, h) => raw(d, w, h, (s, o) => [s[o], 0, 0, 255], 1),
  10: (d, w, h) => blocks(d, w, h, 8, (o, t) => bc1(d, o, t, true)),
  12: (d, w, h) => blocks(d, w, h, 16, (o, t) => { bc1(d, o + 8, t, false); const a = alphaBlock(d, o); for (let i = 0; i < 16; i++) t[i * 4 + 3] = a[i]; }),
  26: (d, w, h) => blocks(d, w, h, 8, (o, t) => { const v = alphaBlock(d, o); for (let i = 0; i < 16; i++) t.set([v[i], v[i], v[i], 255], i * 4); }),
  27: (d, w, h) => blocks(d, w, h, 16, (o, t) => { const r = alphaBlock(d, o), g = alphaBlock(d, o + 8); for (let i = 0; i < 16; i++) t.set([r[i], g[i], 0, 255], i * 4); }),
  34: (d, w, h) => blocks(d, w, h, 8, (o, t) => etc2(d, o, t)),
  45: (d, w, h) => blocks(d, w, h, 8, (o, t) => etc2(d, o, t)),
  47: (d, w, h) => blocks(d, w, h, 16, (o, t) => { etc2(d, o + 8, t); eacAlpha(d, o, t); }),
};

export const DECODABLE = new Set(Object.keys(DECODERS).map(Number));

/** Decode level 0 of `data` into top-down RGBA rows (Unity stores rows bottom-up). Returns null when unsupported. */
export function decodeTexture(data, format, w, h) {
  const dec = DECODERS[format];
  if (!dec) return null;
  const need = levelBytes(format, w, h);
  if (need == null || data.length < need) return null;
  const rgba = dec(data, w, h);
  const row = w * 4, flipped = Buffer.alloc(rgba.length);
  for (let y = 0; y < h; y++) rgba.copy(flipped, (h - 1 - y) * row, y * row, (y + 1) * row);
  return flipped;
}

// ---------------------------------------------------------------- PNG
const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
function crc32(buf) { let c = -1; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** RGBA rows → PNG file bytes. */
export function encodePng(rgba, w, h) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/**
 * A texture as a file: PNG when decodable; otherwise a container another tool reads (.astc for ASTC, .dds for
 * BC6H/BC7) or the raw level-0 bytes. Returns { ext, data, decoded, note? }.
 */
export function textureFile(data, format, w, h) {
  const rgba = decodeTexture(data, format, w, h);
  if (rgba) return { ext: '.png', data: encodePng(rgba, w, h), decoded: true };
  const name = TEXTURE_FORMATS[format] ?? `format ${format}`;
  if (isAstc(format)) {
    const d = ASTC_DIM(format), head = Buffer.alloc(16);
    head.writeUInt32LE(0x5ca1ab13, 0); head[4] = d; head[5] = d; head[6] = 1;
    head.writeUIntLE(w, 7, 3); head.writeUIntLE(h, 10, 3); head.writeUIntLE(1, 13, 3);
    const size = levelBytes(format, w, h);
    return { ext: '.astc', data: Buffer.concat([head, data.subarray(0, size)]), decoded: false, note: `${name}: written as .astc (decode with astcenc -d, or any ASTC-aware viewer); the image is stored upside down.` };
  }
  if (format === 24 || format === 25) {
    const head = Buffer.alloc(148);
    head.write('DDS ', 0, 'latin1');
    head.writeUInt32LE(124, 4); head.writeUInt32LE(0x1 | 0x2 | 0x4 | 0x1000 | 0x80000, 8); head.writeUInt32LE(h, 12); head.writeUInt32LE(w, 16);
    head.writeUInt32LE(levelBytes(format, w, h), 20); head.writeUInt32LE(1, 28);
    head.writeUInt32LE(32, 76); head.writeUInt32LE(0x4, 80); head.write('DX10', 84, 'latin1'); head.writeUInt32LE(0x1000, 108);
    head.writeUInt32LE(format === 25 ? 98 : 95, 128); head.writeUInt32LE(3, 132); head.writeUInt32LE(1, 140);
    return { ext: '.dds', data: Buffer.concat([head, data.subarray(0, levelBytes(format, w, h))]), decoded: false, note: `${name}: written as .dds (DX10 header); the image is stored upside down.` };
  }
  return { ext: '.tex', data, decoded: false, note: `${name}: not decoded here; the raw texture bytes are written (${/Crunched/.test(name) ? 'Unity crunch data needs a crunch decoder' : 'decode with a tool that reads this format'}).` };
}
