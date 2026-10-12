// Recon without files: what is this game, app or site, what is it built with, where does its material live and
// how is it structured — from public sources only (Steam store API, PCGamingWiki, Wikidata, GitHub, Apple App
// Store, and the public web page itself). Nothing is downloaded except page text, API JSON and, for public GitHub
// repositories, a few small project files (or the source text with mirror:true). Results are cached for a day.
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { RPError, sha256, readJson, writeJson, MiB } from './util.mjs';
import { workspaceDir, safeJoin } from './workspace.mjs';
import { detectEngines, categoryOf, scanProject } from './scan.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const FOOTPRINTS = JSON.parse(fsSync.readFileSync(path.join(ROOT, 'knowledge', 'footprints.json'), 'utf8')).footprints;
const USER_AGENT = 'ReversePort (+https://github.com/laaielichter/reverseport)';
const DAY = 24 * 60 * 60 * 1000;
export const SOURCES = ['steam', 'pcgamingwiki', 'wikidata', 'github', 'appstore', 'web'];

// ------------------------------------------------------------------ http

/** Refuse anything that is not a public http(s) address (the HTTP door must not become a proxy into the LAN). */
export function assertPublicUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { throw new RPError('INVALID_ARGUMENT', `Not a URL: ${raw}`); }
  if (!['http:', 'https:'].includes(u.protocol)) throw new RPError('INVALID_ARGUMENT', `Only http(s) URLs: ${raw}`);
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const privateName = host === 'localhost' || /\.(localhost|local|internal|lan|home|test)$/.test(host) || !host.includes('.') && !net.isIP(host);
  let privateIp = false;
  if (net.isIPv4(host)) {
    const [a, b] = host.split('.').map(Number);
    privateIp = a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  } else if (net.isIPv6(host)) {
    privateIp = host === '::' || host === '::1' || /^f[cd]/.test(host) || /^fe[89ab]/.test(host) || /^::ffff:/.test(host);
  }
  if (privateName || privateIp) throw new RPError('PRIVATE_ADDRESS', `re_lookup only reads public addresses (${host}). For local files use re_scan.`);
  return u;
}

async function readLimited(res, maxBytes) {
  const len = Number(res.headers.get('content-length') ?? 0);
  if (len > maxBytes) throw new RPError('TOO_LARGE', `Response is ${len} bytes (limit ${maxBytes}).`);
  if (!res.body?.getReader) { const b = Buffer.from(await res.arrayBuffer()); if (b.length > maxBytes) throw new RPError('TOO_LARGE', 'Response too large.'); return b; }
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) { await reader.cancel().catch(() => {}); throw new RPError('TOO_LARGE', `Response over ${maxBytes} bytes.`); }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

/**
 * GET a URL. Returns {status, url, headers, text, json}. Successful responses are cached in the workspace for a day
 * (fresh:true skips the cache). Uses globalThis.fetch at call time so tests can stand in for the network.
 */
export async function httpGet(url, { as = 'json', headers = {}, maxBytes = 4 * MiB, timeout = 20000, fresh = false, redirect = 'follow' } = {}) {
  const key = sha256(Buffer.from(`${as} ${redirect} ${url}`));
  const cacheFile = path.join(await workspaceDir('lookup-cache'), `${key}.json`);
  if (!fresh) {
    const hit = await readJson(cacheFile, null);
    if (hit && Date.now() - hit.at < DAY) return { ...hit.res, cached: true, json: as === 'json' ? safeParse(hit.res.text) : undefined };
  }
  const h = { 'user-agent': USER_AGENT, accept: as === 'json' ? 'application/json' : 'text/html,application/xhtml+xml,*/*;q=0.8', ...headers };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  let res;
  try { res = await globalThis.fetch(url, { headers: h, signal: ctrl.signal, redirect }); }
  catch (e) { throw new RPError('NETWORK', `${new URL(url).hostname}: ${e.name === 'AbortError' ? 'timed out' : (e.cause?.code ?? e.message)}`); }
  finally { clearTimeout(timer); }
  const out = { status: res.status, url: res.url || url, headers: Object.fromEntries([...(res.headers?.entries?.() ?? [])].map(([k, v]) => [k.toLowerCase(), v])) };
  if (res.status >= 300 && res.status < 400) return { ...out, text: '' };
  const body = await readLimited(res, maxBytes);
  out.text = body.toString('utf8');
  if (res.status === 200) await writeJson(cacheFile, { at: Date.now(), res: out }).catch(() => {});
  return { ...out, json: as === 'json' ? safeParse(out.text) : undefined };
}

function safeParse(t) { try { return JSON.parse(t); } catch { return undefined; } }
const okJson = (r, what) => { if (r.status !== 200 || r.json === undefined) throw new RPError('SOURCE_ERROR', `${what}: HTTP ${r.status}`); return r.json; };

// ------------------------------------------------------------------ helpers

const norm = s => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[™®©]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const stripHtml = s => String(s ?? '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(li|p|ul|h\d)>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
const uniq = a => [...new Set(a.filter(Boolean))];
const clip = (s, n) => (s && s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** How well does `candidate` match the asked name (1 = same after normalization). */
export function nameScore(asked, candidate) {
  const a = norm(asked), c = norm(candidate);
  if (!a || !c) return 0;
  if (a === c) return 1;
  if (c.startsWith(`${a} `) || a.startsWith(`${c} `)) return 0.8;
  const at = new Set(a.split(' ')), ct = c.split(' ');
  const shared = ct.filter(t => at.has(t)).length;
  return shared ? 0.6 * shared / Math.max(at.size, ct.length) : 0;
}

/** Map an engine/framework name (any source) to a footprint key. */
export function footprintFor(name) {
  const n = norm(name).replace(/ /g, ' ');
  if (!n) return null;
  const ids = { 'godot build': 'godot', 'unity build': 'unity', 'unreal build': 'unreal', 'gamemaker build': 'gamemaker', 'electron build': 'electron', fna: 'monogame', 'three js': 'web' };
  if (ids[n]) return ids[n];
  for (const [key, fp] of Object.entries(FOOTPRINTS)) {
    for (const m of fp.match) {
      const mm = norm(m);
      if (n === mm || n.startsWith(`${mm} `) || (mm.length >= 5 && n.includes(mm))) return key;
    }
  }
  return null;
}

// ------------------------------------------------------------------ input

export function classifyInput({ query, url, steamAppId, appStoreId, github } = {}) {
  const t = { name: query?.trim() || null, steamAppId: steamAppId ? String(steamAppId) : null, appStoreId: appStoreId ? String(appStoreId) : null, github: null, playId: null, url: null };
  const gh = s => { const m = String(s).match(/^(?:https?:\/\/(?:www\.)?github\.com\/)?([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?(?:[/#?].*)?$/); return m ? { owner: m[1], repo: m[2] } : null; };
  for (const [k, v] of [['steamAppId', t.steamAppId], ['appStoreId', t.appStoreId]]) if (v && !/^\d{1,12}$/.test(v)) throw new RPError('INVALID_ARGUMENT', `${k} must be a number.`);
  if (github) { t.github = gh(github); if (!t.github) throw new RPError('INVALID_ARGUMENT', 'github must be owner/repo or a github.com URL.'); }
  if (url) {
    const u = assertPublicUrl(url);
    const host = u.hostname.replace(/^www\./, '');
    let m;
    if (host === 'store.steampowered.com' && (m = u.pathname.match(/\/app\/(\d+)/))) t.steamAppId ??= m[1];
    else if (host === 'steamcommunity.com' && (m = u.pathname.match(/\/app\/(\d+)/))) t.steamAppId ??= m[1];
    else if (host === 'apps.apple.com' && (m = u.pathname.match(/\/id(\d+)/))) t.appStoreId ??= m[1];
    else if (host === 'play.google.com' && u.searchParams.get('id')) t.playId = u.searchParams.get('id');
    else if (host === 'github.com' && gh(u.href)) t.github ??= gh(u.href);
    else t.url = u.href;
  }
  if (!t.name && !t.steamAppId && !t.appStoreId && !t.github && !t.playId && !t.url) throw new RPError('INVALID_ARGUMENT', 'Give a name (query), a url, a steamAppId, an appStoreId or a github repo.');
  return t;
}

// ------------------------------------------------------------------ sources

async function steamSource(t, opt) {
  let id = t.steamAppId;
  const tried = [];
  if (!id && t.name) {
    const r = await httpGet(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(t.name)}&l=english&cc=US`, opt);
    const items = okJson(r, 'Steam search').items ?? [];
    const best = items.map(i => ({ i, s: nameScore(t.name, i.name) })).sort((a, b) => b.s - a.s)[0];
    tried.push(...items.slice(0, 5).map(i => ({ id: i.id, name: i.name })));
    if (!best || best.s < 1) return { found: false, candidates: tried, note: 'No exact name match on Steam: rerun with steamAppId from candidates.' };
    id = String(best.i.id);
  }
  if (!id) return { found: false };
  const r = await httpGet(`https://store.steampowered.com/api/appdetails?appids=${id}&l=english`, opt);
  const entry = okJson(r, 'Steam appdetails')[id];
  if (!entry?.success) return { found: false, steamAppId: id };
  const d = entry.data;
  const req = stripHtml(`${d.pc_requirements?.minimum ?? ''}\n${d.pc_requirements?.recommended ?? ''}`);
  const gfx = uniq([...req.matchAll(/\b(DirectX|DX)\s*:?\s*(?:version\s*)?(\d{1,2}(?:\.\d)?)/gi)].map(m => `DirectX ${m[2]}`)
    .concat([...req.matchAll(/\bVulkan\b/gi)].map(() => 'Vulkan'), [...req.matchAll(/\bOpenGL\s*(\d\.\d)?/gi)].map(m => `OpenGL${m[1] ? ` ${m[1]}` : ''}`), [...req.matchAll(/\bMetal\b/g)].map(() => 'Metal')));
  return {
    found: true, steamAppId: String(d.steam_appid ?? id), url: `https://store.steampowered.com/app/${d.steam_appid ?? id}`,
    name: d.name, type: d.type, developers: d.developers ?? [], publishers: d.publishers ?? [], released: d.release_date?.date ?? null,
    platforms: Object.entries(d.platforms ?? {}).filter(([, v]) => v).map(([k]) => k),
    genres: (d.genres ?? []).map(g => g.description), categories: (d.categories ?? []).map(c => c.description),
    description: clip(stripHtml(d.short_description), 600), website: d.website || null, controllerSupport: d.controller_support ?? null,
    requirements: clip(req, 900) || null, graphicsApi: gfx,
    screenshots: (d.screenshots ?? []).slice(0, 8).map(s => s.path_full).filter(Boolean),
    videos: (d.movies ?? []).slice(0, 4).map(m => m.mp4?.max ?? m.webm?.max ?? m.hls_h264 ?? m.dash_h264 ?? null).filter(Boolean),
  };
}

const PCGW_PATHS = {
  game: '<game folder>', steam: '<Steam folder>', uid: '<user id>', localappdata: '%LOCALAPPDATA%', appdata: '%APPDATA%',
  userprofile: '%USERPROFILE%', 'userprofile\\documents': '%USERPROFILE%\\Documents', 'userprofile\\appdata\\locallow': '%USERPROFILE%\\AppData\\LocalLow',
  programdata: '%PROGRAMDATA%', public: '%PUBLIC%', windir: '%WINDIR%', hkcu: 'HKEY_CURRENT_USER', hklm: 'HKEY_LOCAL_MACHINE', wow64: 'Wow6432Node',
  osxhome: '~', linuxhome: '~', xdgdatahome: '$XDG_DATA_HOME', xdgconfighome: '$XDG_CONFIG_HOME', username: '<user name>', ubisoftconnect: '<Ubisoft Connect folder>', uplay: '<Ubisoft Connect folder>',
};

/** Parse the parts of a PCGamingWiki article that tell what a game is built from and where its files live. */
export function parsePcgwWikitext(w) {
  const text = String(w ?? '');
  const rows = kind => [...text.matchAll(new RegExp(`\\{\\{Infobox game/row/${kind}\\s*\\|([^|}]*)((?:\\|[^}]*)?)\\}\\}`, 'gi'))].map(m => {
    const parts = m[2].split('|').slice(1).map(x => x.trim());
    return { value: m[1].trim(), positional: parts.filter(x => !x.includes('=')), extra: Object.fromEntries(parts.filter(x => x.includes('=')).map(x => x.split(/\s*=\s*/, 2).map(y => y.trim()))) };
  });
  const engines = rows('engine').filter(r => r.value).map(r => ({ name: r.value, ...(r.extra.build ? { version: r.extra.build } : {}) }));
  const taxonomy = {};
  for (const m of text.matchAll(/\{\{Infobox game\/row\/taxonomy\/([a-z ]+?)\s*\|\s*([^}]*)\}\}/gi)) {
    const vals = m[2].split(/\s*,\s*/).map(s => s.trim()).filter(Boolean);
    if (vals.length) taxonomy[m[1].trim().toLowerCase()] = vals;
  }
  const paths = kind => [...text.matchAll(new RegExp(`\\{\\{Game data/${kind}\\|([^|}]+)\\|((?:[^{}]|\\{\\{[^{}]*\\}\\})*)\\}\\}`, 'gi'))]
    .map(m => ({ platform: m[1].trim(), path: m[2].replace(/<ref[\s\S]*?(?:<\/ref>|\/>)/g, '').replace(/\{\{p\|([^}]+)\}\}/gi, (_, k) => PCGW_PATHS[k.trim().toLowerCase()] ?? `<${k.trim()}>`).split('|').map(p => p.trim()).filter(Boolean) }))
    .filter(p => p.path.length);
  const block = name => text.match(new RegExp(`\\{\\{${name}\\s*\\n([\\s\\S]*?)\\n\\}\\}`))?.[1] ?? '';
  const fields = name => Object.fromEntries([...block(name).matchAll(/^\|[ \t]*([a-z0-9 .-]+?)[ \t]*=[ \t]*(.*)$/gim)]
    .filter(([, k, v]) => !/notes$/i.test(k) && v.trim() && !/^(unknown|n\/a|false|hackable|na)$/i.test(v.trim()))
    .map(([, k, v]) => [k.trim(), v.replace(/<ref[\s\S]*?(?:<\/ref>|\/>)/g, '').replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, '$1').trim()]));
  const api = fields('API');
  return {
    engines, developers: rows('developer').map(r => r.value), publishers: rows('publisher').map(r => r.value), porters: rows('porter').map(r => r.value),
    released: rows('date').map(r => ({ platform: r.value, date: r.positional[0] ?? null })),
    taxonomy, config: paths('config'), saves: paths('saves'), middleware: fields('Middleware'),
    api: Object.fromEntries(Object.entries(api).filter(([k]) => /versions|shader model|64-bit|arm app|executable|api/i.test(k))),
  };
}

async function pcgwSource(t, opt, steamAppId) {
  let title = null;
  if (steamAppId) {
    const r = await httpGet(`https://www.pcgamingwiki.com/api/appid.php?appid=${steamAppId}`, { ...opt, as: 'text', redirect: 'manual' }).catch(() => null);
    const loc = r?.headers?.location ?? (r?.url?.includes('/wiki/') ? r.url : null);
    if (loc) title = decodeURIComponent(loc.split('/wiki/')[1] ?? '').replace(/_/g, ' ') || null;
  }
  if (!title && t.name) {
    const r = await httpGet(`https://www.pcgamingwiki.com/w/api.php?action=opensearch&search=${encodeURIComponent(t.name)}&limit=5&namespace=0&format=json`, opt);
    const titles = okJson(r, 'PCGamingWiki search')[1] ?? [];
    const best = titles.map(x => ({ x, s: nameScore(t.name, x) })).sort((a, b) => b.s - a.s)[0];
    if (best && best.s >= 0.8) title = best.x;
  }
  if (!title) return { found: false };
  const r = await httpGet(`https://www.pcgamingwiki.com/w/api.php?action=parse&page=${encodeURIComponent(title)}&prop=wikitext&redirects=1&format=json&formatversion=2`, opt);
  const j = okJson(r, 'PCGamingWiki article');
  const wikitext = typeof j.parse?.wikitext === 'string' ? j.parse.wikitext : j.parse?.wikitext?.['*'];
  if (!wikitext) return { found: false, title };
  const pageTitle = j.parse?.title ?? title;
  return { found: true, title: pageTitle, url: `https://www.pcgamingwiki.com/wiki/${encodeURIComponent(pageTitle.replace(/ /g, '_'))}`, ...parsePcgwWikitext(wikitext) };
}

const WD = { engine: 'P408', language: 'P277', developer: 'P178', publisher: 'P123', platform: 'P400', genre: 'P136', mode: 'P404', os: 'P306', instanceOf: 'P31', series: 'P179', basedOn: 'P144', license: 'P275', steam: 'P1733', website: 'P856', repo: 'P1324', version: 'P348', date: 'P577' };

async function wikidataSource(t, opt, { steamAppId, kind } = {}) {
  const api = 'https://www.wikidata.org/w/api.php';
  let qid = null;
  if (steamAppId) {
    const r = await httpGet(`${api}?action=query&list=search&srsearch=${encodeURIComponent(`haswbstatement:P1733=${steamAppId}`)}&srlimit=1&format=json`, opt);
    qid = okJson(r, 'Wikidata search').query?.search?.[0]?.title ?? null;
  }
  if (!qid && t.name) {
    const r = await httpGet(`${api}?action=wbsearchentities&search=${encodeURIComponent(t.name)}&language=en&type=item&limit=7&format=json`, opt);
    const hits = okJson(r, 'Wikidata search').search ?? [];
    const want = kind === 'game' ? /video game|game/i : kind === 'app' ? /app|application|software|service/i : kind === 'software' ? /software|program|library|framework|application/i : /game|app|application|software|program|engine|service|website/i;
    const scored = hits.map(h => ({ h, n: nameScore(t.name, h.label ?? h.match?.text), d: want.test(h.description ?? '') }))
      .filter(x => x.n >= 0.8 && (x.d || x.n === 1)).sort((a, b) => (b.d - a.d) || (b.n - a.n));
    if (scored[0]) qid = scored[0].h.id;
  }
  if (!qid) return { found: false };
  const r = await httpGet(`${api}?action=wbgetentities&ids=${qid}&props=labels|descriptions|claims&languages=en&format=json`, opt);
  const ent = okJson(r, 'Wikidata entity').entities?.[qid];
  if (!ent || ent.missing !== undefined) return { found: false };
  const claims = ent.claims ?? {};
  const vals = p => (claims[p] ?? []).filter(c => c.rank !== 'deprecated').map(c => c.mainsnak?.datavalue?.value).filter(v => v !== undefined);
  const ids = p => vals(p).map(v => v.id).filter(Boolean);
  const want = ['engine', 'language', 'developer', 'publisher', 'platform', 'genre', 'mode', 'os', 'instanceOf', 'series', 'basedOn', 'license'];
  const allIds = uniq(want.flatMap(k => ids(WD[k]))).slice(0, 50);
  const labels = {};
  if (allIds.length) {
    const lr = await httpGet(`${api}?action=wbgetentities&ids=${allIds.join('|')}&props=labels&languages=en&format=json`, opt);
    for (const [id, e] of Object.entries(okJson(lr, 'Wikidata labels').entities ?? {})) labels[id] = e.labels?.en?.value ?? id;
  }
  const L = k => ids(WD[k]).map(id => labels[id] ?? id);
  const date = vals(WD.date).map(v => v.time).filter(Boolean).sort()[0];
  return {
    found: true, qid, url: `https://www.wikidata.org/wiki/${qid}`, name: ent.labels?.en?.value ?? null, description: ent.descriptions?.en?.value ?? null,
    instanceOf: L('instanceOf'), engines: L('engine'), languages: L('language'), developers: L('developer'), publishers: L('publisher'),
    platforms: L('platform'), os: L('os'), genres: L('genre'), modes: L('mode'), series: L('series'), basedOn: L('basedOn'), license: L('license'),
    steamAppId: vals(WD.steam)[0] ?? null, website: vals(WD.website)[0] ?? null, repositories: vals(WD.repo), version: vals(WD.version).at(-1) ?? null,
    released: date ? date.replace(/^\+/, '').slice(0, 10) : null,
  };
}

function ghHeaders() {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  return { accept: 'application/vnd.github+json', ...(token ? { authorization: `Bearer ${token}` } : {}) };
}

const KEY_FILES = [/(^|\/)project\.godot$/, /(^|\/)ProjectSettings\/(ProjectVersion\.txt|EditorBuildSettings\.asset)$/, /(^|\/)Packages\/manifest\.json$/, /\.uproject$/i, /(^|\/)Cargo\.toml$/, /\.csproj$/i, /(^|\/)package\.json$/, /(^|\/)pubspec\.yaml$/, /(^|\/)requirements\.txt$/];

async function pool(items, n, fn) {
  const out = [];
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]); } }));
  return out;
}

async function githubRepoSource(t, opt, { mirror = false, maxFiles = 400 } = {}) {
  const { owner, repo } = t.github;
  const base = `https://api.github.com/repos/${owner}/${repo}`;
  const meta = okJson(await httpGet(base, { ...opt, headers: ghHeaders() }), `GitHub ${owner}/${repo}`);
  const branch = meta.default_branch ?? 'main';
  const langs = await httpGet(`${base}/languages`, { ...opt, headers: ghHeaders() }).then(r => r.json ?? {}).catch(() => ({}));
  const tree = okJson(await httpGet(`${base}/git/trees/${encodeURIComponent(branch)}?recursive=1`, { ...opt, headers: ghHeaders(), maxBytes: 24 * MiB }), 'GitHub tree');
  const dir = path.join(await workspaceDir('lookup', 'github'), `${owner}-${repo}`.replace(/[^A-Za-z0-9._-]/g, '_'));
  await fs.mkdir(dir, { recursive: true });
  const files = (tree.tree ?? []).filter(e => e.type === 'blob' && !e.path.split('/').some(p => p === 'node_modules' || p === '.git'))
    .map(e => { let abs; try { abs = safeJoin(dir, e.path); } catch { return null; } return { rel: e.path, abs, size: e.size ?? 0, ext: path.extname(e.path).toLowerCase() }; }).filter(Boolean);
  for (const f of files) f.category = categoryOf(f);
  const raw = rel => `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(branch)}/${rel.split('/').map(encodeURIComponent).join('/')}`;
  const fetchTo = async f => {
    try {
      const r = await httpGet(raw(f.rel), { ...opt, as: 'text', maxBytes: 2 * MiB });
      if (r.status !== 200) return 0;
      await fs.mkdir(path.dirname(f.abs), { recursive: true });
      await fs.writeFile(f.abs, r.text);
      return r.text.length;
    } catch { return 0; }
  };
  const keys = files.filter(f => f.rel.split('/').length <= 4 && f.size < 512 * 1024 && KEY_FILES.some(re => re.test(f.rel))).slice(0, 16);
  await pool(keys, 6, fetchTo);
  const engines = await detectEngines(dir, files);
  const categories = {}, topDirs = {}, exts = {};
  for (const f of files) {
    const c = (categories[f.category] ??= { files: 0, bytes: 0 }); c.files++; c.bytes += f.size;
    const top = f.rel.includes('/') ? `${f.rel.split('/')[0]}/` : '(root)';
    topDirs[top] = (topDirs[top] ?? 0) + 1;
    exts[f.ext || '(none)'] = (exts[f.ext || '(none)'] ?? 0) + 1;
  }
  const sortCount = o => Object.fromEntries(Object.entries(o).sort((a, b) => (b[1].bytes ?? b[1]) - (a[1].bytes ?? a[1])).slice(0, 25));
  let mirrored = null;
  if (mirror) {
    const wanted = files.filter(f => ['code', 'scene', 'resource', 'config'].includes(f.category) && f.size > 0 && f.size < 512 * 1024).slice(0, maxFiles);
    let budget = 25 * MiB;
    const picked = wanted.filter(f => (budget -= f.size) >= 0);
    const sizes = await pool(picked, 8, fetchTo);
    const scan = await scanProject({ path: dir }).catch(() => null);
    mirrored = { path: dir, files: sizes.filter(Boolean).length, skipped: files.length - sizes.filter(Boolean).length, note: 'Text files only (code, scenes, resources, configs). Run re_graph, re_symbols, re_report or port_plan on this folder.', primary: scan?.primary ?? null, languages: scan?.languages ?? null };
  }
  return {
    found: true, url: meta.html_url, name: meta.name, fullName: meta.full_name, description: meta.description, homepage: meta.homepage || null,
    license: meta.license?.spdx_id ?? null, stars: meta.stargazers_count, topics: meta.topics ?? [], defaultBranch: branch, archived: !!meta.archived,
    pushedAt: meta.pushed_at, languages: langs, files: files.length, truncatedTree: !!tree.truncated,
    engines: engines.map(e => ({ id: e.id, name: e.name, kind: e.kind, version: e.version ?? null, evidence: e.evidence })),
    structure: { topLevel: sortCount(topDirs), categories: sortCount(categories), extensions: sortCount(exts), biggest: [...files].sort((a, b) => b.size - a.size).slice(0, 10).map(f => ({ file: f.rel, size: f.size })) },
    mirror: mirrored,
  };
}

const CLASS_RULES = [
  ['decompilation', /\bdecomp(ilation|iled)?\b|\brecomp(ilation)?\b|matching (build|decomp)/i],
  ['reimplementation', /re-?implement|engine (re)?creation|open[- ]source (engine|reimplementation|port)|source port|clean[- ]room/i],
  ['remake / clone', /\bremake\b|\bclone\b|\brecreation\b|\brecreate|fan[- ]?(made|game)|inspired by/i],
  ['modding / tools', /\bmod(s|ding|loader)?\b|\btool(s|kit)?\b|\beditor\b|save[- ]?editor|unpack|extract|viewer|patcher|trainer|launcher/i],
];

async function githubSearchSource(name, opt) {
  const q = `${name} in:name,description,topics fork:false`;
  const r = await httpGet(`https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=20`, { ...opt, headers: ghHeaders() });
  const items = okJson(r, 'GitHub search').items ?? [];
  const tokens = norm(name).split(' ').filter(w => w.length > 1);
  return items
    .filter(i => { const hay = norm(`${i.name} ${i.description ?? ''} ${(i.topics ?? []).join(' ')}`); return tokens.every(tk => hay.includes(tk)); })
    .map(i => {
      const text = `${i.name} ${i.description ?? ''} ${(i.topics ?? []).join(' ')}`;
      const kind = CLASS_RULES.find(([, re]) => re.test(text))?.[0] ?? 'related';
      return { repo: i.full_name, url: i.html_url, kind, description: clip(i.description ?? '', 200), stars: i.stargazers_count, language: i.language, license: i.license?.spdx_id ?? null, updated: i.pushed_at, archived: !!i.archived };
    })
    .sort((a, b) => (a.kind === 'related') - (b.kind === 'related') || b.stars - a.stars)
    .slice(0, 12);
}

async function appStoreSource(t, opt) {
  let item = null;
  if (t.appStoreId) item = okJson(await httpGet(`https://itunes.apple.com/lookup?id=${t.appStoreId}`, opt), 'App Store lookup').results?.[0] ?? null;
  else if (t.name) {
    const res = okJson(await httpGet(`https://itunes.apple.com/search?term=${encodeURIComponent(t.name)}&entity=software&limit=8&country=us`, opt), 'App Store search').results ?? [];
    const best = res.map(i => ({ i, s: nameScore(t.name, i.trackName) })).sort((a, b) => b.s - a.s)[0];
    if (best && best.s >= 0.8) item = best.i;
  }
  if (!item) return { found: false };
  return {
    found: true, appStoreId: String(item.trackId), url: item.trackViewUrl, name: item.trackName, seller: item.sellerName, developer: item.artistName,
    bundleId: item.bundleId, genres: item.genres ?? [item.primaryGenreName].filter(Boolean), version: item.version, released: item.releaseDate?.slice(0, 10) ?? null,
    minimumOs: item.minimumOsVersion, sizeBytes: item.fileSizeBytes ? Number(item.fileSizeBytes) : null, price: item.formattedPrice ?? item.price ?? null,
    devices: (item.supportedDevices ?? []).length, languages: item.languageCodesISO2A ?? [], features: item.features ?? [], rating: item.contentAdvisoryRating ?? null,
    description: clip(item.description ?? '', 800), screenshots: [...(item.screenshotUrls ?? []), ...(item.ipadScreenshotUrls ?? [])].slice(0, 8),
  };
}

// --- web fingerprint

const WEB_SIGNS = [
  // game engines and game frameworks
  ['engine', 'Unity (WebGL)', /UnityLoader\.js|createUnityInstance|\.loader\.js["']|\.framework\.js(\.br|\.gz)?["']|\.data\.unityweb|unityFramework/i, 'unity'],
  ['engine', 'Godot (Web export)', /GODOT_CONFIG|new Engine\(|godot\.(tools\.)?js|\.pck["']/i, 'godot'],
  ['engine', 'Construct 3', /c3runtime|c3_runtime|construct\.net\/.*runtime/i, 'construct'],
  ['engine', 'Construct 2', /c2runtime/i, 'construct'],
  ['engine', 'GameMaker (HTML5)', /html5game\/|GameMaker HTML5|gml_Script_/i, 'gamemaker'],
  ['engine', 'RPG Maker MV/MZ', /rpg_core\.js|rmmz_core\.js|rpg_managers\.js/i, 'rpgmaker'],
  ['engine', 'Defold', /dmloader\.js|archive_files\.json|Progress\.updateProgress/i, 'defold'],
  ['engine', 'PlayCanvas', /playcanvas(-stable)?(\.min)?\.js|pc\.Application\(|__settings__\.js|playcanv\.as/i, 'web'],
  ['engine', 'Cocos Creator / Cocos2d-js', /cocos2d-js|cc\.game\.run|CCBoot|cocos-creator/i, 'cocos'],
  ['engine', 'Twine', /<tw-storydata|tw-passagedata/i, 'web'],
  ['engine', 'Ruffle (Flash)', /ruffle(\.js)?|\.swf["']/i, 'web'],
  ['engine', 'Emscripten (C/C++ → wasm)', /Module\[["']locateFile["']\]|emscripten|var Module\s*=\s*typeof Module/i, 'web'],
  ['framework', 'three.js', /three(\.module)?(\.min)?\.js|THREE\.WebGLRenderer|from\s*["']three["']|__THREE__/i, 'web'],
  ['framework', 'Babylon.js', /babylon(\.max)?(\.min)?\.js|BABYLON\.Engine/i, 'web'],
  ['framework', 'Phaser', /phaser(\.min)?\.js|Phaser\.Game|new Phaser\./i, 'web'],
  ['framework', 'PixiJS', /pixi(\.min)?\.js|PIXI\.Application/i, 'web'],
  ['framework', 'Kaboom / KAPLAY', /kaboom(\.js)?|kaplay/i, 'web'],
  // web app stacks
  ['framework', 'Next.js', /__NEXT_DATA__|\/_next\/static\//, null],
  ['framework', 'Nuxt', /__NUXT__|\/_nuxt\//, null],
  ['framework', 'SvelteKit', /__sveltekit|\/_app\/immutable\//, null],
  ['framework', 'Astro', /astro-island|\/_astro\//, null],
  ['framework', 'Gatsby', /___gatsby|\/page-data\//, null],
  ['framework', 'Remix', /__remixContext|__remixManifest/, null],
  ['framework', 'Angular', /ng-version=|ng-app=|angular(\.min)?\.js/, null],
  ['framework', 'Vue', /data-v-[0-9a-f]{8}|__VUE__|vue(\.runtime)?(\.global)?(\.prod)?(\.min)?\.js/, null],
  ['framework', 'React', /data-reactroot|react-dom(\.production)?(\.min)?\.js|__REACT_DEVTOOLS_GLOBAL_HOOK__|_reactListening|react\.production\.min/, null],
  ['framework', 'Svelte', /class="[^"]*svelte-[a-z0-9]{5,7}/, null],
  ['framework', 'Flutter (web)', /flutter\.js|flutter_bootstrap\.js|main\.dart\.js/, 'flutter'],
  ['framework', 'Blazor (.NET wasm)', /blazor\.webassembly\.js|_framework\/blazor/, null],
  ['framework', 'Electron/PWA manifest', /rel=["']manifest["']/, null],
  ['build', 'Vite', /\/assets\/index-[A-Za-z0-9_-]{8}\.(js|css)|type="module" crossorigin src=/, null],
  ['build', 'webpack', /webpackChunk|__webpack_require__|webpackJsonp/, null],
  ['cms', 'WordPress', /wp-content\/|wp-includes\//, null],
  ['cms', 'Shopify', /cdn\.shopify\.com|Shopify\.theme/, null],
  ['cms', 'Wix', /static\.wixstatic\.com|wix-bolt|_wixCIDX/, null],
  ['cms', 'Squarespace', /static1\.squarespace\.com|Static\.SQUARESPACE_CONTEXT/, null],
  ['cms', 'Webflow', /data-wf-page|webflow(\.[a-z0-9]+)?\.js/, null],
  ['cms', 'Framer', /framerusercontent\.com|__framer/i, null],
  ['ui', 'Bootstrap', /bootstrap(\.bundle)?(\.min)?\.(css|js)/, null],
  ['ui', 'jQuery', /jquery(-\d[\d.]*)?(\.min)?\.js/, null],
  ['service', 'Firebase', /firebaseapp\.com|firebase(-app)?(-compat)?\.js|__\/firebase\//, null],
  ['service', 'Supabase', /supabase\.co|@supabase\//, null],
  ['service', 'Stripe', /js\.stripe\.com/, null],
  ['service', 'Google Analytics / Tag Manager', /googletagmanager\.com|google-analytics\.com|gtag\(/, null],
  ['service', 'Sentry', /browser\.sentry-cdn\.com|sentry\.io/, null],
  ['service', 'Intercom', /widget\.intercom\.io/, null],
];
const VERSION_SIGNS = [['three.js', /REVISION\s*=\s*["'](\d{2,4})["']/, v => `r${v}`], ['Phaser', /Phaser v(\d+\.\d+\.\d+)/, v => v], ['PixiJS', /PixiJS\s*-?\s*v?(\d+\.\d+\.\d+)/i, v => v], ['Babylon.js', /Babylon\.js v(\d+\.\d+\.\d+)/, v => v], ['React', /react-dom\.production\.min\.js[\s\S]{0,200}?(\d{2}\.\d+\.\d+)|ReactDOM[^\n]{0,80}version:\s*["'](\d+\.\d+\.\d+)/, v => v], ['Vue', /Vue\.js v(\d+\.\d+\.\d+)/, v => v], ['Godot (Web export)', /Godot Engine v?(\d\.\d+(?:\.\d+)?)/, v => v]];

export function fingerprintPage(html, { headers = {}, scripts = '' } = {}) {
  const hay = `${html}\n${scripts}`;
  const found = [];
  for (const [group, name, re, fp] of WEB_SIGNS) if (re.test(hay)) found.push({ group, name, footprint: fp });
  for (const [name, re, fmt] of VERSION_SIGNS) {
    const m = hay.match(re);
    if (m) { const v = m.slice(1).find(Boolean); const hit = found.find(f => f.name === name); if (hit && v) hit.version = fmt(v); }
  }
  const hosting = [];
  const H = k => headers[k] ?? '';
  if (H('x-vercel-id') || /vercel/i.test(H('server'))) hosting.push('Vercel');
  if (H('x-nf-request-id') || /netlify/i.test(H('server'))) hosting.push('Netlify');
  if (H('cf-ray') || /cloudflare/i.test(H('server'))) hosting.push('Cloudflare');
  if (H('x-amz-cf-id')) hosting.push('Amazon CloudFront');
  if (H('x-github-request-id') || /github\.com/i.test(H('server'))) hosting.push('GitHub Pages');
  if (H('fly-request-id')) hosting.push('Fly.io');
  if (/^cache-/i.test(H('x-served-by'))) hosting.push('Fastly');
  if (/firebase|google frontend/i.test(H('server'))) hosting.push('Google (Firebase/Cloud)');
  const server = H('server') || null, poweredBy = H('x-powered-by') || null;
  const generator = html.match(/<meta[^>]+name=["']generator["'][^>]+content=["']([^"']+)/i)?.[1] ?? null;
  return { stack: found, hosting: uniq(hosting), server, poweredBy, generator };
}

function pageLinks(html, base) {
  const abs = u => { try { return new URL(u.replace(/&amp;/g, '&'), base).href; } catch { return null; } };
  const attr = (tag, a) => [...html.matchAll(new RegExp(`<${tag}\\b[^>]*\\b${a}=["']([^"']+)["']`, 'gi'))].map(m => abs(m[1])).filter(Boolean);
  const runtime = uniq([...html.matchAll(/["'`]([^"'`\s<>]+?\.(?:wasm|pck|data|unityweb|br|glb|gltf|bin|json|swf|zip|love))(?:\?[^"'`\s]*)?["'`]/gi)].map(m => abs(m[1])).filter(u => u && !/\/\/(www\.)?(google|facebook|twitter|x)\./.test(u))).slice(0, 40);
  return {
    title: stripHtml(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '') || null,
    description: html.match(/<meta[^>]+(?:name|property)=["'](?:og:)?description["'][^>]+content=["']([^"']+)/i)?.[1] ?? null,
    scripts: uniq(attr('script', 'src')).slice(0, 40), styles: uniq(attr('link', 'href').filter(u => /\.css(\?|$)/i.test(u))).slice(0, 20),
    iframes: uniq(attr('iframe', 'src')).slice(0, 10), runtimeFiles: runtime,
  };
}

async function webSource(url, opt) {
  assertPublicUrl(url);
  const page = await httpGet(url, { ...opt, as: 'text', maxBytes: 3 * MiB });
  if (page.status !== 200) throw new RPError('SOURCE_ERROR', `${url}: HTTP ${page.status}`);
  let html = page.text;
  const finalUrl = page.url || url;
  const links = pageLinks(html, finalUrl);
  const frames = [];
  // itch.io and similar hosts put the game in an iframe (sometimes HTML-escaped in a data attribute): follow one hop.
  const embedded = [...links.iframes, ...[...html.matchAll(/https?:\/\/[a-z0-9.-]*itch\.zone\/html\/[^"'&\s<>]+/gi)].map(m => m[0])];
  for (const f of uniq(embedded).slice(0, 2)) {
    try { assertPublicUrl(f); const r = await httpGet(f, { ...opt, as: 'text', maxBytes: 3 * MiB }); if (r.status === 200) { frames.push({ url: f, ...pageLinks(r.text, f) }); html += `\n${r.text}`; } } catch { /* frame unreachable */ }
  }
  // Read up to three same-site scripts: bundles carry the framework names and versions.
  const origin = new URL(finalUrl).origin;
  const sameSite = [...links.scripts, ...frames.flatMap(f => f.scripts)].filter(s => { try { const u = new URL(s); return u.origin === origin || /itch\.zone$/.test(u.hostname); } catch { return false; } });
  let scripts = '';
  for (const s of sameSite.slice(0, 3)) { const r = await httpGet(s, { ...opt, as: 'text', maxBytes: 6 * MiB }).catch(() => null); if (r?.status === 200) scripts += `\n${r.text.slice(0, 6 * MiB)}`; }
  const fp = fingerprintPage(html, { headers: page.headers, scripts });
  return { found: true, url: finalUrl, ...links, frames, ...fp, scriptsRead: Math.min(3, sameSite.length) };
}

// ------------------------------------------------------------------ assemble

function mergeEngines(list) {
  const byKey = new Map();
  for (const e of list) {
    if (!e?.name) continue;
    const fp = footprintFor(e.name) ?? footprintFor(e.id ?? '');
    const key = fp && fp !== 'web' ? `fp:${fp}` : `n:${norm(e.name).replace(/ \(.*$/, '')}`;
    const cur = byKey.get(key) ?? { name: e.name, footprint: fp, version: null, sources: [] };
    if (e.version && !cur.version) cur.version = e.version;
    if (/\d/.test(e.name) && !/\d/.test(cur.name)) cur.name = e.name;
    cur.sources = uniq([...cur.sources, e.source]);
    if (e.strong) cur.strong = true;
    byKey.set(key, cur);
  }
  return [...byKey.values()].map(({ strong, ...e }) => ({ ...e, confidence: strong || e.sources.length >= 2 ? 'high' : 'medium' }))
    .sort((a, b) => (b.confidence === 'high') - (a.confidence === 'high') || b.sources.length - a.sources.length);
}

const decideKind = (kind, r) => kind !== 'auto' ? kind
  : r.steam?.found || r.pcgamingwiki?.found || (r.wikidata?.instanceOf ?? []).some(x => /game/i.test(x)) ? 'game'
    : r.appstore?.found ? 'app' : r.web?.found ? 'web' : r.github?.found ? 'software' : (r.wikidata?.instanceOf ?? []).some(x => /app/i.test(x)) ? 'app' : 'software';

export async function lookupTool({ query, url, steamAppId, appStoreId, github, kind = 'auto', sources, mirror = false, maxFiles = 400, fresh = false } = {}) {
  const t = classifyInput({ query, url, steamAppId, appStoreId, github });
  const use = new Set(sources?.length ? sources : SOURCES);
  for (const s of use) if (!SOURCES.includes(s)) throw new RPError('INVALID_ARGUMENT', `Unknown source ${s}. Sources: ${SOURCES.join(', ')}.`);
  const opt = { fresh };
  const log = [];
  const run = async (name, fn) => {
    if (!use.has(name)) return null;
    try { const r = await fn(); log.push({ source: name, ok: true, found: !!r?.found }); return r; }
    catch (e) { log.push({ source: name, ok: false, error: e.message }); return { found: false, error: e.message }; }
  };
  const r = {};
  const gameish = kind === 'game' || kind === 'auto';
  // Order matters: Steam gives the app id that PCGamingWiki and Wikidata look up exactly.
  if (gameish && (t.name || t.steamAppId)) r.steam = await run('steam', () => steamSource(t, opt));
  const sid = r.steam?.steamAppId ?? t.steamAppId;
  const steamName = r.steam?.found ? r.steam.name : null;
  const named = { ...t, name: t.name ?? steamName };
  [r.wikidata, r.pcgamingwiki, r.appstore] = await Promise.all([
    (named.name || sid) ? run('wikidata', () => wikidataSource(named, opt, { steamAppId: sid, kind })) : null,
    gameish && (named.name || sid) ? run('pcgamingwiki', () => pcgwSource(named, opt, sid)) : null,
    (kind === 'app' || kind === 'auto') && (t.appStoreId || (named.name && !t.github && !t.url)) ? run('appstore', () => appStoreSource({ ...named, appStoreId: t.appStoreId }, opt)) : null,
  ]);
  if (t.url) r.web = await run('web', () => webSource(t.url, opt));
  const repoFromWikidata = (r.wikidata?.repositories ?? []).map(u => u.match(/github\.com\/([^/]+)\/([^/#?]+)/)).find(Boolean);
  const repo = t.github ?? (repoFromWikidata ? { owner: repoFromWikidata[1], repo: repoFromWikidata[2].replace(/\.git$/, '') } : null);
  if (repo) r.github = await run('github', () => githubRepoSource({ github: repo }, opt, { mirror, maxFiles }));
  const name = steamName ?? r.appstore?.name ?? r.wikidata?.name ?? r.github?.name ?? r.web?.title ?? t.name ?? t.playId;
  const openSource = name && use.has('github') ? await run('github', () => githubSearchSource(name, opt)) : null;
  const theKind = decideKind(kind, r);

  const engines = mergeEngines([
    ...(r.pcgamingwiki?.engines ?? []).map(e => ({ ...e, source: 'pcgamingwiki' })),
    ...(r.wikidata?.engines ?? []).map(n => ({ name: n, source: 'wikidata' })),
    ...(r.github?.engines ?? []).map(e => ({ name: e.name.replace(/ (game build|project)$/i, ''), id: e.id, version: e.version, source: 'github-files', strong: true })),
    ...(r.web?.stack ?? []).filter(s => s.group === 'engine' || (s.footprint === 'web' && s.group === 'framework') || s.footprint === 'flutter').map(s => ({ name: s.name, version: s.version, source: 'web-page', strong: s.group === 'engine' })),
  ]);
  const fpKeys = uniq(engines.map(e => e.footprint).concat(r.web?.found && !engines.length ? ['web'] : []));
  const footprints = fpKeys.map(k => ({ key: k, ...FOOTPRINTS[k] })).map(({ match, ...f }) => f);
  const genres = uniq([...(r.steam?.genres ?? []), ...(r.wikidata?.genres ?? []), ...(r.appstore?.genres ?? []), ...Object.values(r.pcgamingwiki?.taxonomy ?? {}).flat()]);
  const graphicsApi = uniq([...(r.steam?.graphicsApi ?? []), ...Object.entries(r.pcgamingwiki?.api ?? {}).filter(([k]) => /versions/i.test(k)).map(([k, v]) => `${k.replace(/ versions/i, '')} ${v}`)]);
  const dossier = {
    input: { query: query ?? null, url: url ?? null, steamAppId: steamAppId ?? null, appStoreId: appStoreId ?? null, github: github ?? null, kind },
    kind: theKind, name,
    identity: {
      name, description: r.steam?.description ?? r.appstore?.description ?? r.wikidata?.description ?? r.github?.description ?? r.web?.description ?? null,
      developers: uniq([...(r.steam?.developers ?? []), ...(r.pcgamingwiki?.developers ?? []), ...(r.wikidata?.developers ?? []), r.appstore?.developer]),
      publishers: uniq([...(r.steam?.publishers ?? []), ...(r.pcgamingwiki?.publishers ?? []), ...(r.wikidata?.publishers ?? [])]),
      released: r.steam?.released ?? r.wikidata?.released ?? r.appstore?.released ?? null,
      platforms: uniq([...(r.steam?.platforms ?? []), ...(r.wikidata?.platforms ?? []), ...(r.appstore?.found ? ['iOS'] : []), ...(t.playId ? ['Android'] : [])]),
      genres, categories: r.steam?.categories ?? [], modes: r.wikidata?.modes ?? [], series: r.wikidata?.series ?? [], basedOn: r.wikidata?.basedOn ?? [],
      website: r.steam?.website ?? r.wikidata?.website ?? r.github?.homepage ?? null,
      ids: { steam: sid ?? null, wikidata: r.wikidata?.qid ?? null, appStore: r.appstore?.appStoreId ?? t.appStoreId ?? null, googlePlay: t.playId, pcgamingwiki: r.pcgamingwiki?.title ?? null, github: r.github?.fullName ?? null },
    },
    tech: {
      engines, languages: uniq([...(r.wikidata?.languages ?? []), ...Object.keys(r.github?.languages ?? {})]), graphicsApi,
      middleware: r.pcgamingwiki?.middleware ?? {}, web: r.web?.found ? { stack: r.web.stack, hosting: r.web.hosting, server: r.web.server, poweredBy: r.web.poweredBy, generator: r.web.generator } : null,
      app: r.appstore?.found ? { bundleId: r.appstore.bundleId, minimumOs: r.appstore.minimumOs, sizeBytes: r.appstore.sizeBytes, version: r.appstore.version, languages: r.appstore.languages } : t.playId ? { packageId: t.playId } : null,
      license: uniq([...(r.wikidata?.license ?? []), r.github?.license]),
    },
    material: {
      footprints,
      saves: r.pcgamingwiki?.saves ?? [], config: r.pcgamingwiki?.config ?? [],
      requirements: r.steam?.requirements ?? null,
      web: r.web?.found ? { scripts: r.web.scripts, styles: r.web.styles, runtimeFiles: [...r.web.runtimeFiles, ...r.web.frames.flatMap(f => f.runtimeFiles)], frames: r.web.frames.map(f => f.url) } : null,
      repo: r.github?.found ? { url: r.github.url, license: r.github.license, files: r.github.files, structure: r.github.structure, mirror: r.github.mirror } : null,
    },
    references: {
      screenshots: uniq([...(r.steam?.screenshots ?? []), ...(r.appstore?.screenshots ?? [])]).slice(0, 12),
      videos: r.steam?.videos ?? [],
      pages: [r.steam?.found && { title: 'Steam store page', url: r.steam.url }, r.pcgamingwiki?.found && { title: 'PCGamingWiki', url: r.pcgamingwiki.url }, r.wikidata?.found && { title: 'Wikidata', url: r.wikidata.url },
        r.appstore?.found && { title: 'App Store', url: r.appstore.url }, t.playId && { title: 'Google Play', url: `https://play.google.com/store/apps/details?id=${encodeURIComponent(t.playId)}` },
        r.github?.found && { title: 'GitHub', url: r.github.url }, r.web?.found && { title: 'Web page', url: r.web.url }].filter(Boolean),
    },
    openSource: Array.isArray(openSource) ? openSource : [],
    sources: log,
    notes: [
      'Public information only. Engine names come from community wikis and page fingerprints: confidence "high" means two independent sources agree or project files prove it.',
      ...(t.playId ? ['Google Play has no public API: open the store page for details, or attach the .apk and run re_archive.'] : []),
      ...(engines.length ? [] : ['No engine found in public sources. Owning a copy? re_scan on the install folder identifies it from the files.']),
      ...(log.length && log.every(l => !l.ok) ? ['Every source failed: this machine cannot reach the public web from Node. Behind a proxy, set NODE_USE_ENV_PROXY=1 (Node 22.21+/24). Otherwise gather the facts with your own web search and pass them to re_blueprint (name, genres, tags, description, engine).'] : []),
    ],
  };
  const id = `${(name ?? 'lookup').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'lookup'}-${sha256(Buffer.from(JSON.stringify(dossier.input))).slice(0, 6)}`;
  dossier.lookupId = id;
  await writeJson(path.join(await workspaceDir('lookups'), `${id}.json`), dossier);
  dossier.next = [
    `re_blueprint {lookupId:"${id}"} → precise rebuild spec: systems, what to measure on the original, target engine, milestones`,
    ...(r.github?.mirror ? [`re_scan / re_graph / re_report {path:"${r.github.mirror.path}"}`, `port_plan {source:"${r.github.mirror.path}", to}`] : r.github?.found ? ['re_lookup {github, mirror:true} downloads the source text so re_graph, re_symbols and port_plan can read it'] : []),
    ...(footprints.length ? [`Owning a copy: ${footprints[0].readWith?.[0] ?? 're_scan on the install folder'}`] : []),
    ...(dossier.openSource.some(o => o.kind !== 'related') ? ['openSource lists reimplementations/remakes: check their license before reusing code'] : []),
  ];
  return dossier;
}

export async function loadLookup(id) {
  if (typeof id !== 'string' || !/^[a-z0-9-]{1,60}$/.test(id)) throw new RPError('INVALID_ARGUMENT', 'Bad lookupId.');
  const d = await readJson(path.join(await workspaceDir('lookups'), `${id}.json`), null);
  if (!d) throw new RPError('NOT_FOUND', `No lookup ${id}. Run re_lookup first.`);
  return d;
}
