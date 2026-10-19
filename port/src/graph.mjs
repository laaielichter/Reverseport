// Dependency graph across a whole project: imports/includes/requires, Godot res:// loads and scene
// resources, Unity script/prefab GUIDs, and type references for languages without file imports (C#,
// GDScript class_name, Java…). Gives cycles, entry points, orphans and a port order (dependencies first).
import fs from 'node:fs/promises';
import path from 'node:path';
import { requireDir, walk, isText } from './util.mjs';
import { languageOf, fileSymbols, stripComments, identifiers, CODE_LANGUAGES } from './symbols.mjs';
import { unityGuidMap } from './scene.mjs';
import { detectEngines } from './scan.mjs';
import { workspacePackages, packageCandidates, splitSpecifier, tsconfigAliases } from './jsworkspace.mjs';

const JS_EXT = ['.ts', '.tsx', '.mts', '.js', '.mjs', '.cjs', '.jsx', '.vue', '.svelte', '.json'];
const TYPE_INDEX_LANGS = new Set(['csharp', 'java', 'kotlin', 'gdscript', 'swift', 'haxe', 'dart', 'scala']);
const SCENE_LANGS = new Set(['godot-scene', 'godot-resource', 'unity-scene', 'unity-prefab']);

export async function buildGraph(dir, { maxFiles = 30000 } = {}) {
  const root = await requireDir(dir, 'project folder');
  const { files, truncated, unreadable } = await walk(root, { maxFiles });
  const byRel = new Map(files.map(f => [f.rel, f]));
  const lowerRel = new Map(files.map(f => [f.rel.toLowerCase(), f.rel]));
  const exists = rel => (byRel.has(rel) ? rel : lowerRel.get(rel.toLowerCase()) ?? null);
  const engines = await detectEngines(root, files);
  const godotRoots = engines.filter(e => e.id === 'godot').map(e => e.root).sort((a, b) => b.length - a.length);
  const unityRoots = engines.filter(e => e.id === 'unity').map(e => e.root);
  const godotRootOf = rel => godotRoots.find(r => !r || rel.startsWith(`${r}/`)) ?? '';
  const nodes = new Map();
  const externals = new Map();
  const edges = [];
  const edgeSet = new Set();
  const addEdge = (from, to, kind) => { if (!to || from === to) return; const k = `${from}\0${to}`; if (edgeSet.has(k)) return; edgeSet.add(k); edges.push({ from, to, kind }); };
  const external = spec => externals.set(spec, (externals.get(spec) ?? 0) + 1);

  // Header index for C/C++ includes; package dirs for Go
  const headers = new Map();
  for (const f of files) if (/\.(h|hh|hpp|hxx|inl|h\.in)$/i.test(f.rel)) { const b = path.posix.basename(f.rel).toLowerCase(); headers.set(b, [...(headers.get(b) ?? []), f.rel]); }
  let goModule = null;
  if (byRel.has('go.mod')) goModule = (await fs.readFile(byRel.get('go.mod').abs, 'utf8')).match(/^module\s+(\S+)/m)?.[1] ?? null;

  const typeIndex = new Map();
  const identCache = new Map();
  for (const e of engines.filter(x => x.id === 'godot')) for (const a of e.details.autoload) {
    const rel = exists((e.root ? `${e.root}/` : '') + a.path.replace(/^res:\/\//, ''));
    if (rel && /^[A-Z_]\w{2,}$/.test(a.name)) typeIndex.set(a.name, [rel]);
  }
  for (const f of files) {
    const language = languageOf(f.rel);
    if (!language || (!CODE_LANGUAGES.has(language) && !SCENE_LANGS.has(language))) continue;
    if (f.size > 4 * 1024 * 1024) { nodes.set(f.rel, { file: f.rel, language, size: f.size, skipped: 'too large' }); continue; }
    if (SCENE_LANGS.has(language)) { nodes.set(f.rel, { file: f.rel, language, size: f.size, kind: 'scene' }); continue; }
    const sym = await fileSymbols(f.abs, language);
    if (!sym) continue;
    nodes.set(f.rel, { file: f.rel, language, size: f.size, lines: sym.lines, sym });
    if (TYPE_INDEX_LANGS.has(language)) {
      for (const c of sym.classes) if (c.name && !c.inner && c.name.length >= 3) typeIndex.set(c.name, [...(typeIndex.get(c.name) ?? []), f.rel]);
      const text = await fs.readFile(f.abs, 'utf8');
      identCache.set(f.rel, identifiers(stripComments(text, language)));
    }
  }

  const resolveRes = (from, spec) => {
    if (/^(uid|user):\/\//.test(spec)) return null;
    if (spec.startsWith('res://')) { const r = godotRootOf(from); return exists(path.posix.normalize((r ? `${r}/` : '') + spec.slice(6))); }
    return exists(path.posix.normalize(path.posix.join(path.posix.dirname(from), spec)));
  };
  // Monorepos: workspace packages by name and tsconfig "paths" aliases resolve to files in this folder.
  const hasJs = files.some(f => /\.(m?[jt]sx?|cjs|cts)$/.test(f.rel));
  const wsPackages = hasJs ? await workspacePackages(files) : new Map();
  const aliasOf = hasJs ? await tsconfigAliases(files, byRel) : () => [];
  const jsFile = (base, from) => {
    const stem = base.replace(/\.(m?js|cjs|jsx)$/, '');
    for (const c of [base, ...JS_EXT.map(e => stem + e), ...JS_EXT.map(e => `${base}/index${e}`)]) { const hit = exists(c); if (hit && hit !== from && nodes.has(hit)) return hit; }
    for (const c of [base, ...JS_EXT.map(e => stem + e), ...JS_EXT.map(e => `${base}/index${e}`)]) { const hit = exists(c); if (hit && hit !== from) return hit; }
    return null;
  };
  let workspaceEdges = 0, aliasEdges = 0;
  const resolveJs = (from, spec) => {
    if (/^\.{1,2}\//.test(spec) || spec.startsWith('/')) {
      return jsFile(spec.startsWith('/') ? spec.slice(1) : path.posix.normalize(path.posix.join(path.posix.dirname(from), spec)), from);
    }
    for (const c of aliasOf(from, spec)) { const hit = jsFile(c, from); if (hit) { aliasEdges++; return hit; } }
    const { name, sub } = splitSpecifier(spec);
    const ws = wsPackages.get(name);
    if (ws) for (const c of packageCandidates(ws, sub)) { const hit = jsFile(c, from); if (hit) { workspaceEdges++; return hit; } }
    return null;
  };
  const resolvePy = (from, spec) => {
    const dots = spec.match(/^\.*/)[0].length;
    const mod = spec.slice(dots).replace(/\./g, '/');
    const bases = dots ? [path.posix.join(path.posix.dirname(from), ...Array(Math.max(0, dots - 1)).fill('..'))] : ['', 'src', path.posix.dirname(from)];
    for (const b of bases) for (const c of [mod ? `${mod}.py` : '__init__.py', mod ? `${mod}/__init__.py` : null]) { if (!c) continue; const hit = exists(path.posix.normalize(b ? `${b}/${c}` : c)); if (hit) return hit; }
    return null;
  };
  const resolveInclude = (from, spec) => {
    const direct = exists(path.posix.normalize(path.posix.join(path.posix.dirname(from), spec))) ?? exists(spec);
    if (direct) return direct;
    const cands = (headers.get(path.posix.basename(spec).toLowerCase()) ?? []).filter(h => h.toLowerCase().endsWith(spec.toLowerCase()));
    if (cands.length <= 1) return cands[0] ?? null;
    const dirFrom = path.posix.dirname(from);
    return cands.sort((a, b) => commonPrefix(b, dirFrom) - commonPrefix(a, dirFrom))[0];
  };
  const resolveLua = (from, spec) => {
    const p = spec.replace(/\./g, '/');
    for (const b of ['', path.posix.dirname(from)]) for (const c of [`${p}.lua`, `${p}/init.lua`]) { const hit = exists(path.posix.normalize(b ? `${b}/${c}` : c)); if (hit) return hit; }
    return null;
  };
  const resolveRustMod = (from, name) => {
    const dir = path.posix.dirname(from), stem = path.posix.basename(from, '.rs');
    const base = ['mod', 'main', 'lib'].includes(stem) ? dir : path.posix.join(dir, stem);
    return exists(path.posix.normalize(`${base}/${name}.rs`)) ?? exists(path.posix.normalize(`${base}/${name}/mod.rs`));
  };

  for (const n of nodes.values()) {
    if (n.kind === 'scene') {
      const text = await fs.readFile(byRel.get(n.file).abs, 'utf8').catch(() => '');
      if (n.language.startsWith('godot')) {
        for (const m of text.matchAll(/\[ext_resource[^\]]*?path="([^"]+)"/g)) { const hit = resolveRes(n.file, m[1]); if (hit) addEdge(n.file, hit, 'resource'); }
      } else {
        const uroot = unityRoots.find(r => !r || n.file.startsWith(`${r}/`));
        const guids = await unityGuidMap(path.join(root, uroot ?? ''));
        for (const g of new Set([...text.matchAll(/guid:\s*([0-9a-f]{32})/g)].map(m => m[1]))) {
          const asset = guids.get(g);
          const rel = asset && exists((uroot ? `${uroot}/` : '') + asset);
          if (rel && (rel.endsWith('.cs') || /\.(prefab|unity|asset)$/.test(rel))) addEdge(n.file, rel, rel.endsWith('.cs') ? 'script' : 'asset');
        }
      }
      continue;
    }
    if (!n.sym) continue;
    for (const d of n.sym.deps) {
      let hit = null;
      switch (n.language) {
        case 'gdscript': case 'shader': hit = resolveRes(n.file, d.spec); break;
        case 'javascript': case 'typescript': hit = resolveJs(n.file, d.spec); if (!hit && !/^[./]/.test(d.spec) && !wsPackages.has(splitSpecifier(d.spec).name)) external(d.spec.startsWith('@') ? d.spec.split('/').slice(0, 2).join('/') : d.spec.split('/')[0]); break;
        case 'python': hit = resolvePy(n.file, d.spec); if (!hit && !d.spec.startsWith('.')) external(d.spec.split('.')[0]); break;
        case 'c': case 'c-header': case 'cpp': case 'objc': if (d.kind === 'system') external(`<${d.spec}>`); else { hit = resolveInclude(n.file, d.spec); if (!hit) external(`"${d.spec}"`); } break;
        case 'lua': hit = resolveLua(n.file, d.spec); if (!hit) external(d.spec); break;
        case 'rust': if (d.kind === 'mod') hit = resolveRustMod(n.file, d.spec); else if (!/^(crate|self|super)::/.test(d.spec)) external(d.spec.split('::')[0]); break;
        case 'go':
          if (goModule && d.spec.startsWith(`${goModule}/`)) {
            const pkgDir = d.spec.slice(goModule.length + 1);
            for (const f of files) if (path.posix.dirname(f.rel) === pkgDir && f.rel.endsWith('.go') && !f.rel.endsWith('_test.go')) addEdge(n.file, f.rel, 'import');
          } else external(d.spec);
          break;
        case 'java': case 'kotlin': case 'scala': {
          const cls = d.spec.split('.').pop();
          const cands = (typeIndex.get(cls) ?? []).filter(f => f.replace(/\.(java|kt|scala)$/, '').endsWith(d.spec.replace(/\./g, '/')));
          if (cands[0]) hit = cands[0]; else if (cls !== '*') external(d.spec.split('.').slice(0, 2).join('.'));
          break;
        }
        case 'csharp': external(d.spec.split('.').slice(0, 2).join('.')); break;
        default: break;
      }
      if (hit) addEdge(n.file, hit, d.kind ?? 'import');
    }
  }
  // Type references (C#, GDScript class_name, Java/Kotlin same-package, Swift…)
  for (const [file, ids] of identCache) {
    for (const id of ids) {
      const owners = typeIndex.get(id);
      if (!owners || owners.length > 3) continue;
      for (const o of owners) if (o !== file) addEdge(file, o, 'type');
    }
  }

  // Entry points
  const entry = new Set();
  for (const e of engines) {
    if (e.id === 'godot') {
      const base = e.root ? `${e.root}/` : '';
      if (e.details.mainScene) { const r = exists(base + e.details.mainScene.replace(/^res:\/\//, '')); if (r) entry.add(r); }
      for (const a of e.details.autoload) { const r = exists(base + a.path.replace(/^res:\/\//, '')); if (r) entry.add(r); }
    }
    if (e.id === 'unity') for (const s of e.details.buildScenes) { const r = exists((e.root ? `${e.root}/` : '') + s); if (r) entry.add(r); }
    if (e.id === 'node') for (const m of [e.details.main, ...(e.details.starts ?? [])].filter(Boolean)) { const r = exists(path.posix.normalize((e.root ? `${e.root}/` : '') + m)); if (r) entry.add(r); }
  }
  for (const n of nodes.values()) if (n.sym?.entry || /(^|\/)(main\.(rs|go|py|c|cpp|cc|lua)|__main__\.py|Program\.cs)$/.test(n.file)) entry.add(n.file);

  const out = new Map([...nodes.keys()].map(k => [k, []]));
  const inc = new Map([...nodes.keys()].map(k => [k, 0]));
  for (const e of edges) { if (!out.has(e.from) || !nodes.has(e.to)) continue; out.get(e.from).push(e.to); inc.set(e.to, inc.get(e.to) + 1); }
  const { sccs, order } = tarjanOrder([...nodes.keys()], out);
  const cycles = sccs.filter(c => c.length > 1).sort((a, b) => b.length - a.length);
  const orphans = [...nodes.keys()].filter(k => !inc.get(k) && !entry.has(k) && nodes.get(k).kind !== 'scene' && !(out.get(k).length));
  let workspace = null;
  if (wsPackages.size > 1 || aliasEdges) {
    // Package-level view: which workspace package uses which (counts of file imports across packages).
    const dirs = [...wsPackages.entries()].map(([name, w]) => ({ name, dir: w.dir })).sort((a, b) => b.dir.length - a.dir.length);
    const pkgOf = rel => dirs.find(d => !d.dir || rel === d.dir || rel.startsWith(`${d.dir}/`))?.name ?? null;
    const files = new Map(), links = new Map();
    for (const k of nodes.keys()) { const p = pkgOf(k); if (p) files.set(p, (files.get(p) ?? 0) + 1); }
    for (const e of edges) {
      const a = pkgOf(e.from), b = pkgOf(e.to);
      if (!a || !b || a === b) continue;
      const key = `${a}\0${b}`; links.set(key, (links.get(key) ?? 0) + 1);
    }
    workspace = {
      packages: wsPackages.size, workspaceEdges, aliasEdges,
      packageList: dirs.map(d => ({ name: d.name, dir: d.dir || '.', files: files.get(d.name) ?? 0 })).sort((a, b) => b.files - a.files),
      packageEdges: [...links.entries()].map(([k, uses]) => { const [from, to] = k.split('\0'); return { from, to, uses }; }).sort((a, b) => b.uses - a.uses),
    };
  }
  return { root, truncated, unreadable, engines, workspace, nodes, edges: edges.filter(e => nodes.has(e.to)), externals, cycles, order, entryPoints: [...entry], orphans, inDegree: inc, outEdges: out };
}

function commonPrefix(a, b) { let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++; return i; }

/** Strongly connected components (iterative Tarjan) + an order where dependencies come before dependents. */
export function tarjanOrder(keys, out) {
  let index = 0;
  const idx = new Map(), low = new Map(), onStack = new Set(), stack = [], sccs = [];
  for (const start of keys) {
    if (idx.has(start)) continue;
    const work = [[start, 0]];
    idx.set(start, index); low.set(start, index); index++; stack.push(start); onStack.add(start);
    while (work.length) {
      const top = work[work.length - 1];
      const [v, i] = top;
      const next = out.get(v) ?? [];
      if (i < next.length) {
        top[1]++;
        const w = next[i];
        if (!out.has(w)) continue;
        if (!idx.has(w)) { idx.set(w, index); low.set(w, index); index++; stack.push(w); onStack.add(w); work.push([w, 0]); }
        else if (onStack.has(w)) low.set(v, Math.min(low.get(v), idx.get(w)));
      } else {
        work.pop();
        if (work.length) { const u = work[work.length - 1][0]; low.set(u, Math.min(low.get(u), low.get(v))); }
        if (low.get(v) === idx.get(v)) {
          const comp = [];
          let w;
          do { w = stack.pop(); onStack.delete(w); comp.push(w); } while (w !== v);
          sccs.push(comp.sort());
        }
      }
    }
  }
  // Tarjan emits SCCs in reverse topological order of the condensation: a component comes after the ones
  // it depends on. With edges pointing from user to dependency, that is exactly "dependencies first".
  return { sccs, order: sccs.flat() };
}

export function graphMermaid(graph, max = 60) {
  const score = k => (graph.inDegree.get(k) ?? 0) + (graph.outEdges.get(k)?.length ?? 0);
  const keep = [...graph.nodes.keys()].sort((a, b) => score(b) - score(a)).slice(0, max);
  const id = new Map(keep.map((k, i) => [k, `f${i}`]));
  const lines = ['graph LR'];
  for (const k of keep) lines.push(`  ${id.get(k)}["${path.posix.basename(k).replace(/"/g, "'")}"]`);
  let shown = 0;
  for (const e of graph.edges) {
    if (!id.has(e.from) || !id.has(e.to)) continue;
    lines.push(`  ${id.get(e.from)} --> ${id.get(e.to)}`);
    if (++shown > 250) break;
  }
  return lines.join('\n');
}

export async function graphTool({ path: dir, limit, format = 'json' } = {}) {
  const g = await buildGraph(dir);
  // Small by default (portOrder and mostUsed already summarise the edges); an explicit limit asks for more.
  const max = limit === undefined ? 80 : Math.max(10, Math.min(5000, limit));
  const edgeMax = limit === undefined ? 40 : max * 3;
  const files = [...g.nodes.values()].map(n => ({ file: n.file, language: n.language, ...(n.lines != null ? { lines: n.lines } : {}), dependsOn: g.outEdges.get(n.file).length, usedBy: g.inDegree.get(n.file) }));
  files.sort((a, b) => b.usedBy - a.usedBy || b.dependsOn - a.dependsOn);
  const ext = [...g.externals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 50).map(([name, uses]) => ({ name, uses }));
  return {
    root: g.root, truncated: g.truncated, ...(g.unreadable?.length ? { unreadable: g.unreadable, warnings: [`${g.unreadable.length} folder(s) could not be read; the graph does not cover them.`] } : {}), fileCount: g.nodes.size, edgeCount: g.edges.length,
    entryPoints: g.entryPoints, cycles: g.cycles.slice(0, 20).map(c => c.slice(0, 30)), orphans: g.orphans.slice(0, 100),
    ...(g.workspace ? { workspace: { packages: g.workspace.packages, resolvedByPackageName: g.workspace.workspaceEdges, resolvedByTsconfigPaths: g.workspace.aliasEdges, packageList: g.workspace.packageList.slice(0, max), packageEdges: g.workspace.packageEdges.slice(0, edgeMax) } } : {}),
    mostUsed: files.slice(0, 25), externals: ext,
    portOrder: g.order.slice(0, max), portOrderTruncated: g.order.length > max,
    edges: g.edges.slice(0, edgeMax), edgesTruncated: g.edges.length > edgeMax,
    ...(format === 'mermaid' || format === 'both' ? { mermaid: graphMermaid(g) } : {}),
    next: g.edges.length > edgeMax
      ? `Showing ${edgeMax} of ${g.edges.length} edges and ${Math.min(max, g.order.length)} of ${g.order.length} files in portOrder. More: re_graph ${JSON.stringify({ path: g.root, limit: Math.min(5000, Math.max(max * 2, 400)) })}. One area: re_symbols ${JSON.stringify({ path: g.root, match: '<name>' })}. To port: port_plan ${JSON.stringify({ source: g.root, to: '<engine>' })}.`
      : `One area: re_symbols ${JSON.stringify({ path: g.root, match: '<name>' })}. To port: port_plan ${JSON.stringify({ source: g.root, to: '<engine>' })}.`,
  };
}

export async function symbolsTool({ path: target, match, limit = 60 } = {}) {
  const st = await fs.stat(path.resolve(target ?? '')).catch(() => null);
  if (st?.isFile()) {
    const abs = path.resolve(target);
    const buf = await fs.readFile(abs);
    if (!isText(buf)) return { file: abs, error: 'binary file — use re_binary' };
    const sym = await fileSymbols(abs);
    if (!sym) return { file: abs, language: languageOf(abs), note: 'Not a recognised code file. Scenes: re_scene.' };
    return { file: abs, ...sym };
  }
  const g = await buildGraph(target);
  const want = match ? new RegExp(match.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*'), 'i') : null;
  const out = [];
  let classes = 0, functions = 0;
  for (const n of g.nodes.values()) {
    if (!n.sym) continue;
    classes += n.sym.classes.length; functions += n.sym.functions.length;
    const cls = n.sym.classes.filter(c => !want || want.test(c.name ?? '')).map(c => c.name ?? `(script extends ${c.extends})`);
    const fns = n.sym.functions.filter(f => !want || want.test(f.name)).map(f => f.name);
    if (want && !cls.length && !fns.length && !want.test(n.file)) continue;
    if (!want && !cls.length && !fns.length && !n.sym.signals?.length) continue; // nothing to show for this file
    out.push({ file: n.file, language: n.language, lines: n.lines, classes: cls.slice(0, 50), functions: fns.slice(0, 120), ...(n.sym.signals?.length ? { signals: n.sym.signals.map(s => s.name) } : {}), ...(n.sym.exports?.length ? { exported: n.sym.exports.slice(0, 50) } : {}), ...(n.sym.unreal ? { unreal: n.sym.unreal } : {}) });
  }
  const max = Math.max(1, Math.min(5000, limit));
  const truncated = out.length > max;
  return {
    root: g.root, files: out.length, totalFiles: g.nodes.size, totalClasses: classes, totalFunctions: functions, ...(want ? { match } : {}),
    items: out.slice(0, max), truncated,
    ...(truncated || !out.length ? { next: !out.length ? `Nothing matched. Try a broader match, or re_graph ${JSON.stringify({ path: g.root })} for the structure.` : `Showing ${max} of ${out.length} files. Narrow it: re_symbols ${JSON.stringify({ path: g.root, match: '<name or *pattern*>' })} or point path at a subfolder.` } : {}),
  };
}
