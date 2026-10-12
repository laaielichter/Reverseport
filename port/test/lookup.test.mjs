// re_lookup and re_blueprint against a stand-in network (globalThis.fetch is replaced): no real requests are made.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { tempDir } from './helpers.mjs';

process.env.REVERSEPORT_HOME = await tempDir();
const { callTool } = await import('../src/tools.mjs');
const { parsePcgwWikitext, fingerprintPage, assertPublicUrl, classifyInput, footprintFor } = await import('../src/lookup.mjs');

const WIKITEXT = `{{Infobox game
|developers   =
{{Infobox game/row/developer|Hearthfire Studio}}
|engines      =
{{Infobox game/row/engine|Unity|build=2019.4}}
|release dates=
{{Infobox game/row/date|Windows|May 5, 2021}}
|taxonomy     =
{{Infobox game/row/taxonomy/genres | Action, Roguelike }}
{{Infobox game/row/taxonomy/perspectives | Isometric }}
}}
{{Game data|
{{Game data/config|Windows|{{p|userprofile\\Documents}}\\Ember Run\\settings.cfg<ref>checked</ref>}}
}}
{{Game data|
{{Game data/saves|Windows|{{p|appdata}}\\Ember Run\\|{{p|game}}\\saves}}
}}
{{API
|direct3d versions      = 11
|direct3d notes         =
|vulkan versions        = 1.1
|windows 64-bit exe     = true
}}
{{Middleware
|physics          =
|audio            = FMOD
|audio notes      = Studio
|cutscenes        = Bink Video
}}`;

const UNITY_PAGE = `<!doctype html><html><head><title>Sky Courier</title><meta name="description" content="Deliver parcels by air"></head>
<body><canvas id="unity-canvas"></canvas><script src="Build/web.loader.js"></script>
<script>createUnityInstance(document.querySelector("#unity-canvas"), { dataUrl: "Build/web.data.br", frameworkUrl: "Build/web.framework.js.br", codeUrl: "Build/web.wasm.br" });</script></body></html>`;

const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const text = (body, status = 200, headers = {}) => new Response(body, { status, headers: { 'content-type': 'text/html', ...headers } });
const requests = [];
let steamDown = false;

globalThis.fetch = async (input, init = {}) => {
  const u = new URL(String(input));
  requests.push(u.href);
  const p = u.searchParams;
  if (u.hostname === 'store.steampowered.com' && u.pathname === '/api/storesearch/') {
    if (steamDown) return json({}, 503);
    return json({ total: 2, items: [{ id: 999001, name: 'Ember Run: Soundtrack' }, { id: 424242, name: 'Ember Run™' }] });
  }
  if (u.hostname === 'store.steampowered.com' && u.pathname === '/api/appdetails') {
    return json({ 424242: { success: true, data: { name: 'Ember Run™', steam_appid: 424242, type: 'game', developers: ['Hearthfire Studio'], publishers: ['Hearthfire Studio'], release_date: { date: '5 May, 2021' }, platforms: { windows: true, mac: true, linux: false }, genres: [{ description: 'Action' }, { description: 'Indie' }, { description: 'RPG' }], categories: [{ description: 'Single-player' }, { description: 'Steam Achievements' }, { description: 'Full controller support' }, { description: 'Steam Cloud' }], short_description: 'Fight out of a burning <b>underworld</b>.', pc_requirements: { minimum: '<strong>Graphics:</strong> DirectX 11 compatible<br><strong>DirectX:</strong> Version 11' }, screenshots: [{ path_full: 'https://cdn.example/ss1.jpg' }], movies: [{ mp4: { max: 'https://cdn.example/trailer.mp4' } }] } } });
  }
  if (u.hostname === 'www.pcgamingwiki.com' && u.pathname === '/api/appid.php') return new Response(null, { status: 302, headers: { location: 'https://www.pcgamingwiki.com/wiki/Ember_Run' } });
  if (u.hostname === 'www.pcgamingwiki.com' && p.get('action') === 'parse') return json({ parse: { title: 'Ember Run', wikitext: WIKITEXT } });
  if (u.hostname === 'www.wikidata.org' && p.get('action') === 'wbsearchentities') return json({ search: [{ id: 'Q999', label: 'Ember Run', description: 'album' }, { id: 'Q111', label: 'Ember Run', description: '2021 video game' }] });
  if (u.hostname === 'www.wikidata.org' && p.get('list') === 'search') return json({ query: { search: [{ title: 'Q111' }] } });
  if (u.hostname === 'www.wikidata.org' && p.get('action') === 'wbgetentities' && p.get('ids') === 'Q111') {
    const item = id => ({ mainsnak: { datavalue: { value: { id } } } });
    return json({ entities: { Q111: { labels: { en: { value: 'Ember Run' } }, descriptions: { en: { value: '2021 video game' } }, claims: { P408: [item('Q63966')], P31: [item('Q7889')], P136: [item('Q1063238')], P1733: [{ mainsnak: { datavalue: { value: '424242' } } }], P577: [{ mainsnak: { datavalue: { value: { time: '+2021-05-05T00:00:00Z' } } } }] } } } });
  }
  if (u.hostname === 'www.wikidata.org' && p.get('action') === 'wbgetentities') return json({ entities: { Q63966: { labels: { en: { value: 'Unity' } } }, Q7889: { labels: { en: { value: 'video game' } } }, Q1063238: { labels: { en: { value: 'roguelike' } } } } });
  if (u.hostname === 'api.github.com' && u.pathname === '/search/repositories') {
    return json({ items: [
      { full_name: 'fans/ember-run-remake', html_url: 'https://github.com/fans/ember-run-remake', name: 'ember-run-remake', description: 'Open-source remake of Ember Run in Godot', stargazers_count: 120, language: 'GDScript', license: { spdx_id: 'MIT' }, topics: [] },
      { full_name: 'tools/ember-run-save-editor', html_url: 'https://github.com/tools/ember-run-save-editor', name: 'ember-run-save-editor', description: 'Save editor for Ember Run', stargazers_count: 30, language: 'Python', license: null, topics: [] },
      { full_name: 'other/unrelated', html_url: 'https://github.com/other/unrelated', name: 'unrelated', description: 'Nothing to do with it', stargazers_count: 999, topics: [] },
    ] });
  }
  if (u.hostname === 'api.github.com' && u.pathname === '/repos/fans/ember-run-remake') return json({ name: 'ember-run-remake', full_name: 'fans/ember-run-remake', html_url: 'https://github.com/fans/ember-run-remake', description: 'Open-source remake', default_branch: 'main', license: { spdx_id: 'MIT' }, stargazers_count: 120, topics: ['godot'] });
  if (u.hostname === 'api.github.com' && u.pathname.endsWith('/languages')) return json({ GDScript: 5000 });
  if (u.hostname === 'api.github.com' && u.pathname.includes('/git/trees/')) {
    return json({ truncated: false, tree: [
      { path: 'project.godot', type: 'blob', size: 300 }, { path: 'scenes', type: 'tree' }, { path: 'scenes/main.tscn', type: 'blob', size: 200 },
      { path: 'scripts/player.gd', type: 'blob', size: 120 }, { path: 'art/hero.png', type: 'blob', size: 40000 }, { path: '../evil.gd', type: 'blob', size: 10 },
    ] });
  }
  if (u.hostname === 'raw.githubusercontent.com') {
    const file = decodeURIComponent(u.pathname.split('/main/')[1]);
    const files = { 'project.godot': 'config_version=5\n[application]\nconfig/name="Ember Remake"\nrun/main_scene="res://scenes/main.tscn"\nconfig/features=PackedStringArray("4.3")\n', 'scenes/main.tscn': '[gd_scene format=3]\n[node name="Main" type="Node2D"]\n', 'scripts/player.gd': 'extends CharacterBody2D\nfunc _physics_process(delta):\n\tpass\n' };
    return files[file] ? text(files[file]) : text('nope', 404);
  }
  if (u.hostname === 'games.example.com') return text(UNITY_PAGE, 200, { server: 'cloudflare', 'cf-ray': 'abc' });
  return text('not mocked', 404);
};

test('PCGamingWiki article: engine, paths, API, middleware', () => {
  const r = parsePcgwWikitext(WIKITEXT);
  assert.deepEqual(r.engines, [{ name: 'Unity', version: '2019.4' }]);
  assert.deepEqual(r.taxonomy.genres, ['Action', 'Roguelike']);
  assert.deepEqual(r.saves[0].path, ['%APPDATA%\\Ember Run\\', '<game folder>\\saves']);
  assert.equal(r.config[0].path[0], '%USERPROFILE%\\Documents\\Ember Run\\settings.cfg');
  assert.deepEqual(r.middleware, { audio: 'FMOD', cutscenes: 'Bink Video' });
  assert.equal(r.api['vulkan versions'], '1.1');
  assert.equal(r.released[0].date, 'May 5, 2021');
});

test('inputs, footprints and private addresses', () => {
  assert.equal(classifyInput({ url: 'https://store.steampowered.com/app/424242/Ember_Run/' }).steamAppId, '424242');
  assert.deepEqual(classifyInput({ github: 'https://github.com/fans/ember-run-remake.git' }).github, { owner: 'fans', repo: 'ember-run-remake' });
  assert.equal(classifyInput({ url: 'https://apps.apple.com/us/app/x/id123456' }).appStoreId, '123456');
  assert.equal(classifyInput({ url: 'https://play.google.com/store/apps/details?id=com.example.app' }).playId, 'com.example.app');
  for (const bad of ['http://localhost:8080', 'http://127.0.0.1/', 'http://192.168.1.10/', 'http://[::1]/', 'file:///etc/passwd', 'http://router/']) assert.throws(() => assertPublicUrl(bad));
  assert.throws(() => classifyInput({ steamAppId: '1&evil=1' }), /must be a number/);
  assert.equal(footprintFor('Unreal Engine 5'), 'unreal');
  assert.equal(footprintFor('GameMaker Studio 2'), 'gamemaker');
  assert.equal(footprintFor('Some Inhouse Engine'), null);
});

test('re_lookup by name: Steam + PCGamingWiki + Wikidata + open-source search', async () => {
  const d = await callTool('re_lookup', { query: 'Ember Run', kind: 'game' });
  assert.equal(d.kind, 'game');
  assert.equal(d.identity.ids.steam, '424242');
  assert.equal(d.identity.ids.wikidata, 'Q111');
  assert.equal(d.tech.engines[0].name, 'Unity');
  assert.equal(d.tech.engines[0].confidence, 'high');
  assert.deepEqual(d.tech.engines[0].sources.sort(), ['pcgamingwiki', 'wikidata']);
  assert.equal(d.material.footprints[0].key, 'unity');
  assert.match(d.material.footprints[0].layout.join('\n'), /Assembly-CSharp\.dll/);
  assert.equal(d.material.saves[0].platform, 'Windows');
  assert.ok(d.tech.graphicsApi.includes('DirectX 11'));
  assert.equal(d.tech.middleware.audio, 'FMOD');
  assert.ok(d.identity.genres.includes('Roguelike'));
  assert.deepEqual(d.openSource.map(o => [o.repo, o.kind]), [['fans/ember-run-remake', 'remake / clone'], ['tools/ember-run-save-editor', 'modding / tools']]);
  assert.equal(d.references.videos[0], 'https://cdn.example/trailer.mp4');
  assert.match(d.lookupId, /^ember-run-[0-9a-f]{6}$/);
  assert.ok(d.next[0].startsWith('re_blueprint'));
  assert.ok(d.sources.every(s => s.ok));
});

test('re_blueprint from a lookup: archetypes, same-engine target, parity table, Unity skeleton', async () => {
  const d = await callTool('re_lookup', { query: 'Ember Run', kind: 'game' });
  const out = await tempDir();
  const bp = await callTool('re_blueprint', { lookupId: d.lookupId, output: path.join(out, 'proj') });
  assert.ok(bp.archetypes.some(a => a.id === 'roguelike'));
  assert.ok(bp.archetypes.some(a => a.id === 'rpg'));
  assert.equal(bp.target.target, 'unity');
  assert.match(bp.target.why, /same engine/);
  assert.ok(bp.systems.some(s => s.id === 'run-structure'));
  assert.ok(bp.systems.some(s => s.id === 'achievements'));
  assert.ok(bp.systems.some(s => s.id === 'camera'));
  const parity = JSON.parse(await fs.readFile(bp.files.parity, 'utf8'));
  assert.equal(parity.parameters.length, bp.parameters);
  assert.ok(parity.parameters.every(p => p.status === 'todo' && p.original === null));
  const stub = await fs.readFile(path.join(out, 'proj', 'Assets/Scripts/Systems/CameraSystem.cs'), 'utf8');
  assert.match(stub, /\[SerializeField\] float fovDeg = 0f;/);
  assert.match(stub, /public class CameraSystem : MonoBehaviour/);
  const md = await fs.readFile(bp.files.blueprint, 'utf8');
  assert.match(md, /Clean-room rules/);
  assert.match(md, /Ember Run Rebuild/);
  assert.match(md, /fans\/ember-run-remake/);
  await assert.rejects(callTool('re_blueprint', { lookupId: d.lookupId, output: path.join(out, 'proj') }), /new or empty/);
});

test('re_blueprint without a lookup: platformer to three.js and Godot', async () => {
  const bp = await callTool('re_blueprint', { name: 'Pixel Hopper', genres: ['Platformer'], description: 'Tight 2D jumping', target: 'threejs', scaffold: true });
  assert.equal(bp.target.target, 'threejs');
  assert.equal(bp.systems[0].id, 'character-controller');
  const ts = await fs.readFile(path.join(bp.files.project, 'src/systems/character-controller.ts'), 'utf8');
  assert.match(ts, /jumpHeightMax: 0,/);
  const gd = await callTool('re_blueprint', { name: 'Pixel Hopper Two', genres: ['platformer'], perspective: '2d' });
  assert.equal(gd.target.target, 'godot');
  const g = await fs.readFile(path.join(gd.files.project, 'systems/character_controller.gd'), 'utf8');
  assert.match(g, /@export var coyote_frames: float = 0.0/);
  const app = await callTool('re_blueprint', { name: 'Chatter', kind: 'app', genres: ['Social Networking'] });
  assert.equal(app.target.engine, false);
  assert.equal(app.files.project, null);
  assert.ok(app.systems.some(s => s.id === 'feed-messaging'));
  await assert.rejects(callTool('re_blueprint', { genres: ['puzzle'] }), /Give a name/);
});

test('re_lookup on a public GitHub repo: structure, engine from files, mirror', async () => {
  const d = await callTool('re_lookup', { github: 'fans/ember-run-remake', mirror: true, sources: ['github'] });
  assert.equal(d.identity.ids.github, 'fans/ember-run-remake');
  assert.equal(d.tech.engines[0].footprint, 'godot');
  assert.equal(d.tech.engines[0].confidence, 'high');
  assert.equal(d.material.repo.files, 4);
  const m = d.material.repo.mirror;
  assert.equal(m.primary.id, 'godot');
  assert.equal(await fs.readFile(path.join(m.path, 'scripts/player.gd'), 'utf8'), 'extends CharacterBody2D\nfunc _physics_process(delta):\n\tpass\n');
  await assert.rejects(fs.access(path.join(m.path, '..', 'evil.gd')));
  assert.ok(d.next.some(n => n.startsWith('port_plan')));
});

test('re_lookup on a web page: Unity WebGL fingerprint, runtime files, hosting', async () => {
  const d = await callTool('re_lookup', { url: 'https://games.example.com/sky-courier/', sources: ['web'] });
  assert.equal(d.kind, 'web');
  assert.equal(d.tech.engines[0].name, 'Unity (WebGL)');
  assert.equal(d.tech.engines[0].confidence, 'high');
  assert.ok(d.tech.web.hosting.includes('Cloudflare'));
  assert.ok(d.material.web.runtimeFiles.includes('https://games.example.com/sky-courier/Build/web.data.br'));
  assert.ok(d.material.web.scripts.includes('https://games.example.com/sky-courier/Build/web.loader.js'));
  assert.equal(fingerprintPage('<div id="__next"></div><script id="__NEXT_DATA__"></script>').stack[0].name, 'Next.js');
  await assert.rejects(callTool('re_lookup', { url: 'http://127.0.0.1:32147/api/agent/tools' }), /public addresses/);
});

test('a failing source is reported, the rest still answers', async () => {
  steamDown = true;
  try {
    const d = await callTool('re_lookup', { query: 'Ember Run', kind: 'game', fresh: true, sources: ['steam', 'wikidata'] });
    assert.equal(d.sources.find(s => s.source === 'steam').ok, false);
    assert.equal(d.identity.ids.wikidata, 'Q111');
    assert.equal(d.tech.engines[0].name, 'Unity');
  } finally { steamDown = false; }
  await assert.rejects(callTool('re_lookup', {}), /Give a name/);
  await assert.rejects(callTool('re_lookup', { query: 'x', sources: ['myspace'] }), /must be one of/);
});
