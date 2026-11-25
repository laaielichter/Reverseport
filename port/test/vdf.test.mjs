import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { tempDir } from './helpers.mjs';

const dir = await tempDir();
process.env.REVERSEPORT_HOME = path.join(dir, 'home');
const { parseVdf, vdfSummary, looksLikeVdf } = await import('../src/vdf.mjs');
const { saveTool, peel } = await import('../src/save.mjs');
const { identify } = await import('../src/formats.mjs');

const ACF = `"AppState"
{
\t"appid"\t\t"1234560"
\t"universe"\t\t"1"
\t"name"\t\t"Example \\"Quoted\\" Game"
\t"StateFlags"\t\t"4"
\t"installdir"\t\t"Example Game"
\t"LastUpdated"\t\t"1706702400"
\t"SizeOnDisk"\t\t"52428800000"
\t"buildid"\t\t"13579246"
\t"InstalledDepots"
\t{
\t\t"1234561"
\t\t{
\t\t\t"manifest"\t\t"8214650000000000001"
\t\t\t"size"\t\t"52000000000"
\t\t}
\t\t"1234562"
\t\t{
\t\t\t"manifest"\t\t"99"
\t\t\t"size"\t\t"428800000"
\t\t}
\t}
\t"UserConfig"
\t{
\t\t"language"\t\t"english"
\t\t"BetaKey"\t\t"public-beta"
\t}
}
`;
const LIBRARY = `"libraryfolders"
{
\t"0"
\t{
\t\t"path"\t\t"C:\\\\Program Files (x86)\\\\Steam"
\t\t"label"\t\t""
\t\t"totalsize"\t\t"0"
\t\t"apps"
\t\t{
\t\t\t"228980"\t\t"419000000"
\t\t\t"1234560"\t\t"52428800000"
\t\t}
\t}
\t"1"
\t{
\t\t"path"\t\t"D:\\\\SteamLibrary"
\t\t"label"\t\t"Games"
\t\t"totalsize"\t\t"2000398934016"
\t\t"apps"
\t\t{
\t\t}
\t}
}
`;

test('VDF: nested quoted pairs, escapes, comments, bare tokens and conditionals', () => {
  const v = parseVdf(ACF);
  assert.equal(v.AppState.name, 'Example "Quoted" Game');
  assert.equal(v.AppState.appid, '1234560', 'values stay strings, as stored');
  assert.deepEqual(v.AppState.InstalledDepots['1234562'], { manifest: '99', size: '428800000' });
  assert.deepEqual(Object.keys(v.AppState), ['appid', 'universe', 'name', 'StateFlags', 'installdir', 'LastUpdated', 'SizeOnDisk', 'buildid', 'InstalledDepots', 'UserConfig']);
  assert.equal(parseVdf(LIBRARY).libraryfolders['0'].path, 'C:\\Program Files (x86)\\Steam');
  const odd = parseVdf('// header comment\r\n"Root" // trailing\r\n{\r\n  bare value // comment\r\n  "tab"  "a\\tb\\nc"\r\n  "unknown" "keep \\x as is"\r\n  "win"  "1" [$WIN32]\r\n  "url" "http://example.com/a"\r\n  "empty" ""\r\n  "sub" [$X360] { "k" "v" }\r\n  "dup" "1"\r\n  "dup" "2"\r\n  "dup" { "x" "y" }\r\n  "__proto__" "safe"\r\n  "Empty" { }\r\n}\r\n"Second" { "a" "b" }');
  assert.deepEqual(odd, { Root: { bare: 'value', tab: 'a\tb\nc', unknown: 'keep \\x as is', win: '1', url: 'http://example.com/a', empty: '', sub: { k: 'v' }, dup: ['1', '2', { x: 'y' }], ['__proto__']: 'safe', Empty: {} }, Second: { a: 'b' } });
  assert.equal(Object.getPrototypeOf(odd.Root), Object.prototype);
  assert.deepEqual(parseVdf('"k" "v"'), { k: 'v' });
});

test('VDF: damaged text stops with BAD_FORMAT and the line', () => {
  const cases = [['"a" { "b" "c"', /opened on line 1 is never closed/], ['"a"\n{\n"b" "c"\n}\n}', /stray "}" on line 5/], ['"a" { "b" }', /key "b" on line 1 has no value/], ['"a" "unterminated', /starts on line 1 never closes/], ['{ "a" "b" }', /"\{" without a key/], ['"lonely"', /has no value/], ['   // only a comment\n', /no key\/value pair/], [`${'"a" {'.repeat(100)}`, /nests deeper/]];
  for (const [text, re] of cases) assert.throws(() => parseVdf(text), e => e.code === 'BAD_FORMAT' && re.test(e.message), `${text.slice(0, 30)} → ${re}`);
});

test('VDF summary: appmanifest and libraryfolders', () => {
  assert.deepEqual(vdfSummary(parseVdf(ACF)), {
    kind: 'steam-appmanifest', appid: 1234560, name: 'Example "Quoted" Game', installdir: 'Example Game', buildid: '13579246', size: 52428800000, lastUpdated: '2024-01-31T12:00:00Z', stateFlags: 4,
    depots: [{ id: '1234561', manifest: '8214650000000000001', size: 52000000000 }, { id: '1234562', manifest: '99', size: 428800000 }], branch: 'public-beta',
  });
  assert.deepEqual(vdfSummary(parseVdf(LIBRARY)), { kind: 'steam-libraryfolders', folders: [{ path: 'C:\\Program Files (x86)\\Steam', apps: 2, appids: ['228980', '1234560'] }, { path: 'D:\\SteamLibrary', label: 'Games', totalSize: 2000398934016, apps: 0, appids: [] }] });
  // The old libraryfolders layout: index → path.
  assert.deepEqual(vdfSummary(parseVdf('"LibraryFolders" { "TimeNextStatsReport" "1" "1" "D:\\\\Games" }')), { kind: 'steam-libraryfolders', folders: [{ path: 'D:\\Games' }] });
  assert.deepEqual(vdfSummary(parseVdf('"appstate" { "appid" "7" }')), { kind: 'steam-appmanifest', appid: 7, depots: [] });
  assert.equal(vdfSummary(parseVdf('"GameInfo" { "game" "x" }')), null);
});

test('re_save reads VDF/ACF as a layer and identify names it', async () => {
  const file = path.join(dir, 'appmanifest_1234560.acf');
  await fs.writeFile(file, ACF);
  const r = await saveTool({ file });
  assert.deepEqual(r.layers, ['vdf']);
  assert.equal(r.steam.appid, 1234560);
  assert.equal(r.steam.lastUpdated, '2024-01-31T12:00:00Z');
  const field = p => r.fields.items.find(f => f.path === p);
  assert.deepEqual(field('AppState.name'), { path: 'AppState.name', type: 'string', sample: 'Example "Quoted" Game', role: 'identity' });
  assert.deepEqual(field('AppState.InstalledDepots.1234562.size'), { path: 'AppState.InstalledDepots.1234562.size', type: 'string', sample: '428800000' });
  const other = path.join(dir, 'appmanifest_later.acf');
  await fs.writeFile(other, ACF.replace('13579246', '13579999'));
  assert.deepEqual((await saveTool({ file, compare: other })).compare.changed.items, [{ path: 'AppState.buildid', before: '13579246', after: '13579999' }]);
  const game = path.join(dir, 'settings.vdf');
  await fs.writeFile(game, '"Settings"\n{\n\t"volume"\t"0.8"\n\t"gold"\t"12"\n}\n');
  const g = await saveTool({ file: game });
  assert.deepEqual(g.layers, ['vdf']);
  assert.equal(g.steam, undefined);
  assert.deepEqual(g.roles, { settings: ['Settings.volume'], currency: ['Settings.gold'] });
  const broken = path.join(dir, 'broken.acf');
  await fs.writeFile(broken, ACF.slice(0, 200));
  const b = await saveTool({ file: broken });
  assert.deepEqual(b.layers, ['vdf']);
  assert.match(b.stopped, /never closed|never closes|no value/);
  assert.deepEqual(identify(Buffer.from(ACF)), { id: 'vdf', name: 'Valve KeyValues text (VDF / ACF)', category: 'text' });
  assert.equal(identify(Buffer.from('// comment\n"Root"\n{\n}\n')).id, 'vdf');
  assert.ok(looksLikeVdf(LIBRARY));
  // JSON, INI and key=value saves are not taken for VDF.
  for (const [text, layer] of [['{"a": {"b": 1}}', 'json'], ['[player]\nname="x"\ngold=5\n', 'ini'], ['"quoted"=1\nname=x\n', 'key=value']]) {
    assert.equal(looksLikeVdf(text), false, text);
    assert.deepEqual(peel(Buffer.from(text)).layers, [layer]);
    assert.notEqual(identify(Buffer.from(text)).id, 'vdf');
  }
});
