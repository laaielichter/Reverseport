// re_graph closure: what a set of files needs to move as a whole.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { tempDir } from './helpers.mjs';

const { graphTool } = await import('../src/graph.mjs');

async function project() {
  const root = await tempDir('rp-closure-');
  const files = {
    'package.json': '{ "name": "c", "type": "module" }',
    'model/gltf.js': 'export const read = 1;\n',
    'model/inspect.js': "import { read } from './gltf.js';\nexport const inspect = read;\n",
    'build/run.js': "import { inspect } from '../model/inspect.js';\nimport { write } from '../journal/journal.js';\nexport const run = () => write(inspect);\n",
    'journal/journal.js': "import { root } from '../project/files.js';\nexport const write = (x) => [root, x];\n",
    'project/files.js': 'export const root = "/";\n',
  };
  for (const [rel, text] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(root, rel)), { recursive: true });
    await fs.writeFile(path.join(root, rel), text);
  }
  return root;
}

test('closure: a self-contained module and one with coupling outside its folder', async () => {
  const root = await project();
  const a = (await graphTool({ path: root, closure: 'model/inspect.js' })).closure;
  assert.equal(a.selfContained, true);
  assert.equal(a.files, 2);
  assert.match(a.verdict, /^self-contained: 2 file/);
  const b = (await graphTool({ path: root, closure: ['build/run.js'] })).closure;
  assert.equal(b.selfContained, false);
  assert.deepEqual(b.outside.map(o => o.folder).sort(), ['journal', 'model', 'project']);
  assert.match(b.verdict, /needs 4 file\(s\) outside build/);
});

test('closure: a folder means its files; a typo gets a suggestion and is never self-contained', async () => {
  const root = await project();
  const c = (await graphTool({ path: root, closure: 'model' })).closure;
  assert.equal(c.selfContained, true);
  assert.equal(c.files, 2);
  const d = (await graphTool({ path: root, closure: 'model/inspct.js' })).closure;
  assert.equal(d.selfContained, false);
  assert.equal(d.missing[0].didYouMean, 'model/inspect.js');
});
