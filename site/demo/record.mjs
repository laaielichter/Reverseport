#!/usr/bin/env node
// Generates the "read field by field" view on the site from a real Godot 4.3 .pck. Nothing in it is typed by hand:
//   1. copies the godot-mini test project to a temp folder and packs it as a real .pck (Godot 4.3, pack format 2)
//   2. runs the real CLI (`reverseport archive`) on it
//   3. writes the annotated header bytes and that output into site/index.html between the hex markers, and the
//      field list into site/demo/transcript.json.
// Usage: node site/demo/record.mjs   (deterministic: running it twice changes nothing)
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPck } from '../../port/test/helpers.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'rp-site-demo-'));
const env = { ...process.env, REVERSEPORT_HOME: path.join(work, '.reverseport'), REVERSEPORT_STASHPAD: 'off' };

// ---------------------------------------------------------------- material
fs.cpSync(path.join(REPO, 'port', 'test', 'fixtures', 'godot-mini'), path.join(work, 'MiniHeli'), { recursive: true });
const files = {};
const walk = dir => { for (const n of fs.readdirSync(dir).sort()) { const p = path.join(dir, n); if (fs.statSync(p).isDirectory()) walk(p); else files[`res://${path.relative(path.join(work, 'MiniHeli'), p).split(path.sep).join('/')}`] = fs.readFileSync(p); } };
walk(path.join(work, 'MiniHeli'));
for (const [dir, set] of [['build-43', files]]) {
  fs.mkdirSync(path.join(work, dir));
  fs.writeFileSync(path.join(work, dir, 'MiniHeli.pck'), buildPck(set, { version: 2, godot: [4, 3, 0] }));
}

// ---------------------------------------------------------------- real runs
const cli = (...args) => {
  const r = spawnSync(process.execPath, [path.join(REPO, 'bin', 'reverseport.mjs'), ...args, '--compact'], { cwd: work, env, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`reverseport ${args.join(' ')} failed: ${r.stderr}`);
  return JSON.parse(r.stdout);
};
const pack = cli('archive', 'build-43/MiniHeli.pck', '--limit', '3');

// ---------------------------------------------------------------- annotated pack header
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const bytes = fs.readFileSync(path.join(work, 'build-43', 'MiniHeli.pck'));
const u32 = o => bytes.readUInt32LE(o), u64 = o => Number(bytes.readBigUInt64LE(o));
const nameLen = u32(100);
const name = bytes.toString('utf8', 104, 104 + nameLen).replace(/\0+$/, '');
const e = 104 + nameLen;
const fields = [
  { from: 0, to: 4, f: 'magic', label: 'Magic', value: '"GDPC": a Godot pack' },
  { from: 4, to: 8, f: 'version', label: 'Pack format', value: String(u32(4)) },
  { from: 8, to: 20, f: 'engine', label: 'Engine', value: `Godot ${u32(8)}.${u32(12)}.${u32(16)}` },
  { from: 20, to: 24, f: 'flags', label: 'Pack flags', value: u32(20) ? 'set' : 'none (not encrypted)' },
  { from: 24, to: 32, f: 'offset', label: 'Files start at', value: `byte ${u64(24)}` },
  { from: 32, to: 96, f: 'reserved', label: 'Reserved', value: '64 zero bytes' },
  { from: 96, to: 100, f: 'count', label: 'Files', value: String(u32(96)) },
  { from: 100, to: 104, f: 'size', label: 'Path length', value: String(nameLen) },
  { from: 104, to: e, f: 'path', label: 'First path', value: name },
  { from: e, to: e + 8, f: 'offset', label: 'Its offset', value: `${u64(e)}, counted from byte ${u64(24)}` },
  { from: e + 8, to: e + 16, f: 'size', label: 'Its size', value: `${u64(e + 8)} bytes` },
  { from: e + 16, to: e + 32, f: 'md5', label: 'Its MD5', value: bytes.toString('hex', e + 16, e + 32) },
];
const fieldAt = o => fields.find(x => o >= x.from && o < x.to);
const end = e + 32;
let hex = '';
for (let o = 0; o < end; o++) {
  if (o === 48) { hex += `<span class="hx-skip" role="row">… bytes 0x30–0x5f are reserved zeros</span>`; o = 95; continue; }
  if (o % 8 === 0) hex += `<span class="hx-off${o % 16 ? ' hx-mid' : ''}">${o.toString(16).padStart(4, '0')}</span>`;
  const fld = fieldAt(o);
  hex += `<span class="hx-b f-${fld?.f ?? 'none'}" data-field="${fld?.label ?? ''}">${bytes[o].toString(16).padStart(2, '0')}</span>`;
}
const legend = fields.filter(f => f.f !== 'reserved').map(f => `<li class="f-${f.f}"><span class="lg-name">${esc(f.label)}</span><span class="lg-val">${esc(f.value)}</span></li>`).join('');
const report = `<pre class="report" aria-label="What re_archive reports">${esc(`reverseport archive MiniHeli.pck
{ "format": ${JSON.stringify(pack.format)},
  "packVersion": ${pack.packVersion}, "godotVersion": ${JSON.stringify(pack.godotVersion)},
  "encryptedDirectory": ${pack.encryptedDirectory}, "totalEntries": ${pack.totalEntries},
  "entries": [ { "path": ${JSON.stringify(pack.entries[0].path)},
                 "offset": ${pack.entries[0].offset}, "size": ${pack.entries[0].size} }, … ] }`)}</pre>`;
const block = `<!-- hex:start (generated by site/demo/record.mjs; do not edit) -->
<div><div class="hx" role="img" aria-label="The first ${end} bytes of a Godot 4.3 .pck file, coloured by field">${hex}</div>
${report}</div>
<ul class="legend">${legend}</ul>
<!-- hex:end -->`;
const indexPath = path.join(REPO, 'site', 'index.html');
if (fs.existsSync(indexPath)) {
  const html = fs.readFileSync(indexPath, 'utf8');
  const next = html.replace(/<!-- hex:start[\s\S]*?<!-- hex:end -->/, block);
  if (next === html && !html.includes('hex:start')) throw new Error('site/index.html has no hex markers');
  fs.writeFileSync(indexPath, next);
}
fs.writeFileSync(path.join(REPO, 'site', 'demo', 'transcript.json'), `${JSON.stringify({ recordedWith: 'site/demo/record.mjs', packHeader: fields.map(({ from, to, label, value }) => ({ from, to, label, value })) }, null, 2)}\n`);
fs.rmSync(work, { recursive: true, force: true });
console.log(`byte view: ${end} bytes, ${fields.length} fields`);
