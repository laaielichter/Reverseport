// Builds a tiny RPG Maker MV project on disk: data/*.json, two tileset PNGs, one map with two events.
import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = b => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
export function png(w, h, rgb) {
  const chunk = (type, data) => { const l = Buffer.alloc(4); l.writeUInt32BE(data.length); const t = Buffer.from(type); const c = Buffer.alloc(4); c.writeUInt32BE(crc(Buffer.concat([t, data]))); return Buffer.concat([l, t, data, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.alloc(1 + w * 3); for (let x = 0; x < w; x++) row.set(rgb, 1 + x * 3);
  const raw = Buffer.concat(Array(h).fill(row));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

export async function buildRpgMakerProject(dir) {
  await fs.mkdir(path.join(dir, 'data'), { recursive: true });
  await fs.mkdir(path.join(dir, 'img', 'tilesets'), { recursive: true });
  await fs.mkdir(path.join(dir, 'js'), { recursive: true });
  await fs.writeFile(path.join(dir, 'js', 'rpg_core.js'), '// core');
  await fs.writeFile(path.join(dir, 'img', 'tilesets', 'Outside_A2.png'), png(768, 576, [40, 160, 60]));
  await fs.writeFile(path.join(dir, 'img', 'tilesets', 'Outside_B.png'), png(768, 768, [120, 90, 60]));
  const w = 6, h = 5;
  const data = new Array(w * h * 6).fill(0);
  for (let i = 0; i < w * h; i++) data[i] = 2816; // A2 grass autotile, layer 0
  data[w * h + 2 * w + 3] = 5; // a B tile on layer 1
  const page = (list, trigger = 0, cond = {}) => ({ conditions: { switch1Valid: false, switch1Id: 1, switch2Valid: false, switch2Id: 1, variableValid: false, variableId: 1, variableValue: 0, selfSwitchValid: false, selfSwitchCh: 'A', ...cond }, trigger, list });
  const events = [null,
    { id: 1, name: 'Sign', x: 2, y: 1, pages: [page([{ code: 101, indent: 0, parameters: ['', 0, 0, 2] }, { code: 401, indent: 0, parameters: ['Welcome!'] }, { code: 121, indent: 0, parameters: [1, 1, 0] }, { code: 122, indent: 0, parameters: [2, 2, 0, 0, 7] }, { code: 0, indent: 0, parameters: [] }])] },
    { id: 2, name: 'Auto', x: 4, y: 3, pages: [page([{ code: 111, indent: 0, parameters: [0, 1, 0] }, { code: 123, indent: 1, parameters: ['A', 0] }, { code: 0, indent: 1, parameters: [] }, { code: 412, indent: 0, parameters: [] }, { code: 230, indent: 0, parameters: [1] }, { code: 301, indent: 0, parameters: [0, 1, false, false] }, { code: 0, indent: 0, parameters: [] }], 3)] },
  ];
  const files = {
    'System.json': { gameTitle: 'Tiny Quest', startMapId: 1, startX: 1, startY: 1, hasEncryptedImages: false, hasEncryptedAudio: false, switches: ['', 'met'], variables: ['', '', 'gold'] },
    'MapInfos.json': [null, { id: 1, name: 'Town', parentId: 0, order: 1 }],
    'Map001.json': { displayName: 'Town', tilesetId: 1, width: w, height: h, data, events },
    'Tilesets.json': [null, { id: 1, name: 'Outside', tilesetNames: ['', 'Outside_A2', '', '', '', 'Outside_B', '', '', ''], flags: [] }],
    'CommonEvents.json': [null, { id: 1, name: 'Heal', trigger: 0, list: [{ code: 314, indent: 0, parameters: [0, 0] }, { code: 0, indent: 0, parameters: [] }] }],
    'Actors.json': [null, { id: 1, name: 'Hero' }],
    'Items.json': [null, { id: 1, name: 'Potion' }],
  };
  for (const [f, v] of Object.entries(files)) await fs.writeFile(path.join(dir, 'data', f), JSON.stringify(v));
  return dir;
}
