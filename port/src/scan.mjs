// Project and build reconnaissance: what is in this folder, which engine/framework made it, which
// languages, where it starts. Works on source projects and on exported games (Godot, Unity, Unreal…).
import fs from 'node:fs/promises';
import path from 'node:path';
import { RPError, requireDir, walk, readAt, countLines, isText, MiB } from './util.mjs';
import { LANGUAGE_BY_EXT, CODE_LANGUAGES } from './symbols.mjs';
import { parseGodotProject } from './scene.mjs';
import { workspaceTooling } from './jsworkspace.mjs';

const CATEGORY_BY_EXT = {};
const cat = (name, exts) => exts.split(' ').forEach(e => { CATEGORY_BY_EXT[`.${e}`] = name; });
cat('scene', 'tscn scn unity prefab umap');
cat('resource', 'tres res asset mat anim controller overrideController uasset physicmaterial mask playable lighting');
cat('image', 'png jpg jpeg tga bmp gif webp psd exr hdr dds ktx ktx2 svg tif tiff ico basis');
cat('audio', 'wav ogg mp3 flac aif aiff opus wem bnk bank fsb xm it mod s3m mid midi');
cat('model', 'fbx obj gltf glb blend dae 3ds max ma mb ply stl usd usda usdc usdz vox');
cat('font', 'ttf otf woff woff2 fnt');
cat('video', 'mp4 webm ogv mov avi mkv bik bk2 usm');
cat('config', 'json yaml yml toml ini cfg xml plist properties godot import meta csproj sln vcxproj uproject uplugin gradle cmake lock editorconfig gitignore gitattributes');
cat('build-binary', 'exe dll so dylib pck pak ucas utoc bundle assets ress resource apk aab ipa jar class dex wasm pdb lib a o obj node');
cat('docs', 'md txt rst pdf html htm');

// npm dependency → framework name, for "what is this built with" in JS/TS projects.
const JS_FRAMEWORKS = [['three', 'three.js'], ['phaser', 'Phaser'], ['@babylonjs/core', 'Babylon.js'], ['babylonjs', 'Babylon.js'], ['pixi.js', 'PixiJS'], ['playcanvas', 'PlayCanvas'], ['excalibur', 'Excalibur'], ['kaboom', 'Kaboom'], ['kaplay', 'KAPLAY'],
  ['electron', 'Electron'], ['electron-vite', 'Electron'], ['electron-builder', 'Electron'], ['@tauri-apps/api', 'Tauri'], ['@capacitor/core', 'Capacitor'], ['react-native', 'React Native'], ['expo', 'Expo'],
  ['react', 'React'], ['vue', 'Vue'], ['svelte', 'Svelte'], ['solid-js', 'SolidJS'], ['preact', 'Preact'], ['@angular/core', 'Angular'], ['lit', 'Lit'],
  ['next', 'Next.js'], ['nuxt', 'Nuxt'], ['@sveltejs/kit', 'SvelteKit'], ['@solidjs/start', 'SolidStart'], ['astro', 'Astro'], ['@remix-run/react', 'Remix'], ['react-router', 'React Router'],
  ['vite', 'Vite'], ['webpack', 'webpack'], ['esbuild', 'esbuild'],
  ['express', 'Express'], ['fastify', 'Fastify'], ['hono', 'Hono'], ['koa', 'Koa'], ['@nestjs/core', 'NestJS'], ['elysia', 'Elysia'],
  ['effect', 'Effect'], ['drizzle-orm', 'Drizzle ORM'], ['@prisma/client', 'Prisma'], ['@trpc/server', 'tRPC'],
  ['@modelcontextprotocol/sdk', 'MCP SDK'], ['ai', 'Vercel AI SDK'], ['@opentui/core', 'OpenTUI'], ['ink', 'Ink (terminal UI)'], ['sst', 'SST']];

/** The file a package script starts (`node x.js`, `tsx src/a.ts`, `bun run --cwd pkg src/index.ts`). A leading \0 marks a path relative to --cwd's target, already joined. */
function scriptEntry(cmd) {
  if (typeof cmd !== 'string') return null;
  for (const part of cmd.split(/&&|\|\||;|\|/)) {
    const t = part.trim().split(/\s+/);
    const i = t.findIndex(x => /^(node|tsx|ts-node|bun|deno|esno|vite-node)$/.test(x));
    if (i < 0) continue;
    let cwd = null;
    for (let j = i + 1; j < t.length; j++) {
      const x = t[j];
      if (x === 'run' || x === 'x') continue;
      if (x === '--cwd' && t[j + 1]) { cwd = t[++j]; continue; }
      if (x.startsWith('--cwd=')) { cwd = x.slice(6); continue; }
      if (x.startsWith('-')) continue;
      if (/\.[cm]?[jt]sx?$/.test(x)) return cwd ? `\0${path.posix.normalize(path.posix.join(cwd, x))}` : x;
    }
  }
  return null;
}

function categoryOf(f) {
  const lang = LANGUAGE_BY_EXT[f.ext];
  if (lang && CODE_LANGUAGES.has(lang)) return 'code';
  if (lang === 'godot-scene' || lang === 'unity-scene' || lang === 'unity-prefab') return 'scene';
  if (lang === 'godot-resource') return 'resource';
  const base = path.basename(f.rel).toLowerCase();
  if (['makefile', 'cmakelists.txt', 'dockerfile', 'project.godot'].includes(base)) return 'config';
  return CATEGORY_BY_EXT[f.ext] ?? 'other';
}

async function readText(file, max = 256 * 1024) {
  try { const b = await readAt(file, 0, max); return isText(b) ? b.toString('utf8') : ''; } catch { return ''; }
}

const UNITY_VERSION = /\b(\d{4}\.\d+\.\d+[abfpx]\d+)\b/;

export async function detectEngines(root, files) {
  const engines = [];
  const rels = files.map(f => f.rel);
  const lower = new Map(files.map(f => [f.rel.toLowerCase(), f]));
  const has = rel => lower.has(rel.toLowerCase());
  const find = re => files.filter(f => re.test(f.rel));
  const add = e => engines.push(e);
  const depth = rel => rel.split('/').length;

  // Godot projects (shallowest project.godot first)
  for (const f of find(/(^|\/)project\.godot$/).sort((a, b) => depth(a.rel) - depth(b.rel)).slice(0, 5)) {
    const p = parseGodotProject(await readText(f.abs));
    add({ id: 'godot', name: `Godot ${p.version ?? (p.godotMajor ? `${p.godotMajor}.x` : '')}`.trim(), kind: 'project', root: path.posix.dirname(f.rel) === '.' ? '' : path.posix.dirname(f.rel), version: p.version, details: p, evidence: [f.rel] });
  }
  // Exported Godot games
  const pcks = find(/\.pck$/i);
  if (pcks.length) add({ id: 'godot-build', name: 'Godot exported game', kind: 'build', evidence: pcks.slice(0, 10).map(f => f.rel), details: { packs: pcks.map(f => ({ file: f.rel, size: f.size })) } });
  const exes = find(/\.(exe|x86_64|x86_32|arm64|app)$/i).filter(f => f.size > 1024 * 1024);
  for (const f of exes.slice(0, 20)) {
    const tail = await readAt(f.abs, f.size - 4, 4).catch(() => Buffer.alloc(0));
    if (tail.toString('latin1') === 'GDPC') add({ id: 'godot-build', name: 'Godot exported game (pack embedded in executable)', kind: 'build', evidence: [f.rel], details: { embeddedIn: f.rel } });
  }
  // Unity projects
  for (const f of find(/(^|\/)ProjectSettings\/ProjectVersion\.txt$/)) {
    const text = await readText(f.abs);
    const prefix = f.rel.replace(/ProjectSettings\/ProjectVersion\.txt$/, '');
    const manifest = await readText(path.join(root, prefix, 'Packages', 'manifest.json'));
    const pipeline = /render-pipelines\.high-definition/.test(manifest) ? 'HDRP' : /render-pipelines\.universal/.test(manifest) ? 'URP' : 'Built-in';
    const buildScenes = [...(await readText(path.join(root, prefix, 'ProjectSettings', 'EditorBuildSettings.asset'))).matchAll(/path: (Assets\/[^\n]+\.unity)/g)].map(m => m[1].trim());
    add({ id: 'unity', name: `Unity ${text.match(/m_EditorVersion:\s*(\S+)/)?.[1] ?? ''}`.trim(), kind: 'project', root: prefix.replace(/\/$/, ''), version: text.match(/m_EditorVersion:\s*(\S+)/)?.[1] ?? null, evidence: [f.rel], details: { renderPipeline: pipeline, inputSystem: /com\.unity\.inputsystem/.test(manifest), buildScenes, textSerialization: null } });
  }
  // Unity builds
  const ggm = find(/(^|\/)[^/]*_Data\/globalgamemanagers$|(^|\/)Data\/globalgamemanagers$/);
  if (ggm.length || rels.some(r => /(^|\/)UnityPlayer\.(dll|so|dylib)$/i.test(r))) {
    let version = null;
    if (ggm[0]) version = (await readAt(ggm[0].abs, 0, 256)).toString('latin1').match(UNITY_VERSION)?.[1] ?? null;
    const il2cpp = rels.some(r => /GameAssembly\.(dll|so|dylib)$/i.test(r) || /il2cpp_data\//.test(r));
    const managed = find(/_Data\/Managed\/Assembly-CSharp\.dll$/);
    add({ id: 'unity-build', name: `Unity game build${version ? ` (${version})` : ''}`, kind: 'build', version, evidence: [...ggm.map(f => f.rel), ...rels.filter(r => /UnityPlayer\./.test(r))].slice(0, 5), details: { scriptingBackend: il2cpp ? 'IL2CPP' : managed.length ? 'Mono' : 'unknown', gameAssemblies: managed.map(f => f.rel) } });
  }
  // Unreal
  for (const f of find(/\.uproject$/i)) {
    let json = {};
    try { json = JSON.parse(await readText(f.abs)); } catch { /* damaged */ }
    add({ id: 'unreal', name: `Unreal Engine ${json.EngineAssociation ?? ''}`.trim(), kind: 'project', root: path.posix.dirname(f.rel) === '.' ? '' : path.posix.dirname(f.rel), version: json.EngineAssociation ?? null, evidence: [f.rel], details: { modules: (json.Modules ?? []).map(m => m.Name), plugins: (json.Plugins ?? []).filter(p => p.Enabled).map(p => p.Name) } });
  }
  const paks = find(/Content\/Paks\/[^/]+\.pak$/i);
  if (paks.length) add({ id: 'unreal-build', name: 'Unreal Engine game build', kind: 'build', evidence: paks.slice(0, 5).map(f => f.rel), details: { paks: paks.map(f => f.rel), ioStore: rels.some(r => /\.utoc$/i.test(r)) } });
  // Other engines and frameworks
  if (find(/\.yyp$/i).length) add({ id: 'gamemaker', name: 'GameMaker project', kind: 'project', evidence: find(/\.yyp$/i).map(f => f.rel) });
  if (find(/(^|\/)data\.win$/i).length) add({ id: 'gamemaker-build', name: 'GameMaker game build', kind: 'build', evidence: find(/(^|\/)data\.win$/i).map(f => f.rel) });
  const rpg = find(/(^|\/)js\/(rpg_core|rmmz_core)\.js$/);
  if (rpg.length) add({ id: 'rpgmaker', name: rpg[0].rel.includes('rmmz') ? 'RPG Maker MZ' : 'RPG Maker MV', kind: 'project', evidence: rpg.map(f => f.rel) });
  if (find(/\.rpy$/).length || find(/\.rpa$/).length) add({ id: 'renpy', name: "Ren'Py", kind: find(/\.rpy$/).length ? 'project' : 'build', evidence: [...find(/\.rpy$/), ...find(/\.rpa$/)].slice(0, 5).map(f => f.rel) });
  if (has('main.lua') && has('conf.lua')) add({ id: 'love2d', name: 'LÖVE (Love2D)', kind: 'project', evidence: ['main.lua', 'conf.lua'] });
  if (has('main.lua') && has('build.settings')) add({ id: 'solar2d', name: 'Solar2D (Corona)', kind: 'project', evidence: ['main.lua', 'build.settings'] });
  if (has('game.project')) add({ id: 'defold', name: 'Defold', kind: 'project', evidence: ['game.project'] });
  if (find(/\.c3proj$/i).length) add({ id: 'construct', name: 'Construct 3', kind: 'project', evidence: find(/\.c3proj$/i).map(f => f.rel) });
  for (const f of find(/(^|\/)Cargo\.toml$/).slice(0, 5)) {
    const t = await readText(f.abs);
    if (/^\s*bevy\s*=/m.test(t)) add({ id: 'bevy', name: 'Bevy (Rust)', kind: 'project', evidence: [f.rel] });
    else if (/^\s*macroquad\s*=/m.test(t)) add({ id: 'macroquad', name: 'macroquad (Rust)', kind: 'project', evidence: [f.rel] });
  }
  for (const f of find(/\.csproj$/i).slice(0, 20)) {
    const t = await readText(f.abs);
    if (/MonoGame\.Framework/i.test(t)) add({ id: 'monogame', name: 'MonoGame', kind: 'project', evidence: [f.rel] });
    else if (/\bFNA\b/.test(t)) add({ id: 'fna', name: 'FNA', kind: 'project', evidence: [f.rel] });
    else if (/Godot\.NET\.Sdk/i.test(t)) { /* part of a Godot .NET project */ }
  }
  const pkgFiles = find(/(^|\/)package\.json$/).filter(f => !f.rel.includes('node_modules')).sort((a, b) => a.rel.split('/').length - b.rel.split('/').length);
  const PKG_MAX = 60;
  for (const f of pkgFiles.slice(0, PKG_MAX)) {
    let pkg = {};
    try { pkg = JSON.parse(await readText(f.abs)); } catch { continue; }
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    const found = JS_FRAMEWORKS.filter(([d]) => deps[d]).map(([, n]) => n);
    const pkgDir = path.posix.dirname(f.rel) === '.' ? '' : path.posix.dirname(f.rel);
    const starts = [...(typeof pkg.bin === 'string' ? [pkg.bin] : Object.values(pkg.bin ?? {})), ...['start', 'dev', 'serve'].map(k => scriptEntry(pkg.scripts?.[k])).filter(Boolean)];
    // `bun run --cwd packages/cli src/index.ts` at the root starts a file in another package.
    for (let i = 0; i < starts.length; i++) if (typeof starts[i] === 'string' && starts[i].startsWith('\0')) starts[i] = path.posix.relative(pkgDir || '.', starts[i].slice(1)) || starts[i].slice(1);
    add({ id: 'node', name: `Node.js package${found.length ? ` (${[...new Set(found)].join(', ')})` : ''}`, kind: 'project', root: path.posix.dirname(f.rel) === '.' ? '' : path.posix.dirname(f.rel), evidence: [f.rel], details: { name: pkg.name, main: pkg.main, bin: pkg.bin, starts: [...new Set(starts)], scripts: Object.keys(pkg.scripts ?? {}), frameworks: [...new Set(found)] } });
  }
  if (pkgFiles.length > 1 || rels.some(r => /^(turbo|nx|lerna|rush)\.json$|^pnpm-workspace\.yaml$/.test(r))) {
    let rootPkg = {};
    if (has('package.json')) { try { rootPkg = JSON.parse(await readText(path.join(root, 'package.json'))); } catch { /* damaged */ } }
    const { manager, tools } = workspaceTooling(rels, rootPkg);
    const declared = Array.isArray(rootPkg.workspaces) ? rootPkg.workspaces : rootPkg.workspaces?.packages ?? [];
    if (declared.length || tools.length || pkgFiles.length > 2) {
      add({ id: 'js-monorepo', name: `JavaScript/TypeScript monorepo (${[manager, ...tools].filter(Boolean).join(', ') || 'workspaces'})`, kind: 'project', evidence: ['package.json', ...rels.filter(r => /^(turbo|nx|lerna|rush)\.json$|^pnpm-workspace\.yaml$|^bun\.lockb?$/.test(r))].filter(r => rels.includes(r)), details: { packageManager: manager, tools, workspaces: declared, packages: pkgFiles.length, packagesListed: Math.min(pkgFiles.length, PKG_MAX) } });
    }
  }
  if (rels.some(r => /(^|\/)resources\/app\.asar$/i.test(r))) add({ id: 'electron-build', name: 'Electron app build', kind: 'build', evidence: rels.filter(r => /app\.asar$/i.test(r)).slice(0, 3) });
  if (find(/(^|\/)pubspec\.yaml$/).length) add({ id: 'flutter', name: 'Flutter / Dart', kind: 'project', evidence: find(/(^|\/)pubspec\.yaml$/).map(f => f.rel) });
  const depthOfRel = r => r.split('/').length;
  const manifests = find(/(^|\/)AndroidManifest\.xml$/).map(f => f.rel).sort((a, b) => depthOfRel(a) - depthOfRel(b));
  if (manifests.length) {
    // The project root is the folder above src/main (and above app/ for a Gradle app module).
    const root = path.posix.dirname(manifests[0]).replace(/(^|\/)src\/main$/, '').replace(/(^|\/)app$/, '');
    add({ id: 'android', name: 'Android app', kind: 'project', root: root === '.' ? '' : root, evidence: manifests.slice(0, 3) });
  }
  if (find(/\.xcodeproj\//).length) add({ id: 'xcode', name: 'Xcode project (Apple)', kind: 'project', evidence: [...new Set(find(/\.xcodeproj\//).map(f => f.rel.split('.xcodeproj/')[0] + '.xcodeproj'))].slice(0, 3) });
  if (find(/\.sln$/i).length && !engines.some(e => ['unity', 'godot'].includes(e.id))) add({ id: 'dotnet', name: '.NET solution', kind: 'project', evidence: find(/\.sln$/i).map(f => f.rel).slice(0, 3) });
  for (const [file, id, name] of [['go.mod', 'go', 'Go module'], ['CMakeLists.txt', 'cmake', 'CMake (C/C++)'], ['pyproject.toml', 'python', 'Python project'], ['setup.py', 'python', 'Python project'], ['requirements.txt', 'python', 'Python project'], ['pom.xml', 'maven', 'Maven (Java)'], ['build.gradle', 'gradle', 'Gradle (JVM)'], ['build.gradle.kts', 'gradle', 'Gradle (JVM)'], ['Makefile', 'make', 'Makefile build']]) {
    if (has(file) && !engines.some(e => e.id === id)) add({ id, name, kind: 'project', evidence: [file] });
  }
  if (engines.some(e => e.id === 'python')) {
    const reqs = await readText(path.join(root, 'requirements.txt'));
    if (/^\s*pygame/im.test(reqs) || (await Promise.all(find(/\.py$/).slice(0, 200).map(f => readText(f.abs, 16384)))).some(t => /^\s*import\s+pygame|^\s*from\s+pygame/m.test(t))) add({ id: 'pygame', name: 'Pygame', kind: 'project', evidence: ['import pygame'] });
  }
  return engines;
}

export async function scanProject({ path: dir, maxFiles = 50000 } = {}) {
  let abs;
  try { abs = await requireDir(dir, 'project folder'); }
  catch (e) { if (e.code === 'NOT_A_FOLDER') throw new RPError('NOT_A_FOLDER', `${path.resolve(dir)} is a file. Use re_binary for executables/libraries, re_archive for packs and archives, re_probe for unknown formats.`); throw e; }
  const { files, truncated, skippedDirs, unreadable } = await walk(abs, { maxFiles: Math.min(Math.max(100, maxFiles), 500000) });
  const categories = {}, languages = {};
  let codeRead = 0;
  for (const f of files) {
    f.category = categoryOf(f);
    const c = (categories[f.category] ??= { files: 0, bytes: 0 });
    c.files++; c.bytes += f.size;
    const lang = LANGUAGE_BY_EXT[f.ext];
    if (f.category === 'code') {
      const l = (languages[lang] ??= { files: 0, lines: 0, bytes: 0 });
      l.files++; l.bytes += f.size;
      if (codeRead < 20000 && f.size < 4 * MiB) { codeRead++; l.lines += countLines(await fs.readFile(f.abs, 'utf8').catch(() => '')); }
    }
  }
  const engines = await detectEngines(abs, files);
  const depthOf = e => (e.root ? e.root.split('/').length : 0);
  const primary = engines.filter(e => e.kind === 'project').sort((a, b) => depthOf(a) - depthOf(b) || (b.id === 'js-monorepo') - (a.id === 'js-monorepo'))[0] ?? engines[0] ?? null;
  const entryPoints = [];
  for (const e of engines) {
    if (e.id === 'godot') {
      const base = e.root ? `${e.root}/` : '';
      if (e.details.mainScene) entryPoints.push({ file: base + e.details.mainScene.replace(/^res:\/\//, ''), why: 'Godot main scene (run/main_scene)' });
      for (const a of e.details.autoload) entryPoints.push({ file: base + a.path.replace(/^res:\/\//, ''), why: `Godot autoload "${a.name}"` });
    }
    if (e.id === 'unity') for (const s of e.details.buildScenes) entryPoints.push({ file: (e.root ? `${e.root}/` : '') + s, why: 'Unity scene in build settings' });
    if (e.id === 'node') {
      const base = e.root ? `${e.root}/` : '';
      if (e.details.main) entryPoints.push({ file: path.posix.normalize(base + e.details.main), why: 'package.json main' });
      for (const s of e.details.starts ?? []) entryPoints.push({ file: path.posix.normalize(base + s), why: 'package.json bin/start script' });
    }
    if (e.id === 'love2d' || e.id === 'solar2d') entryPoints.push({ file: 'main.lua', why: `${e.name} entry` });
  }
  for (const f of files.filter(f => /(^|\/)(main\.(rs|go|py|c|cpp|cc)|__main__\.py|Program\.cs|index\.(html|js|ts))$/.test(f.rel)).slice(0, 10)) if (!entryPoints.some(p => p.file === f.rel)) entryPoints.push({ file: f.rel, why: 'conventional entry file name' });
  const biggest = [...files].sort((a, b) => b.size - a.size).slice(0, 12).map(f => ({ file: f.rel, size: f.size, category: f.category }));
  const binaries = files.filter(f => f.category === 'build-binary').slice(0, 50).map(f => ({ file: f.rel, size: f.size }));
  const sortObj = o => Object.fromEntries(Object.entries(o).sort((a, b) => b[1].bytes - a[1].bytes));
  return {
    root: abs, files: files.length, truncated, totalBytes: files.reduce((s, f) => s + f.size, 0), skippedDirs: skippedDirs.slice(0, 40), ...(unreadable.length ? { unreadable, warnings: [`${unreadable.length} folder(s) could not be read; results do not cover them.`] } : {}),
    primary: primary ? { id: primary.id, name: primary.name, kind: primary.kind } : null, engines, languages: sortObj(languages), categories: sortObj(categories),
    entryPoints, biggest, binaries,
    next: nextSteps(engines, binaries, abs),
  };
}

function nextSteps(engines, binaries, root) {
  const steps = [];
  const j = v => JSON.stringify(v);
  if (engines.some(e => e.kind === 'project')) steps.push(`re_graph ${j({ path: root })} for the dependency graph and porting order`, `re_symbols ${j({ path: root, match: '<name>' })} for classes and functions`, `port_plan ${j({ source: root, to: '<unity|godot|godot-csharp|unreal|threejs|language>' })} to start a port`);
  if (engines.some(e => e.id === 'godot-build')) { const pck = binaries.find(b => /\.pck$/i.test(b.file ?? b.rel ?? b)); steps.push(`re_archive ${j({ file: pck ? `${root}/${pck.file ?? pck.rel ?? pck}` : `${root}/<game>.pck` })} to list the packed project`); }
  if (engines.some(e => e.id === 'unity-build')) steps.push(`re_binary ${j({ file: `${root}/<Game>_Data/Managed/Assembly-CSharp.dll` })} lists the game classes (Mono builds)`);
  if (binaries.length) { const b = binaries[0]; steps.push(`re_binary ${j({ file: `${root}/${b.file ?? b.rel ?? b}` })} for executables and libraries`); }
  return steps;
}

export { categoryOf };
