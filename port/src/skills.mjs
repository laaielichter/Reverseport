// The skills that ship with this exact ReversePort version, served by the CLI.
// An agent that runs `reverseport skills get <name>` always reads the guide that matches the binary it calls,
// even when a copied SKILL.md in its own skills folder is older.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RPError } from './util.mjs';

const SKILLS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'skills');

function frontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  const meta = {};
  if (m) for (const line of m[1].split(/\r?\n/)) { const kv = line.match(/^([a-zA-Z_-]+):\s*(.*)$/); if (kv) meta[kv[1]] = kv[2].replace(/^["']|["']$/g, ''); }
  return { meta, body: m ? text.slice(m[0].length) : text };
}

async function load(dir) {
  let folders = [];
  try { folders = (await fs.readdir(dir, { withFileTypes: true })).filter(d => d.isDirectory()).map(d => d.name).sort(); } catch { return []; }
  const out = [];
  for (const folder of folders) {
    const file = path.join(dir, folder, 'SKILL.md');
    let text;
    try { text = await fs.readFile(file, 'utf8'); } catch { continue; } // a folder without SKILL.md is not a skill
    const { meta, body } = frontmatter(text);
    out.push({ name: meta.name || folder, description: meta.description ?? '', file, body: body.trim(), text });
  }
  return out;
}

export async function listSkills({ dir = SKILLS_DIR } = {}) {
  return (await load(dir)).map(({ name, description }) => ({ name, description }));
}

export async function getSkill(name, { dir = SKILLS_DIR } = {}) {
  const all = await load(dir);
  const hit = all.find(s => s.name === name);
  if (!hit) throw new RPError('INVALID_ARGUMENT', `${name ? `Unknown skill "${name}".` : 'Name a skill.'} Skills: ${all.map(s => s.name).join(', ') || '(none bundled)'}.`);
  return hit;
}
