// Where ReversePort keeps its own output: port plans, extracted files, reports.
// Originals are only read. Everything ReversePort writes lands in the workspace or in a port's output folder.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { RPError } from './util.mjs';

export function workspaceRoot(env = process.env, home = os.homedir()) {
  const chosen = env.REVERSEPORT_HOME?.trim();
  return path.resolve(chosen || path.join(home, '.reverseport'));
}

export async function workspaceDir(...parts) {
  const dir = path.join(workspaceRoot(), ...parts);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

export function isInside(child, parent) {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === '' || (!!rel && !rel.startsWith('..') && !path.isAbsolute(rel));
}

/** Join a relative, untrusted path (archive entry, agent-chosen file name) under root; refuse escapes. */
export function safeJoin(root, rel) {
  const clean = String(rel ?? '').replace(/\\/g, '/').replace(/^res:\/\//, '').replace(/^\/+/, '');
  if (!clean || clean.split('/').some(p => p === '..') || /^[A-Za-z]:/.test(clean) || clean.includes('\0')) {
    throw new RPError('UNSAFE_PATH', `Refusing unsafe path: ${rel}`);
  }
  const out = path.resolve(root, clean);
  if (!isInside(out, root) || out === path.resolve(root)) throw new RPError('UNSAFE_PATH', `Refusing unsafe path: ${rel}`);
  return out;
}

/** Folder name for files extracted from an archive: readable and unique per source file. */
export function extractionName(file, hash) {
  const base = path.basename(file).replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 60) || 'file';
  return `${base}-${hash.slice(0, 8)}`;
}
