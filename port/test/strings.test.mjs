import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tempDir } from './helpers.mjs';

const F = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const { callTool } = await import('../src/tools.mjs');
const { extractStrings, toPo, readTranslations } = await import('../src/strings.mjs');

test('re_strings: Godot scene text and GDScript tr()/text assignments with stable ids', async () => {
  const r = await extractStrings(path.join(F, 'godot-mini'));
  const ids = r.entries.map(e => e.id);
  assert.ok(ids.includes('ui/hud.tscn#Score#text'), ids.join('\n'));
  const label = r.entries.find(e => e.id === 'ui/hud.tscn#Score#text');
  assert.equal(label.text, 'Score: 0');
  assert.equal(label.kind, 'Label');
  const code = r.entries.find(e => e.file === 'ui/hud.gd');
  assert.equal(code.text, 'Score: %d');
  assert.deepEqual(code.placeholders, ['%d']);
});

test('re_strings: Unity YAML, RPG Maker, Ren\'Py and i18n JSON', async () => {
  const root = await tempDir('rp-strings-');
  const w = async (rel, text) => { const f = path.join(root, rel); await fs.mkdir(path.dirname(f), { recursive: true }); await fs.writeFile(f, text); };
  await w('Assets/UI/Menu.prefab', `%YAML 1.1
%TAG !u! tag:unity3d.com,2011:
--- !u!1 &100
GameObject:
  m_Name: StartButton
--- !u!114 &101
MonoBehaviour:
  m_Text: 'Start the game'
  m_FontSize: 14
--- !u!114 &102
MonoBehaviour:
  m_text: "Press {0} to jump"
`);
  await w('data/Map001.json', JSON.stringify({ displayName: 'Village', events: [null, { id: 1, pages: [{ list: [{ code: 101, parameters: ['face', 0, 0, 2] }, { code: 401, parameters: ['Welcome, traveller.'] }, { code: 401, parameters: ['Rest here a while.'] }, { code: 102, parameters: [['Yes', 'No'], 1] }, { code: 0, parameters: [] }] }] }] }));
  await w('data/System.json', JSON.stringify({ gameTitle: 'Tiny Quest', terms: { basic: ['Level', 'Lv'], commands: ['Fight'], messages: { actionFailure: 'There was no effect on %1!' } } }));
  await w('game/script.rpy', 'define e = Character("Eileen")\nlabel start:\n    e "Hello, world."\n    "The narrator speaks."\n    menu:\n        "Go left":\n            jump left\n        "Go right" if True:\n            jump right\n');
  await w('i18n/en.json', JSON.stringify({ menu: { play: 'Play', quit: 'Quit' }, hint: 'Collect {count} coins' }));
  const r = await extractStrings(root);
  const by = Object.fromEntries(r.entries.map(e => [e.id, e.text]));
  assert.equal(by['Assets/UI/Menu.prefab#MonoBehaviour&101#m_Text'], 'Start the game');
  assert.equal(by['Assets/UI/Menu.prefab#MonoBehaviour&102#m_text'], 'Press {0} to jump');
  assert.equal(by['data/Map001.json#event1/page0/cmd1#ShowText'], 'Welcome, traveller.\nRest here a while.');
  assert.equal(by['data/Map001.json#event1/page0/cmd3/choice1#Choice'], 'No');
  assert.equal(by['data/Map001.json#map#displayName'], 'Village');
  assert.equal(by['data/System.json#terms/messages/actionFailure#term'], 'There was no effect on %1!');
  assert.equal(by['game/script.rpy#start/L3#say:e'], 'Hello, world.');
  assert.equal(by['game/script.rpy#start/L4#narrator'], 'The narrator speaks.');
  assert.equal(by['game/script.rpy#start/L8#menu'], 'Go right');
  assert.equal(by['i18n/en.json#menu.play#value'], 'Play');
  assert.equal(by['i18n/en.json#hint#value'], 'Collect {count} coins');
  assert.ok(!Object.values(by).includes('face'), 'non-text parameters are not strings');
  const po = toPo(r.entries, { lang: 'nl' });
  assert.match(po, /msgid "Start the game"\nmsgstr ""/);
  assert.match(po, /#: data\/Map001\.json/);
  await fs.rm(root, { recursive: true, force: true });
});

test('re_strings: extract writes .pot + csv + catalog; apply writes a translated copy and checks placeholders', async () => {
  const src = await tempDir('rp-strings-src-');
  const w = async (rel, text) => { const f = path.join(src, rel); await fs.mkdir(path.dirname(f), { recursive: true }); await fs.writeFile(f, text); };
  await w('project.godot', 'config_version=5\n');
  await w('ui/hud.tscn', '[gd_scene format=3]\n\n[node name="HUD" type="CanvasLayer"]\n\n[node name="Score" type="Label" parent="."]\ntext = "Score: 0"\ntooltip_text = "Your points"\n');
  await w('ui/hud.gd', 'extends CanvasLayer\nfunc _ready():\n\t$Score.text = tr("Press %s to start") % "Enter"\n');
  await w('icon.png', 'png');
  const outDir = await tempDir('rp-strings-out-');
  const r = await callTool('re_strings', { path: src, format: 'all', out: outDir });
  assert.equal(r.strings, 3);
  assert.ok(r.written.some(f => f.endsWith('.pot')) && r.written.some(f => f.endsWith('.csv')) && r.written.some(f => f.endsWith('.strings.json')));
  // Translate via CSV (by id) and PO (by source) mixed: csv wins on id.
  const csv = r.written.find(f => f.endsWith('.csv'));
  const rows = (await fs.readFile(csv, 'utf8')).split('\n');
  const translated = rows.map((row, i) => i === 0 || !row ? row : row.replace(/,""$/, row.includes('Press %s') ? ',"Druk op %s om te starten"' : row.includes('Your points') ? ',"Jouw punten {oops}"' : ',"Score: 0"')).join('\n');
  const tfile = path.join(outDir, 'nl.csv');
  await fs.writeFile(tfile, translated);
  const dest = path.join(outDir, 'nl');
  const a = await callTool('re_strings', { path: src, action: 'apply', translations: tfile, out: dest, lang: 'nl' });
  assert.equal(a.applied, 1, JSON.stringify(a));
  assert.equal(a.problems.length, 1);
  assert.match(a.problems[0].problem, /placeholders differ/);
  const gd = await fs.readFile(path.join(dest, 'ui/hud.gd'), 'utf8');
  assert.match(gd, /tr\("Druk op %s om te starten"\)/);
  assert.equal(await fs.readFile(path.join(dest, 'icon.png'), 'utf8'), 'png', 'other files are copied');
  assert.match(await fs.readFile(path.join(src, 'ui/hud.gd'), 'utf8'), /Press %s/, 'source untouched');
  // apply refuses a non-empty folder and a folder inside the source.
  await assert.rejects(callTool('re_strings', { path: src, action: 'apply', translations: tfile, out: dest }), e => e.code === 'OUTPUT_NOT_EMPTY');
  await assert.rejects(callTool('re_strings', { path: src, action: 'apply', translations: tfile, out: path.join(src, 'nl') }), e => e.code === 'INVALID_ARGUMENT');
  // .po round trip
  const po = path.join(outDir, 'nl.po');
  await fs.writeFile(po, 'msgid ""\nmsgstr ""\n\nmsgid "Score: 0"\nmsgstr "Punten: 0"\n\nmsgid "Press %s to start"\nmsgstr ""\n');
  const map = await readTranslations(po);
  assert.equal(map.get('Score: 0'), 'Punten: 0');
  assert.equal(map.has('Press %s to start'), false);
  await fs.rm(src, { recursive: true, force: true });
  await fs.rm(outDir, { recursive: true, force: true });
});
