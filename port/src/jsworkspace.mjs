// JavaScript/TypeScript monorepos: workspace packages (npm/yarn/pnpm/bun workspaces, turbo, nx, lerna)
// and tsconfig "paths" aliases. Lets the graph follow `@scope/pkg/sub` and `@/foo` imports to real files
// instead of counting them as outside libraries.
import fs from 'node:fs/promises';
import path from 'node:path';

/** JSON with comments and trailing commas (tsconfig, turbo.json, jsconfig). Returns null when damaged. */
export function parseJsonc(text) {
  if (typeof text !== 'string') return null;
  let out = '', i = 0, inStr = false;
  while (i < text.length) {
    const c = text[i], n = text[i + 1];
    if (inStr) { out += c; if (c === '\\') { out += n ?? ''; i += 2; continue; } if (c === '"') inStr = false; i++; continue; }
    if (c === '"') { inStr = true; out += c; i++; continue; }
    if (c === '/' && n === '/') { while (i < text.length && text[i] !== '\n') i++; continue; }
    if (c === '/' && n === '*') { i += 2; while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++; i += 2; continue; }
    out += c; i++;
  }
  out = out.replace(/,(\s*[}\]])/g, '$1');
  try { return JSON.parse(out); } catch { return null; }
}

const readMaybe = async abs => { try { return await fs.readFile(abs, 'utf8'); } catch { return null; } };

/** Package manager and monorepo tool from lockfiles and config at the root. */
export function workspaceTooling(rels, rootPkg = {}) {
  const has = f => rels.includes(f);
  const manager = rootPkg.packageManager?.split('@')[0]
    ?? (has('bun.lock') || has('bun.lockb') ? 'bun' : has('pnpm-lock.yaml') ? 'pnpm' : has('yarn.lock') ? 'yarn' : has('package-lock.json') ? 'npm' : null);
  const tools = [['turbo.json', 'Turborepo'], ['nx.json', 'Nx'], ['lerna.json', 'Lerna'], ['rush.json', 'Rush'], ['pnpm-workspace.yaml', 'pnpm workspaces']]
    .filter(([f]) => has(f)).map(([, n]) => n);
  return { manager, tools };
}

/**
 * Package globs from pnpm-workspace.yaml without a YAML library: the `packages:` key as a block list
 * (`- 'glob'` per line) or a flow list (`['a', 'b']`). Comments and other keys are skipped.
 */
export function pnpmWorkspaceGlobs(text) {
  if (typeof text !== 'string') return [];
  const unquote = v => v.trim().replace(/^(['"])(.*)\1$/, '$2').trim();
  const noComment = line => line.replace(/(^|\s)#.*$/, '');
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = noComment(lines[i]).match(/^packages\s*:\s*(.*)$/);
    if (!m) continue;
    const rest = m[1].trim();
    if (rest.startsWith('[')) {
      const body = rest.slice(1, rest.lastIndexOf(']') < 0 ? undefined : rest.lastIndexOf(']'));
      for (const v of body.split(',')) { const g = unquote(v); if (g) out.push(g); }
      return out;
    }
    for (let j = i + 1; j < lines.length; j++) {
      const line = noComment(lines[j]);
      if (!line.trim()) continue;
      const item = line.match(/^\s*-\s*(.+)$/);
      if (item) { const g = unquote(item[1]); if (g) out.push(g); continue; }
      if (/^\S/.test(line)) break; // the next top-level key
    }
    return out;
  }
  return out;
}

/**
 * Workspace packages by name. `files` are walk() entries ({rel, abs}). Every package.json outside
 * node_modules counts; that also covers repos that do not declare workspaces but import siblings by name.
 */
export async function workspacePackages(files) {
  const packages = new Map();
  for (const f of files) {
    if (!/(^|\/)package\.json$/.test(f.rel) || f.rel.includes('node_modules/')) continue;
    const pkg = parseJsonc(await readMaybe(f.abs));
    if (!pkg?.name || typeof pkg.name !== 'string') continue;
    const dir = path.posix.dirname(f.rel) === '.' ? '' : path.posix.dirname(f.rel);
    if (!packages.has(pkg.name) || dir.length < packages.get(pkg.name).dir.length) packages.set(pkg.name, { dir, pkg });
  }
  return packages;
}

/** Split `@scope/name/sub/path` or `name/sub` into package name and subpath ('' when none). */
export function splitSpecifier(spec) {
  const parts = spec.split('/');
  const n = spec.startsWith('@') ? 2 : 1;
  return { name: parts.slice(0, n).join('/'), sub: parts.slice(n).join('/') };
}

// Pick a file-looking target out of an exports entry (string, conditions object, or array).
function exportTarget(v) {
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) { for (const x of v) { const t = exportTarget(x); if (t) return t; } return null; }
  if (v && typeof v === 'object') {
    for (const k of ['source', 'bun', 'development', 'import', 'types', 'module', 'node', 'require', 'browser', 'default']) if (k in v) { const t = exportTarget(v[k]); if (t) return t; }
    for (const x of Object.values(v)) { const t = exportTarget(x); if (t) return t; }
  }
  return null;
}

/** Candidate relative paths inside the package for a subpath, most likely first. */
export function packageCandidates({ dir, pkg }, sub) {
  const base = dir ? `${dir}/` : '';
  const out = [];
  const key = sub ? `./${sub}` : '.';
  const ex = pkg.exports;
  if (ex && typeof ex === 'object' && !Array.isArray(ex) && Object.keys(ex).some(k => k.startsWith('.'))) {
    if (key in ex) { const t = exportTarget(ex[key]); if (t) out.push(t); }
    for (const [k, v] of Object.entries(ex)) {
      const star = k.indexOf('*');
      if (star < 0 || !sub) continue;
      const pre = k.slice(0, star), post = k.slice(star + 1);
      if (key.startsWith(pre) && key.endsWith(post) && key.length >= pre.length + post.length) {
        const t = exportTarget(v);
        if (t) out.push(t.replaceAll('*', () => key.slice(pre.length, key.length - post.length))); // Node replaces every * in the target; the function keeps $&, $1… in the match literal
      }
    }
  } else if (!sub && (typeof ex === 'string' || Array.isArray(ex))) { const t = exportTarget(ex); if (t) out.push(t); }
  if (!sub) for (const k of ['source', 'module', 'main', 'types', 'typings']) if (typeof pkg[k] === 'string') out.push(pkg[k]);
  if (sub) out.push(sub, `src/${sub}`);
  else out.push('src/index', 'index', 'src/main', 'mod');
  // Built output often points at dist/; the source usually sits at the same place under src/.
  const extra = [];
  for (const c of out) { const m = c.replace(/^\.\//, '').match(/^(dist|build|lib|out)\/(.*)$/); if (m) extra.push(`src/${m[2]}`); }
  return [...out, ...extra].map(c => path.posix.normalize(base + c.replace(/^\.\//, '')));
}

/** tsconfig/jsconfig `paths` per folder, following `extends` to local files (a few levels). */
export async function tsconfigAliases(files, byRel) {
  const configs = new Map();
  const load = async (rel, depth = 0) => {
    if (configs.has(rel)) return configs.get(rel);
    const f = byRel.get(rel);
    const json = f ? parseJsonc(await readMaybe(f.abs)) : null;
    let result = null;
    if (json) {
      const dir = path.posix.dirname(rel) === '.' ? '' : path.posix.dirname(rel);
      let inherited = null;
      for (const ext of [json.extends].flat().filter(e => typeof e === 'string' && e.startsWith('.'))) {
        if (depth > 4) break;
        let target = path.posix.normalize(path.posix.join(dir || '.', ext));
        if (!target.endsWith('.json')) target += '.json';
        const parent = await load(target, depth + 1);
        if (parent) inherited = parent;
      }
      const co = json.compilerOptions ?? {};
      if (co.paths && typeof co.paths === 'object') {
        // Paths resolve against baseUrl when set, else against the tsconfig that declares them.
        const baseDir = typeof co.baseUrl === 'string' ? path.posix.normalize(path.posix.join(dir || '.', co.baseUrl)) : (dir || '.');
        result = { baseDir: baseDir === '.' ? '' : baseDir, paths: co.paths };
      } else if (inherited) result = inherited;
    }
    configs.set(rel, result);
    return result;
  };
  for (const f of files) if (/(^|\/)(tsconfig[\w.-]*|jsconfig)\.json$/.test(f.rel) && !f.rel.includes('node_modules/')) await load(f.rel);
  const byDir = new Map();
  for (const [rel, cfg] of configs) {
    if (!cfg || !/(^|\/)(tsconfig|jsconfig)\.json$/.test(rel)) continue;
    byDir.set(path.posix.dirname(rel) === '.' ? '' : path.posix.dirname(rel), cfg);
  }
  /** Candidate relative paths for `spec` imported from `from`; [] when no alias matches. */
  return (from, spec) => {
    let dir = path.posix.dirname(from);
    for (;;) {
      const key = dir === '.' ? '' : dir;
      const cfg = byDir.get(key);
      if (cfg) {
        const out = [];
        for (const [pattern, targets] of Object.entries(cfg.paths)) {
          const star = pattern.indexOf('*');
          let wild = null;
          if (star < 0) { if (spec !== pattern) continue; wild = ''; }
          else {
            const pre = pattern.slice(0, star), post = pattern.slice(star + 1);
            if (!spec.startsWith(pre) || !spec.endsWith(post) || spec.length < pre.length + post.length) continue;
            wild = spec.slice(pre.length, spec.length - post.length);
          }
          for (const t of [targets].flat()) if (typeof t === 'string') out.push(path.posix.normalize(path.posix.join(cfg.baseDir || '.', t.replaceAll('*', () => wild))));
        }
        return out;
      }
      if (key === '') return [];
      dir = path.posix.dirname(dir);
    }
  };
}

// Every file-looking string in an import-map target (string, conditions object or array), source first.
function importTargets(v, out = []) {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) for (const x of v) importTargets(x, out);
  else if (v && typeof v === 'object') {
    const order = ['source', 'bun', 'deno', 'development', 'import', 'module', 'node', 'default', 'require', 'browser', 'types'];
    for (const k of [...order.filter(k => k in v), ...Object.keys(v).filter(k => !order.includes(k))]) importTargets(v[k], out);
  }
  return out;
}

const isLocal = t => /^\.{1,2}\//.test(t) || t.startsWith('/');

/**
 * Import maps: Node subpath imports (`#name` in the nearest package.json "imports") and Deno import maps
 * ("imports" in the nearest deno.json/deno.jsonc, or the file its "importMap" names). Returns a lookup
 * `(from, spec) => null | { local: string[], remote: string | null }`: `local` are candidate paths relative to
 * the root, `remote` is the mapped specifier when the map points outside the folder (npm:, jsr:, https:, a package).
 */
export async function importMaps(files, byRel) {
  const nodeImports = new Map(), denoImports = new Map();
  const dirOf = rel => (path.posix.dirname(rel) === '.' ? '' : path.posix.dirname(rel));
  for (const f of files) {
    if (f.rel.includes('node_modules/')) continue;
    const base = path.posix.basename(f.rel);
    if (base === 'package.json') {
      const pkg = parseJsonc(await readMaybe(f.abs));
      nodeImports.set(dirOf(f.rel), pkg?.imports && typeof pkg.imports === 'object' ? pkg.imports : null);
    } else if (base === 'deno.json' || base === 'deno.jsonc') {
      const json = parseJsonc(await readMaybe(f.abs));
      if (!json) continue;
      let map = json.imports && typeof json.imports === 'object' ? json.imports : null, mapDir = dirOf(f.rel);
      if (!map && typeof json.importMap === 'string' && isLocal(json.importMap)) {
        const rel = path.posix.normalize(path.posix.join(mapDir || '.', json.importMap));
        const ext = byRel.get(rel) ? parseJsonc(await readMaybe(byRel.get(rel).abs)) : null;
        if (ext?.imports && typeof ext.imports === 'object') { map = ext.imports; mapDir = dirOf(rel); }
      }
      if (map) denoImports.set(dirOf(f.rel), { dir: mapDir, map });
    }
  }
  if (!nodeImports.size && !denoImports.size) return () => null;
  const ups = from => { const out = []; let d = dirOf(from); for (;;) { out.push(d); if (!d) return out; d = dirOf(d); } };
  const result = (dir, targets, wild) => {
    const local = [], remote = [];
    for (const t of importTargets(targets)) {
      const filled = wild == null ? t : t.replaceAll('*', () => wild);
      if (!isLocal(filled)) { remote.push(filled); continue; }
      const rel = path.posix.normalize(path.posix.join(dir || '.', filled));
      local.push(rel);
      const built = rel.match(/^(.*?)(?:^|\/)(dist|build|lib|out)\/(.*)$/);
      if (built) local.push(path.posix.normalize(`${built[1] ? `${built[1]}/` : ''}src/${built[3]}`));
    }
    return local.length || remote.length ? { local, remote: remote[0] ?? null } : null;
  };
  return (from, spec) => {
    if (spec.startsWith('#')) {
      // Node uses the nearest package.json only.
      for (const d of ups(from)) {
        if (!nodeImports.has(d)) continue;
        const imports = nodeImports.get(d);
        if (!imports) return null;
        if (spec in imports) return result(d, imports[spec], null);
        let best = null;
        for (const [k, v] of Object.entries(imports)) {
          const star = k.indexOf('*');
          if (star < 0) continue;
          const pre = k.slice(0, star), post = k.slice(star + 1);
          if (spec.startsWith(pre) && spec.endsWith(post) && spec.length >= pre.length + post.length && (!best || pre.length > best.pre.length)) best = { pre, v, wild: spec.slice(pre.length, spec.length - post.length) };
        }
        return best ? result(d, best.v, best.wild) : null;
      }
      return null;
    }
    for (const d of ups(from)) {
      const cfg = denoImports.get(d);
      if (!cfg) continue;
      if (typeof cfg.map[spec] === 'string') return result(cfg.dir, cfg.map[spec], null);
      let best = null;
      for (const [k, v] of Object.entries(cfg.map)) if (k.endsWith('/') && typeof v === 'string' && spec.startsWith(k) && (!best || k.length > best.k.length)) best = { k, v };
      if (best) return result(cfg.dir, best.v + spec.slice(best.k.length), null);
    }
    return null;
  };
}

/** Package name for an import that stays outside the folder: `@scope/pkg`, `pkg`, `npm:pkg`, `jsr:@scope/pkg`, a URL's host. */
export function externalPackage(spec) {
  const url = spec.match(/^https?:\/\/([^/]+)/);
  if (url) return url[1];
  const reg = spec.match(/^(npm|jsr):\/?(.*)$/);
  const body = reg ? reg[2] : spec;
  const parts = body.split('/');
  const name = (body.startsWith('@') ? parts.slice(0, 2) : parts.slice(0, 1)).join('/').replace(/(.)@[^/]*$/, '$1');
  return reg ? `${reg[1]}:${name}` : name;
}
