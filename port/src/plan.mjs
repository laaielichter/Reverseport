// Port workflow: plan a port (units in dependency order), hand units to an agent with everything it needs,
// write the ported files into a separate output folder, convert scenes, track progress and verify parity.
// The source project is never modified.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { closest } from './agent.mjs';
import { RPError, requireDir, walk, isText, readJson, writeJson, pascalCase, snakeCase, kebabCase, nameKey, countLines, statOrNull } from './util.mjs';
import { workspaceDir, workspaceRoot, safeJoin, isInside } from './workspace.mjs';
import { buildGraph } from './graph.mjs';
import { languageOf, fileSymbols, extractSymbols, CODE_LANGUAGES } from './symbols.mjs';
import { categoryOf } from './scan.mjs';
import { ENGINES, normEngine, mapFor, apiHits, leftovers, LIFECYCLE_EQUIV, portMapTool } from './knowledge.mjs';
import { readScene, parseGodotScene, parseUnityYaml } from './scene.mjs';
import { convertTree } from './convert.mjs';
import { writeTscn, unitySpec, threeModule, unrealSpec, scaffold, sceneFunctionName } from './porters.mjs';
import { dormantFindings, resumePack } from './dormant.mjs';
import { parityFindings } from './trace.mjs';
import { readUnityAnimation, clipToTres, controllerToGd, snake as animSnake } from './unity-anim.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TARGETS = ['godot', 'godot-csharp', 'unity', 'unreal', 'threejs'];
const LANGUAGE_TARGETS = { typescript: '.ts', javascript: '.js', python: '.py', csharp: '.cs', cpp: '.cpp', rust: '.rs', go: '.go', java: '.java', kotlin: '.kt', lua: '.lua', gdscript: '.gd', swift: '.swift', dart: '.dart' };
const MAX_UNIT_SOURCE = 200 * 1024;

const plansDir = () => workspaceDir('ports');
const planFile = async id => path.join(await plansDir(), id, 'plan.json');

export async function loadPlan(id) {
  if (!id || !/^[a-z0-9-]{3,80}$/.test(id)) throw new RPError('INVALID_ARGUMENT', 'Give a planId (port_status lists them).');
  const plan = await readJson(await planFile(id), null);
  if (!plan) throw new RPError('UNKNOWN_PLAN', `No port plan "${id}". port_status without planId lists the plans.`);
  return plan;
}
async function savePlan(plan) {
  plan.updated = new Date().toISOString();
  await writeJson(await planFile(plan.id), plan);
  try { await fs.writeFile(path.join(plan.output, 'PORT-PLAN.md'), planMarkdown(plan)); plan.planFileError = undefined; }
  catch (e) { plan.planFileError = `PORT-PLAN.md could not be written: ${e.code ?? e.message}`; }
}

/** One shape for "what next" everywhere: the exact call to make. */
const call = (tool, args) => ({ tool, arguments: args });
const callText = c => `${c.tool} ${JSON.stringify(c.arguments)}`;

/** The next call as data ({tool, arguments}) — copy it as-is. */
function nextCallObj(plan) {
  const u = nextUnit(plan);
  if (!u) return call('port_verify', { planId: plan.id });
  if (u.kind === 'scene' || (u.kind === 'animation' && u.action === 'convert-scene')) return call('port_scene', { planId: plan.id, unit: u.id });
  if (u.kind === 'asset') return call('port_copy_assets', { planId: plan.id });
  return call('port_unit', { planId: plan.id });
}

/** The same next call as text, with a short reason. */
function nextCall(plan) {
  const u = nextUnit(plan);
  const c = nextCallObj(plan);
  return u ? `${callText(c)}  (next: ${u.id} ${u.source})` : `${callText(c)}  (every unit is handled)`;
}

const withNext = (plan, extra = {}) => ({ ...extra, next: nextCall(plan), nextCall: nextCallObj(plan) });

function detectFrom(graph, scanEngines) {
  const e = scanEngines.find(x => ['godot', 'unity', 'unreal'].includes(x.id));
  if (e) {
    if (e.id === 'godot' && e.details?.dotnet && ![...graph.nodes.values()].some(n => n.language === 'gdscript')) return { engine: 'godot-csharp', root: e.root };
    return { engine: e.id, root: e.root };
  }
  const counts = {};
  for (const n of graph.nodes.values()) if (CODE_LANGUAGES.has(n.language)) counts[n.language] = (counts[n.language] ?? 0) + (n.lines ?? 0);
  const lang = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  return { engine: null, language: lang, root: '' };
}

/** Where does a source file go in the target project? */
function targetPath(rel, kind, ctx) {
  const { to, from } = ctx;
  let p = rel;
  if (ctx.sourceRoot && p.startsWith(`${ctx.sourceRoot}/`)) p = p.slice(ctx.sourceRoot.length + 1);
  if (from === 'unity') p = p.replace(/^Assets\//, '');
  const dir = path.posix.dirname(p) === '.' ? '' : path.posix.dirname(p);
  const base = path.posix.basename(p).replace(/\.[^.]+$/, '');
  const ext = path.posix.extname(p);
  const j = (...parts) => parts.filter(Boolean).join('/');
  const dirNoScripts = dir.replace(/^Scripts(\/|$)/, '');
  if (kind === 'asset') {
    if (to === 'unity') return j('Assets', dir, path.posix.basename(p));
    if (to === 'threejs') return j('public', 'assets', dir, path.posix.basename(p));
    if (to === 'unreal') return j('ReversePort', 'Import', dir, path.posix.basename(p));
    return j(from === 'unity' ? 'assets' : '', dir, path.posix.basename(p));
  }
  if (kind === 'script' || kind === 'shader' || kind === 'resource') {
    if (to === 'unity') return kind === 'shader' ? j('Assets', 'Shaders', dir, `${base}.shader`) : kind === 'resource' ? j('Assets', 'Data', dir, `${pascalCase(base)}.asset.json`) : j('Assets', 'Scripts', dir, `${pascalCase(base)}.cs`);
    if (to === 'godot') return kind === 'shader' ? j(dir, `${snakeCase(base)}.gdshader`) : kind === 'resource' ? j(dir, `${snakeCase(base)}.tres`) : j(from === 'unity' ? 'scripts' : '', from === 'unity' ? dirNoScripts : dir, `${snakeCase(base)}.gd`);
    if (to === 'godot-csharp') return kind === 'script' ? j(dir, `${pascalCase(base)}.cs`) : rel;
    if (to === 'unreal') return kind === 'script' ? j('Source', ctx.module, dirNoScripts, `${pascalCase(base)}.h`) : j('ReversePort', 'Rebuild', dir, `${base}${ext}.md`);
    if (to === 'threejs') return kind === 'shader' ? j('src', 'shaders', dir, `${kebabCase(base)}.glsl`) : kind === 'resource' ? j('src', 'data', dir, `${kebabCase(base)}.json`) : j('src', dirNoScripts, `${kebabCase(base)}.ts`);
    const tExt = LANGUAGE_TARGETS[to] ?? ext;
    return j(dir, `${base}${tExt}`);
  }
  if (kind === 'animation') {
    const isCtrl = ext === '.controller';
    if (to === 'godot' || to === 'godot-csharp') return j('animations', dir.replace(/^(Animations?|Anim)(\/|$)/, ''), isCtrl ? `${snakeCase(base)}_animator.gd` : `${snakeCase(base)}.tres`);
    return j('ReversePort', 'Notes', `${p}.md`);
  }
  if (kind === 'scene') {
    if (to === 'godot') return j('scenes', dir.replace(/^(Scenes|Prefabs)(\/|$)/, ''), `${snakeCase(base)}.tscn`);
    if (to === 'godot-csharp') return rel;
    if (to === 'unity') return j('Assets', 'ReversePort', 'Specs', dir, `${base}.scene.json`);
    if (to === 'threejs') return j('src', 'scenes', dir, `${kebabCase(base)}.ts`);
    if (to === 'unreal') return j('ReversePort', 'Scenes', dir, `${base}.scene.json`);
  }
  return j('ReversePort', 'Notes', `${p}.md`);
}

function unityPrefabPath(rel, ctx, isScene) {
  let p = rel;
  if (ctx.sourceRoot && p.startsWith(`${ctx.sourceRoot}/`)) p = p.slice(ctx.sourceRoot.length + 1);
  const dir = path.posix.dirname(p) === '.' ? '' : path.posix.dirname(p);
  const base = pascalCase(path.posix.basename(p));
  return ['Assets', isScene ? 'Scenes' : 'Prefabs', dir, `${base}${isScene ? '.unity' : '.prefab'}`].filter(Boolean).join('/');
}

function kindOf(f) {
  const lang = languageOf(f.rel);
  const cat = categoryOf(f);
  if (/\.(import|meta|uid)$/i.test(f.rel)) return null;
  if (lang === 'godot-scene' || lang === 'unity-scene' || lang === 'unity-prefab') return 'scene';
  if (lang === 'godot-resource') return 'resource';
  if (/\.(anim|controller)$/i.test(f.rel) && /(^|\/)Assets\//.test(f.rel)) return 'animation';
  if (lang === 'shader') return 'shader';
  if (cat === 'code') return 'script';
  if (['image', 'audio', 'model', 'font', 'video'].includes(cat)) return 'asset';
  if (/(^|\/)project\.godot$/.test(f.rel) || /ProjectSettings\/(InputManager|TagManager|EditorBuildSettings)\.asset$/.test(f.rel) || /\.uproject$/.test(f.rel)) return 'config';
  if (f.ext === '.asset' && /^Assets\//.test(f.rel)) return 'resource';
  return null;
}

export async function planPort({ source, to, output, name, include, exclude, unrealVersion = '5.5' } = {}) {
  const src = await requireDir(source, 'source project');
  const target = normEngine(to);
  if (!target) throw new RPError('INVALID_ARGUMENT', `Give the target: ${TARGETS.join(', ')} (engines) or a language (${Object.keys(LANGUAGE_TARGETS).join(', ')}).`);
  if (!TARGETS.includes(target) && !LANGUAGE_TARGETS[target]) { const near = closest(target, [...TARGETS, ...Object.keys(LANGUAGE_TARGETS)], 3); throw new RPError('INVALID_ARGUMENT', `Unknown target "${to}".${near ? ` Did you mean "${near}"?` : ''} Engines: ${TARGETS.join(', ')}; languages: ${Object.keys(LANGUAGE_TARGETS).join(', ')}.`); }
  const graph = await buildGraph(src);
  const from = detectFrom(graph, graph.engines);
  const fromId = from.engine ?? from.language ?? 'unknown';
  if (fromId === target) throw new RPError('INVALID_ARGUMENT', `Source and target are both ${target}.`);
  const id = `${kebabCase(name ?? path.basename(src)).slice(0, 40)}-to-${target}-${crypto.randomBytes(3).toString('hex')}`;
  const earlier = [];
  for (const pid of (await fs.readdir(await plansDir()).catch(() => [])).sort()) {
    const p = await readJson(path.join(await plansDir(), pid, 'plan.json'), null);
    if (p && p.source === src && p.to === target) earlier.push({ planId: p.id, ...progress(p), updated: p.updated });
  }
  const out = output ? path.resolve(output) : path.join(await plansDir(), id, 'output');
  if (isInside(out, src)) throw new RPError('UNSAFE_PATH', 'The output folder must not be inside the source project.');
  if (isInside(src, out)) throw new RPError('UNSAFE_PATH', 'The output folder must not contain the source project.');
  const existing = await fs.readdir(out).catch(() => null);
  if (existing?.length && !existing.includes('.reverseport-port')) throw new RPError('OUTPUT_NOT_EMPTY', `${out} is not empty. Choose an empty or new folder; ReversePort never overwrites other files.`);
  await fs.mkdir(out, { recursive: true });
  const projectName = graph.engines.find(e => e.details?.name)?.details?.name ?? name ?? path.basename(src);
  const ctx = { to: target, from: from.engine ?? from.language, sourceRoot: from.root, module: pascalCase(projectName) };
  const want = include ? new RegExp(include) : null, skip = exclude ? new RegExp(exclude) : null;
  const { files } = await walk(src, { maxFiles: 60000 });
  const orderIndex = new Map(graph.order.map((f, i) => [f, i]));
  const units = [];
  for (const f of files) {
    if (want && !want.test(f.rel)) continue;
    if (skip && skip.test(f.rel)) continue;
    if (from.root && !f.rel.startsWith(`${from.root}/`) && f.rel !== from.root) continue;
    const kind = kindOf(f);
    if (!kind) continue;
    const node = graph.nodes.get(f.rel);
    let action = kind === 'asset' ? 'copy' : kind === 'scene' ? (['godot', 'unity', 'threejs', 'unreal', 'godot-csharp'].includes(target) ? 'convert-scene' : 'rebuild') : kind === 'animation' ? (target === 'godot' ? 'convert-scene' : 'rebuild') : kind === 'config' ? 'rebuild' : 'translate';
    if (target === 'godot-csharp' && ctx.from === 'godot' && (kind === 'resource' || (kind === 'config' && /project\.godot$/.test(f.rel)))) action = 'convert-scene';
    const unit = { source: f.rel, kind, language: languageOf(f.rel), size: f.size, lines: node?.lines ?? null, target: targetPath(f.rel, kind, ctx), action, status: 'pending' };
    if (target === 'unreal' && kind === 'script') unit.extraTargets = [unit.target.replace(/\.h$/, '.cpp')];
    if (kind === 'config') unit.target = action === 'convert-scene' ? (ctx.sourceRoot ? f.rel.slice(ctx.sourceRoot.length + 1) : f.rel) : ['ReversePort', 'Notes', `${path.posix.basename(f.rel)}.md`].join('/');
    if (target === 'unity' && kind === 'scene') unit.savePath = unityPrefabPath(f.rel, ctx, false);
    units.push(unit);
  }
  // Main/entry scenes become scenes, others prefabs (Unity); entry points go last.
  const entry = new Set(graph.entryPoints);
  for (const u of units) if (target === 'unity' && u.kind === 'scene' && entry.has(u.source) && /\.(tscn|unity)$/.test(u.source)) { u.savePath = unityPrefabPath(u.source, ctx, true); u.sceneKind = 'scene'; }
  // Order: assets, then dependency order (dependencies first), then configs.
  const rank = u => (u.kind === 'asset' ? -1 : u.kind === 'config' ? 1e9 : orderIndex.get(u.source) ?? 1e8);
  units.sort((a, b) => rank(a) - rank(b) || a.source.localeCompare(b.source));
  units.forEach((u, i) => { u.id = `u${String(i + 1).padStart(3, '0')}`; });
  const idBySource = new Map(units.map(u => [u.source, u.id]));
  for (const u of units) {
    u.dependsOn = (graph.outEdges.get(u.source) ?? []).map(d => idBySource.get(d)).filter(Boolean);
    if (u.kind === 'script' && isText(await fs.readFile(path.join(src, u.source)).catch(() => Buffer.alloc(0)))) {
      const text = await fs.readFile(path.join(src, u.source), 'utf8');
      const hits = apiHits(text, ctx.from, target);
      u.apiHits = hits.reduce((s, h) => s + h.count, 0);
      u.risk = (u.lines ?? 0) > 400 || u.apiHits > 25 ? 'high' : (u.lines ?? 0) > 150 || u.apiHits > 8 ? 'medium' : 'low';
    }
  }
  // Collision check: two sources → same target
  const seen = new Map();
  for (const u of units) {
    const k = u.target.toLowerCase();
    if (seen.has(k)) { const ext = path.posix.extname(u.target); u.target = u.target.slice(0, -ext.length) + `_${u.id}` + ext; u.note = `renamed: ${seen.get(k)} already targets this path`; }
    seen.set(u.target.toLowerCase(), u.id);
  }
  const godotEngine = graph.engines.find(e => e.id === 'godot');
  const plan = {
    id, name: projectName, created: new Date().toISOString(), source: src, output: out, from: ctx.from, to: target, sourceRoot: from.root, module: ctx.module,
    map: mapFor(ctx.from, target) ? `${normEngine(ctx.from)}->${target}` : null,
    engines: graph.engines.map(e => ({ id: e.id, name: e.name, version: e.version ?? null })),
    godotVersion: godotEngine?.version ?? '4.3', unrealVersion,
    entryPoints: graph.entryPoints, cycles: graph.cycles.slice(0, 20), units, log: [],
  };
  await fs.writeFile(path.join(out, '.reverseport-port'), `${id}\n`);
  const scaffoldFiles = await writeScaffold(plan, units);
  await savePlan(plan);
  return summary(plan, { scaffold: scaffoldFiles, ...(earlier.length ? { existingPlans: earlier, note: 'Earlier plans for this source and target exist; continue one of them with port_unit {planId} instead of starting over if that was the intent.' } : {}) });
}

async function writeScaffold(plan) {
  const mainUnit = plan.units.find(u => u.kind === 'scene' && plan.entryPoints.includes(u.source));
  let mainScene = null;
  if (mainUnit && plan.to === 'threejs') mainScene = { fn: sceneFunctionName(mainUnit.source), path: `./${path.posix.relative('src', mainUnit.target).replace(/\.ts$/, '')}` };
  if (mainUnit && (plan.to === 'godot' || plan.to === 'godot-csharp')) mainScene = `res://${mainUnit.target}`;
  const files = scaffold(plan.to, { name: plan.name, godotVersion: plan.godotVersion, unrealVersion: plan.unrealVersion, mainScene });
  if (plan.to === 'unity' && plan.units.some(u => u.kind === 'scene')) files['Assets/Editor/ReversePortSceneBuilder.cs'] = await fs.readFile(path.join(ROOT, 'templates', 'unity', 'ReversePortSceneBuilder.cs'), 'utf8');
  const written = [];
  for (const [rel, content] of Object.entries(files)) {
    const dest = safeJoin(plan.output, rel);
    if (await statOrNull(dest)) continue;
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, content);
    written.push(rel);
  }
  if (written.length) plan.log.push({ at: new Date().toISOString(), event: 'scaffold', files: written });
  return written;
}

function summary(plan, extra = {}) {
  const by = (k) => plan.units.reduce((o, u) => { o[u[k]] = (o[u[k]] ?? 0) + 1; return o; }, {});
  const next = nextUnit(plan);
  return {
    planId: plan.id, name: plan.name, from: plan.from, to: plan.to, source: plan.source, output: plan.output, map: plan.map,
    units: plan.units.length, byKind: by('kind'), byStatus: by('status'), byAction: by('action'),
    risky: plan.units.filter(u => u.risk === 'high').map(u => u.source).slice(0, 20),
    cycles: plan.cycles?.length ? plan.cycles : undefined,
    next: nextCall(plan), nextCall: nextCallObj(plan), nextUnit: next ? { unit: next.id, source: next.source, action: next.action } : null,
    ...(plan.planFileError ? { warnings: [plan.planFileError] } : {}),
    ...extra,
    howTo: 'Work unit by unit: port_unit {planId} → write the port → port_write {planId, unit, files|content|copy}. Scenes: port_scene {planId, unit}. Assets: port_write {planId, unit, copy:true} or port_copy_assets. Finish with port_verify.',
  };
}

function nextUnit(plan) {
  const done = new Set(plan.units.filter(u => ['done', 'skipped'].includes(u.status)).map(u => u.id));
  const open = plan.units.filter(u => u.status === 'pending' || u.status === 'in_progress' || u.status === 'partial');
  return open.find(u => u.kind !== 'asset' && u.dependsOn.every(d => done.has(d) || d === u.id)) ?? open.find(u => u.kind !== 'asset') ?? open[0] ?? null;
}

function findUnit(plan, unit) {
  const u = plan.units.find(x => x.id === unit || x.source === unit || x.target === unit);
  if (!u) throw new RPError('UNKNOWN_UNIT', `Unit ${unit} is not in plan ${plan.id}. port_status {planId} lists the units.`);
  return u;
}

const CHECKLIST = {
  script: [
    'Keep every public function, signal/event and exported field; name them in the target idiom (see conventions).',
    'Replace each engine API with the mapped equivalent (apiHints); never leave source-engine calls in the target file.',
    'Convert units and axes where code uses positions, directions or angles (port_convert).',
    'Mark anything you could not port with a "PORT:" comment explaining what is missing — port_verify counts them.',
    'Use the target names of already-ported dependencies (dependencies[].targetSymbols) so files fit together.',
  ],
  scene: ['Run port_scene {planId, unit}: it writes the converted scene/spec and marks the unit. Then review its reverseport TODO notes.'],
  resource: ['Port the data with the field names of its ported script/class. Keep values; convert units if they are distances.'],
  shader: ['Start from port_shader {file, to}: it maps uniforms, intrinsics and built-ins and marks the rest with PORT: comments. Resolve every leftover it lists; uniforms keep their names.'],
  asset: ['Copy as-is: port_write {planId, unit, copy:true}. The target engine imports it itself.'],
  config: ['Recreate these project settings in the target (input actions, tags/groups, autoloads/singletons, main scene). Write what you did into the notes file.'],
};

export async function portUnit({ planId, unit, full = false } = {}) {
  const plan = await loadPlan(planId);
  const u = unit ? findUnit(plan, unit) : nextUnit(plan);
  if (!u) return { planId, done: true, message: 'All units are done or skipped.', next: callText(call('port_verify', { planId })), nextCall: call('port_verify', { planId }) };
  const repeat = !full && plan.units.some(x => x.status === 'done' && x.kind === u.kind && x.id !== u.id);
  const abs = path.join(plan.source, u.source);
  const result = { planId, unit: u.id, source: u.source, kind: u.kind, action: u.action, target: u.target, ...(u.extraTargets ? { extraTargets: u.extraTargets } : {}), status: u.status, from: plan.from, to: plan.to };
  if (u.status === 'pending') { u.status = 'in_progress'; u.started = new Date().toISOString(); await savePlan(plan); }
  result.checklist = repeat ? 'Same checklist as the earlier units (port_unit {planId, unit, full:true} repeats it).' : CHECKLIST[u.kind] ?? CHECKLIST.script;
  if (u.kind === 'asset') { const c = call('port_write', { planId, unit: u.id, copy: true }); return { ...result, next: callText(c), nextCall: c }; }
  if (u.kind === 'animation' && u.action === 'convert-scene') {
    const c = call('port_scene', { planId, unit: u.id });
    return { ...result, next: callText(c), nextCall: c };
  }
  if (u.kind === 'scene') {
    const scene = await readScene(abs).catch(e => ({ error: e.message }));
    const c = call('port_scene', { planId, unit: u.id });
    return { ...result, scene: scene.root ? { nodes: scene.nodeCount, root: scene.root.name, connections: scene.connections?.length ?? 0 } : scene, next: callText(c), nextCall: c };
  }
  const buf = await fs.readFile(abs);
  if (!isText(buf)) return { ...result, note: 'Binary file — cannot be translated as text. Rebuild it in the target engine and write notes.' };
  const text = buf.toString('utf8');
  result.sourceText = text.length > MAX_UNIT_SOURCE ? `${text.slice(0, MAX_UNIT_SOURCE)}\n… [truncated: ${text.length} chars total — read the rest from ${abs}]` : text;
  result.sourceFile = abs;
  const lang = languageOf(u.source);
  if (lang && CODE_LANGUAGES.has(lang)) result.symbols = extractSymbols(text, lang);
  result.apiHints = apiHits(text, plan.from, plan.to);
  if (repeat) result.conventions = `Same as the earlier units (port_map {from:"${plan.from}", to:"${plan.to}"}, or port_unit with full:true).`;
  else {
    const map = portMapTool({ from: plan.from, to: plan.to });
    result.conventions = map.conventions ?? [map.note].filter(Boolean);
    result.targetEngine = ENGINES[plan.to] ? { name: ENGINES[plan.to].name, axes: ENGINES[plan.to].axes, units: ENGINES[plan.to].units, lifecycle: ENGINES[plan.to].lifecycle } : { language: plan.to };
  }
  const deps = [];
  for (const d of u.dependsOn) {
    const du = plan.units.find(x => x.id === d);
    if (!du) continue;
    const info = { unit: du.id, source: du.source, target: du.target, status: du.status };
    if (du.status === 'done' && du.targetSymbols) info.targetSymbols = du.targetSymbols;
    deps.push(info);
  }
  result.dependencies = deps;
  result.usedBy = plan.units.filter(x => x.dependsOn.includes(u.id)).map(x => x.source).slice(0, 20);
  result.naming = namingFor(u, plan);
  const writeCall = call('port_write', { planId, unit: u.id, files: [{ path: u.target, content: '<ported code>' }, ...(u.extraTargets ? [{ path: u.extraTargets[0], content: '<ported code>' }] : [])] });
  result.next = `${callText(writeCall)}  (write the ported file, then send it)`;
  result.nextCall = writeCall;
  return result;
}

function namingFor(u, plan) {
  const base = path.posix.basename(u.source).replace(/\.[^.]+$/, '');
  const cls = pascalCase(base);
  if (plan.to === 'unity') return { className: cls, rule: 'class name must equal the file name (Unity)', file: u.target };
  if (plan.to === 'godot-csharp') return { className: cls, rule: 'public partial class, name = file name', file: u.target };
  if (plan.to === 'unreal') return { className: `A${cls} (Actor) or U${cls}Component (component)`, rule: 'UCLASS + GENERATED_BODY; .h/.cpp pair; include "<File>.generated.h" last', files: [u.target, ...(u.extraTargets ?? [])] };
  if (plan.to === 'godot') return { className: cls, rule: 'class_name in PascalCase, file and functions in snake_case', file: u.target };
  if (plan.to === 'threejs') return { className: cls, rule: 'export class in PascalCase, file in kebab-case', file: u.target };
  return { file: u.target };
}

async function writeFiles(plan, u, files) {
  const written = [];
  for (const fl of files) {
    const rel = fl.path ?? u.target;
    if (typeof fl.content !== 'string') throw new RPError('INVALID_ARGUMENT', `files[].content must be a string (${rel}).`);
    if (fl.content.length > 8 * 1024 * 1024) throw new RPError('TOO_LARGE', `${rel} is larger than 8 MiB.`);
    const dest = safeJoin(plan.output, rel);
    if (/^\.reverseport-port$/.test(path.basename(dest))) throw new RPError('UNSAFE_PATH', 'Reserved file name.');
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.writeFile(dest, fl.content);
    written.push(rel.replace(/\\/g, '/'));
  }
  return written;
}

function checkTarget(plan, u, contents) {
  const all = contents.join('\n');
  const targetLang = languageOf(u.target);
  const sym = targetLang && CODE_LANGUAGES.has(targetLang) ? extractSymbols(all, targetLang) : null;
  const left = leftovers(all, plan.from, plan.to);
  const todo = (all.match(/\b(PORT|TODO|FIXME)\b:?/g) ?? []).length;
  return { sym, left, todo };
}

export async function portWrite({ planId, unit, content, files, copy, status = 'done', notes } = {}) {
  const plan = await loadPlan(planId);
  const u = findUnit(plan, unit);
  if (!['done', 'partial', 'skipped'].includes(status)) throw new RPError('INVALID_ARGUMENT', 'status must be done, partial or skipped.');
  let written = [];
  if (status === 'skipped') { u.status = 'skipped'; u.notes = notes ?? u.notes; await savePlan(plan); return withNext(plan, { planId, unit: u.id, status: 'skipped' }); }
  if (copy) {
    const dest = safeJoin(plan.output, u.target);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.copyFile(path.join(plan.source, u.source), dest);
    written = [u.target];
  } else {
    const list = files ?? (typeof content === 'string' ? [{ path: u.target, content }] : null);
    if (!list?.length) throw new RPError('INVALID_ARGUMENT', 'Give content (for the unit target), files [{path, content}] or copy:true.');
    written = await writeFiles(plan, u, list);
  }
  const texts = [];
  for (const rel of written) { const b = await fs.readFile(safeJoin(plan.output, rel)); if (isText(b)) texts.push(b.toString('utf8')); }
  const check = copy ? null : checkTarget(plan, u, texts);
  u.status = status;
  u.written = [...new Set([...(u.written ?? []), ...written])];
  u.finished = new Date().toISOString();
  if (notes) u.notes = String(notes).slice(0, 4000);
  if (check?.sym) u.targetSymbols = { classes: check.sym.classes.map(c => c.name).filter(Boolean).slice(0, 50), functions: check.sym.functions.map(fn => fn.name).slice(0, 200) };
  if (check) { u.portMarkers = check.todo; u.leftovers = check.left.reduce((s, l) => s + l.count, 0); }
  plan.log.push({ at: u.finished, event: 'write', unit: u.id, files: written, status });
  if (plan.log.length > 500) plan.log = plan.log.slice(-500);
  await savePlan(plan);
  const parity = check?.sym ? parityFor(check.sym, await sourceSymbols(plan, u), texts.join('\n')) : null;
  const clean = !check || (!check.left.length && !(parity?.missing.length));
  return {
    planId, unit: u.id, status: u.status, clean, written: written.map(r => path.join(plan.output, r)),
    ...(check ? { leftovers: check.left, portMarkers: check.todo } : {}),
    ...(parity ? { missingFromSource: parity.missing.slice(0, 40), ...(parity.lifecycle.length ? { lifecycleWithoutCounterpart: parity.lifecycle } : {}) } : {}),
    progress: progress(plan),
    ...(plan.planFileError ? { warnings: [plan.planFileError] } : {}),
    next: clean ? nextCall(plan) : `Fix the leftovers and missingFromSource above while this file is fresh, then port_write ${JSON.stringify({ planId, unit: u.id })} with the corrected files again. (Or continue: ${nextCall(plan)}; port_verify will list it.)`,
    nextCall: clean ? nextCallObj(plan) : call('port_write', { planId, unit: u.id, files: [{ path: u.target, content: '<corrected file>' }] }),
  };
}

function lifecycleMatch(srcName, targetKeys) {
  for (const group of LIFECYCLE_EQUIV) if (group.includes(srcName)) return group.some(g => targetKeys.has(nameKey(g)));
  return false;
}

async function sourceSymbols(plan, u) {
  const lang = languageOf(u.source);
  if (!lang || !CODE_LANGUAGES.has(lang)) return null;
  return fileSymbols(path.join(plan.source, u.source), lang).catch(() => null);
}

function parityFor(targetSym, srcSym, targetText = '') {
  if (!srcSym) return { missing: [] };
  const keys = new Set([...targetSym.functions.map(f => nameKey(f.name)), ...targetSym.classes.map(c => nameKey(c.name ?? ''))]);
  const flat = nameKey(targetText);
  const missing = [];
  const lifecycle = [];
  for (const fn of srcSym.functions) {
    if (keys.has(nameKey(fn.name)) || lifecycleMatch(fn.name, keys)) continue;
    (LIFECYCLE_EQUIV.some(g => g.includes(fn.name)) ? lifecycle : missing).push(fn.name);
  }
  for (const s of srcSym.signals ?? []) if (!flat.includes(nameKey(s.name))) missing.push(`signal ${s.name}`);
  return { missing, lifecycle };
}

const progress = plan => {
  const total = plan.units.length;
  const done = plan.units.filter(u => u.status === 'done').length, skipped = plan.units.filter(u => u.status === 'skipped').length;
  return { done, skipped, partial: plan.units.filter(u => u.status === 'partial').length, pending: plan.units.filter(u => ['pending', 'in_progress'].includes(u.status)).length, total, percent: total ? Math.round(((done + skipped) / total) * 100) : 100 };
};

export async function portStatus({ planId } = {}) {
  if (!planId) {
    const dir = await plansDir();
    const ids = (await fs.readdir(dir).catch(() => [])).sort();
    const plans = [];
    for (const id of ids) { const p = await readJson(path.join(dir, id, 'plan.json'), null); if (p) plans.push({ planId: p.id, name: p.name, from: p.from, to: p.to, output: p.output, ...progress(p), updated: p.updated }); }
    return { workspace: workspaceRoot(), plans };
  }
  const plan = await loadPlan(planId);
  await savePlan(plan);
  return { ...summary(plan), progress: progress(plan), recent: plan.log.slice(-10), partial: plan.units.filter(u => u.status === 'partial').map(u => ({ unit: u.id, source: u.source, notes: u.notes })).slice(0, 30), planFile: path.join(plan.output, 'PORT-PLAN.md'), resume: resumePack(plan, { verify: plan.lastVerify ?? null }) };
}

export async function portVerify({ planId } = {}) {
  const plan = await loadPlan(planId);
  const errors = [], warnings = [], notPorted = [];
  let markers = 0, left = 0, missingTotal = 0, dormantTotal = 0, behaviourTotal = 0;
  for (const u of plan.units) {
    if (u.status === 'skipped') continue;
    if (['pending', 'in_progress'].includes(u.status)) { notPorted.push(u.id); continue; }
    const files = u.written ?? [];
    for (const rel of files) if (!(await statOrNull(safeJoin(plan.output, rel)))) errors.push({ unit: u.id, issue: `written file is missing: ${rel}` });
    if (u.kind === 'asset' || u.kind === 'scene' || u.kind === 'config' || u.kind === 'animation') continue;
    const texts = [];
    for (const rel of files) { const b = await fs.readFile(safeJoin(plan.output, rel)).catch(() => null); if (b && isText(b)) texts.push(b.toString('utf8')); }
    if (!texts.length) continue;
    const check = checkTarget(plan, u, texts);
    markers += check.todo; left += check.left.reduce((s, l) => s + l.count, 0);
    if (check.left.length) warnings.push({ unit: u.id, source: u.source, issue: 'source-engine API left in the port', details: check.left });
    if (check.sym) {
      const src = await sourceSymbols(plan, u);
      const parity = parityFor(check.sym, src, texts.join('\n'));
      if (parity.missing.length) { missingTotal += parity.missing.length; warnings.push({ unit: u.id, source: u.source, issue: 'functions/signals not found in the port', missing: parity.missing.slice(0, 40) }); }
      if (parity.lifecycle.length) warnings.push({ unit: u.id, source: u.source, issue: 'lifecycle callbacks without a counterpart (fine if their work moved elsewhere)', lifecycle: parity.lifecycle });
      // Dormant logic: names exist but do nothing, or nothing calls them, or errors were silenced.
      const srcLang = languageOf(u.source);
      const srcText = srcLang && CODE_LANGUAGES.has(srcLang) ? await fs.readFile(path.join(plan.source, u.source), 'utf8').catch(() => null) : null;
      const findings = dormantFindings({ sourceText: srcText, sourceLang: srcLang, targetText: texts.join('\n'), targetLang: languageOf(u.target), lifecycleGroups: LIFECYCLE_EQUIV });
      if (findings.length) { dormantTotal += findings.length; warnings.push({ unit: u.id, source: u.source, issue: 'dormant logic: empty or thin bodies, functions the source called but the port never does, added suppressions', findings: findings.slice(0, 40) }); }
      // Behaviour parity: tick placement, delta use, randomness and seeding, execution order, time scale.
      const behaviour = parityFindings({ sourceText: srcText, sourceLang: srcLang, targetText: texts.join('\n'), targetLang: languageOf(u.target) });
      if (behaviour.length) { behaviourTotal += behaviour.length; warnings.push({ unit: u.id, source: u.source, issue: 'behaviour parity: timing, randomness or order differs from the source', findings: behaviour }); }
    }
    if (u.status === 'partial') warnings.push({ unit: u.id, source: u.source, issue: 'marked partial', notes: u.notes });
  }
  const p = progress(plan);
  const passed = !errors.length && p.pending === 0 && p.partial === 0 && left === 0 && missingTotal === 0 && dormantTotal === 0 && behaviourTotal === 0;
  if (notPorted.length) warnings.unshift({ issue: 'not ported yet', count: notPorted.length, units: notPorted.slice(0, 10) });
  const onlyPending = !errors.length && warnings.length === (notPorted.length ? 1 : 0);
  const report = { planId, passed, progress: p, errors, warnings: warnings.slice(0, 200), portMarkers: markers, leftovers: left, missingSymbols: missingTotal, dormant: dormantTotal, behaviour: behaviourTotal, output: plan.output,
    next: passed ? 'Open the output in the target engine, build, run, and compare behaviour with the original.' : onlyPending ? `Nothing is wrong so far; ${notPorted.length} unit(s) are not ported yet. Continue: ${nextCall(plan)}` : 'Fix the errors and the warnings above (leftovers, missing functions, dormant logic, behaviour parity, partial units), then run port_verify again. To prove behaviour, log both with port_trace harnesses and compare.',
    ...(passed ? {} : { nextCall: onlyPending ? nextCallObj(plan) : call('port_verify', { planId }) }) };
  plan.lastVerify = { at: new Date().toISOString(), passed, errors: errors.length, warnings: warnings.length };
  await savePlan(plan);
  report.resume = resumePack(plan, { verify: report });
  return report;
}

export async function portCopyAssets({ planId, match } = {}) {
  const plan = await loadPlan(planId);
  const re = match ? new RegExp(match, 'i') : null;
  let copied = 0, bytes = 0;
  for (const u of plan.units.filter(x => x.kind === 'asset' && x.status !== 'done' && x.status !== 'skipped' && (!re || re.test(x.source)))) {
    const dest = safeJoin(plan.output, u.target);
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.copyFile(path.join(plan.source, u.source), dest);
    u.status = 'done'; u.written = [u.target]; copied++; bytes += u.size;
  }
  plan.log.push({ at: new Date().toISOString(), event: 'copy-assets', copied });
  await savePlan(plan);
  return { planId, copied, bytes, progress: progress(plan) };
}

// ---------------------------------------------------------------- scenes
async function sceneTree(abs) {
  const text = await fs.readFile(abs, 'utf8');
  if (/^﻿?\[gd_scene/.test(text)) return { engine: 'godot', parsed: parseGodotScene(text) };
  if (/^%YAML/.test(text)) return { engine: 'unity', parsed: await parseUnityYaml(text, abs) };
  throw new RPError('UNSUPPORTED_SCENE', 'Scene conversion needs a Godot .tscn or a Unity .unity/.prefab saved as text.');
}

/** For every Animator controller used in a Unity tree: its ported script and the clips already ported (by plan). */
async function animatorInfos(plan, root, resolveFromPlan) {
  const out = new Map();
  const visit = async n => {
    const a = (n.components ?? []).find(c => c.type === 'Animator');
    if (a && !out.has(a.controller ?? null)) {
      const info = { clips: [], missing: [], script: null };
      if (a.controller && plan && !a.controller.startsWith('guid:')) {
        const t = resolveFromPlan(a.controller);
        info.script = t ? `res://${t}` : null;
        try {
          const { controller } = await readUnityAnimation(path.join(plan.source, plan.sourceRoot ? `${plan.sourceRoot}/${a.controller}` : a.controller));
          for (const st of controller.layers[0]?.states ?? []) {
            if (!st.motion) continue;
            const res = resolveFromPlan(st.motion);
            const name = animSnake(path.basename(st.motion).replace(/\.anim$/i, ''));
            if (res && !info.clips.some(c => c.name === name)) info.clips.push({ name, res: `res://${res}` }); else if (!res) info.missing.push(st.motion);
          }
        } catch { /* controller unreadable: the node gets a todo */ }
      }
      out.set(a.controller ?? null, info);
    }
    for (const c of n.children ?? []) await visit(c);
  };
  await visit(root);
  return out;
}

async function portUnityAnimation({ plan, u, abs, target, out }) {
  if (target !== 'godot') throw new RPError('INVALID_ARGUMENT', 'Unity .anim/.controller conversion targets Godot; other targets get a rebuild note from port_unit.');
  const parsed = await readUnityAnimation(abs);
  const resolveFromPlan = ref => { if (!plan || !ref) return null; const rel = plan.sourceRoot ? `${plan.sourceRoot}/${ref}` : ref; return plan.units.find(x => x.source === rel || x.source.toLowerCase() === rel.toLowerCase())?.target ?? null; };
  let content, notes = [], summary;
  if (parsed.kind === 'unity-animation') {
    const r = clipToTres(parsed.clip, { coords: 'unity-3d', resolve: ref => { const t = resolveFromPlan(ref); return t ? `res://${t}` : null; } });
    content = r.text; summary = { tracks: r.tracks, length: parsed.clip.length, loop: parsed.clip.loop, todo: r.todo };
    notes.push(`${r.tracks} track(s); positions mirrored on Z. Add this Animation to the AnimationPlayer library of the node that had the Animator (port_scene does that for prefabs ported after this clip).`);
    if (r.todo.length) notes.push(...r.todo);
  } else {
    const ctrl = parsed.controller;
    const r = controllerToGd(ctrl, { className: `${pascalCase(path.basename(abs, '.controller'))}Animator`, resolveClip: ref => (ref && resolveFromPlan(ref) ? animSnake(path.basename(ref).replace(/\.anim$/i, '')) : null) });
    content = r.text; summary = { states: r.states, transitions: r.transitions, parameters: ctrl.parameters.length, todo: r.todo };
    notes.push('A GDScript state machine with the same states, parameters and conditions, driving an AnimationPlayer; port_scene puts it on an "Animator" child of every node that used this controller. Blend trees and extra layers need an AnimationTree by hand.');
    if (r.todo.length) notes.push(...r.todo);
  }
  if (plan) {
    const written = await writeFiles(plan, u, [{ path: u.target, content }]);
    u.status = 'done'; u.written = written; u.finished = new Date().toISOString(); u.notes = notes.join(' ');
    plan.log.push({ at: u.finished, event: 'scene', unit: u.id, files: written });
    await savePlan(plan);
    return withNext(plan, { planId: plan.id, unit: u.id, written: written.map(r => path.join(plan.output, r)), ...summary, notes, progress: progress(plan) });
  }
  const name = path.basename(abs).replace(/\.[^.]+$/, '');
  const dest = out ? path.resolve(out) : path.join(await workspaceDir('scenes'), parsed.kind === 'unity-animation' ? `${snakeCase(name)}.tres` : `${snakeCase(name)}_animator.gd`);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.writeFile(dest, content);
  return { file: dest, target, ...summary, notes, preview: content.slice(0, 4000) };
}

export async function portScene({ planId, unit, file, to, out } = {}) {
  let plan = null, u = null, abs, target;
  if (planId) { plan = await loadPlan(planId); u = unit ? findUnit(plan, unit) : plan.units.find(x => x.action === 'convert-scene' && x.status !== 'done'); if (!u) return { planId, message: 'No scene units left.' }; if (u.action !== 'convert-scene') throw new RPError('INVALID_ARGUMENT', `Unit ${u.id} (${u.kind}) is not a scene conversion; use port_unit/port_write.`); abs = path.join(plan.source, u.source); target = plan.to; }
  else { if (!file || !to) throw new RPError('INVALID_ARGUMENT', 'Give {planId, unit} or {file, to}.'); abs = path.resolve(file); target = normEngine(to); }
  if (target === 'godot-csharp') return swapToCsharp(plan, u, abs, resolveRef => resolveRef);
  if (/\.(anim|controller)$/i.test(abs)) return portUnityAnimation({ plan, u, abs, target, out });
  const { engine, parsed } = await sceneTree(abs);
  const resolveFromPlan = (srcRef, kindWanted) => {
    if (!plan || !srcRef) return null;
    let rel = srcRef;
    if (engine === 'godot') rel = (plan.sourceRoot ? `${plan.sourceRoot}/` : '') + srcRef.replace(/^res:\/\//, '');
    else if (engine === 'unity' && plan.sourceRoot) rel = `${plan.sourceRoot}/${srcRef}`;
    const hit = plan.units.find(x => x.source === rel || x.source.toLowerCase() === rel.toLowerCase());
    if (!hit) return null;
    if (kindWanted === 'unityPrefab') return hit.savePath ?? null;
    return hit.target;
  };
  let content, notes = [];
  const name = path.basename(abs).replace(/\.[^.]+$/, '');
  if (target === 'godot') {
    if (engine !== 'unity') throw new RPError('INVALID_ARGUMENT', 'Scene → Godot conversion reads Unity scenes/prefabs.');
    const tree = convertTree(parsed.root, 'unity', 'godot');
    const animators = await animatorInfos(plan, parsed.root, resolveFromPlan);
    content = writeTscn(tree, { engine: 'unity', name, resolve: ref => { const t = resolveFromPlan(ref); return t ? `res://${t}` : null; }, animator: ref => animators.get(ref ?? null) ?? null });
    notes.push('Meshes from model files are placeholders (metadata/reverseport_todo); import the models in Godot and assign them.');
  } else if (target === 'unity') {
    if (engine !== 'godot') throw new RPError('INVALID_ARGUMENT', 'Scene → Unity conversion reads Godot .tscn scenes.');
    const tree = convertTree(parsed.root, 'godot', 'unity');
    const isScene = u?.sceneKind === 'scene';
    const spec = unitySpec(tree, { kind: isScene ? 'scene' : 'prefab', savePath: u?.savePath ?? `Assets/Prefabs/${pascalCase(name)}.prefab`, order: plan ? plan.units.indexOf(u) : 0, subResources: parsed.subResources ?? {},
      resolve: ref => resolveFromPlan(ref, ref.endsWith('.tscn') ? 'unityPrefab' : undefined) });
    content = JSON.stringify(spec, null, 2) + '\n';
    notes.push('In Unity: Tools ▸ ReversePort ▸ Build prefabs and scenes from specs (Assets/Editor/ReversePortSceneBuilder.cs).');
    if (parsed.connections?.length) notes.push(`Recreate ${parsed.connections.length} signal connection(s) as C# events/UnityEvents: ${parsed.connections.slice(0, 10).map(c => `${c.from}.${c.signal} → ${c.to}.${c.method}`).join(', ')}`);
  } else if (target === 'threejs') {
    if (engine !== 'godot') throw new RPError('INVALID_ARGUMENT', 'Scene → three.js conversion reads Godot .tscn scenes.');
    const imports = [];
    const collect = n => { if (n.instance && !imports.some(i => i.source === n.instance)) { const t = resolveFromPlan(n.instance); if (t && u) imports.push({ source: n.instance, fn: sceneFunctionName(t), path: `./${path.posix.relative(path.posix.dirname(u.target), t).replace(/\.ts$/, '')}`.replace(/^\.\/\.\.\//, '../') }); } (n.children ?? []).forEach(collect); };
    collect(parsed.root);
    content = threeModule(parsed.root, { fnName: sceneFunctionName(u?.target ?? abs), imports, subResources: parsed.subResources ?? {} });
    if (parsed.connections?.length) notes.push(`Signal connections to wire in code: ${parsed.connections.slice(0, 10).map(c => `${c.from}.${c.signal} → ${c.to}.${c.method}`).join(', ')}`);
  } else if (target === 'unreal') {
    if (engine !== 'godot') throw new RPError('INVALID_ARGUMENT', 'Scene → Unreal conversion reads Godot .tscn scenes.');
    const tree = convertTree(parsed.root, 'godot', 'unreal');
    content = JSON.stringify(unrealSpec(tree, { subResources: parsed.subResources ?? {}, resolve: ref => resolveFromPlan(ref) }), null, 2) + '\n';
    notes.push('Build a Blueprint (or level) from this spec; locations are in cm with Unreal axes.');
  } else throw new RPError('INVALID_ARGUMENT', `Scene conversion targets: godot (from Unity), godot-csharp, unity, threejs, unreal (from Godot).`);
  if (plan) {
    const written = await writeFiles(plan, u, [{ path: u.target, content }]);
    u.status = 'done'; u.written = written; u.finished = new Date().toISOString(); u.notes = notes.join(' ');
    plan.log.push({ at: u.finished, event: 'scene', unit: u.id, files: written });
    await savePlan(plan);
    return withNext(plan, { planId, unit: u.id, written: written.map(r => path.join(plan.output, r)), notes, progress: progress(plan) });
  }
  const dest = out ? path.resolve(out) : path.join(await workspaceDir('scenes'), `${name}.${target === 'godot' || target === 'godot-csharp' ? 'tscn' : target === 'threejs' ? 'ts' : 'scene.json'}`);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.writeFile(dest, content);
  return { file: dest, target, notes, preview: content.slice(0, 4000) };
}

/** Godot GDScript → C#: same scenes/resources/project settings, script paths swapped to the C# files. */
async function swapToCsharp(plan, u, abs) {
  let text = await fs.readFile(abs, 'utf8');
  const toCs = p => {
    if (!plan) return `res://${p.replace(/^res:\/\//, '').replace(/([^/]+)\.gd$/, (m, b) => `${pascalCase(b)}.cs`)}`;
    const rel = (plan.sourceRoot ? `${plan.sourceRoot}/` : '') + p.replace(/^res:\/\//, '');
    const hit = plan.units.find(x => x.source === rel);
    return hit ? `res://${hit.target}` : null;
  };
  let swapped = 0;
  text = text.replace(/(\[ext_resource[^\]]*?path=")([^"]+\.gd)(")/g, (m, a, p, b) => { const t = toCs(p); if (!t) return m; swapped++; return `${a}${t}${b}`; });
  if (/^; Engine configuration file/.test(text)) {
    text = text.replace(/^(\w+)="(\*?)(res:\/\/[^"]+\.gd)"$/gm, (m, k, star, p) => { const t = toCs(p); if (!t) return m; swapped++; return `${k}="${star}${t}"`; });
    text = text.replace(/config\/features=PackedStringArray\(([^)]*)\)/, (m, inner) => (/"C#"/.test(inner) ? m : `config/features=PackedStringArray(${inner}, "C#")`));
    if (!/^\[dotnet\]/m.test(text)) text += `\n[dotnet]\n\nproject/assembly_name="${plan?.module ?? 'Game'}"\n`;
  }
  const notes = [`${swapped} script reference(s) now point to the C# files; everything else is unchanged.`];
  if (!plan) {
    const dest = path.join(await workspaceDir('scenes'), path.basename(abs));
    await fs.writeFile(dest, text);
    return { file: dest, target: 'godot-csharp', notes };
  }
  const written = await writeFiles(plan, u, [{ path: u.target, content: text }]);
  u.status = 'done'; u.written = written; u.finished = new Date().toISOString(); u.notes = notes.join(' ');
  plan.log.push({ at: u.finished, event: 'scene', unit: u.id, files: written });
  await savePlan(plan);
  return withNext(plan, { planId: plan.id, unit: u.id, written: written.map(r => path.join(plan.output, r)), notes, progress: progress(plan) });
}

// ---------------------------------------------------------------- PORT-PLAN.md
function planMarkdown(plan) {
  const p = progress(plan);
  const icon = { done: '✅', partial: '🟡', skipped: '⏭️', in_progress: '🔧', pending: '⬜' };
  const rows = plan.units.filter(u => u.kind !== 'asset').map(u => `| ${icon[u.status] ?? ''} ${u.id} | ${u.kind} | \`${u.source}\` | \`${u.target}\` | ${u.risk ?? ''} | ${(u.notes ?? '').replace(/\|/g, '/').slice(0, 120)} |`);
  const assets = plan.units.filter(u => u.kind === 'asset');
  return `# Port plan — ${plan.name}

**${plan.from} → ${plan.to}** · ${p.done + p.skipped}/${p.total} units (${p.percent}%) · plan \`${plan.id}\`

Source (read-only): \`${plan.source}\`
Generated by [ReversePort](https://github.com/laaielichter/reverseport). Agents: \`port_unit {planId:"${plan.id}"}\` → port → \`port_write\`; finish with \`port_verify\`.

${plan.cycles?.length ? `> ⚠️ ${plan.cycles.length} dependency cycle(s): port the files in a cycle together.\n\n` : ''}| | Kind | Source | Target | Risk | Notes |
|---|---|---|---|---|---|
${rows.join('\n')}

Assets to copy: ${assets.length} (${assets.filter(a => a.status === 'done').length} copied).
${plan.lastVerify ? `\nLast verify: ${plan.lastVerify.passed ? 'passed' : 'not passed'} (${plan.lastVerify.errors} errors, ${plan.lastVerify.warnings} warnings) at ${plan.lastVerify.at}.\n` : ''}`;
}

export { TARGETS, countLines };
