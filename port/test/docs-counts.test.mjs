// The profile table in the docs says how many tools each profile lists; these numbers come from the code.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tools } from '../src/tools.mjs';
import { PROFILES, CORE_ENGINE_TOOLS } from '../src/relay.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ALWAYS = 2; // set_tool_profile, run_batch
const WITH_ENGINE = 2; // engine_tools, engine_call

test('the profile table matches what each profile lists', async () => {
  const compactLocal = PROFILES.compact.local.length;
  const compactEngine = PROFILES.compact.tools.split(',').length;
  const expected = {
    compact: [compactLocal, compactEngine, compactLocal + compactEngine + ALWAYS + WITH_ENGINE, compactLocal + ALWAYS],
    standard: [tools.length, CORE_ENGINE_TOOLS.length, tools.length + CORE_ENGINE_TOOLS.length + ALWAYS + WITH_ENGINE, tools.length + ALWAYS],
  };
  for (const file of ['docs/connect-any-agent.md', 'docs/connect-any-agent.nl.md']) {
    const text = await fs.readFile(path.join(REPO, file), 'utf8');
    for (const [profile, numbers] of Object.entries(expected)) {
      const row = text.split('\n').find(l => l.startsWith(`| \`${profile}\``));
      assert.ok(row, `${file}: a row for ${profile}`);
      assert.deepEqual(row.match(/\d+/g).map(Number), numbers, `${file}: ${profile} row`);
    }
  }
});
