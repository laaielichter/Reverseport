import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const guidePath = path.join(root, 'docs/gdscript-to-csharp.md');

test('GDScript draft guide shows real output, review steps, and links', () => {
  const exists = fs.existsSync(guidePath);
  assert.ok(exists, 'guide file exists');
  const guide = exists ? fs.readFileSync(guidePath, 'utf8') : '';

  assert.match(guide, /node port\/cli\.mjs draft --file .* --to godot-csharp/);
  assert.match(guide, /node port\/cli\.mjs draft --file .* --to unity/);
  assert.match(guide, /"translatedCleanly": "100%"/);
  assert.match(guide, /"translatedCleanly": "59%"/);
  assert.match(guide, /"portMarkers": 17/);
  assert.match(guide, /"status": "partial"/);
  assert.match(guide, /port_write/);
  assert.match(guide, /does not build or run the output/);

  assert.match(fs.readFileSync(path.join(root, 'docs/index.md'), 'utf8'), /\[the GDScript-to-C# guide\]\(gdscript-to-csharp\.md\)/);
  assert.match(fs.readFileSync(path.join(root, 'docs/README.md'), 'utf8'), /\[Turn a GDScript file into a C# first draft\]\(gdscript-to-csharp\.md\)/);
  assert.match(fs.readFileSync(path.join(root, 'README.md'), 'utf8'), /\[GDScript to C# first draft\]\(docs\/gdscript-to-csharp\.md\)/);
});
