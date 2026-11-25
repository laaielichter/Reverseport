// Imported resources of a Godot export back to the formats they were imported from: textures (.ctex/.stex → .png;
// lossless WebP is decoded to PNG, lossy WebP stays .webp), audio (.sample → .wav, QOA included; .oggvorbisstr/.oggstr
// → .ogg, .mp3str → .mp3) and translations (.translation → .csv).
// The layouts are taken from Godot's source; each section names the file and the fields it relies on. What cannot
// be converted without guessing (Basis Universal, ASTC, BPTC, ...) is reported with its format and size and left.
import { RPError } from './util.mjs';
import { decodeTexture, encodePng } from './texture.mjs';
import { decodeWebp } from './webp.mjs';

/** Extensions of imported resources this module handles (or reports). */
export const IMPORTED_RE = /\.(ctex|stex|ctex3d|ctexarray|ccube|ccubearray|tex3d|texarr|image|sample|oggvorbisstr|oggstr|mp3str|translation)$/i;
const TEXTURE_MAGICS = new Set(['GST2', 'GDST', 'GSTL']);
const RESOURCE_EXT_RE = /\.(sample|oggvorbisstr|oggstr|mp3str|translation)$/i;
/** True when re_decode should hand this file to convertImported (by extension for resources, by magic for textures). */
export const isImported = (rel, magic) => TEXTURE_MAGICS.has(magic) || ((magic === 'RSRC' || magic === 'RSCC') && RESOURCE_EXT_RE.test(rel)) || /\.(image|tex3d|texarr)$/i.test(rel);

// ------------------------------------------------------------------------------------------------ textures
// Image::Format, in enum order. The order differs between the two major versions from index 7 on.
// Godot 3: core/image.h (3.x). Godot 4: core/io/image.h (master; 4.0–4.3 end at ASTC_8x8_HDR, later ones were appended).
const IMAGE_FORMATS_3 = ['L8', 'LA8', 'R8', 'RG8', 'RGB8', 'RGBA8', 'RGBA4444', 'RGBA5551', 'RF', 'RGF', 'RGBF', 'RGBAF', 'RH', 'RGH', 'RGBH', 'RGBAH', 'RGBE9995',
  'DXT1', 'DXT3', 'DXT5', 'RGTC_R', 'RGTC_RG', 'BPTC_RGBA', 'BPTC_RGBF', 'BPTC_RGBFU', 'PVRTC2', 'PVRTC2A', 'PVRTC4', 'PVRTC4A',
  'ETC', 'ETC2_R11', 'ETC2_R11S', 'ETC2_RG11', 'ETC2_RG11S', 'ETC2_RGB8', 'ETC2_RGBA8', 'ETC2_RGB8A1'];
const IMAGE_FORMATS_4 = ['L8', 'LA8', 'R8', 'RG8', 'RGB8', 'RGBA8', 'RGBA4444', 'RGB565', 'RF', 'RGF', 'RGBF', 'RGBAF', 'RH', 'RGH', 'RGBH', 'RGBAH', 'RGBE9995',
  'DXT1', 'DXT3', 'DXT5', 'RGTC_R', 'RGTC_RG', 'BPTC_RGBA', 'BPTC_RGBF', 'BPTC_RGBFU',
  'ETC', 'ETC2_R11', 'ETC2_R11S', 'ETC2_RG11', 'ETC2_RG11S', 'ETC2_RGB8', 'ETC2_RGBA8', 'ETC2_RGB8A1', 'ETC2_RA_AS_RG', 'DXT5_RA_AS_RG',
  'ASTC_4x4', 'ASTC_4x4_HDR', 'ASTC_8x8', 'ASTC_8x8_HDR', 'R16', 'RG16', 'RGB16', 'RGBA16', 'R16I', 'RG16I', 'RGB16I', 'RGBA16I', 'ASTC_6x6', 'ASTC_6x6_HDR'];
export const GODOT_IMAGE_FORMATS = { 3: IMAGE_FORMATS_3, 4: IMAGE_FORMATS_4 };

const PIXEL_BYTES = { L8: 1, LA8: 2, R8: 1, RG8: 2, RGB8: 3, RGBA8: 4, RGBA4444: 2, RGBA5551: 2, RGB565: 2, RF: 4, RGF: 8, RGBF: 12, RGBAF: 16, RH: 2, RGH: 4, RGBH: 6, RGBAH: 8, RGBE9995: 4, R16: 2, RG16: 4, RGB16: 6, RGBA16: 8, R16I: 2, RG16I: 4, RGB16I: 6, RGBA16I: 8 };
// [block edge in pixels, bytes per block]
const BLOCKS = { DXT1: [4, 8], DXT3: [4, 16], DXT5: [4, 16], RGTC_R: [4, 8], RGTC_RG: [4, 16], BPTC_RGBA: [4, 16], BPTC_RGBF: [4, 16], BPTC_RGBFU: [4, 16], ETC: [4, 8], ETC2_R11: [4, 8], ETC2_R11S: [4, 8], ETC2_RG11: [4, 16], ETC2_RG11S: [4, 16], ETC2_RGB8: [4, 8], ETC2_RGBA8: [4, 16], ETC2_RGB8A1: [4, 8], ETC2_RA_AS_RG: [4, 16], DXT5_RA_AS_RG: [4, 16], ASTC_4x4: [4, 16], ASTC_4x4_HDR: [4, 16], ASTC_6x6: [6, 16], ASTC_6x6_HDR: [6, 16], ASTC_8x8: [8, 16], ASTC_8x8_HDR: [8, 16] };
/** Bytes of mip level 0 (Image::_get_dst_image_size: width and height rounded up to whole blocks), or null (PVRTC). */
function level0Bytes(name, w, h) {
  if (PIXEL_BYTES[name]) return w * h * PIXEL_BYTES[name];
  if (BLOCKS[name]) { const [edge, bytes] = BLOCKS[name]; return Math.ceil(w / edge) * Math.ceil(h / edge) * bytes; }
  return null;
}
/** Bytes of the whole mip chain down to 1×1, only for per-pixel formats (the rule for block formats changed between Godot versions). */
function chainBytes(name, w, h) {
  if (!PIXEL_BYTES[name]) return null;
  let total = 0;
  for (;;) { total += w * h * PIXEL_BYTES[name]; if (w === 1 && h === 1) return total; w = Math.max(1, w >> 1); h = Math.max(1, h >> 1); }
}

const RAW_PICK = {
  L8: (s, o) => [s[o], s[o], s[o], 255], LA8: (s, o) => [s[o], s[o], s[o], s[o + 1]], R8: (s, o) => [s[o], 0, 0, 255],
  RG8: (s, o) => [s[o], s[o + 1], 0, 255], RGB8: (s, o) => [s[o], s[o + 1], s[o + 2], 255], RGBA8: (s, o) => [s[o], s[o + 1], s[o + 2], s[o + 3]],
};
// Godot format → the id of the same block format in texture.mjs (its decoders are keyed by Unity TextureFormat).
const BLOCK_DECODER = { DXT1: 10, DXT5: 12, RGTC_R: 26, RGTC_RG: 27, ETC: 34, ETC2_RGB8: 45, ETC2_RGBA8: 47 };

/** Level 0 of a Godot Image → RGBA rows (top-down, as Godot stores them), or null when the format is not decoded here. */
export function godotImageToRgba(data, name, w, h) {
  const need = level0Bytes(name, w, h);
  if (need == null || data.length < need) return null;
  if (RAW_PICK[name]) {
    const bpp = PIXEL_BYTES[name], out = Buffer.alloc(w * h * 4), pick = RAW_PICK[name];
    if (name === 'RGBA8') { data.copy(out, 0, 0, need); return out; }
    for (let i = 0; i < w * h; i++) out.set(pick(data, i * bpp), i * 4);
    return out;
  }
  if (BLOCK_DECODER[name] == null) return null;
  const rgba = decodeTexture(data, BLOCK_DECODER[name], w, h, { flip: false });
  // texture.mjs shows BC4 as grey; Godot's RGTC_R is a red channel, like R8.
  if (rgba && name === 'RGTC_R') for (let i = 0; i < rgba.length; i += 4) { rgba[i + 1] = 0; rgba[i + 2] = 0; }
  return rgba;
}

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** The PNG file inside a lossless payload. Godot prefixes it with "PNG " (drivers/png/image_loader_png.cpp, unpack_mem_png). */
function pngPayload(p) {
  const at = p.subarray(0, 4).toString('latin1') === 'PNG ' ? 4 : 0;
  if (p.length < at + 24 || !p.subarray(at, at + 8).equals(PNG_SIG)) return null;
  return { data: p.subarray(at), width: p.readUInt32BE(at + 16), height: p.readUInt32BE(at + 20) };
}
/** The WebP file inside a payload. Godot 3 prefixes it with "WEBP" (modules/webp/image_loader_webp.cpp); Godot 4 stores the RIFF file as is. */
function webpPayload(p) {
  const at = p.subarray(0, 4).toString('latin1') === 'WEBP' && p.subarray(4, 8).toString('latin1') === 'RIFF' ? 4 : 0;
  if (p.length < at + 12 || p.subarray(at, at + 4).toString('latin1') !== 'RIFF' || p.subarray(at + 8, at + 12).toString('latin1') !== 'WEBP') return null;
  return { data: p.subarray(at) };
}

const DATA_FORMATS_4 = ['image', 'png', 'webp', 'basis_universal'];

/**
 * One image as CompressedTexture2D::load_image_from_file reads it (scene/resources/compressed_texture.cpp, master):
 *   u32 data_format (DATA_FORMAT_IMAGE 0, PNG 1, WEBP 2, BASIS_UNIVERSAL 3; compressed_texture.h), u16 width, u16 height,
 *   u32 mipmaps, u32 Image::Format; then for PNG/WEBP mipmaps+1 times { u32 size, bytes }, for BASIS_UNIVERSAL one
 *   { u32 size, bytes }, for IMAGE the raw image data (all mip levels, largest first).
 * Returns the fields, the payload of the largest level, and `end` (offset after this image, null when not known).
 */
function readImage4(buf, off) {
  if (off + 16 > buf.length) throw new RPError('BAD_FORMAT', 'texture image header is truncated');
  const df = buf.readUInt32LE(off), width = buf.readUInt16LE(off + 4), height = buf.readUInt16LE(off + 6), mipmaps = buf.readUInt32LE(off + 8), fmt = buf.readUInt32LE(off + 12);
  const img = { dataFormat: DATA_FORMATS_4[df] ?? `unknown (${df})`, width, height, mipmaps, format: IMAGE_FORMATS_4[fmt] ?? `unknown (${fmt})`, payload: null, end: null };
  let p = off + 16;
  if (df === 1 || df === 2 || df === 3) {
    const levels = df === 3 ? 1 : mipmaps + 1;
    if (levels > 32) throw new RPError('BAD_FORMAT', `texture claims ${levels} mip levels`);
    for (let i = 0; i < levels; i++) {
      if (p + 4 > buf.length) throw new RPError('BAD_FORMAT', 'texture payload is truncated');
      const size = buf.readUInt32LE(p);
      if (p + 4 + size > buf.length) throw new RPError('BAD_FORMAT', 'texture payload is truncated');
      if (i === 0) img.payload = buf.subarray(p + 4, p + 4 + size);
      p += 4 + size;
    }
    img.end = p;
  } else if (df === 0) {
    const need = level0Bytes(img.format, width, height);
    img.payload = buf.subarray(p, need != null ? Math.min(buf.length, p + need) : buf.length);
    if (need != null && img.payload.length < need) throw new RPError('BAD_FORMAT', `texture data is truncated (${img.payload.length} of ${need} bytes)`);
    const whole = mipmaps > 0 ? chainBytes(img.format, width, height) : need;
    img.end = whole != null ? p + whole : null;
  }
  return img;
}

/** One parsed image → { ext, data } or { reason }. */
function imageOutput(img) {
  const where = `${img.width}x${img.height} ${img.format}`;
  if (img.dataFormat === 'png') { const png = pngPayload(img.payload); return png ? { ext: '.png', data: png.data, how: 'stored PNG' } : { reason: `${where}: the lossless payload is not a PNG file` }; }
  if (img.dataFormat === 'webp') {
    const webp = webpPayload(img.payload);
    if (!webp) return { reason: `${where}: the payload is not a WebP file` };
    // Lossless WebP (Godot 4's default for lossless textures) becomes the PNG the project referenced; lossy WebP stays.
    let decoded = null;
    try { decoded = decodeWebp(webp.data); } catch (e) { if (!(e instanceof RPError)) throw e; return { ext: '.webp', data: webp.data, how: `stored WebP (not converted: ${e.message})` }; }
    return decoded ? { ext: '.png', data: encodePng(decoded.rgba, decoded.width, decoded.height), how: 'lossless WebP decoded to PNG' } : { ext: '.webp', data: webp.data, how: 'stored lossy WebP' };
  }
  if (img.dataFormat === 'basis_universal') return { reason: `Basis Universal (${img.payload?.length ?? 0} bytes, ${where}): not transcoded here, the file is left as it is` };
  if (img.dataFormat !== 'image') return { reason: `data format ${img.dataFormat} is not known` };
  const rgba = godotImageToRgba(img.payload, img.format, img.width, img.height);
  if (!rgba) return { reason: `${where} (${img.payload.length} bytes): this pixel format is not decoded here, the file is left as it is` };
  return { ext: '.png', data: encodePng(rgba, img.width, img.height), how: `decoded ${img.format}${img.mipmaps ? ', largest mip level' : ''}` };
}

/**
 * .ctex, Godot 4 CompressedTexture2D::_load_data (scene/resources/compressed_texture.cpp, master):
 *   "GST2", u32 version (FORMAT_VERSION 1), u32 width, u32 height, u32 flags (FORMAT_BIT_HAS_MIPMAPS 1<<23, DETECT_3D
 *   1<<24, DETECT_NORMAL 1<<26, DETECT_ROUGNESS 1<<27), u32 mipmap_limit, 3 × u32 reserved, then one image (readImage4).
 */
export function parseCtex(buf) {
  if (buf.length < 52 || buf.toString('latin1', 0, 4) !== 'GST2') throw new RPError('BAD_FORMAT', 'Not a Godot 4 compressed texture (GST2).');
  const version = buf.readUInt32LE(4);
  if (version > 1) throw new RPError('UNSUPPORTED', `compressed texture version ${version} is newer than this reader (1)`);
  const img = readImage4(buf, 36);
  return { kind: 'CompressedTexture2D', godot: 4, version, width: buf.readUInt32LE(8), height: buf.readUInt32LE(12), flags: buf.readUInt32LE(16), mipmapLimit: buf.readInt32LE(20), images: [img] };
}

/**
 * .ctexarray/.ccube/.ccubearray (CompressedTextureLayered::_load_data) and .ctex3d (CompressedTexture3D::_load_data),
 * same file: "GSTL", u32 version, u32 layer count (3D: depth), u32 layered type (3D: ignored), u32 data format flags,
 * u32 mipmap_limit (3D: mipmap count), 3 × u32 reserved, then the images one after another (readImage4).
 * Reading stops at the first image whose end is not known (raw block-compressed data with mipmaps).
 */
export function parseLayered(buf) {
  if (buf.length < 52 || buf.toString('latin1', 0, 4) !== 'GSTL') throw new RPError('BAD_FORMAT', 'Not a Godot 4 layered texture (GSTL).');
  const version = buf.readUInt32LE(4), layers = buf.readUInt32LE(8);
  if (version > 1) throw new RPError('UNSUPPORTED', `layered texture version ${version} is newer than this reader (1)`);
  if (layers > 4096) throw new RPError('BAD_FORMAT', `layered texture claims ${layers} layers`);
  const images = [];
  let p = 36;
  for (let i = 0; i < layers && p != null; i++) { const img = readImage4(buf, p); images.push(img); p = img.end; }
  return { kind: 'layered texture', godot: 4, version, layers, type: buf.readUInt32LE(12), flags: buf.readUInt32LE(16), mipmapLimit: buf.readInt32LE(20), width: images[0]?.width, height: images[0]?.height, images };
}

/**
 * .stex, Godot 3 StreamTexture::_load_data (scene/resources/texture.cpp, 3.x):
 *   "GDST", u16 width, u16 custom width, u16 height, u16 custom height, u32 texture flags, u32 data format, where the
 *   low 20 bits are the Image::Format (FORMAT_MASK_IMAGE_FORMAT) and FORMAT_BIT_PNG 1<<20, FORMAT_BIT_WEBP 1<<21,
 *   FORMAT_BIT_STREAM 1<<22, FORMAT_BIT_HAS_MIPMAPS 1<<23 (texture.h). PNG/WebP: u32 mipmaps, then per level
 *   { u32 size, bytes }; otherwise the raw image data, largest level first.
 */
export function parseStex(buf) {
  if (buf.length < 20 || buf.toString('latin1', 0, 4) !== 'GDST') throw new RPError('BAD_FORMAT', 'Not a Godot 3 stream texture (GDST).');
  const width = buf.readUInt16LE(4), height = buf.readUInt16LE(8), flags = buf.readUInt32LE(12), df = buf.readUInt32LE(16);
  const fmt = df & 0xfffff, isPng = !!(df & (1 << 20)), isWebp = !!(df & (1 << 21)), hasMips = !!(df & (1 << 23));
  const img = { dataFormat: isPng ? 'png' : isWebp ? 'webp' : 'image', width, height, mipmaps: hasMips ? 1 : 0, format: IMAGE_FORMATS_3[fmt] ?? `unknown (${fmt})`, payload: null, end: null };
  if (isPng || isWebp) {
    if (buf.length < 28) throw new RPError('BAD_FORMAT', 'texture payload is truncated');
    img.mipmaps = Math.max(0, buf.readUInt32LE(20) - 1);
    const size = buf.readUInt32LE(24);
    if (28 + size > buf.length) throw new RPError('BAD_FORMAT', 'texture payload is truncated');
    img.payload = buf.subarray(28, 28 + size);
    img.format = isPng ? 'PNG' : 'WebP'; // the format bits are not used for these
  } else {
    const need = level0Bytes(img.format, width, height);
    img.payload = buf.subarray(20, need != null ? Math.min(buf.length, 20 + need) : buf.length);
    if (need != null && img.payload.length < need) throw new RPError('BAD_FORMAT', `texture data is truncated (${img.payload.length} of ${need} bytes)`);
  }
  return { kind: 'StreamTexture', godot: 3, width, height, customWidth: buf.readUInt16LE(6), customHeight: buf.readUInt16LE(10), flags, mipmapLimit: null, images: [img] };
}

function convertTexture(buf, magic) {
  const tex = magic === 'GST2' ? parseCtex(buf) : magic === 'GDST' ? parseStex(buf) : parseLayered(buf);
  const first = tex.images[0];
  const info = { kind: tex.kind, godot: tex.godot, width: tex.width, height: tex.height, dataFormat: first?.dataFormat, format: first?.format, mipmaps: first?.mipmaps, flags: tex.flags, ...(tex.mipmapLimit != null ? { mipmapLimit: tex.mipmapLimit } : {}), ...(tex.version != null ? { version: tex.version } : {}), ...(tex.layers != null ? { layers: tex.layers } : {}) };
  const outs = tex.images.map(imageOutput);
  const bad = outs.find(o => o.reason);
  if (!outs.length || bad) return { info, outputs: [], notConverted: bad?.reason ?? 'no image data' };
  if (magic === 'GSTL') {
    if (tex.images.length < tex.layers) return { info, outputs: [], notConverted: `${tex.layers} layers of ${first.width}x${first.height} ${first.format} with mipmaps: where each layer starts depends on the Godot version, the file is left as it is` };
    return { info: { ...info, how: outs[0].how }, outputs: outs.map((o, i) => ({ ext: o.ext, data: o.data, part: `layer${i}` })) };
  }
  return { info: { ...info, how: outs[0].how }, outputs: [{ ext: outs[0].ext, data: outs[0].data }] };
}

// ------------------------------------------------------------------------------------------------ resources
const propsOf = res => Object.fromEntries(res.props);
const val = (props, name, fallback) => (props[name] && props[name].value != null ? props[name].value : fallback);
const bytesOf = v => (v && v.kind === 'PackedByteArray' ? (Buffer.isBuffer(v.value) ? v.value : Buffer.from(v.value)) : null);
const mainOf = (r, types) => r.resources.find(x => types.includes(x.type)) ?? null;

// ---- audio: .sample
const IMA_STEP = [7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45, 50, 55, 60, 66, 73, 80, 88, 97, 107, 118, 130, 143, 157, 173, 190, 209, 230, 253, 279, 307, 337, 371, 408, 449, 494, 544, 598, 658, 724, 796, 876, 963, 1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066, 2272, 2499, 2749, 3024, 3327, 3660, 4026, 4428, 4871, 5358, 5894, 6484, 7132, 7845, 8630, 9493, 10442, 11487, 12635, 13899, 15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794, 32767];
const IMA_INDEX = [-1, -1, -1, -1, 2, 4, 6, 8, -1, -1, -1, -1, 2, 4, 6, 8];
/**
 * Godot's IMA ADPCM is one continuous nibble stream without the block headers of WAVE_FORMAT_IMA_ADPCM, so it is
 * decoded to 16-bit PCM exactly as the mixer does (AudioStreamPlaybackWAV::do_resample, scene/resources/
 * audio_stream_wav.cpp 4.3 / audio_stream_sample.cpp 3.x): predictor 0 and step index 0 at the start, low nibble
 * first, and for stereo byte (n >> 1) * 2 + channel holds nibble n of that channel.
 */
export function decodeGodotAdpcm(data, stereo) {
  const ch = stereo ? 2 : 1, frames = Math.floor(data.length / ch) * 2;
  const out = Buffer.alloc(frames * ch * 2);
  for (let c = 0; c < ch; c++) {
    let predictor = 0, index = 0;
    for (let n = 0; n < frames; n++) {
      const byte = data[(n >> 1) * ch + c], nibble = n & 1 ? byte >> 4 : byte & 15, step = IMA_STEP[index];
      index = Math.min(88, Math.max(0, index + IMA_INDEX[nibble]));
      let diff = step >> 3;
      if (nibble & 1) diff += step >> 2;
      if (nibble & 2) diff += step >> 1;
      if (nibble & 4) diff += step;
      predictor = Math.min(0x7fff, Math.max(-0x8000, predictor + (nibble & 8 ? -diff : diff)));
      out.writeInt16LE(predictor, (n * ch + c) * 2);
    }
  }
  return out;
}

// QOA, "Quite OK Audio" (thirdparty/misc/qoa.h in Godot 4.3+, MIT, Dominic Szablewski): what the WAV importer
// writes for "compress mode: QOA", the default in Godot 4.3+. The sample data is a whole QOA file: u64 header
// ('qoaf', total samples per channel), then frames of u64 header (channels, rate, samples, frame size), the LMS state
// per channel (4 x i16 history, 4 x i16 weights) and 64-bit slices (4-bit scale factor, 20 x 3-bit residuals).
// All values are big-endian. This follows qoa_decode_frame step by step; integer maths as in C (32-bit, arithmetic shifts).
const QOA_SLICE_LEN = 20, QOA_LMS_LEN = 4;
const QOA_DEQUANT = [1, 7, 21, 45, 84, 138, 211, 304, 421, 562, 731, 928, 1157, 1419, 1715, 2048].map(sf => [0.75, -0.75, 2.5, -2.5, 4.5, -4.5, 7, -7].map(d => { const v = sf * d; return Math.sign(v) * Math.round(Math.abs(v)); }));

/** A QOA file → { channels, sampleRate, frames, pcm (interleaved 16-bit little-endian) }. */
export function decodeQoa(buf) {
  if (buf.length < 16 || buf.toString('latin1', 0, 4) !== 'qoaf') throw new RPError('BAD_FORMAT', 'not QOA data (no "qoaf" header)');
  const total = buf.readUInt32BE(4);
  const channels = buf[8], sampleRate = buf.readUIntBE(9, 3);
  if (!total || !channels || !sampleRate) throw new RPError('BAD_FORMAT', 'QOA header without samples, channels or sample rate');
  const out = Buffer.alloc(total * channels * 2);
  const history = Array.from({ length: channels }, () => new Int32Array(QOA_LMS_LEN));
  const weights = Array.from({ length: channels }, () => new Int32Array(QOA_LMS_LEN));
  let p = 8, done = 0;
  while (done < total && p + 8 <= buf.length) {
    const ch = buf[p], rate = buf.readUIntBE(p + 1, 3), samples = buf.readUInt16BE(p + 4), size = buf.readUInt16BE(p + 6);
    const slices = Math.floor((size - 8 - QOA_LMS_LEN * 4 * ch) / 8);
    if (ch !== channels || rate !== sampleRate || p + size > buf.length || samples * ch > slices * QOA_SLICE_LEN || done + samples > total) break;
    let q = p + 8;
    for (let c = 0; c < ch; c++) {
      for (let i = 0; i < QOA_LMS_LEN; i++) { history[c][i] = buf.readInt16BE(q + i * 2); weights[c][i] = buf.readInt16BE(q + 8 + i * 2); }
      q += 16;
    }
    for (let si = 0; si < samples; si += QOA_SLICE_LEN) {
      for (let c = 0; c < ch; c++) {
        const hi = buf.readUInt32BE(q), lo = buf.readUInt32BE(q + 4); q += 8;
        const dq = QOA_DEQUANT[hi >>> 28];
        const end = Math.min(si + QOA_SLICE_LEN, samples);
        const h = history[c], w = weights[c];
        for (let k = 0, n = si; n < end; k++, n++) {
          const bit = 57 - 3 * k; // the k-th 3-bit residual, counted from bit 59 down
          const quant = bit >= 32 ? (hi >>> (bit - 32)) & 7 : bit >= 0 && bit <= 29 ? (lo >>> bit) & 7 : ((hi << (32 - bit)) | (lo >>> bit)) & 7;
          const predicted = ((w[0] * h[0] + w[1] * h[1] + w[2] * h[2] + w[3] * h[3]) | 0) >> 13;
          const residual = dq[quant];
          const sample = Math.max(-32768, Math.min(32767, predicted + residual));
          out.writeInt16LE(sample, ((done + n) * channels + c) * 2);
          const delta = residual >> 4;
          for (let i = 0; i < QOA_LMS_LEN; i++) w[i] = (w[i] + (h[i] < 0 ? -delta : delta)) | 0;
          h[0] = h[1]; h[1] = h[2]; h[2] = h[3]; h[3] = sample;
        }
      }
    }
    done += samples; p += size;
  }
  if (done < total) throw new RPError('BAD_FORMAT', `QOA data ends after ${done} of ${total} samples`);
  return { channels, sampleRate, frames: total, pcm: out };
}

const fourcc = (id, data) => { const head = Buffer.alloc(8); head.write(id, 0, 'latin1'); head.writeUInt32LE(data.length, 4); return Buffer.concat([head, data, Buffer.alloc(data.length & 1)]); };

/**
 * AudioStreamWAV (Godot 3: AudioStreamSample) → RIFF/WAVE. Properties (audio_stream_wav.cpp _bind_methods): data,
 * format (0 8-bit signed, 1 16-bit, 2 IMA ADPCM, 3 QOA), loop_mode (0 off, 1 forward, 2 ping-pong, 3 backward),
 * loop_begin, loop_end (frames), mix_rate (default 44100), stereo. As save_to_wav does: 8-bit samples are stored
 * signed and get +128, 16-bit is copied. Loops go in a `smpl` chunk with the values the WAV importer reads back
 * (editor/import/resource_importer_wav.cpp: loop type 0/1/2, then loop_begin and loop_end as stored).
 */
export function sampleToWav(res) {
  const props = propsOf(res);
  const data = bytesOf(props.data);
  if (!data) return { notConverted: 'no data property (an empty sample)' };
  const format = val(props, 'format', 0), rate = val(props, 'mix_rate', 44100), stereo = !!val(props, 'stereo', false), loopMode = val(props, 'loop_mode', 0);
  const ch = stereo ? 2 : 1;
  const info = { kind: res.type, sampleFormat: ['8-bit', '16-bit', 'IMA ADPCM', 'QOA'][format] ?? `unknown (${format})`, mixRate: rate, channels: ch, bytes: data.length };
  let pcm, bits;
  if (format === 0) { pcm = Buffer.from(data.map(b => (b + 128) & 255)); bits = 8; }
  else if (format === 1) { pcm = data.subarray(0, data.length - (data.length % (2 * ch))); bits = 16; }
  else if (format === 2) { pcm = decodeGodotAdpcm(data, stereo); bits = 16; info.how = 'IMA ADPCM decoded to 16-bit PCM (Godot stores it without WAV block headers)'; }
  else if (format === 3) {
    try { pcm = decodeQoa(data).pcm; } catch (e) { if (!(e instanceof RPError)) throw e; return { info, notConverted: `QOA audio (${data.length} bytes, ${rate} Hz, ${ch} channel${ch > 1 ? 's' : ''}) did not decode: ${e.message}` }; }
    bits = 16; info.how = 'QOA decoded to 16-bit PCM (QOA is lossy: this is what the game plays, not the original recording)';
  }
  else return { info, notConverted: `sample format ${format} is not known` };
  const align = ch * (bits / 8), frames = pcm.length / align;
  const fmt = Buffer.alloc(16);
  fmt.writeUInt16LE(1, 0); fmt.writeUInt16LE(ch, 2); fmt.writeUInt32LE(rate, 4); fmt.writeUInt32LE(rate * align, 8); fmt.writeUInt16LE(align, 12); fmt.writeUInt16LE(bits, 14);
  const chunks = [fourcc('fmt ', fmt), fourcc('data', pcm)];
  if (loopMode >= 1 && loopMode <= 3) {
    const begin = val(props, 'loop_begin', 0), end = val(props, 'loop_end', 0) || frames;
    const smpl = Buffer.alloc(60);
    smpl.writeUInt32LE(Math.round(1e9 / rate), 8); smpl.writeUInt32LE(60, 12); smpl.writeUInt32LE(1, 28); // sample period (ns), MIDI unity note, one loop
    smpl.writeUInt32LE(loopMode - 1, 40); smpl.writeUInt32LE(begin, 44); smpl.writeUInt32LE(end, 48);
    chunks.push(fourcc('smpl', smpl));
    info.loop = { mode: ['forward', 'ping-pong', 'backward'][loopMode - 1], begin, end };
  }
  const body = Buffer.concat([Buffer.from('WAVE', 'latin1'), ...chunks]);
  const riff = Buffer.alloc(8); riff.write('RIFF', 0, 'latin1'); riff.writeUInt32LE(body.length, 4);
  return { info: { ...info, frames, bits }, outputs: [{ ext: '.wav', data: Buffer.concat([riff, body]) }] };
}

// ---- audio: Ogg
// Ogg page checksum (RFC 3533): CRC-32 with polynomial 0x04c11db7, most significant bit first, start value 0, no
// final xor, over the whole page with the checksum field zeroed. Not zlib's CRC-32.
const OGG_CRC = new Uint32Array(256).map((_, n) => { let r = n << 24; for (let k = 0; k < 8; k++) r = r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1; return r >>> 0; });
export function oggCrc(buf) { let c = 0; for (let i = 0; i < buf.length; i++) c = ((c << 8) ^ OGG_CRC[((c >>> 24) ^ buf[i]) & 0xff]) >>> 0; return c; }

function oggPage({ lacing, body, granule, serial, sequence, continued, bos, eos }) {
  const head = Buffer.alloc(27 + lacing.length);
  head.write('OggS', 0, 'latin1');
  head[5] = (continued ? 1 : 0) | (bos ? 2 : 0) | (eos ? 4 : 0);
  head.writeBigInt64LE(BigInt(granule), 6); head.writeUInt32LE(serial, 14); head.writeUInt32LE(sequence, 18);
  head[26] = lacing.length; head.set(lacing, 27);
  const page = Buffer.concat([head, ...body]);
  page.writeUInt32LE(oggCrc(page), 22);
  return page;
}

/**
 * OggPacketSequence (modules/ogg/ogg_packet_sequence.cpp: packet_data = one array of packets per original page,
 * granule_positions = that page's granule position) → an Ogg stream. Each stored page becomes one Ogg page with the
 * same packets and granule position, so the page boundaries Vorbis needs (identification header alone on the first
 * page, audio starting on a fresh page) are the ones the original file had. A stored page whose first packet began
 * on earlier pages has more than 255 segments; the head of that packet then goes on pages of its own (flagged as
 * continued, granule position -1: no packet ends there), as an Ogg muxer writes it.
 */
export function oggFromPackets(pages, granules, { serial = 0x47445245 } = {}) {
  if (!pages.length) throw new RPError('BAD_FORMAT', 'the packet sequence has no pages');
  if (granules.length !== pages.length) throw new RPError('BAD_FORMAT', `the packet sequence has ${pages.length} pages but ${granules.length} granule positions`);
  const out = [];
  let sequence = 0;
  const emit = (lacing, body, granule, continued, last) => { out.push(oggPage({ lacing, body, granule, serial, sequence, continued, bos: sequence === 0, eos: last })); sequence++; };
  pages.forEach((packets, i) => {
    if (!packets.length) throw new RPError('BAD_FORMAT', `stored page ${i} has no packets`);
    const segs = packets.map(p => Math.floor(p.length / 255) + 1);
    const rest = segs.slice(1).reduce((a, b) => a + b, 0);
    if (rest > 254) throw new RPError('UNSUPPORTED', `stored page ${i} holds more packets than one Ogg page can (${rest + 1} segments after the first packet)`);
    let headSegs = Math.max(0, segs[0] - (255 - rest)), pos = 0, continued = false;
    const first = packets[0];
    while (headSegs > 0) { // whole 255-byte segments of the first packet; its last segment stays on the final page
      const n = Math.min(255, headSegs);
      emit(new Uint8Array(n).fill(255), [first.subarray(pos, pos + n * 255)], -1, continued, false);
      pos += n * 255; headSegs -= n; continued = true;
    }
    const lacing = [], body = [];
    packets.forEach((p, k) => {
      const from = k === 0 ? pos : 0, len = p.length - from;
      for (let s = 0; s < Math.floor(len / 255); s++) lacing.push(255);
      lacing.push(len % 255);
      body.push(p.subarray(from));
    });
    emit(Uint8Array.from(lacing), body, granules[i], continued, i === pages.length - 1);
  });
  return Buffer.concat(out);
}

function oggStreamToOgg(r, res) {
  const props = propsOf(res);
  const loop = val(props, 'loop', false) ? { loop: true, loopOffset: val(props, 'loop_offset', 0) } : {};
  const whole = bytesOf(props.data); // Godot 3 AudioStreamOGGVorbis: the .ogg file itself
  if (whole) {
    if (whole.subarray(0, 4).toString('latin1') !== 'OggS') return { info: { kind: res.type }, notConverted: `the data property (${whole.length} bytes) does not start with an Ogg page` };
    return { info: { kind: res.type, how: 'data property copied', bytes: whole.length, ...loop }, outputs: [{ ext: '.ogg', data: whole }] };
  }
  const seq = mainOf(r, ['OggPacketSequence']);
  if (!seq) return { info: { kind: res.type }, notConverted: 'no data property and no OggPacketSequence in the resource' };
  const sp = propsOf(seq);
  const pageList = sp.packet_data?.kind === 'array' ? sp.packet_data.value : null;
  if (!pageList) return { info: { kind: res.type }, notConverted: 'the OggPacketSequence has no packet_data' };
  const pages = pageList.map(pg => (pg.kind === 'array' ? pg.value.map(bytesOf) : []));
  if (pages.some(pg => pg.some(p => !p))) return { info: { kind: res.type }, notConverted: 'packet_data holds something other than byte arrays' };
  const granules = sp.granule_positions?.value ?? [];
  let data;
  try { data = oggFromPackets(pages, granules); } catch (e) { return { info: { kind: res.type, pages: pages.length }, notConverted: `${e.message}: the file is left as it is` }; }
  return { info: { kind: res.type, how: 'Ogg pages rebuilt from the stored packets', pages: pages.length, packets: pages.reduce((a, p) => a + p.length, 0), samplingRate: val(sp, 'sampling_rate', null), bytes: data.length, ...loop }, outputs: [{ ext: '.ogg', data }] };
}

function mp3StreamToMp3(res) {
  const data = bytesOf(propsOf(res).data);
  if (!data) return { info: { kind: res.type }, notConverted: 'no data property' };
  return { info: { kind: res.type, how: 'data property copied', bytes: data.length }, outputs: [{ ext: '.mp3', data }] };
}

// ---- translations
// The decoding codebook of smaz, copied from Smaz_rcb in Godot's thirdparty/misc/smaz.c (254 entries).
const SMAZ = [' ', 'the', 'e', 't', 'a', 'of', 'o', 'and', 'i', 'n', 's', 'e ', 'r', ' th', ' t', 'in', 'he', 'th', 'h', 'he ', 'to', '\r\n', 'l', 's ', 'd', ' a', 'an',
  'er', 'c', ' o', 'd ', 'on', ' of', 're', 'of ', 't ', ', ', 'is', 'u', 'at', '   ', 'n ', 'or', 'which', 'f', 'm', 'as', 'it', 'that', '\n', 'was', 'en',
  '  ', ' w', 'es', ' an', ' i', '\r', 'f ', 'g', 'p', 'nd', ' s', 'nd ', 'ed ', 'w', 'ed', 'http://', 'for', 'te', 'ing', 'y ', 'The', ' c', 'ti', 'r ', 'his',
  'st', ' in', 'ar', 'nt', ',', ' to', 'y', 'ng', ' h', 'with', 'le', 'al', 'to ', 'b', 'ou', 'be', 'were', ' b', 'se', 'o ', 'ent', 'ha', 'ng ', 'their', '"',
  'hi', 'from', ' f', 'in ', 'de', 'ion', 'me', 'v', '.', 've', 'all', 're ', 'ri', 'ro', 'is ', 'co', 'f t', 'are', 'ea', '. ', 'her', ' m', 'er ', ' p',
  'es ', 'by', 'they', 'di', 'ra', 'ic', 'not', 's, ', 'd t', 'at ', 'ce', 'la', 'h ', 'ne', 'as ', 'tio', 'on ', 'n t', 'io', 'we', ' a ', 'om', ', a', 's o',
  'ur', 'li', 'll', 'ch', 'had', 'this', 'e t', 'g ', 'e\r\n', ' wh', 'ere', ' co', 'e o', 'a ', 'us', ' d', 'ss', '\n\r\n', '\r\n\r', '="', ' be', ' e',
  's a', 'ma', 'one', 't t', 'or ', 'but', 'el', 'so', 'l ', 'e s', 's,', 'no', 'ter', ' wa', 'iv', 'ho', 'e a', ' r', 'hat', 's t', 'ns', 'ch ', 'wh', 'tr',
  'ut', '/', 'have', 'ly ', 'ta', ' ha', ' on', 'tha', '-', ' l', 'ati', 'en ', 'pe', ' re', 'there', 'ass', 'si', ' fo', 'wa', 'ec', 'our', 'who', 'its', 'z',
  'fo', 'rs', '>', 'ot', 'un', '<', 'im', 'th ', 'nc', 'ate', '><', 'ver', 'ad', ' we', 'ly', 'ee', ' n', 'id', ' cl', 'ac', 'il', '</', 'rt', ' wi', 'div',
  'e, ', ' it', 'whi', ' ma', 'ge', 'x', 'e c', 'men', '.com'].map(s => Buffer.from(s, 'latin1'));

/** smaz_decompress (thirdparty/misc/smaz.c): 254 = one verbatim byte follows, 255 = length-1 and that many verbatim bytes, else a codebook entry. */
export function smazDecompress(src) {
  const out = [];
  for (let i = 0; i < src.length;) {
    const c = src[i];
    if (c === 254) { if (i + 2 > src.length) throw new RPError('BAD_FORMAT', 'smaz data is truncated'); out.push(src.subarray(i + 1, i + 2)); i += 2; }
    else if (c === 255) { if (i + 2 > src.length) throw new RPError('BAD_FORMAT', 'smaz data is truncated'); const len = src[i + 1] + 1; if (i + 2 + len > src.length) throw new RPError('BAD_FORMAT', 'smaz data is truncated'); out.push(src.subarray(i + 2, i + 2 + len)); i += 2 + len; }
    else { out.push(SMAZ[c]); i++; }
  }
  return Buffer.concat(out);
}

/**
 * OptimizedTranslation::hash (core/string/optimized_translation.h; PHashTranslation in 3.x): d = 0x1000193 when 0,
 * then d = d * 0x1000193 ^ byte over the UTF-8 key. Godot 3 and early 4 xor the byte as a signed char, which only
 * differs for non-ASCII keys: `signed` selects that variant.
 */
export function translationHash(d, key, signed = false) {
  let h = d === 0 ? 0x1000193 : d;
  for (const b of Buffer.from(key, 'utf8')) h = Math.imul(h, 0x1000193) ^ (signed && b > 127 ? b | 0xffffff00 : b);
  return h >>> 0;
}

/**
 * The stored texts of a compressed translation (OptimizedTranslation::get_translated_message_list): hash_table[i] is
 * an offset into bucket_table or 0xFFFFFFFF; a bucket is { int size, u32 func, size × { u32 key, u32 str_offset,
 * u32 comp_size, u32 uncomp_size } }; a text is raw UTF-8 when comp_size == uncomp_size and smaz otherwise.
 */
export function readOptimizedTranslation(res) {
  const props = propsOf(res);
  const ht = props.hash_table?.value ?? [], bt = props.bucket_table?.value ?? [], strings = bytesOf(props.strings) ?? Buffer.alloc(0);
  const texts = [];
  ht.forEach((raw, slot) => {
    const p = raw >>> 0;
    if (p === 0xffffffff) return;
    const size = bt[p], func = bt[p + 1] >>> 0;
    if (!(size >= 0) || p + 2 + size * 4 > bt.length) throw new RPError('BAD_FORMAT', `translation bucket at ${p} is outside the bucket table`);
    for (let j = 0; j < size; j++) {
      const e = p + 2 + j * 4, key = bt[e] >>> 0, off = bt[e + 1] >>> 0, comp = bt[e + 2] >>> 0, uncomp = bt[e + 3] >>> 0;
      if (off + comp > strings.length) throw new RPError('BAD_FORMAT', 'translation string is outside the strings table');
      const stored = strings.subarray(off, off + comp);
      let text = null, compressed = comp !== uncomp, error;
      try { text = (compressed ? smazDecompress(stored) : stored).toString('utf8').replace(/\0+$/, ''); } catch (err) { error = err.message; }
      texts.push({ slot, bucket: p, func, hash: key, compressed, text, ...(error ? { error } : {}) });
    }
  });
  return { locale: val(props, 'locale', null), hashTable: ht, texts };
}

/** Godot's own lookup (OptimizedTranslation::get_message) for one candidate key: the matching entry of `texts` or null. */
function lookupKey(tr, index, key) {
  const size = tr.hashTable.length;
  if (!size) return null;
  for (const signed of [false, true]) {
    const p = tr.hashTable[translationHash(0, key, signed) % size] >>> 0;
    if (p === 0xffffffff) continue;
    const funcs = index.get(p);
    if (!funcs) continue;
    const hit = funcs.entries.get(translationHash(funcs.func, key, signed));
    if (hit) return hit;
    if (!/[^\x00-\x7f]/.test(key)) break;
  }
  return null;
}

const csvCell = s => (/[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
const csvText = rows => rows.map(r => r.map(csvCell).join(',')).join('\n') + '\n';

/**
 * A .translation resource → CSV. PHashTranslation/OptimizedTranslation keep only hashes of the keys, so a key is
 * recovered only when it is among `keys` (candidates): each is looked up the way the engine does. Texts without a
 * key go in a second CSV with the stored hash instead. A plain Translation (messages) has its keys and is written whole.
 */
export function translationToCsv(r, rel, keys = []) {
  const res = mainOf(r, ['PHashTranslation', 'OptimizedTranslation', 'Translation']);
  if (!res) return { info: { kind: r.type }, notConverted: `${r.type} is not a translation resource` };
  const props = propsOf(res);
  const fromName = rel.split('/').pop().match(/\.([A-Za-z]{2,3}(?:[_-][A-Za-z0-9]+)*)\.translation$/i)?.[1] ?? null;
  const locale = val(props, 'locale', null) ?? fromName ?? 'unknown';
  const localeFrom = props.locale ? 'locale property' : fromName ? 'file name' : 'not stored';
  if (props.messages && !props.hash_table) {
    const m = props.messages;
    const pairs = m.kind === 'dict' ? m.value.map(([k, v]) => [String(k.value), String(v.value ?? '')]) : m.kind === 'PackedStringArray' ? m.value.reduce((a, s, i) => (i % 2 ? (a.at(-1).push(s), a) : (a.push([s]), a)), []).filter(p => p.length === 2) : [];
    return { info: { kind: res.type, locale, localeFrom, texts: pairs.length, matched: pairs.length, withoutKey: 0, how: 'keys are stored in the resource' }, outputs: [{ ext: '.csv', data: Buffer.from(csvText([['keys', locale], ...pairs])) }] };
  }
  const tr = readOptimizedTranslation(res);
  const index = new Map();
  for (const t of tr.texts) { if (!index.has(t.bucket)) index.set(t.bucket, { func: t.func, entries: new Map() }); index.get(t.bucket).entries.set(t.hash, t); }
  let tried = 0;
  for (const key of new Set(keys)) {
    if (typeof key !== 'string' || !key) continue;
    tried++;
    const hit = lookupKey(tr, index, key);
    if (hit && hit.key === undefined) hit.key = key;
  }
  const readable = tr.texts.filter(t => t.text != null), unreadable = tr.texts.length - readable.length;
  const matched = readable.filter(t => t.key !== undefined), unmatched = readable.filter(t => t.key === undefined);
  const outputs = [{ ext: '.csv', data: Buffer.from(csvText([['keys', locale], ...matched.map(t => [t.key, t.text])])) }];
  if (unmatched.length) outputs.push({ ext: '.csv', part: 'unmatched', data: Buffer.from(csvText([['key_hash', locale], ...unmatched.map(t => [`${t.func.toString(16)}:${t.hash.toString(16).padStart(8, '0')}`, t.text])])) });
  return {
    info: { kind: res.type, locale, localeFrom, texts: tr.texts.length, smazCompressed: tr.texts.filter(t => t.compressed).length, candidateKeys: tried, matched: matched.length, withoutKey: unmatched.length, ...(unreadable ? { unreadable } : {}),
      note: unmatched.length ? `${unmatched.length} of ${tr.texts.length} texts have no key: the file stores only key hashes and no candidate key matched. They are in the .unmatched.csv with their hash; pass more candidates in keys.` : `all ${matched.length} texts matched a candidate key` },
    outputs,
  };
}

// ---- candidate keys
const unescape = s => s.replace(/\\(u[0-9a-fA-F]{4}|.)/g, (_, c) => (c === 'n' ? '\n' : c === 't' ? '\t' : c === 'r' ? '\r' : c[0] === 'u' ? String.fromCharCode(parseInt(c.slice(1), 16)) : c));
/** Candidate translation keys in script or scene text: every string literal (tr("KEY") arguments, text = "KEY" properties, ...). */
export function keysInText(text) {
  const out = [];
  for (const m of text.matchAll(/"((?:\\.|[^"\\\n]){1,300})"|'((?:\\.|[^'\\\n]){1,300})'/g)) out.push(unescape(m[1] ?? m[2]));
  return out;
}
/** First column of a translation CSV (the keys), without the header row. Quoted cells may hold commas, newlines and "". */
export function keysInCsv(text) {
  const out = [];
  let cell = '', col = 0, row = 0, quoted = false;
  const endCell = () => { if (col === 0 && row > 0 && cell) out.push(cell); cell = ''; col++; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false; } else cell += c; }
    else if (c === '"') quoted = true;
    else if (c === ',') endCell();
    else if (c === '\n') { endCell(); col = 0; row++; }
    else if (c !== '\r') cell += c;
  }
  if (cell || col) endCell();
  return out;
}

// ------------------------------------------------------------------------------------------------ .import files
/**
 * A .import side file (Godot's ConfigFile text): [remap] path="res://.godot/imported/icon.png-<md5>.ctex" (Godot 3:
 * res://.import/...stex; also path.s3tc, path.etc2, ... for per-platform variants) and [deps] source_file="res://icon.png".
 * Exports keep only [remap]; the original is then the .import file's own path without ".import".
 */
export function parseImportFile(text, importRel) {
  const strip = s => s.replace(/^res:\/\//, '');
  let section = '', source = null;
  const paths = [];
  for (const line of text.split(/\r?\n/)) {
    const sec = line.match(/^\[([^\]]+)\]\s*$/);
    if (sec) { section = sec[1]; continue; }
    const kv = line.match(/^([A-Za-z0-9_.\/]+)\s*=\s*"((?:\\.|[^"\\])*)"\s*$/);
    if (!kv) continue;
    if (section === 'remap' && /^path(\.|$)/.test(kv[1])) paths.push(strip(kv[2]));
    else if (section === 'deps' && kv[1] === 'source_file') source = strip(kv[2]);
  }
  if (!source && importRel) source = importRel.replace(/\.import$/i, '');
  return { source, paths };
}

/** Where a converted file goes: the original name when the .import files know it, else beside the imported file. */
export function importedDest(rel, source, ext, part) {
  const tag = part ? `.${part}` : '';
  if (source) {
    const dot = source.lastIndexOf('.'), slash = source.lastIndexOf('/');
    const stem = dot > slash + 1 ? source.slice(0, dot) : source, srcExt = dot > slash + 1 ? source.slice(dot) : '';
    // Same type as the original: its exact name. Otherwise (an .svg or .jpg that was stored as PNG) keep the full name and add the real type.
    return srcExt.toLowerCase() === ext ? `${stem}${tag}${ext}` : `${source}${tag}${ext}`;
  }
  return `${rel.replace(IMPORTED_RE, '')}${tag}${ext}`;
}

// ------------------------------------------------------------------------------------------------ entry
/**
 * Convert one imported resource. `readRsrc` is godotbin's binary resource reader (passed in, godotbin imports this
 * module). Returns { info, outputs: [{ ext, data, part? }], notConverted? }; outputs is empty when notConverted is set.
 */
export function convertImported(buf, rel, { readRsrc, keys = [] } = {}) {
  const magic = buf.toString('latin1', 0, 4);
  if (TEXTURE_MAGICS.has(magic)) return convertTexture(buf, magic);
  if (magic !== 'RSRC' && magic !== 'RSCC') return { info: {}, outputs: [], notConverted: `${/\.image$/i.test(rel) ? 'an Image file' : 'this imported file'} (${buf.length} bytes, starts with ${JSON.stringify(magic)}) is not a layout this reader knows, the file is left as it is` };
  const r = readRsrc(buf, { byteBuffers: true });
  let out;
  if (r.type === 'AudioStreamWAV' || r.type === 'AudioStreamSample') out = sampleToWav(mainOf(r, [r.type]) ?? r.resources.at(-1));
  else if (r.type === 'AudioStreamOggVorbis' || r.type === 'AudioStreamOGGVorbis') out = oggStreamToOgg(r, mainOf(r, [r.type]) ?? r.resources.at(-1));
  else if (r.type === 'AudioStreamMP3') out = mp3StreamToMp3(mainOf(r, [r.type]) ?? r.resources.at(-1));
  else if (/Translation$/.test(r.type)) out = translationToCsv(r, rel, keys);
  else out = { info: { kind: r.type }, notConverted: `${r.type} resources are not converted to a source format` };
  return { info: { godot: r.major, ...out.info }, outputs: out.notConverted ? [] : out.outputs, ...(out.notConverted ? { notConverted: out.notConverted } : {}) };
}
