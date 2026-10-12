// Diffs (two builds, two versions of a project, two packs or binaries), raw probing of unknown data
// (hex view, entropy map, embedded files, record strides), carving, and the architecture report.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createReadStream, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import crypto from 'node:crypto';
import { RPError, readAt, requireFile, statOrNull, walk, MiB, sha256File, limit, pascalCase } from './util.mjs';
import { identify, findSignatures, entropyProfile, strideGuess } from './formats.mjs';
import { inspectBinary } from './binary.mjs';
import { openArchive } from './archive.mjs';
import { workspaceDir } from './workspace.mjs';
import { scanProject } from './scan.mjs';
import { buildGraph, graphMermaid } from './graph.mjs';
import { readScene } from './scene.mjs';

export function hexdump(buf, base = 0) {
  const lines = [];
  for (let i = 0; i < buf.length; i += 16) {
    const row = buf.subarray(i, i + 16);
    const hex = [...row].map(b => b.toString(16).padStart(2, '0')).join(' ').padEnd(47);
    const ascii = [...row].map(b => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.')).join('');
    lines.push(`${(base + i).toString(16).padStart(8, '0')}  ${hex}  ${ascii}`);
  }
  return lines.join('\n');
}

export async function probe({ file, offset = 0, length = 256, maxMB = 512 } = {}) {
  const { abs, size } = await requireFile(file);
  if (offset < 0 || offset >= Math.max(size, 1)) throw new RPError('INVALID_ARGUMENT', `offset must be within the file (0…${size - 1}).`);
  const head = await readAt(abs, offset, 4096);
  const view = head.subarray(0, Math.max(16, Math.min(length, 4096)));
  const strideBuf = await readAt(abs, offset, 65536);
  const span = Math.min(maxMB, 64 * 1024) * MiB;
  return {
    file: abs, size, offset, identified: identify(head),
    hex: hexdump(view, offset),
    entropy: await entropyProfile(abs, { start: offset, maxBytes: span }),
    embedded: await findSignatures(abs, { start: offset, maxBytes: span, max: 150 }),
    strides: strideGuess(strideBuf),
    hint: 'embedded[] are candidate files inside this one (carve with re_extract); strides suggest fixed-size records (tables); entropy ≥ 7.5 means compressed or encrypted data.',
  };
}

export async function carve({ file, offset, length, name } = {}) {
  const { abs, size } = await requireFile(file);
  if (!Number.isInteger(offset) || offset < 0 || offset >= size) throw new RPError('INVALID_ARGUMENT', 'offset must be an integer inside the file.');
  let len = length;
  let kind = identify(await readAt(abs, offset, 4096));
  if (!len) {
    const sig = (await findSignatures(abs, { start: offset, maxBytes: 64 * MiB, max: 5, includeStart: true })).hits.find(h => h.offset === offset);
    if (sig?.size) len = sig.size;
    else throw new RPError('INVALID_ARGUMENT', `Give length: the size of a ${kind.name} at this offset is not stored in its header.`);
  }
  len = Math.min(len, size - offset);
  const ext = { png: 'png', jpeg: 'jpg', gif: 'gif', webp: 'webp', wav: 'wav', ogg: 'ogg', flac: 'flac', mp4: 'mp4', glb: 'glb', zip: 'zip', 'godot-pck': 'pck', pe: 'exe', elf: 'elf', dds: 'dds', fbx: 'fbx', sqlite: 'sqlite', pdf: 'pdf', otf: 'otf', woff: 'woff', woff2: 'woff2', midi: 'mid', 'godot-ctex': 'ctex', 'godot-resource': 'res', unityfs: 'bundle', wasm: 'wasm' }[kind.id] ?? 'bin';
  const dir = await workspaceDir('extracted', 'carved');
  const base = (name ? String(name).replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 80) : `${path.basename(abs).replace(/[^A-Za-z0-9._-]+/g, '_')}@${offset.toString(16)}`) + (name && path.extname(name) ? '' : `.${ext}`);
  const dest = path.join(dir, base);
  await pipeline(createReadStream(abs, { start: offset, end: offset + len - 1 }), createWriteStream(dest));
  kind = identify(await readAt(dest, 0, 4096));
  return { file: dest, bytes: len, identified: kind, from: { file: abs, offset } };
}

async function quickHash(file, size) {
  if (size <= 64 * MiB) return sha256File(file);
  const h = crypto.createHash('sha256');
  h.update(await readAt(file, 0, MiB)); h.update(await readAt(file, Math.floor(size / 2), MiB)); h.update(await readAt(file, size - MiB, MiB));
  return `sampled:${h.digest('hex')}`;
}

export async function compare({ a, b, limit: max = 300 } = {}) {
  const sa = await statOrNull(path.resolve(a ?? '')), sb = await statOrNull(path.resolve(b ?? ''));
  if (!sa || !sb) throw new RPError('NOT_FOUND', 'Both a and b must exist.');
  const A = path.resolve(a), Bp = path.resolve(b);
  const cap = Math.max(10, Math.min(5000, max));
  if (sa.isDirectory() && sb.isDirectory()) {
    const [wa, wb] = await Promise.all([walk(A, { maxFiles: 200000, ignore: new Set(['.git']) }), walk(Bp, { maxFiles: 200000, ignore: new Set(['.git']) })]);
    const ma = new Map(wa.files.map(f => [f.rel, f])), mb = new Map(wb.files.map(f => [f.rel, f]));
    const added = [], removed = [], changed = [];
    for (const [rel, f] of mb) if (!ma.has(rel)) added.push({ file: rel, size: f.size });
    for (const [rel, f] of ma) if (!mb.has(rel)) removed.push({ file: rel, size: f.size });
    for (const [rel, fa] of ma) {
      const fb = mb.get(rel);
      if (!fb) continue;
      if (fa.size !== fb.size) changed.push({ file: rel, sizeA: fa.size, sizeB: fb.size, delta: fb.size - fa.size });
      else if (fa.size && (await quickHash(fa.abs, fa.size)) !== (await quickHash(fb.abs, fb.size))) changed.push({ file: rel, sizeA: fa.size, sizeB: fb.size, delta: 0 });
    }
    changed.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));
    return { kind: 'folders', a: A, b: Bp, summary: { added: added.length, removed: removed.length, changed: changed.length, unchanged: ma.size - removed.length - changed.length }, added: limit(added, cap), removed: limit(removed, cap), changed: limit(changed, cap) };
  }
  if (!sa.isFile() || !sb.isFile()) throw new RPError('INVALID_ARGUMENT', 'Compare two folders or two files.');
  const ka = identify(await readAt(A, 0, 4096)), kb = identify(await readAt(Bp, 0, 4096));
  // Archives / packs
  const arcA = await openArchive(A).catch(() => null), arcB = arcA ? await openArchive(Bp).catch(() => null) : null;
  if (arcA?.entries?.length && arcB?.entries) {
    const ea = new Map(arcA.entries.map(e => [e.path, e])), eb = new Map(arcB.entries.map(e => [e.path, e]));
    const added = [...eb.keys()].filter(k => !ea.has(k)).map(k => ({ path: k, size: eb.get(k).size }));
    const removed = [...ea.keys()].filter(k => !eb.has(k)).map(k => ({ path: k, size: ea.get(k).size }));
    const changed = [...ea.keys()].filter(k => eb.has(k) && (ea.get(k).size !== eb.get(k).size || (ea.get(k).md5 && eb.get(k).md5 && ea.get(k).md5 !== eb.get(k).md5))).map(k => ({ path: k, sizeA: ea.get(k).size, sizeB: eb.get(k).size, delta: eb.get(k).size - ea.get(k).size }));
    changed.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));
    return { kind: 'archives', format: [arcA.format, arcB.format], a: A, b: Bp, ...(arcA.godotVersion ? { godotVersion: [arcA.godotVersion, arcB.godotVersion] } : {}), summary: { added: added.length, removed: removed.length, changed: changed.length, entriesA: ea.size, entriesB: eb.size }, added: limit(added, cap), removed: limit(removed, cap), changed: limit(changed, cap) };
  }
  // Executables
  if (ka.category === 'executable' && kb.category === 'executable') {
    const [ia, ib] = await Promise.all([inspectBinary({ file: A, strings: { limit: 1 } }), inspectBinary({ file: Bp, strings: { limit: 1 } })]);
    const libs = i => new Set((i.binary?.imports ?? []).flatMap(x => (x.libraries ? x.libraries : [x.library])));
    const fns = i => new Set((i.binary?.imports ?? []).flatMap(x => (x.functions ?? []).map(f => `${x.library}!${f}`)));
    const ex = i => new Set(i.binary?.exports?.names ?? []);
    const diff = (x, y) => ({ added: [...y].filter(v => !x.has(v)).slice(0, cap), removed: [...x].filter(v => !y.has(v)).slice(0, cap) });
    const secs = i => new Map((i.binary?.sections ?? []).map(s => [s.name, s]));
    const sA = secs(ia), sB = secs(ib);
    const sections = [...new Set([...sA.keys(), ...sB.keys()])].map(n => ({ name: n, sizeA: sA.get(n)?.rawSize ?? sA.get(n)?.size ?? null, sizeB: sB.get(n)?.rawSize ?? sB.get(n)?.size ?? null, entropyA: sA.get(n)?.entropy, entropyB: sB.get(n)?.entropy })).filter(s => s.sizeA !== s.sizeB || s.entropyA !== s.entropyB);
    return { kind: 'binaries', a: A, b: Bp, identical: ia.sha256 === ib.sha256, format: [ia.binary?.format, ib.binary?.format], arch: [ia.binary?.arch, ib.binary?.arch], size: [ia.size, ib.size], timestamp: [ia.binary?.timestamp, ib.binary?.timestamp], libraries: diff(libs(ia), libs(ib)), importedFunctions: diff(fns(ia), fns(ib)), exports: diff(ex(ia), ex(ib)), changedSections: sections.slice(0, 100), hints: [ia.hints, ib.hints] };
  }
  // Raw bytes
  const BLOCK = 4096, sizeA = sa.size, sizeB = sb.size;
  const scan = Math.min(Math.max(sizeA, sizeB), 512 * MiB);
  const fa = await fs.open(A, 'r'), fb = await fs.open(Bp, 'r');
  let first = null, blocks = 0;
  const regions = [];
  try {
    const ba = Buffer.alloc(MiB), bb = Buffer.alloc(MiB);
    for (let pos = 0; pos < scan; pos += MiB) {
      const [ra, rb] = await Promise.all([fa.read(ba, 0, MiB, pos), fb.read(bb, 0, MiB, pos)]);
      const n = Math.max(ra.bytesRead, rb.bytesRead);
      for (let o = 0; o < n; o += BLOCK) {
        const x = ba.subarray(o, Math.min(o + BLOCK, ra.bytesRead)), y = bb.subarray(o, Math.min(o + BLOCK, rb.bytesRead));
        if (x.equals(y)) continue;
        blocks++;
        if (first === null) { let k = 0; while (k < Math.min(x.length, y.length) && x[k] === y[k]) k++; first = pos + o + k; }
        const at = pos + o, last = regions[regions.length - 1];
        if (last && last.end === at) last.end = at + BLOCK; else if (regions.length < 200) regions.push({ start: at, end: at + BLOCK });
      }
    }
  } finally { await fa.close(); await fb.close(); }
  return { kind: 'bytes', a: A, b: Bp, formats: [ka.name, kb.name], size: [sizeA, sizeB], identical: blocks === 0 && sizeA === sizeB, firstDifference: first, differingBlocks4K: blocks, regions: regions.map(r => ({ start: r.start, end: r.end, length: r.end - r.start })), scannedBytes: scan, hint: first !== null ? `re_probe {file, offset:${first}} on each file shows the bytes around the first difference.` : undefined };
}

export async function report({ path: dir, out } = {}) {
  const scan = await scanProject({ path: dir });
  const graph = await buildGraph(dir);
  const name = scan.engines.find(e => e.details?.name)?.details?.name ?? path.basename(scan.root);
  const lines = [`# Architecture — ${name}`, '', `Generated by [ReversePort](https://github.com/laaielichter/reverseport) on ${new Date().toISOString().slice(0, 10)} from \`${scan.root}\`.`, ''];
  lines.push('## At a glance', '', `- **Engine / stack:** ${scan.engines.map(e => e.name).join(', ') || 'not detected'}`, `- **Files:** ${scan.files} (${(scan.totalBytes / MiB).toFixed(1)} MiB)`, `- **Languages:** ${Object.entries(scan.languages).map(([l, v]) => `${l} (${v.files} files, ${v.lines} lines)`).join(', ') || '—'}`, `- **Entry points:** ${scan.entryPoints.map(e => `\`${e.file}\``).join(', ') || '—'}`, '');
  lines.push('## Module graph', '', 'Most connected files (arrows point to what a file depends on):', '', '```mermaid', graphMermaid(graph, 40), '```', '');
  if (graph.cycles.length) lines.push('## Dependency cycles', '', ...graph.cycles.slice(0, 10).map(c => `- ${c.map(x => `\`${x}\``).join(' ↔ ')}`), '');
  const hubs = [...graph.nodes.keys()].map(k => ({ k, n: graph.inDegree.get(k) })).sort((x, y) => y.n - x.n).slice(0, 12).filter(x => x.n);
  if (hubs.length) lines.push('## Most used', '', '| File | Used by |', '|---|---|', ...hubs.map(h => `| \`${h.k}\` | ${h.n} |`), '');
  const scenes = scan.entryPoints.filter(e => /\.(tscn|unity|prefab)$/.test(e.file)).slice(0, 3);
  for (const s of scenes) {
    const sc = await readScene(path.join(scan.root, s.file)).catch(() => null);
    if (sc?.mermaid) lines.push(`## Scene: ${s.file}`, '', '```mermaid', sc.mermaid, '```', '');
  }
  const classes = [];
  for (const n of graph.nodes.values()) for (const c of n.sym?.classes ?? []) if (c.name) classes.push({ name: c.name, extends: c.extends, file: n.file, functions: n.sym.functions.length });
  if (classes.length) lines.push('## Classes', '', '| Class | Extends | File | Functions |', '|---|---|---|---|', ...classes.slice(0, 150).map(c => `| ${c.name} | ${c.extends ?? ''} | \`${c.file}\` | ${c.functions} |`), '');
  if (graph.orphans.length) lines.push('## Possibly unused', '', ...graph.orphans.slice(0, 40).map(o => `- \`${o}\``), '');
  const ext = [...graph.externals.entries()].sort((x, y) => y[1] - x[1]).slice(0, 25);
  if (ext.length) lines.push('## External dependencies', '', ...ext.map(([k, v]) => `- ${k} (${v})`), '');
  const dest = out ? path.resolve(out) : path.join(await workspaceDir('reports'), `${pascalCase(name)}-ARCHITECTURE.md`);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.writeFile(dest, lines.join('\n'));
  return { file: dest, name, engines: scan.engines.map(e => e.name), files: scan.files, classes: classes.length, cycles: graph.cycles.length, entryPoints: scan.entryPoints, preview: lines.slice(0, 40).join('\n') };
}
