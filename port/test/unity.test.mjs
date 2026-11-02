// Unity bundles and serialized files through re_archive and re_scan, on fixtures built in memory: a player build
// without type trees, and UnityFS bundles (LZ4 and LZMA blocks) whose serialized file carries type trees.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { archiveTool } from '../src/archive.mjs';
import { scanProject } from '../src/scan.mjs';
import { lz4Block, lzmaDecode, lzmaAlone } from '../src/decompress.mjs';
import { decodeTexture, encodePng, textureFile } from '../src/texture.mjs';
import { meshToObj } from '../src/mesh.mjs';
import { tempDir } from './helpers.mjs';
import { lz4Literal, lzmaLiteral, serializedFile, unityBundle, typeTree, stringRows, pptrRows, playerBuild, obj, W } from './unity-fixture.mjs';

/** PNG → { width, height, rgba } (8-bit RGBA, filter 0 rows: what encodePng writes). */
function readPng(buf) {
  assert.equal(buf.toString('latin1', 1, 4), 'PNG');
  let p = 8, width, height; const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString('latin1', p + 4, p + 8), data = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); }
    if (type === 'IDAT') idat.push(data);
    p += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat)), rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) { assert.equal(raw[y * (width * 4 + 1)], 0); raw.copy(rgba, y * width * 4, y * (width * 4 + 1) + 1, (y + 1) * (width * 4 + 1)); }
  return { width, height, rgba };
}
const pixel = (img, x, y) => [...img.rgba.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4)];

test('LZ4 and LZMA decoders: literal runs, overlapping matches, a real encoder\'s stream, corrupt input', () => {
  const text = Buffer.from('ReversePort '.repeat(40));
  assert.deepEqual(lz4Block(lz4Literal(text), text.length), text);
  // "abc" then a match of 9 at offset 3 (overlapping copy), then the final literal "!".
  const block = Buffer.from([0x35, 0x61, 0x62, 0x63, 0x03, 0x00, 0x10, 0x21]);
  assert.equal(lz4Block(block, 13).toString(), 'abcabcabcabc!');
  assert.throws(() => lz4Block(Buffer.from([0x35, 0x61, 0x62, 0x63, 0x09, 0x00, 0x10, 0x21]), 13), { code: 'BAD_FORMAT' }, 'offset before the start');
  assert.throws(() => lz4Block(block, 12), { code: 'BAD_FORMAT' }, 'output larger than declared');
  const { props, data } = lzmaLiteral(text);
  assert.deepEqual(lzmaDecode(props, data, text.length), text);
  // xz --format=lzma output (size unknown, end marker, rep and normal matches).
  const xz = Buffer.from('XQAAgAD//////////wAqGgiiAyVm8Ut4xaIF/y7m2dIgGq00+OId6EE2+twGabs85BA0Jwnrs2bj7TeIqO86YLg17JzgVCRkTp0oFlmYQJr5P1JJZ1NQlrN39rYJIax//Z+MAA==', 'base64');
  assert.equal(lzmaAlone(xz, 4096).toString(), 'The quick brown fox jumps over the lazy dog. '.repeat(6) + 'ReversePort reads Unity bundles. '.repeat(4));
  assert.throws(() => lzmaDecode(props, data.subarray(0, data.length >> 1), text.length), { code: 'BAD_FORMAT' });
});

test('textures: DXT1, RGBA32 and ETC2 decode upside-up; ASTC and BC7 become .astc and .dds files', () => {
  const dxt = Buffer.from([0x00, 0xf8, 0x1f, 0x00, 0x55, 0x55, 0xff, 0xff]); // rows 0-1 index 1 (blue), rows 2-3 index 3
  const img = decodeTexture(dxt, 10, 4, 4);
  assert.deepEqual([...img.subarray(0, 4)], [85, 0, 170, 255], 'top row is the last stored row (index 3: one third red, two thirds blue)');
  assert.deepEqual([...img.subarray(12 * 4, 12 * 4 + 4)], [0, 0, 255, 255], 'bottom row is stored row 0 (blue)');
  const rgba = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual([...decodeTexture(rgba, 4, 1, 2)], [5, 6, 7, 8, 1, 2, 3, 4]);
  assert.equal(decodeTexture(Buffer.alloc(4), 4, 4, 4), null, 'too little data');
  const png = readPng(encodePng(Buffer.from([255, 0, 0, 255, 0, 255, 0, 128]), 2, 1));
  assert.deepEqual([png.width, png.height, ...png.rgba], [2, 1, 255, 0, 0, 255, 0, 255, 0, 128]);
  const astc = textureFile(Buffer.alloc(16 * 4), 54, 8, 8);
  assert.equal(astc.ext, '.astc');
  assert.equal(astc.data.readUInt32LE(0), 0x5ca1ab13);
  assert.deepEqual([astc.data[4], astc.data[5], astc.data.readUIntLE(7, 3), astc.data.readUIntLE(10, 3)], [4, 4, 8, 8]);
  const dds = textureFile(Buffer.alloc(16), 25, 4, 4);
  assert.equal(dds.ext, '.dds');
  assert.equal(dds.data.toString('latin1', 84, 88), 'DX10');
  assert.equal(dds.data.readUInt32LE(128), 98, 'DXGI_FORMAT_BC7_UNORM');
  assert.equal(textureFile(Buffer.alloc(8), 28, 4, 4).ext, '.tex', 'crunched: raw');
});

test('player build without type trees: scenes, scripts in use, names; TextAsset, PNG and FSB5 extract', async () => {
  const dir = await tempDir();
  const build = await playerBuild(dir);
  const level = await archiveTool({ file: path.join(build.data, 'level0') });
  assert.equal(level.format, 'unity-assets');
  assert.equal(level.unityVersion, '2019.4.40f1');
  assert.deepEqual(level.assets.classes, { MonoBehaviour: 3, GameObject: 3, Transform: 1 });
  assert.deepEqual(level.assets.scripts, [{ class: 'Game.AI.Enemy', assembly: 'Assembly-CSharp.dll', instances: 2 }, { class: 'Game.Player', assembly: 'Assembly-CSharp.dll', instances: 1 }]);
  assert.equal(level.assets.serializedFiles[0].typeTree, false);
  assert.match(level.note, /no type trees/);
  const paths = level.entries.map(e => e.path);
  assert.ok(paths.includes('GameObject/Hero.bin') && paths.includes('GameObject/Goblin.bin') && paths.some(p => /^GameObject\/Goblin~\d+\.bin$/.test(p)), paths.join(', '));
  assert.ok(level.entries.some(e => e.path === 'MonoBehaviour/Player.bin' && e.script === 'Game.Player'), 'unnamed MonoBehaviours take their script name');

  const ggm = await archiveTool({ file: path.join(build.data, 'globalgamemanagers') });
  assert.deepEqual(ggm.assets.scenes, ['Assets/Scenes/Menu.unity', 'Assets/Scenes/Level1.unity']);

  const shared = await archiveTool({ file: path.join(build.data, 'sharedassets0.assets') });
  assert.deepEqual(shared.entries.map(e => e.path), ['TextAsset/dialogue.txt', 'Texture2D/flag.png', 'Texture2D/tile.png', 'AudioClip/jump.fsb']);
  assert.deepEqual(shared.entries.filter(e => e.width).map(e => [e.width, e.height, e.textureFormat]), [[4, 2, 'RGBA32'], [4, 4, 'DXT1']]);
  const out = path.join(dir, 'out');
  const ex = await archiveTool({ file: path.join(build.data, 'sharedassets0.assets'), action: 'extract', out });
  assert.deepEqual(ex.skipped, []);
  assert.equal(await fs.readFile(path.join(out, 'TextAsset/dialogue.txt'), 'utf8'), '{"hello":"wereld"}');
  const flag = readPng(await fs.readFile(path.join(out, 'Texture2D/flag.png')));
  assert.deepEqual([flag.width, flag.height, pixel(flag, 0, 0), pixel(flag, 3, 1)], [4, 2, [0, 0, 255, 255], [255, 0, 0, 255]], 'stored bottom-up, written top-down');
  const tile = readPng(await fs.readFile(path.join(out, 'Texture2D/tile.png')));
  assert.deepEqual(pixel(tile, 2, 2), [255, 0, 0, 255], 'DXT1 from the .resS');
  assert.deepEqual(await fs.readFile(path.join(out, 'AudioClip/jump.fsb')), build.fsb);

  const scan = await scanProject({ path: dir });
  const unity = scan.engines.find(e => e.id === 'unity-build');
  assert.ok(unity.details.assetFiles.includes('Game_Data/level0') && unity.details.assetFiles.includes('Game_Data/sharedassets0.assets'));
  assert.ok(scan.nextSteps.some(s => s.startsWith('re_archive') && s.includes('globalgamemanagers')), scan.nextSteps.join('\n'));
  await fs.rm(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------- a bundle with type trees
const COMMON = { m_Name: 427, Base: 55, string: 840, int: 222 };
const ALIGN = 0x4000;
function treeBundleCab() {
  const v = 22;
  const textTree = typeTree([[0, 'TextAsset', 'Base', -1], ...stringRows(1, 'm_Name'), ...stringRows(1, 'm_Script')], v, COMMON);
  const scriptTree = typeTree([[0, 'MonoScript', 'Base', -1], ...stringRows(1, 'm_Name'), [1, 'int', 'm_ExecutionOrder', 4], [1, 'Hash128', 'm_PropertiesHash', 16], [2, 'UInt32', 'a', 4], [2, 'UInt32', 'b', 4], [2, 'UInt32', 'c', 4], [2, 'UInt32', 'd', 4],
    ...stringRows(1, 'm_ClassName'), ...stringRows(1, 'm_Namespace'), ...stringRows(1, 'm_AssemblyName')], v, COMMON);
  const behaviourTree = typeTree([[0, 'MonoBehaviour', 'Base', -1], ...pptrRows(1, 'm_GameObject', 'GameObject'), [1, 'UInt8', 'm_Enabled', 1, ALIGN], ...pptrRows(1, 'm_Script', 'MonoScript'), ...stringRows(1, 'm_Name'),
    [1, 'int', 'speed', 4], [1, 'float', 'jumpHeight', 4], ...stringRows(1, 'title'), [1, 'vector', 'waypoints', -1], [2, 'Array', 'Array', -1, ALIGN], [3, 'int', 'size', 4], [3, 'Vector2f', 'data', 8], [4, 'float', 'x', 4], [4, 'float', 'y', 4]], v, COMMON);
  const bundleTree = typeTree([[0, 'AssetBundle', 'Base', -1], ...stringRows(1, 'm_Name'), [1, 'vector', 'm_PreloadTable', -1], [2, 'Array', 'Array', -1, ALIGN], [3, 'int', 'size', 4], ...pptrRows(3, 'data', 'Object'),
    [1, 'map', 'm_Container', -1], [2, 'Array', 'Array', -1, ALIGN], [3, 'int', 'size', 4], [3, 'pair', 'data', -1], ...stringRows(4, 'first'), [4, 'AssetInfo', 'second', -1], [5, 'int', 'preloadIndex', 4], [5, 'int', 'preloadSize', 4], ...pptrRows(5, 'asset', 'Object')], v, COMMON);
  const texTree = typeTree([[0, 'Texture2D', 'Base', -1], ...stringRows(1, 'm_Name'), [1, 'int', 'm_Width', 4], [1, 'int', 'm_Height', 4], [1, 'int', 'm_CompleteImageSize', 4], [1, 'int', 'm_TextureFormat', 4], [1, 'int', 'm_MipCount', 4],
    [1, 'TypelessData', 'image data', -1, ALIGN], [2, 'int', 'size', 4], [2, 'UInt8', 'data', 1], [1, 'StreamingInfo', 'm_StreamData', -1], [2, 'UInt64', 'offset', 8], [2, 'unsigned int', 'size', 4], ...stringRows(2, 'path')], v, COMMON);
  const dxt5 = Buffer.concat([Buffer.from([255, 255, 0, 0, 0, 0, 0, 0]), Buffer.from([0xe0, 0x07, 0xe0, 0x07, 0, 0, 0, 0])]); // opaque green
  const resS = Buffer.concat([Buffer.alloc(32), dxt5]);
  const cab = serializedFile({ version: v, unityVersion: '2022.3.10f1', typeTree: true,
    types: [{ classId: 49, tree: textTree }, { classId: 115, tree: scriptTree }, { classId: 114, tree: behaviourTree }, { classId: 142, tree: bundleTree }, { classId: 28, tree: texTree }],
    objects: [
      { pathId: 100, type: 0, data: obj.textAsset('story', 'Er was eens…') },
      { pathId: 200, type: 1, data: Buffer.concat([W.str('Player'), W.i32(0), Buffer.alloc(16), W.str('Player'), W.str('Game'), W.str('Assembly-CSharp.dll')]) },
      { pathId: 300, type: 2, data: obj.monoBehaviour(0, [0, 200], 'PlayerConfig', Buffer.concat([W.i32(7), W.f32(2.5), W.str('Held'), W.i32(2), W.f32(1), W.f32(2), W.f32(3), W.f32(4)])) },
      { pathId: 1, type: 3, data: obj.assetBundle('characters', [['assets/story.txt', 100], ['assets/config/player.asset', 300]]) },
      { pathId: 400, type: 4, data: Buffer.concat([W.str('grass'), W.i32(4), W.i32(4), W.i32(16), W.i32(12), W.i32(1), W.i32(0), W.i64(32), W.u32(16), W.str('archive:/CAB-test/CAB-test.resS')]) },
    ] });
  return { cab, resS };
}

test('UnityFS bundle with type trees (LZ4): container paths, scripts, JSON objects, PNG from the .resS, raw files', async () => {
  const dir = await tempDir();
  const { cab, resS } = treeBundleCab();
  const file = path.join(dir, 'characters.bundle');
  await fs.writeFile(file, unityBundle([{ path: 'CAB-test', data: cab, flags: 4 }, { path: 'CAB-test.resS', data: resS }]));
  const list = await archiveTool({ file });
  assert.equal(list.format, 'unityfs');
  assert.deepEqual([list.unityVersion, list.bundleFormat, list.blockCompression], ['2022.3.10f1', 7, ['LZ4']]);
  assert.equal(list.assets.serializedFiles[0].typeTree, true);
  assert.equal(list.assets.containerPaths, 2);
  assert.deepEqual(list.assets.scripts, [{ class: 'Game.Player', assembly: 'Assembly-CSharp.dll', instances: 1 }]);
  const byPath = Object.fromEntries(list.entries.map(e => [e.path, e]));
  assert.equal(byPath['TextAsset/story.txt'].asset, 'assets/story.txt');
  assert.equal(byPath['MonoBehaviour/PlayerConfig.json'].asset, 'assets/config/player.asset');
  assert.deepEqual([byPath['Texture2D/grass.png'].width, byPath['Texture2D/grass.png'].textureFormat], [4, 'DXT5']);
  assert.ok(byPath['raw/CAB-test'] && byPath['raw/CAB-test.resS']);
  const out = path.join(dir, 'out');
  const ex = await archiveTool({ file, action: 'extract', out });
  assert.deepEqual(ex.skipped, []);
  assert.equal(await fs.readFile(path.join(out, 'TextAsset/story.txt'), 'utf8'), 'Er was eens…');
  const config = JSON.parse(await fs.readFile(path.join(out, 'MonoBehaviour/PlayerConfig.json'), 'utf8'));
  assert.deepEqual([config.speed, config.jumpHeight, config.title, config.waypoints, config.m_Script], [7, 2.5, 'Held', [{ x: 1, y: 2 }, { x: 3, y: 4 }], { m_FileID: 0, m_PathID: 200 }]);
  const grass = readPng(await fs.readFile(path.join(out, 'Texture2D/grass.png')));
  assert.deepEqual(pixel(grass, 1, 1), [0, 255, 0, 255]);
  assert.deepEqual(await fs.readFile(path.join(out, 'raw/CAB-test')), cab);
  assert.deepEqual(await fs.readFile(path.join(out, 'raw/CAB-test.resS')), resS);
  const only = await archiveTool({ file, action: 'extract', match: 'TextAsset/*', out: path.join(dir, 'only') });
  assert.deepEqual(only.files.map(f => f.path), ['TextAsset/story.txt']);
  await fs.rm(dir, { recursive: true, force: true });
});

test('UnityFS variants: LZMA blocks with the table at the end, format 6, encrypted bundles, corrupt data', async () => {
  const dir = await tempDir();
  const { cab, resS } = treeBundleCab();
  const files = [{ path: 'CAB-test', data: cab }, { path: 'CAB-test.resS', data: resS }];
  const lzma = path.join(dir, 'lzma.bundle');
  await fs.writeFile(lzma, unityBundle(files, { compression: 'lzma', infoAtEnd: true, format: 6, revision: '2018.4.11f1' }));
  const list = await archiveTool({ file: lzma });
  assert.deepEqual([list.bundleFormat, list.blockCompression, list.assets.objects], [6, ['LZMA'], 5]);
  const ex = await archiveTool({ file: lzma, action: 'extract', match: 'TextAsset/*', out: path.join(dir, 'out') });
  assert.equal(await fs.readFile(path.join(dir, 'out', 'TextAsset/story.txt'), 'utf8'), 'Er was eens…');
  assert.equal(ex.extracted, 1);

  const enc = path.join(dir, 'enc.bundle');
  await fs.writeFile(enc, unityBundle(files, { encrypted: true }));
  const e = await archiveTool({ file: enc });
  assert.equal(e.encrypted, true);
  assert.match(e.note, /never decrypted/);
  await assert.rejects(archiveTool({ file: enc, action: 'extract', out: path.join(dir, 'x') }), { code: 'UNSUPPORTED_ARCHIVE' });

  const good = unityBundle(files, { compression: 'none' });
  const bad = path.join(dir, 'bad.bundle');
  await fs.writeFile(bad, good.subarray(0, good.length - 200));
  await assert.rejects(archiveTool({ file: bad }), { code: 'BAD_FORMAT' });
  await fs.rm(dir, { recursive: true, force: true });
});

test('meshes → OBJ: vertex streams (float and half UVs), external vertex data, compressed meshes, quads', async () => {
  const data = Buffer.alloc(3 * 16);
  [[0, 0, 0], [1, 0, 0], [0, 2, 0]].forEach((p, i) => { p.forEach((v, k) => data.writeFloatLE(v, i * 16 + k * 4)); data.writeUInt16LE(i === 1 ? 0x3c00 : 0, i * 16 + 12); data.writeUInt16LE(i === 2 ? 0x3800 : 0, i * 16 + 14); });
  const channels = Array.from({ length: 14 }, () => ({ stream: 0, offset: 0, format: 0, dimension: 0 }));
  channels[0] = { stream: 0, offset: 0, format: 0, dimension: 3 };
  channels[4] = { stream: 0, offset: 12, format: 1, dimension: 2 };
  const mesh = { m_Name: 'tri', m_IndexFormat: 0, m_IndexBuffer: Buffer.from([0, 0, 1, 0, 2, 0]), m_SubMeshes: [{ firstByte: 0, indexCount: 3, topology: 0, baseVertex: 0 }], m_VertexData: { m_VertexCount: 3, m_Channels: channels, m_DataSize: data } };
  const obj = await meshToObj(mesh, [2021, 3, 0], () => { throw new Error('not external'); });
  assert.equal(obj.text, 'g tri\nv 0 0 0\nv -1 0 0\nv 0 2 0\nvt 0 0\nvt 1 0\nvt 0 0.5\ng tri_0\nf 3/3 2/2 1/1\n');
  // The same vertices kept in a .resS (m_StreamData), drawn as one quad.
  const quad = { ...mesh, m_IndexBuffer: Buffer.from([0, 0, 1, 0, 2, 0, 1, 0]), m_SubMeshes: [{ firstByte: 0, indexCount: 4, topology: 2 }], m_VertexData: { ...mesh.m_VertexData, m_DataSize: Buffer.alloc(0) }, m_StreamData: { offset: 0n, size: 48, path: 'archive:/CAB-x/CAB-x.resS' } };
  const fromRes = await meshToObj(quad, [2021, 3, 0], async (p, offset, size) => { assert.deepEqual([p, offset, size], ['archive:/CAB-x/CAB-x.resS', 0, 48]); return data; });
  assert.equal(fromRes.faces, 2);
  assert.match(fromRes.text, /f 3\/3 2\/2 1\/1\nf 2\/2 3\/3 1\/1\n$/);
  // Compressed: 8-bit packed positions and triangles.
  const packed = (items, bytes, range = 1, start = 0) => ({ m_NumItems: items, m_Range: range, m_Start: start, m_BitSize: 8, m_Data: Buffer.from(bytes) });
  const compressed = { m_Name: 'c', m_SubMeshes: [{ firstByte: 0, indexCount: 3, topology: 0 }], m_VertexData: { m_VertexCount: 0, m_Channels: [], m_DataSize: Buffer.alloc(0) },
    m_CompressedMesh: { m_Vertices: packed(9, [0, 0, 0, 255, 0, 0, 0, 255, 0]), m_UV: packed(0, []), m_Normals: packed(0, []), m_Triangles: packed(3, [0, 1, 2]) } };
  const c = await meshToObj(compressed, [2019, 4, 0], null);
  assert.equal(c.text, 'g c\nv 0 0 0\nv -1 0 0\nv 0 1 0\ng c_0\nf 3 2 1\n');
  assert.equal(await meshToObj({ m_Name: 'empty', m_SubMeshes: [] }, [2022, 1, 0], null), null);
});
