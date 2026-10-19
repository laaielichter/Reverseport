import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tempDir } from './helpers.mjs';

const { listSkills, getSkill } = await import('../src/skills.mjs');
const BIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'bin', 'reverseport.mjs');

test('skills: lists the bundled skills with name and description', async () => {
  const all = await listSkills();
  assert.ok(all.length >= 5);
  for (const s of all) { assert.ok(s.name); assert.ok(s.description.length > 20, s.name); }
  assert.ok(all.some(s => s.name === 'reverse-engineer'));
});

test('skills: get returns the full guide; unknown names list the real ones', async () => {
  const s = await getSkill('reverse-engineer');
  assert.match(s.text, /^---\nname: reverse-engineer/);
  assert.ok(!s.body.startsWith('---'));
  await assert.rejects(getSkill('nope'), e => e.code === 'INVALID_ARGUMENT' && /reverse-engineer/.test(e.message));
});

test('skills: frontmatter name wins over the folder; folders without SKILL.md are skipped', async () => {
  const dir = await tempDir();
  await fs.mkdir(path.join(dir, 'folder-a'));
  await fs.writeFile(path.join(dir, 'folder-a', 'SKILL.md'), '---\nname: alpha\ndescription: "Alpha skill"\n---\n\n# Alpha\n');
  await fs.mkdir(path.join(dir, 'empty'));
  assert.deepEqual(await listSkills({ dir }), [{ name: 'alpha', description: 'Alpha skill' }]);
  assert.equal((await getSkill('alpha', { dir })).body, '# Alpha');
});

test('skills: CLI prints the version-matched guide', () => {
  const version = execFileSync(process.execPath, [BIN, '--version']).toString().trim();
  const out = execFileSync(process.execPath, [BIN, 'skills', 'get', 'port-verify']).toString();
  assert.ok(out.startsWith(`<!-- ReversePort ${version} · skill port-verify -->\n---\n`));
  const list = JSON.parse(execFileSync(process.execPath, [BIN, 'skills', '--compact']).toString());
  assert.equal(list.version, version);
  const bad = spawnSync(process.execPath, [BIN, 'skills', 'get', 'nope']);
  assert.equal(bad.status, 2);
});
