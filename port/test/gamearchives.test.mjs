import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { tempDir } from './helpers.mjs';
import { archiveTool, openArchive } from '../src/archive.mjs';
import { unpickle } from '../src/gamearchives.mjs';

const u16 = n => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const u32 = n => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
const u32be = n => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
const u64 = n => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), u32be(13), Buffer.from('IHDR'), Buffer.alloc(13), u32be(0), u32be(0), Buffer.from('IEND'), u32be(0xae426082)]);

// ---------------------------------------------------------------- RPA (pickle protocol 2 written by hand)
function pickleIndex(index) {
  const parts = [Buffer.from([0x80, 2, 0x7d, 0x28])]; // PROTO 2, EMPTY_DICT, MARK
  for (const [name, [off, len, prefix]] of Object.entries(index)) {
    const n = Buffer.from(name, 'utf8');
    parts.push(Buffer.from([0x58]), u32(n.length), n); // BINUNICODE
    parts.push(Buffer.from([0x5d, 0x28])); // EMPTY_LIST, MARK
    parts.push(Buffer.from([0x4a]), u32(off >>> 0), Buffer.from([0x4a]), u32(len >>> 0)); // BININT ×2
    const pre = Buffer.from(prefix, 'latin1');
    parts.push(Buffer.from([0x55, pre.length]), pre); // SHORT_BINSTRING
    parts.push(Buffer.from([0x87, 0x65])); // TUPLE3, APPENDS
  }
  parts.push(Buffer.from([0x75, 0x2e])); // SETITEMS, STOP
  return Buffer.concat(parts);
}
async function buildRpa(dir) {
  const key = 0x42424242;
  const files = { 'game/script.rpy': Buffer.from('label start:\n    "Hello"\n'), 'game/images/bg.png': PNG };
  const header = Buffer.alloc(34);
  const chunks = [header];
  const index = {};
  let off = 34;
  for (const [name, data] of Object.entries(files)) {
    const prefix = data.subarray(0, 2), rest = data.subarray(2);
    index[name] = [off ^ key, rest.length ^ key, prefix.toString('latin1')];
    chunks.push(rest); off += rest.length;
  }
  const idx = zlib.deflateSync(pickleIndex(index));
  header.write(`RPA-3.0 ${off.toString(16).padStart(16, '0')} ${key.toString(16).padStart(8, '0')}\n`, 0, 'latin1');
  chunks.push(idx);
  const file = path.join(dir, 'archive.rpa');
  await fs.writeFile(file, Buffer.concat(chunks));
  return { file, files };
}

// ---------------------------------------------------------------- GameMaker FORM
async function buildGameMaker(dir) {
  const strings = ['MyGame', 'My Game Title', 'spr_player', 'obj_player', 'rm_main', 'snd_jump'];
  const strgBody = [u32(strings.length)];
  const ptrs = [], strData = [];
  // layout computed later: we build chunks sequentially and patch pointers.
  const chunk = (name, body) => Buffer.concat([Buffer.from(name), u32(body.length), body]);
  // Compute absolute offsets: FORM header 8, GEN8 chunk first.
  const gen8Body = Buffer.alloc(0x50);
  const gen8 = chunk('GEN8', gen8Body);
  const gen8Start = 8;
  const strgStart = gen8Start + gen8.length;
  // STRG: count, pointers to each string record (ptr points at string chars; length u32 precedes)
  let cursor = strgStart + 8 + 4 + 4 * strings.length;
  const records = [];
  for (const s of strings) { const b = Buffer.from(s); ptrs.push(cursor + 4); records.push(Buffer.concat([u32(b.length), b, Buffer.alloc(1)])); cursor += 4 + b.length + 1; }
  const strg = chunk('STRG', Buffer.concat([u32(strings.length), ...ptrs.map(u32), ...records]));
  gen8Body[1] = 17; gen8Body.writeUInt32LE(ptrs[0], 4); gen8Body.writeUInt32LE(ptrs[1], 0x2c); gen8Body.writeUInt32LE(2, 0x30); gen8Body.writeUInt32LE(3, 0x34); gen8Body.writeUInt32LE(1, 0x38); gen8Body.writeUInt32LE(0, 0x3c); gen8Body.writeUInt32LE(1280, 0x40); gen8Body.writeUInt32LE(720, 0x44);
  const gen8b = chunk('GEN8', gen8Body);
  const sprtStart = strgStart + strg.length;
  const sprtRec = sprtStart + 8 + 4 + 4; // one record right after the pointer list
  const sprt = chunk('SPRT', Buffer.concat([u32(1), u32(sprtRec), u32(ptrs[2]), Buffer.alloc(12)]));
  const objtStart = sprtStart + sprt.length;
  const objt = chunk('OBJT', Buffer.concat([u32(1), u32(objtStart + 16), u32(ptrs[3]), Buffer.alloc(12)]));
  const roomStart = objtStart + objt.length;
  const room = chunk('ROOM', Buffer.concat([u32(1), u32(roomStart + 16), u32(ptrs[4]), Buffer.alloc(12)]));
  const sondStart = roomStart + room.length;
  const sond = chunk('SOND', Buffer.concat([u32(1), u32(sondStart + 16), u32(ptrs[5]), Buffer.alloc(12)]));
  const txtrStart = sondStart + sond.length;
  const txtrRec = txtrStart + 8 + 4 + 4, pngAt = txtrRec + 16;
  const txtr = chunk('TXTR', Buffer.concat([u32(1), u32(txtrRec), u32(0), u32(0), u32(pngAt), u32(0), PNG]));
  const audoStart = txtrStart + txtr.length;
  const wav = Buffer.concat([Buffer.from('RIFF'), u32(4), Buffer.from('WAVE')]);
  const audoRec = audoStart + 8 + 4 + 4;
  const audo = chunk('AUDO', Buffer.concat([u32(1), u32(audoRec), u32(wav.length), wav]));
  const chunksAll = Buffer.concat([gen8b, strg, sprt, objt, room, sond, txtr, audo]);
  const file = path.join(dir, 'data.win');
  await fs.writeFile(file, Buffer.concat([Buffer.from('FORM'), u32(chunksAll.length), chunksAll]));
  return file;
}

// ---------------------------------------------------------------- FMOD bank with FSB5 (PCM16)
async function buildFmod(dir) {
  const pcm = Buffer.alloc(64, 1);
  const names = Buffer.concat([u32(4), Buffer.from('jump\0')]);
  const sampleHeader = (() => { const freqIdx = 8n, channels = 0n, dataOffset = 0n, samples = 32n; const v = (samples << 34n) | (dataOffset << 6n) | (channels << 5n) | (freqIdx << 1n); const b = Buffer.alloc(8); b.writeBigUInt64LE(v); return b; })();
  const fsb = Buffer.concat([Buffer.from('FSB5'), u32(1), u32(1), u32(8), u32(names.length), u32(pcm.length), u32(2), Buffer.alloc(60 - 28), sampleHeader, names, pcm]);
  const strings = Buffer.from('event:/Player/Jump\0bus:/Master\0');
  const chunk = (id, body) => Buffer.concat([Buffer.from(id), u32(body.length), body, body.length & 1 ? Buffer.alloc(1) : Buffer.alloc(0)]);
  const body = Buffer.concat([Buffer.from('FEV '), chunk('PROJ', strings), chunk('SND ', fsb)]);
  const file = path.join(dir, 'Master.bank');
  await fs.writeFile(file, Buffer.concat([Buffer.from('RIFF'), u32(body.length), body]));
  return file;
}

// ---------------------------------------------------------------- Wwise bank
async function buildWwise(dir) {
  const wem = Buffer.from('RIFFwemdata');
  const bkhd = Buffer.concat([Buffer.from('BKHD'), u32(8), u32(134), u32(12345)]);
  const didx = Buffer.concat([Buffer.from('DIDX'), u32(12), u32(777), u32(0), u32(wem.length)]);
  const data = Buffer.concat([Buffer.from('DATA'), u32(wem.length), wem]);
  const obj = (type, body) => Buffer.concat([Buffer.from([type]), u32(body.length), body]);
  const hircBody = Buffer.concat([u32(3), obj(2, Buffer.alloc(8)), obj(4, Buffer.alloc(4)), obj(3, Buffer.alloc(4))]);
  const hirc = Buffer.concat([Buffer.from('HIRC'), u32(hircBody.length), hircBody]);
  const file = path.join(dir, 'Init.bnk');
  await fs.writeFile(file, Buffer.concat([bkhd, didx, data, hirc]));
  await fs.writeFile(path.join(dir, 'SoundbanksInfo.xml'), '<SoundBanksInfo><File Id="777" Language="SFX"><ShortName>jump.wav</ShortName></File></SoundBanksInfo>');
  return file;
}

// ---------------------------------------------------------------- Unreal pak v8 (stored + zlib)
async function buildPak(dir) {
  const fstring = s => Buffer.concat([u32(s.length + 1), Buffer.from(s), Buffer.alloc(1)]);
  const content1 = Buffer.from('uasset-bytes-stored-' + 'x'.repeat(40));
  const content2 = Buffer.from('level data '.repeat(20));
  const zipped = zlib.deflateSync(content2);
  const entryHeader = (offset, csize, size, method, blocks, blockSize) => Buffer.concat([u64(offset), u64(csize), u64(size), u32(method), Buffer.alloc(20), ...(method ? [u32(blocks.length), ...blocks.flatMap(b => [u64(b.start), u64(b.end)])] : []), Buffer.alloc(1), u32(blockSize)]);
  // entry 1 at 0 (stored)
  const h1len = 8 + 8 + 8 + 4 + 20 + 1 + 4;
  const e1 = { offset: 0, csize: content1.length, size: content1.length, method: 0 };
  const rec1 = Buffer.concat([entryHeader(0, content1.length, content1.length, 0, [], 0), content1]);
  const e2off = rec1.length;
  const h2len = h1len + 4 + 16;
  const e2 = { offset: e2off, csize: zipped.length, size: content2.length, method: 1 };
  const blocks = [{ start: e2off + h2len, end: e2off + h2len + zipped.length }];
  const rec2 = Buffer.concat([entryHeader(e2off, zipped.length, content2.length, 1, blocks, 65536), zipped]);
  const data = Buffer.concat([rec1, rec2]);
  const index = Buffer.concat([fstring('../../../'), u32(2), fstring('Game/Content/Thing.uasset'), entryHeader(e1.offset, e1.csize, e1.size, 0, [], 0), fstring('Game/Maps/Level.umap'), entryHeader(e2.offset, e2.csize, e2.size, 1, blocks, 65536)]);
  const methods = Buffer.alloc(32 * 4); methods.write('Zlib', 0);
  const footer = Buffer.concat([Buffer.alloc(16), Buffer.from([0]), Buffer.from([0xe1, 0x12, 0x6f, 0x5a]), u32(8), u64(data.length), u64(index.length), Buffer.alloc(20), methods]);
  const file = path.join(dir, 'Game-WindowsNoEditor.pak');
  await fs.writeFile(file, Buffer.concat([data, index, footer]));
  return { file, content1, content2 };
}

// ---------------------------------------------------------------- SWF (FWS) with a JPEG, a sound, DoABC and SymbolClass
function swfBody() {
  const rect = Buffer.from([0x78, 0x00, 0x05, 0x5f, 0x00, 0x00, 0x0f, 0xa0, 0x00]); // 15 bits: 0..11000, 0..8000 twips (550x400)
  const tag = (code, data) => Buffer.concat([u16((code << 6) | 0x3f), u32(data.length), data]);
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(20), Buffer.from([0xff, 0xd9])]);
  const abc = (() => { const u30 = n => Buffer.from([n]); const strs = ['', 'com.game', 'Player', 'flash.display.Sprite', 'jump']; return Buffer.concat([u16(16), u16(46), u30(1), u30(1), u30(1), u30(strs.length), ...strs.slice(1).map(s => Buffer.concat([u30(s.length), Buffer.from(s)]))]); })();
  const doabc = Buffer.concat([u32(1), Buffer.from('frame1\0'), abc]);
  const symbols = Buffer.concat([u16(2), u16(0), Buffer.from('com.game.Main\0'), u16(1), Buffer.from('com.game.Player\0')]);
  const sound = Buffer.concat([u16(7), Buffer.from([0x2c]), u32(100), u16(0), Buffer.from([0xff, 0xfb, 0x90, 0x00, 1, 2, 3])]);
  return Buffer.concat([rect, u16(24 * 256), u16(10), tag(69, u32(8)), tag(21, Buffer.concat([u16(5), jpeg])), tag(14, sound), tag(82, doabc), tag(76, symbols), tag(43, Buffer.from('intro\0')), tag(1, Buffer.alloc(0)), tag(0, Buffer.alloc(0))]);
}
async function buildSwf(dir, compressed) {
  const body = swfBody();
  const header = Buffer.concat([Buffer.from(compressed ? 'CWS' : 'FWS'), Buffer.from([10]), u32(8 + body.length)]);
  const file = path.join(dir, compressed ? 'game-c.swf' : 'game.swf');
  await fs.writeFile(file, Buffer.concat([header, compressed ? zlib.deflateSync(body) : body]));
  return file;
}

test('unpickle reads the shapes Ren\'Py uses', () => {
  const d = unpickle(pickleIndex({ 'a/b.png': [1, 2, 'xy'] }));
  assert.deepEqual(Object.keys(d), ['a/b.png']);
  assert.equal(d['a/b.png'][0][0], 1);
  assert.equal(Buffer.from(d['a/b.png'][0][2]).toString('latin1'), 'xy');
});

test("Ren'Py RPA-3.0: list with the XOR key and extract with prefixes", async () => {
  const dir = await tempDir();
  const { file, files } = await buildRpa(dir);
  const list = await archiveTool({ file });
  assert.equal(list.format, 'renpy-rpa');
  assert.equal(list.keyed, true);
  assert.deepEqual(list.entries.map(e => e.path).sort(), Object.keys(files).sort());
  assert.equal(list.renpy.sourceScripts, 1);
  const ex = await archiveTool({ file, action: 'extract', out: path.join(dir, 'out') });
  assert.equal(ex.extracted, 2);
  for (const [name, data] of Object.entries(files)) assert.deepEqual(await fs.readFile(path.join(dir, 'out', name)), data);
  await fs.rm(dir, { recursive: true, force: true });
});

test('GameMaker data.win: chunks, game info, names, textures and audio extract', async () => {
  const dir = await tempDir();
  const file = await buildGameMaker(dir);
  const list = await archiveTool({ file });
  assert.equal(list.format, 'gamemaker-data');
  assert.equal(list.game.name, 'MyGame');
  assert.equal(list.game.displayName, 'My Game Title');
  assert.equal(list.game.version, '2.3.1.0');
  assert.deepEqual(list.game.windowSize, [1280, 720]);
  assert.deepEqual(list.names.sprites, ['spr_player']);
  assert.deepEqual(list.names.objects, ['obj_player']);
  assert.deepEqual(list.names.rooms, ['rm_main']);
  assert.deepEqual(list.entries.map(e => e.path), ['textures/texture_0.png', 'audio/snd_jump.wav']);
  const ex = await archiveTool({ file, action: 'extract', out: path.join(dir, 'out') });
  assert.equal(ex.extracted, 2);
  assert.deepEqual(await fs.readFile(path.join(dir, 'out', 'textures', 'texture_0.png')), PNG);
  await fs.rm(dir, { recursive: true, force: true });
});

test('FMOD bank: event paths and FSB5 samples; Wwise bank: media, objects and names from SoundbanksInfo.xml', async () => {
  const dir = await tempDir();
  const fmod = await archiveTool({ file: await buildFmod(dir) });
  assert.equal(fmod.format, 'fmod-bank');
  assert.deepEqual(fmod.events, ['event:/Player/Jump']);
  assert.equal(fmod.fsb.codec, 'PCM16');
  assert.equal(fmod.entries[0].path, 'samples/jump.pcm');
  assert.equal(fmod.entries[0].frequency, 44100);
  assert.equal(fmod.entries[0].size, 64);
  const ww = await archiveTool({ file: await buildWwise(dir) });
  assert.equal(ww.format, 'wwise-bank');
  assert.equal(ww.bankVersion, 134);
  assert.deepEqual(ww.entries.map(e => e.path), ['media/jump.wem']);
  assert.deepEqual(ww.objects, { sound: 1, event: 1, action: 1 });
  const ex = await archiveTool({ file: path.join(dir, 'Init.bnk'), action: 'extract', out: path.join(dir, 'out') });
  assert.equal((await fs.readFile(path.join(dir, 'out', 'media', 'jump.wem'))).toString(), 'RIFFwemdata');
  await fs.rm(dir, { recursive: true, force: true });
});

test('Unreal pak v8: footer, index, stored and zlib entries extract; Oodle/encrypted are only listed', async () => {
  const dir = await tempDir();
  const { file, content1, content2 } = await buildPak(dir);
  const list = await archiveTool({ file });
  assert.equal(list.format, 'unreal-pak');
  assert.equal(list.pakVersion, 8);
  assert.deepEqual(list.compressionMethods, ['Zlib']);
  assert.deepEqual(list.entries.map(e => [e.path, e.compressionMethod]), [['Game/Content/Thing.uasset', 'None'], ['Game/Maps/Level.umap', 'Zlib']]);
  assert.equal(list.unreal.uassets, 1);
  const ex = await archiveTool({ file, action: 'extract', out: path.join(dir, 'out') });
  assert.equal(ex.extracted, 2);
  assert.deepEqual(await fs.readFile(path.join(dir, 'out', 'Game', 'Content', 'Thing.uasset')), content1);
  assert.deepEqual(await fs.readFile(path.join(dir, 'out', 'Game', 'Maps', 'Level.umap')), content2);
  await fs.rm(dir, { recursive: true, force: true });
});

test('SWF: stage, tags, AS3 classes, symbols, assets; compressed SWF inflates on extract', async () => {
  const dir = await tempDir();
  const list = await archiveTool({ file: await buildSwf(dir, false) });
  assert.equal(list.format, 'swf');
  assert.deepEqual(list.stage, { width: 550, height: 400, frameRate: 24, frameCount: 10 });
  assert.equal(list.actionScript, 'AS3 (DoABC)');
  assert.equal(list.documentClass, 'com.game.Main');
  assert.ok(list.classes.includes('Player') && list.classes.includes('flash.display.Sprite'));
  assert.deepEqual(list.frameLabels, ['intro']);
  assert.deepEqual(list.entries.map(e => e.path), ['images/image_5.jpg', 'sounds/sound_7.mp3', 'abc/frame1.abc']);
  const ex = await archiveTool({ file: path.join(dir, 'game.swf'), action: 'extract', out: path.join(dir, 'out') });
  assert.equal(ex.extracted, 3);
  assert.equal((await fs.readFile(path.join(dir, 'out', 'images', 'image_5.jpg')))[0], 0xff);
  const c = await archiveTool({ file: await buildSwf(dir, true) });
  assert.equal(c.compression, 'zlib');
  assert.equal(c.documentClass, 'com.game.Main');
  const cex = await archiveTool({ file: path.join(dir, 'game-c.swf'), action: 'extract', out: path.join(dir, 'out2') });
  assert.ok(cex.files.some(f => f.path === 'swf-inflated.swf'));
  const again = await archiveTool({ file: path.join(dir, 'out2', 'swf-inflated.swf') });
  assert.equal(again.compression, 'none');
  await fs.rm(dir, { recursive: true, force: true });
});
