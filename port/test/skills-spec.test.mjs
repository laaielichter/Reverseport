// Agent Skills specification checks (agentskills.io): name rules, description length, body budget, and that every
// hook command points at a file that exists. Zero dependencies; `skills-ref validate` can cross-check in CI.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BODY_BUDGET = 20000; // characters, about 5,000 tokens: the spec's guidance for a SKILL.md body

async function skillFiles() {
  const out = [];
  for (const root of ['skills', '.agents/skills']) {
    let dirs = [];
    try { dirs = await fs.readdir(path.join(REPO, root), { withFileTypes: true }); } catch { continue; }
    for (const d of dirs) if (d.isDirectory() && !(root === 'skills' && d.name === 'reverse-engineer-anything')) out.push({ dir: d.name, file: path.join(root, d.name, 'SKILL.md') });
  }
  out.push({ dir: 'reverseport', file: 'docs/claude-ai-skill/SKILL.md' });
  return out;
}

test('every SKILL.md follows the Agent Skills spec', async () => {
  for (const { dir, file } of await skillFiles()) {
    const text = await fs.readFile(path.join(REPO, file), 'utf8');
    const m = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    assert.ok(m, `${file}: frontmatter`);
    const name = m[1].match(/^name:\s*(.+)$/m)?.[1].trim().replace(/^["']|["']$/g, '');
    const description = m[1].match(/^description:\s*(.+)$/m)?.[1].trim().replace(/^["']|["']$/g, '');
    assert.match(name ?? '', /^[a-z0-9]+(-[a-z0-9]+)*$/, `${file}: name is lowercase words joined by hyphens`);
    assert.ok(name.length <= 64, `${file}: name ≤ 64 characters`);
    assert.equal(name, dir, `${file}: name matches its folder`);
    assert.ok(description && description.length <= 1024, `${file}: description present and ≤ 1024 characters (${description?.length})`);
    assert.ok(m[2].length <= BODY_BUDGET, `${file}: body ${m[2].length} characters; move detail into references/`);
  }
});

test('plugin hooks point at scripts that exist', async () => {
  const hooks = JSON.parse(await fs.readFile(path.join(REPO, 'hooks', 'hooks.json'), 'utf8')).hooks;
  for (const [event, groups] of Object.entries(hooks)) for (const g of groups) for (const h of g.hooks) {
    const script = /\$\{CLAUDE_PLUGIN_ROOT\}\/([^"\s]+)/.exec(h.command)?.[1];
    assert.ok(script, `${event}: command names a plugin script`);
    await fs.access(path.join(REPO, script));
    assert.ok(h.timeout <= 30, `${event}: short timeout`);
  }
});
