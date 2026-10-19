// Shared helpers: errors, file access with limits, hashing, entropy, walking a tree, naming.
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';

export class RPError extends Error {
  constructor(code, message, details) { super(message); this.code = code; if (details) this.details = details; }
}

export const MiB = 1024 * 1024;

/** Folders that never hold source a port needs (caches, build output, VCS, package stores). */
export const IGNORED_DIRS = new Set([
  '.git', '.svn', '.hg', 'node_modules', '.godot', '.import', 'Library', 'Temp', 'Logs', 'UserSettings', 'obj',
  '__pycache__', '.venv', 'venv', '.gradle', '.idea', '.vs', '.vscode', 'DerivedDataCache', 'Intermediate', 'Saved',
  '.mono', '.reverseport', '.cache', '.next', '.nuxt', '.parcel-cache', '.turbo', 'Pods', '.dart_tool',
  '.pytest_cache', '.mypy_cache', '.ruff_cache', '.tox', 'zig-cache', '.zig-cache', 'zig-out', 'DerivedData',
  '.svelte-kit', '.angular', '.vite', '.expo', '.terraform', 'bower_components', 'jspm_packages',
]);

/**
 * Folders that are build output or a package store only next to a marker file: `target/` is Rust or Maven output
 * beside Cargo.toml/pom.xml but may be real source elsewhere; `vendor/` holds copied dependencies beside go.mod,
 * composer.json or a Gemfile.
 */
export const IGNORED_DIRS_BESIDE = {
  target: ['Cargo.toml', 'pom.xml', 'build.sbt'],
  vendor: ['go.mod', 'composer.json', 'Gemfile'],
  '.build': ['Package.swift'],
  '.gradle': [],
};

export async function statOrNull(file) { try { return await fs.stat(file); } catch { return null; } }

export async function requireFile(file, what = 'file') {
  if (typeof file !== 'string' || !file.trim()) throw new RPError('INVALID_ARGUMENT', `Give the ${what} path.`);
  const abs = path.resolve(file);
  const st = await statOrNull(abs);
  if (!st) throw new RPError('NOT_FOUND', `${what} not found: ${abs}`);
  if (!st.isFile()) throw new RPError('NOT_A_FILE', `Not a file: ${abs}`);
  return { abs, size: st.size };
}

export async function requireDir(dir, what = 'folder') {
  if (typeof dir !== 'string' || !dir.trim()) throw new RPError('INVALID_ARGUMENT', `Give the ${what} path.`);
  const abs = path.resolve(dir);
  const st = await statOrNull(abs);
  if (!st) throw new RPError('NOT_FOUND', `${what} not found: ${abs}`);
  if (!st.isDirectory()) throw new RPError('NOT_A_FOLDER', `Not a folder: ${abs}`);
  return abs;
}

/** Read `length` bytes at `offset` (clamped to the file). */
export async function readAt(file, offset, length) {
  const fh = await fs.open(file, 'r');
  try {
    const buf = Buffer.alloc(Math.max(0, length));
    const { bytesRead } = await fh.read(buf, 0, buf.length, offset);
    return buf.subarray(0, bytesRead);
  } finally { await fh.close(); }
}

/** Read the start of a file, at most `max` bytes. */
export async function readHead(file, max) {
  const st = await fs.stat(file);
  return readAt(file, 0, Math.min(st.size, max));
}

export function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    createReadStream(file).on('data', d => hash.update(d)).on('error', reject).on('end', () => resolve(hash.digest('hex')));
  });
}

export const sha256 = buf => crypto.createHash('sha256').update(buf).digest('hex');

/** Shannon entropy in bits per byte (0 = constant, 8 = random/compressed/encrypted). */
export function entropy(buf) {
  if (!buf?.length) return 0;
  const counts = new Uint32Array(256);
  for (let i = 0; i < buf.length; i++) counts[buf[i]]++;
  let e = 0;
  for (const c of counts) if (c) { const p = c / buf.length; e -= p * Math.log2(p); }
  return Math.round(e * 1000) / 1000;
}

/** Heuristic: is this buffer text (UTF-8/ASCII) rather than binary? */
export function isText(buf) {
  const n = Math.min(buf.length, 8192);
  if (!n) return true;
  let odd = 0;
  for (let i = 0; i < n; i++) {
    const b = buf[i];
    if (b === 0) return false;
    if (b < 7 || (b > 13 && b < 32 && b !== 27)) odd++;
  }
  return odd / n < 0.02;
}

export const toPosix = p => p.split(path.sep).join('/');

/** Walk a folder. Returns files with posix relative paths; skips IGNORED_DIRS and symlinks. */
export async function walk(root, { maxFiles = 50000, ignore = IGNORED_DIRS, ignoreBeside = ignore === IGNORED_DIRS ? IGNORED_DIRS_BESIDE : {}, maxDepth = 40 } = {}) {
  const files = [];
  const skipped = new Set();
  const unreadable = [];
  let truncated = false;
  async function visit(dir, depth) {
    if (truncated || depth > maxDepth) return;
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch (e) { if (unreadable.length < 50) unreadable.push({ path: toPosix(path.relative(root, dir)) || '.', code: e.code ?? 'ERROR' }); return; }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    const names = new Set(entries.map(e => e.name));
    const buildOutput = name => ignoreBeside[name]?.some(marker => names.has(marker));
    for (const e of entries) {
      if (truncated) return;
      const abs = path.join(dir, e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) {
        if (ignore.has(e.name) || buildOutput(e.name)) { skipped.add(toPosix(path.relative(root, abs))); continue; }
        await visit(abs, depth + 1);
      } else if (e.isFile()) {
        if (files.length >= maxFiles) { truncated = true; return; }
        let size = 0;
        try { size = (await fs.stat(abs)).size; } catch { continue; }
        files.push({ rel: toPosix(path.relative(root, abs)), abs, size, ext: path.extname(e.name).toLowerCase() });
      }
    }
  }
  await visit(root, 0);
  return { files, truncated, skippedDirs: [...skipped].sort(), unreadable };
}

export function limit(list, max) {
  return list.length > max ? { items: list.slice(0, max), truncated: true, total: list.length } : { items: list, truncated: false, total: list.length };
}

export const countLines = text => (text ? text.split('\n').length - (text.endsWith('\n') ? 1 : 0) : 0);

const words = s => String(s).replace(/\.[^.]+$/, '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/[^A-Za-z0-9]+/).filter(Boolean);
export const pascalCase = s => words(s).map(w => w[0].toUpperCase() + w.slice(1)).join('') || 'Unnamed';
export const camelCase = s => { const p = pascalCase(s); return p[0].toLowerCase() + p.slice(1); };
export const kebabCase = s => words(s).map(w => w.toLowerCase()).join('-') || 'unnamed';
export const snakeCase = s => words(s).map(w => w.toLowerCase()).join('_') || 'unnamed';
/** Name key used to compare symbols across languages: `_physics_process`, `PhysicsProcess`, `physicsProcess` → `physicsprocess`. */
export const nameKey = s => String(s).replace(/[^A-Za-z0-9]/g, '').toLowerCase();

export const hex = (n, width = 0) => '0x' + Number(n).toString(16).padStart(width, '0');

export function compileMatcher(match) {
  if (!match) return () => true;
  if (typeof match !== 'string' || match.length > 300) throw new RPError('INVALID_ARGUMENT', 'match must be a string (≤ 300 chars).');
  if (match.startsWith('/') && match.lastIndexOf('/') > 0) {
    const end = match.lastIndexOf('/');
    let re;
    try { re = new RegExp(match.slice(1, end), match.slice(end + 1).replace(/[^imsu]/g, '')); } catch (e) { throw new RPError('INVALID_ARGUMENT', `Bad regular expression: ${e.message}`); }
    return s => re.test(s);
  }
  if (/[*?]/.test(match)) {
    const re = new RegExp('^' + match.split('').map(c => (c === '*' ? '.*' : c === '?' ? '.' : c.replace(/[.+^${}()|[\]\\]/g, '\\$&'))).join('') + '$', 'i');
    return s => re.test(s) || re.test(s.split('/').pop());
  }
  const needle = match.toLowerCase();
  return s => s.toLowerCase().includes(needle);
}

export async function readJson(file, fallback) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return fallback; }
}

export async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(value, null, 2) + '\n');
  await fs.rename(tmp, file);
}
