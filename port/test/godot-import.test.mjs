import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { tempDir, buildPng, buildRsrc, rv, buildCtex, buildCtexLayered, buildStex, godotPngPayload, buildSample, buildOggStr3, buildOggVorbisStr4, buildMp3Str, buildTranslation, buildImportFile } from './helpers.mjs';
import { decodeTool } from '../src/godotbin.mjs';
import { parseCtex, parseStex, oggCrc, oggFromPackets, smazDecompress, translationHash, decodeGodotAdpcm, parseImportFile, keysInCsv, keysInText, GODOT_IMAGE_FORMATS } from '../src/godot-import.mjs';

// ---------------------------------------------------------------- readers for what the tool writes
/** PNG → { width, height, rgba }; rgba inflates the pixels (8-bit RGBA, filter 0 rows: what encodePng writes). */
function readPng(buf) {
  assert.equal(buf.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'PNG signature');
  assert.equal(buf.toString('latin1', 12, 16), 'IHDR');
  const width = buf.readUInt32BE(16), height = buf.readUInt32BE(20), depth = buf[24], colour = buf[25];
  const idat = [];
  for (let p = 8; p < buf.length;) { const len = buf.readUInt32BE(p), type = buf.toString('latin1', p + 4, p + 8); if (type === 'IDAT') idat.push(buf.subarray(p + 8, p + 8 + len)); p += 12 + len; }
  return { width, height, get rgba() {
    assert.deepEqual([depth, colour], [8, 6], '8-bit RGBA');
    const raw = zlib.inflateSync(Buffer.concat(idat)), rgba = Buffer.alloc(width * height * 4);
    for (let y = 0; y < height; y++) { assert.equal(raw[y * (width * 4 + 1)], 0, 'filter 0'); raw.copy(rgba, y * width * 4, y * (width * 4 + 1) + 1, (y + 1) * (width * 4 + 1)); }
    return rgba;
  } };
}
/** RIFF/WAVE → { chunk id: data }. */
function readWav(buf) {
  assert.equal(buf.toString('latin1', 0, 4), 'RIFF');
  assert.equal(buf.readUInt32LE(4), buf.length - 8, 'RIFF size');
  assert.equal(buf.toString('latin1', 8, 12), 'WAVE');
  const chunks = {};
  for (let p = 12; p < buf.length;) { const id = buf.toString('latin1', p, p + 4), len = buf.readUInt32LE(p + 4); chunks[id] = buf.subarray(p + 8, p + 8 + len); p += 8 + len + (len & 1); }
  return chunks;
}
const fmtOf = c => ({ tag: c['fmt '].readUInt16LE(0), channels: c['fmt '].readUInt16LE(2), rate: c['fmt '].readUInt32LE(4), byteRate: c['fmt '].readUInt32LE(8), align: c['fmt '].readUInt16LE(12), bits: c['fmt '].readUInt16LE(14) });
/** Ogg stream → pages with verified checksums, and the packets they carry. */
function readOgg(buf) {
  const pages = [], packets = [];
  let partial = [];
  for (let p = 0; p < buf.length;) {
    assert.equal(buf.toString('latin1', p, p + 4), 'OggS', `page at ${p}`);
    const nseg = buf[p + 26], lacing = [...buf.subarray(p + 27, p + 27 + nseg)], size = 27 + nseg + lacing.reduce((a, b) => a + b, 0);
    const page = Buffer.from(buf.subarray(p, p + size)), crc = page.readUInt32LE(22);
    page.writeUInt32LE(0, 22);
    assert.equal(oggCrc(page), crc, `checksum of page ${pages.length}`);
    let q = p + 27 + nseg, ended = 0;
    for (const l of lacing) { partial.push(buf.subarray(q, q + l)); q += l; if (l < 255) { packets.push(Buffer.concat(partial)); partial = []; ended++; } }
    pages.push({ flags: buf[p + 5], granule: Number(buf.readBigInt64LE(p + 6)), serial: buf.readUInt32LE(p + 14), sequence: buf.readUInt32LE(p + 18), segments: nseg, ended });
    p += size;
  }
  assert.equal(partial.length, 0, 'no unfinished packet');
  return { pages, packets };
}
function readCsv(text) {
  const rows = [[]];
  let cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false; } else cell += c; }
    else if (c === '"') quoted = true;
    else if (c === ',') { rows.at(-1).push(cell); cell = ''; }
    else if (c === '\n') { rows.at(-1).push(cell); cell = ''; rows.push([]); }
    else cell += c;
  }
  if (!rows.at(-1).length) rows.pop();
  return rows;
}
async function decodeOne(name, data, extra = {}) {
  const dir = await tempDir();
  await fs.writeFile(path.join(dir, name), data);
  const r = await decodeTool({ path: path.join(dir, name), out: path.join(dir, 'out'), ...extra });
  const read = rel => fs.readFile(path.join(dir, 'out', rel));
  return { r, read, dir, done: () => fs.rm(dir, { recursive: true, force: true }) };
}
const px = (...rows) => Buffer.from(rows.flat());

// ---------------------------------------------------------------- textures
test('image format enums: Godot 3 and 4 differ from index 7 on', () => {
  assert.equal(GODOT_IMAGE_FORMATS[3][7], 'RGBA5551'); assert.equal(GODOT_IMAGE_FORMATS[4][7], 'RGB565');
  assert.equal(GODOT_IMAGE_FORMATS[3][17], 'DXT1'); assert.equal(GODOT_IMAGE_FORMATS[4][17], 'DXT1');
  assert.equal(GODOT_IMAGE_FORMATS[3][29], 'ETC'); assert.equal(GODOT_IMAGE_FORMATS[4][25], 'ETC');
  assert.equal(GODOT_IMAGE_FORMATS[3][35], 'ETC2_RGBA8'); assert.equal(GODOT_IMAGE_FORMATS[4][31], 'ETC2_RGBA8');
  assert.equal(GODOT_IMAGE_FORMATS[3].length, 37); assert.equal(GODOT_IMAGE_FORMATS[4][35], 'ASTC_4x4');
});

test('.ctex with a lossless PNG payload: the PNG bytes come out unchanged', async () => {
  const png = buildPng();
  const ctex = buildCtex({ width: 1, height: 1, dataFormat: 1, payloads: [godotPngPayload(png)] }, { flags: 1 << 24, mipmapLimit: 0 });
  const h = parseCtex(ctex);
  assert.deepEqual([h.version, h.width, h.height, h.flags, h.images[0].dataFormat, h.images[0].format, h.images[0].mipmaps], [1, 1, 1, 1 << 24, 'png', 'RGBA8', 0]);
  const t = await decodeOne('icon.png-abc.ctex', ctex);
  assert.equal(t.r.files[0].decoded, 'icon.png-abc.png');
  assert.equal(t.r.byKind.png, 1);
  const out = await t.read('icon.png-abc.png');
  assert.ok(out.equals(png), 'identical PNG file');
  assert.deepEqual([readPng(out).width, readPng(out).height], [1, 1]);
  await t.done();
});

test('.ctex with raw RGBA8 and mipmaps: largest level becomes a PNG with the same pixels', async () => {
  const level0 = px([255, 0, 0, 255, 0, 255, 0, 128], [0, 0, 255, 0, 10, 20, 30, 40]); // 2×2, top row first
  const ctex = buildCtex({ width: 2, height: 2, dataFormat: 0, format: 5, payloads: [level0, px([9, 9, 9, 9])] });
  const t = await decodeOne('tile.ctex', ctex);
  assert.equal(t.r.files[0].format, 'RGBA8');
  assert.equal(t.r.files[0].mipmaps, 1);
  const png = readPng(await t.read('tile.png'));
  assert.deepEqual([png.width, png.height], [2, 2]);
  assert.ok(png.rgba.equals(level0), 'pixels, not flipped');
  await t.done();
});

test('raw L8, LA8, R8, RG8 and RGB8 expand to RGBA', async () => {
  const cases = [[0, [200], [200, 200, 200, 255]], [1, [200, 7], [200, 200, 200, 7]], [2, [200], [200, 0, 0, 255]], [3, [200, 100], [200, 100, 0, 255]], [4, [1, 2, 3], [1, 2, 3, 255]]];
  for (const [format, bytes, want] of cases) {
    const t = await decodeOne('p.ctex', buildCtex({ width: 1, height: 1, dataFormat: 0, format, payloads: [Buffer.from(bytes)] }));
    assert.deepEqual([...readPng(await t.read('p.png')).rgba], want, GODOT_IMAGE_FORMATS[4][format]);
    await t.done();
  }
});

test('.ctex with DXT1 and DXT5 blocks decodes through texture.mjs', async () => {
  // One 4×4 block: colour0 = pure red (0xF800), colour1 = pure blue (0x001F), every pixel index 0 → red.
  const dxt1 = Buffer.from([0x00, 0xf8, 0x1f, 0x00, 0, 0, 0, 0]);
  const a = await decodeOne('a.ctex', buildCtex({ width: 4, height: 4, dataFormat: 0, format: 17, payloads: [dxt1] }));
  const p1 = readPng(await a.read('a.png'));
  assert.deepEqual([p1.width, p1.height, ...p1.rgba.subarray(0, 4), ...p1.rgba.subarray(60, 64)], [4, 4, 255, 0, 0, 255, 255, 0, 0, 255]);
  await a.done();
  // DXT5: alpha0 = 128, alpha1 = 0, all alpha indices 0 → alpha 128 everywhere.
  const b = await decodeOne('b.ctex', buildCtex({ width: 4, height: 4, dataFormat: 0, format: 19, payloads: [Buffer.concat([Buffer.from([128, 0, 0, 0, 0, 0, 0, 0]), dxt1])] }));
  assert.deepEqual([...readPng(await b.read('b.png')).rgba.subarray(0, 4)], [255, 0, 0, 128]);
  await b.done();
});

test('.ctex with a WebP payload that does not decode as lossless: the embedded file is written as .webp, as stored', async () => {
  const body = Buffer.from('WEBPVP8L\x04\x00\x00\x00abcd', 'latin1');
  const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.from([body.length, 0, 0, 0]), body]);
  const t = await decodeOne('photo.ctex', buildCtex({ width: 8, height: 8, dataFormat: 2, payloads: [webp] }));
  assert.equal(t.r.files[0].decoded, 'photo.webp');
  assert.ok((await t.read('photo.webp')).equals(webp));
  await t.done();
});

test('Basis Universal, BPTC, ASTC and DXT3 are reported with format and size, and nothing is written', async () => {
  const cases = [
    ['basis.ctex', buildCtex({ width: 64, height: 32, dataFormat: 3, format: 5, payloads: [Buffer.alloc(40)] }), /Basis Universal \(40 bytes, 64x32/],
    ['bptc.ctex', buildCtex({ width: 4, height: 4, dataFormat: 0, format: 22, payloads: [Buffer.alloc(16)] }), /4x4 BPTC_RGBA \(16 bytes\)/],
    ['astc.ctex', buildCtex({ width: 8, height: 8, dataFormat: 0, format: 35, payloads: [Buffer.alloc(64)] }), /8x8 ASTC_4x4 \(64 bytes\)/],
    ['dxt3.ctex', buildCtex({ width: 4, height: 4, dataFormat: 0, format: 18, payloads: [Buffer.alloc(16)] }), /4x4 DXT3/],
  ];
  for (const [name, data, want] of cases) {
    const t = await decodeOne(name, data);
    assert.equal(t.r.decoded, 0, name);
    assert.equal(t.r.notConverted.length, 1, name);
    assert.match(t.r.notConverted[0].reason, want);
    assert.equal(t.r.notConverted[0].bytes, data.length);
    assert.deepEqual(await fs.readdir(path.join(t.dir, 'out')).catch(() => []), []);
    await t.done();
  }
});

test('.ctexarray: each layer becomes a PNG', async () => {
  const layer = c => ({ width: 1, height: 1, dataFormat: 0, format: 5, payloads: [Buffer.from(c)] });
  const t = await decodeOne('atlas.ctexarray', buildCtexLayered([layer([1, 2, 3, 4]), layer([5, 6, 7, 8])]));
  assert.deepEqual([t.r.files[0].decoded, t.r.files[0].also], ['atlas.layer0.png', ['atlas.layer1.png']]);
  assert.deepEqual([...readPng(await t.read('atlas.layer1.png')).rgba], [5, 6, 7, 8]);
  await t.done();
});

test('.stex (Godot 3): PNG payload, WebP payload with its WEBP prefix, and raw data in the Godot 3 enum', async () => {
  const png = buildPng();
  const stex = buildStex({ width: 1, height: 1, kind: 'png', payload: godotPngPayload(png) });
  const h = parseStex(stex);
  assert.deepEqual([h.width, h.height, h.flags, h.images[0].dataFormat], [1, 1, 7, 'png']);
  const a = await decodeOne('icon.png-0123.stex', stex);
  assert.ok((await a.read('icon.png-0123.png')).equals(png));
  assert.equal(a.r.files[0].godot, 3);
  await a.done();
  const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.from([4, 0, 0, 0]), Buffer.from('WEBP')]);
  const b = await decodeOne('w.stex', buildStex({ width: 1, height: 1, kind: 'webp', payload: Buffer.concat([Buffer.from('WEBP'), webp]) }));
  assert.ok((await b.read('w.webp')).equals(webp));
  await b.done();
  // Godot 3 index 29 is ETC (Godot 4: ETC2_RG11S); 4 = RGB8 in both.
  assert.equal(parseStex(buildStex({ width: 4, height: 4, kind: 'raw', format: 29, payload: Buffer.alloc(8) })).images[0].format, 'ETC');
  const c = await decodeOne('r.stex', buildStex({ width: 2, height: 1, kind: 'raw', format: 4, payload: Buffer.from([1, 2, 3, 4, 5, 6]) }));
  assert.deepEqual([...readPng(await c.read('r.png')).rgba], [1, 2, 3, 255, 4, 5, 6, 255]);
  await c.done();
});

// ---------------------------------------------------------------- audio
test('.sample 16-bit stereo with a loop: fmt, data and smpl chunks', async () => {
  const pcm = Buffer.alloc(16);
  [100, -100, 2000, -2000, 32767, -32768, 0, 1].forEach((v, i) => pcm.writeInt16LE(v, i * 2));
  const t = await decodeOne('hit.wav-abc.sample', buildSample({ data: pcm, format: 1, mixRate: 22050, stereo: true, loopMode: 2, loopBegin: 1, loopEnd: 3 }));
  assert.equal(t.r.files[0].decoded, 'hit.wav-abc.wav');
  const c = readWav(await t.read('hit.wav-abc.wav'));
  assert.deepEqual(fmtOf(c), { tag: 1, channels: 2, rate: 22050, byteRate: 88200, align: 4, bits: 16 });
  assert.ok(c.data.equals(pcm));
  assert.equal(c.smpl.length, 60);
  assert.deepEqual([c.smpl.readUInt32LE(28), c.smpl.readUInt32LE(40), c.smpl.readUInt32LE(44), c.smpl.readUInt32LE(48)], [1, 1, 1, 3]); // one loop, ping-pong, 1..3
  assert.deepEqual(t.r.files[0].loop, { mode: 'ping-pong', begin: 1, end: 3 });
  await t.done();
});

test('.sample 8-bit (Godot 3 AudioStreamSample, defaults left out): signed samples become unsigned, no smpl chunk', async () => {
  const t = await decodeOne('beep.sample', buildSample({ data: Buffer.from([0x00, 0x7f, 0x80, 0xff, 0x01]), major: 3 }));
  const c = readWav(await t.read('beep.wav'));
  assert.deepEqual(fmtOf(c), { tag: 1, channels: 1, rate: 44100, byteRate: 44100, align: 1, bits: 8 });
  assert.deepEqual([...c.data], [0x80, 0xff, 0x00, 0x7f, 0x81]);
  assert.equal(c.smpl, undefined);
  assert.equal(t.r.files[0].kind, 'AudioStreamSample');
  await t.done();
});

test('.sample IMA ADPCM is decoded to 16-bit PCM; QOA data that does not decode is reported', async () => {
  // Nibbles 7, 0 (low nibble first): step 7 → +11 (index 8, step 16), then nibble 0 → +2.
  assert.deepEqual([...new Int16Array(decodeGodotAdpcm(Buffer.from([0x07]), false).buffer.slice(0, 4))], [11, 13]);
  const t = await decodeOne('a.sample', buildSample({ data: Buffer.from([0x07, 0x8f]), format: 2 }));
  const c = readWav(await t.read('a.wav'));
  assert.deepEqual(fmtOf(c), { tag: 1, channels: 1, rate: 44100, byteRate: 88200, align: 2, bits: 16 });
  assert.equal(c.data.length, 8);
  assert.deepEqual([c.data.readInt16LE(0), c.data.readInt16LE(2)], [11, 13]);
  await t.done();
  const q = await decodeOne('q.sample', buildSample({ data: Buffer.from('qoaf0000'), format: 3 }));
  assert.equal(q.r.decoded, 0);
  assert.match(q.r.notConverted[0].reason, /QOA audio \(8 bytes, 44100 Hz, 1 channel\)/);
  await q.done();
});

test('Ogg checksum matches a page written by libogg', () => {
  // First page of a file made with ffmpeg/libvorbis (the Vorbis identification header).
  const page = Buffer.from('4f6767530002000000000000000068110808000000008cc978a3011e01766f72626973000000000244ac00000000000080b5010000000000b801', 'hex');
  const crc = page.readUInt32LE(22);
  page.writeUInt32LE(0, 22);
  assert.equal(oggCrc(page), crc);
  assert.equal(oggCrc(page), 0xa378c98c);
  assert.notEqual(zlib.crc32?.(page) ?? 0, crc, 'not zlib CRC-32');
});

test('.oggstr (Godot 3): the stored .ogg file is copied', async () => {
  const ogg = oggFromPackets([[Buffer.from('ident')], [Buffer.from('audio')]], [0, 64]);
  const t = await decodeOne('music.ogg-abc.oggstr', buildOggStr3(ogg));
  assert.ok((await t.read('music.ogg-abc.ogg')).equals(ogg));
  assert.equal(t.r.files[0].loop, true);
  await t.done();
});

test('.oggvorbisstr (Godot 4): pages are rebuilt from the packets and parse back to the same packets', async () => {
  const fill = (n, seed) => Buffer.from(Array.from({ length: n }, (_, i) => (i * 31 + seed) & 255));
  // Stored pages as Godot's importer makes them: identification header; comment; a setup header of 70000 bytes (it
  // began on earlier pages of the original file, so it needs more than one Ogg page); audio packets including sizes
  // that are 0 mod 255; a long audio packet followed by a short one; the last page.
  const pages = [[fill(30, 1)], [fill(45, 2)], [fill(70000, 3)], [fill(255, 4), fill(510, 5), fill(1, 6), fill(300, 7)], [fill(66000, 9), fill(20, 10)], [fill(77, 8)]];
  const granules = [0, 0, 0, 4096, 4500, 5000];
  const t = await decodeOne('song.oggvorbisstr', buildOggVorbisStr4(pages, granules));
  assert.equal(t.r.files[0].decoded, 'song.ogg');
  assert.deepEqual([t.r.files[0].pages, t.r.files[0].packets], [6, 10]);
  const { pages: got, packets } = readOgg(await t.read('song.ogg')); // every checksum is verified in readOgg
  assert.equal(packets.length, 10);
  pages.flat().forEach((p, i) => assert.ok(packets[i].equals(p), `packet ${i}`));
  assert.deepEqual(got.map(p => p.sequence), got.map((_, i) => i));
  assert.equal(new Set(got.map(p => p.serial)).size, 1);
  assert.ok(got.every(p => p.segments <= 255));
  // flags: 1 continued packet, 2 beginning of stream, 4 end of stream. A page where no packet ends has granule -1.
  assert.deepEqual(got.map(p => [p.flags, p.ended, p.granule, p.segments]), [
    [2, 1, 0, 1], // identification header alone on the first page
    [0, 1, 0, 1],
    [0, 0, -1, 20], [1, 1, 0, 255], // setup header: 275 segments
    [0, 4, 4096, 2 + 3 + 1 + 2],
    [0, 0, -1, 5], [1, 2, 4500, 255], // 259 segments + 1
    [4, 1, 5000, 1],
  ]);
  await t.done();
});

test('.mp3str: the data property is the .mp3 file', async () => {
  const mp3 = Buffer.from([0xff, 0xfb, 0x90, 0x00, 1, 2, 3]);
  const t = await decodeOne('voice.mp3str', buildMp3Str(mp3));
  assert.ok((await t.read('voice.mp3')).equals(mp3));
  await t.done();
});

// ---------------------------------------------------------------- translations
test('smaz codebook and the translation hash', () => {
  assert.equal(smazDecompress(Buffer.from([1, 0, 5, 254, 0x21])).toString(), 'the of!');
  assert.equal(smazDecompress(Buffer.from([255, 2, 0x58, 0x59, 0x5a, 67, 253])).toString(), 'XYZhttp://.com');
  assert.equal(translationHash(0, ''), 0x1000193);
  assert.equal(translationHash(0, 'A'), (Math.imul(0x1000193, 0x1000193) ^ 65) >>> 0);
  assert.equal(translationHash(7, 'A'), (Math.imul(7, 0x1000193) ^ 65) >>> 0);
});

test('.translation: texts decoded, given keys matched, the rest listed without a key', async () => {
  const messages = { GREETING: 'Hello, "world"', QUIT: 'Quit', START: 'the of', MULTI: 'Line one\nLine two', SECRET: 'No key for this' };
  const tr = buildTranslation(messages, { locale: 'en', smaz: { 'the of': Buffer.from([1, 0, 5, 254, 0]) } });
  const t = await decodeOne('text.en.translation', tr, { keys: ['GREETING', 'QUIT', 'START', 'MULTI', 'NOT_A_KEY'] });
  const f = t.r.files[0];
  assert.deepEqual([f.decoded, f.also, f.locale, f.texts, f.smazCompressed, f.matched, f.withoutKey], ['text.en.csv', ['text.en.unmatched.csv'], 'en', 5, 1, 4, 1]);
  const rows = readCsv((await t.read('text.en.csv')).toString());
  assert.deepEqual(rows[0], ['keys', 'en']);
  assert.deepEqual(Object.fromEntries(rows.slice(1)), { GREETING: 'Hello, "world"', QUIT: 'Quit', START: 'the of', MULTI: 'Line one\nLine two' });
  const un = readCsv((await t.read('text.en.unmatched.csv')).toString());
  assert.deepEqual(un[0], ['key_hash', 'en']);
  assert.equal(un.length, 2);
  assert.equal(un[1][1], 'No key for this');
  assert.match(un[1][0], /^[0-9a-f]+:[0-9a-f]{8}$/);
  assert.deepEqual([t.r.translations.texts, t.r.translations.withoutKey], [5, 1]);
  assert.match(t.r.translations.summary, /^1 of 5 translated texts have no key/);
  await t.done();
});

test('.translation without keys: every text is still decoded and all are reported as without a key', async () => {
  const t = await decodeOne('ui.nl.translation', buildTranslation({ A: 'Hallo', B: 'Stoppen' }, { locale: null, major: 3 }));
  const f = t.r.files[0];
  assert.deepEqual([f.kind, f.locale, f.localeFrom, f.texts, f.matched, f.withoutKey], ['PHashTranslation', 'nl', 'file name', 2, 0, 2]);
  assert.deepEqual(readCsv((await t.read('ui.nl.csv')).toString()), [['keys', 'nl']]);
  assert.deepEqual(readCsv((await t.read('ui.nl.unmatched.csv')).toString()).slice(1).map(r => r[1]).sort(), ['Hallo', 'Stoppen']);
  await t.done();
});

test('plain Translation resource (keys stored): written whole', async () => {
  const res = buildRsrc([{ type: 'Translation', props: { messages: rv.dict([[rv.str('HI'), rv.str('Hoi')], [rv.str('BYE'), rv.str('Doei, tot ziens')]]), locale: rv.str('nl') } }]);
  const t = await decodeOne('plain.translation', res);
  assert.deepEqual(readCsv((await t.read('plain.csv')).toString()), [['keys', 'nl'], ['HI', 'Hoi'], ['BYE', 'Doei, tot ziens']]);
  await t.done();
});

test('key candidates from script text and CSV', () => {
  assert.deepEqual(keysInText('label.text = tr("MENU_START")\nprint(tr(\'A_B\'), "x\\ty")\n[node]\ntext = "TITLE"'), ['MENU_START', 'A_B', 'x\ty', 'TITLE']);
  assert.deepEqual(keysInCsv('keys,en,nl\nHELLO,Hello,Hallo\n"WITH,COMMA","a ""b""\nc",d\r\nLAST,x,y'), ['HELLO', 'WITH,COMMA', 'LAST']);
});

// ---------------------------------------------------------------- .import files and a whole folder
test('.import parsing: remap paths (also per-platform), source_file, and the fallback to the .import name', () => {
  const full = parseImportFile('[remap]\n\nimporter="texture"\npath.s3tc="res://.godot/imported/a.png-1.s3tc.ctex"\npath.etc2="res://.godot/imported/a.png-1.etc2.ctex"\nmetadata={\n"vram_texture": true\n}\n\n[deps]\n\nsource_file="res://art/a.png"\n', 'art/a.png.import');
  assert.deepEqual(full, { source: 'art/a.png', paths: ['.godot/imported/a.png-1.s3tc.ctex', '.godot/imported/a.png-1.etc2.ctex'] });
  assert.deepEqual(parseImportFile(buildImportFile({ remap: 'res://.import/b.png-2.stex' }), 'ui/b.png.import'), { source: 'ui/b.png', paths: ['.import/b.png-2.stex'] });
});

test('a folder: converted files get their original names and places, keys come from scripts and CSVs, nothing leaves the output folder', async () => {
  const dir = await tempDir();
  const put = async (rel, data) => { await fs.mkdir(path.dirname(path.join(dir, 'game', rel)), { recursive: true }); await fs.writeFile(path.join(dir, 'game', rel), data); };
  const png = buildPng();
  // Godot 4 layout: export-style .import (only [remap]) and an editor-style one with [deps].
  await put('.godot/imported/icon.png-aaaa.ctex', buildCtex({ width: 1, height: 1, dataFormat: 1, payloads: [godotPngPayload(png)] }));
  await put('icon.png.import', buildImportFile({ remap: 'res://.godot/imported/icon.png-aaaa.ctex' }));
  await put('.godot/imported/logo.svg-bbbb.ctex', buildCtex({ width: 1, height: 1, dataFormat: 0, format: 5, payloads: [Buffer.from([1, 2, 3, 4])] }));
  await put('art/logo.svg.import', buildImportFile({ remap: 'res://.godot/imported/logo.svg-bbbb.ctex', source: 'res://art/logo.svg' }));
  await put('.godot/imported/hit.wav-cccc.sample', buildSample({ data: Buffer.alloc(4), format: 1 }));
  await put('sfx/hit.wav.import', buildImportFile({ remap: 'res://.godot/imported/hit.wav-cccc.sample', importer: 'wav', type: 'AudioStreamWAV' }));
  // Godot 3 layout.
  await put('.import/old.png-dddd.stex', buildStex({ width: 1, height: 1, kind: 'png', payload: godotPngPayload(png) }));
  await put('ui/old.png.import', buildImportFile({ remap: 'res://.import/old.png-dddd.stex', source: 'res://ui/old.png', type: 'StreamTexture' }));
  // Two platform variants of one source: one output.
  await put('.godot/imported/two.png-eeee.s3tc.ctex', buildCtex({ width: 1, height: 1, dataFormat: 0, format: 5, payloads: [Buffer.from([9, 9, 9, 9])] }));
  await put('.godot/imported/two.png-eeee.etc2.ctex', buildCtex({ width: 1, height: 1, dataFormat: 0, format: 5, payloads: [Buffer.from([9, 9, 9, 9])] }));
  await put('two.png.import', '[remap]\n\npath.s3tc="res://.godot/imported/two.png-eeee.s3tc.ctex"\npath.etc2="res://.godot/imported/two.png-eeee.etc2.ctex"\n');
  // A hostile .import that points outside the output folder.
  await put('.godot/imported/evil.png-ffff.ctex', buildCtex({ width: 1, height: 1, dataFormat: 1, payloads: [godotPngPayload(png)] }));
  await put('evil.png.import', buildImportFile({ remap: 'res://.godot/imported/evil.png-ffff.ctex', source: 'res://../../escaped.png' }));
  // Translation: keys from a script, a scene and a CSV in the tree, and one from the caller.
  await put('text.en.translation', buildTranslation({ MENU_START: 'Start', MENU_QUIT: 'Quit', TITLE: 'My Game', FROM_CSV: 'Csv text', GIVEN: 'Given text', LOST: 'Nobody knows' }));
  await put('menu.gd', 'extends Control\nfunc _ready():\n\t$Start.text = tr("MENU_START")\n\t$Quit.text = tr(\'MENU_QUIT\')\n');
  await put('menu.tscn', '[gd_scene format=3]\n\n[node name="Title" type="Label"]\ntext = "TITLE"\n');
  await put('text.csv', 'keys,en\nFROM_CSV,Csv text\n');
  await put('script.gde', Buffer.from('GDEC0000'));

  const r = await decodeTool({ path: path.join(dir, 'game'), out: path.join(dir, 'out'), keys: ['GIVEN'] });
  const by = Object.fromEntries(r.files.map(f => [f.file, f]));
  assert.equal(by['.godot/imported/icon.png-aaaa.ctex'].decoded, 'icon.png');
  assert.equal(by['.godot/imported/icon.png-aaaa.ctex'].original, 'res://icon.png');
  assert.equal(by['.godot/imported/logo.svg-bbbb.ctex'].decoded, 'art/logo.svg.png'); // an SVG was imported: the pixels are a PNG
  assert.equal(by['.godot/imported/hit.wav-cccc.sample'].decoded, 'sfx/hit.wav');
  assert.equal(by['.import/old.png-dddd.stex'].decoded, 'ui/old.png');
  assert.ok((await fs.readFile(path.join(dir, 'out', 'icon.png'))).equals(png));
  assert.ok((await fs.readFile(path.join(dir, 'out', 'ui', 'old.png'))).equals(png));
  assert.deepEqual([...readPng(await fs.readFile(path.join(dir, 'out', 'art', 'logo.svg.png'))).rgba], [1, 2, 3, 4]);
  assert.equal(fmtOf(readWav(await fs.readFile(path.join(dir, 'out', 'sfx', 'hit.wav')))).bits, 16);
  // variants
  assert.equal(r.files.filter(f => f.decoded === 'two.png').length, 1);
  assert.ok(r.skipped.some(s => /two\.png-eeee/.test(s.file) && /another imported variant/.test(s.reason)));
  // the unsafe path is refused and nothing is written outside
  assert.ok(r.skipped.some(s => /evil/.test(s.file) && /unsafe path/i.test(s.reason)), JSON.stringify(r.skipped));
  await assert.rejects(fs.stat(path.join(dir, 'escaped.png')));
  await assert.rejects(fs.stat(path.join(dir, '..', 'escaped.png')));
  // encrypted: reported only
  assert.ok(r.skipped.some(s => s.file === 'script.gde' && /encrypted/.test(s.reason)));
  // translation
  const tr = by['text.en.translation'];
  assert.deepEqual([tr.texts, tr.matched, tr.withoutKey], [6, 5, 1]);
  const rows = readCsv(await fs.readFile(path.join(dir, 'out', 'text.en.csv'), 'utf8'));
  assert.deepEqual(Object.fromEntries(rows.slice(1)), { MENU_START: 'Start', MENU_QUIT: 'Quit', TITLE: 'My Game', FROM_CSV: 'Csv text', GIVEN: 'Given text' });
  assert.deepEqual(readCsv(await fs.readFile(path.join(dir, 'out', 'text.en.unmatched.csv'), 'utf8')).slice(1).map(x => x[1]), ['Nobody knows']);
  assert.equal(r.translations.candidateKeys.given, 1);
  assert.match(r.translations.summary, /^1 of 6 translated texts have no key/);
  assert.match(r.next, /original names/);
  await fs.rm(dir, { recursive: true, force: true });
});

test('keys must be an array of strings', async () => {
  await assert.rejects(decodeTool({ path: '.', keys: 'A,B' }), /keys must be an array of strings/);
});

test('a stored Ogg page that cannot be written back without guessing granule positions is reported, not converted', async () => {
  const many = Array.from({ length: 300 }, (_, i) => Buffer.from([i & 255]));
  const t = await decodeOne('odd.oggvorbisstr', buildOggVorbisStr4([[Buffer.from('id')], many], [0, 10]));
  assert.equal(t.r.decoded, 0);
  assert.match(t.r.notConverted[0].reason, /more packets than one Ogg page can/);
  await t.done();
});
