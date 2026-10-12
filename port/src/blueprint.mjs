// Rebuild blueprint: turns what is known about an existing game or app (a re_lookup dossier and/or genres, tags and a
// description) into a precise, clean-room rebuild spec: the systems it is made of, the parameters to measure on the
// original so the rebuild matches it in function and feel, a target engine with its conventions, milestones, a
// parity table to fill and verify, and a project skeleton with every measured parameter as a tunable.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RPError, writeJson, pascalCase, camelCase, snakeCase, kebabCase, statOrNull } from './util.mjs';
import { workspaceDir, isInside } from './workspace.mjs';
import { ENGINES, normEngine } from './knowledge.mjs';
import { scaffold } from './porters.mjs';
import { loadLookup, footprintFor, FOOTPRINTS } from './lookup.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const KNOWLEDGE = JSON.parse(fs.readFileSync(path.join(ROOT, 'knowledge', 'systems.json'), 'utf8'));
const ENGINE_TARGETS = ['godot', 'godot-csharp', 'unity', 'unreal', 'threejs'];
const APP_TARGETS = { web: 'Web app (TypeScript + a UI framework)', flutter: 'Flutter (Dart, iOS + Android + web)', 'react-native': 'React Native (TypeScript, iOS + Android)', swift: 'Swift / SwiftUI (iOS)', kotlin: 'Kotlin / Jetpack Compose (Android)', electron: 'Electron (desktop, TypeScript)' };
const NON_NUMERIC = new Set(['list', 'table', 'notes', 'graph', 'formula', 'samples', 'hex', 'fields', 'curve', 'ms, curve', 'px, s']);

const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wordRe = k => new RegExp(`(^|[^a-z0-9])${esc(k)}(s|es)?([^a-z0-9]|$)`, 'i');

/** Score archetypes against genres/tags (strong) and free text (weak). */
export function matchArchetypes({ genres = [], tags = [], text = '', kind = null, force = [] } = {}) {
  const strong = [...genres, ...tags].map(s => String(s).toLowerCase());
  const weak = String(text).toLowerCase();
  const out = [];
  for (const a of KNOWLEDGE.archetypes) {
    if (kind && a.kind !== kind && !force.includes(a.id)) continue;
    const hits = [];
    let score = 0;
    for (const k of a.match) {
      const re = wordRe(k);
      const g = strong.find(s => re.test(s));
      if (g) { score += 2; hits.push(`genre/tag "${g}"`); } else if (re.test(weak)) { score += 1; hits.push(`description mentions "${k}"`); }
    }
    if (force.includes(a.id)) { score += 10; hits.unshift('requested'); }
    if (score) out.push({ id: a.id, name: a.name, kind: a.kind, score, why: [...new Set(hits)].slice(0, 4) });
  }
  out.sort((a, b) => b.score - a.score);
  const picked = out.filter(a => a.score >= 2);
  return picked.length ? picked.slice(0, 5) : out.slice(0, 2);
}

function perspectiveOf(values = [], engineFp) {
  const v = values.map(s => String(s).toLowerCase()).join(' ');
  if (/first-person|third-person|free-roaming|\b3d\b|behind view|vr\b/.test(v)) return '3d';
  if (/side view|side-scroll|scrolling|flip screen|text-based|\b2d\b|pixel/.test(v)) return '2d';
  if (/isometric|top-down|bird/.test(v)) return engineFp === 'gamemaker' || engineFp === 'rpgmaker' ? '2d' : 'unknown (isometric/top-down: check whether the world is 2D sprites or 3D)';
  return 'unknown';
}

function platformFeatures(categories = [], features = []) {
  const c = [...categories, ...features].map(s => String(s).toLowerCase());
  const add = [];
  const has = re => c.some(s => re.test(s));
  if (has(/achievement/)) add.push({ id: 'achievements', name: 'Achievements', build: 'Achievement list with unlock conditions (write your own names/descriptions).', measure: [{ param: 'achievements', unit: 'list', how: 'public achievement list: conditions and counts' }] });
  if (has(/controller support/)) add.push({ id: 'gamepad', name: 'Full controller support', build: 'Every screen navigable with a gamepad; button prompts swap with the active device.', measure: [{ param: 'button_layout', unit: 'table', how: 'action per button' }] });
  if (has(/cloud/)) add.push({ id: 'cloud-save', name: 'Cloud saves', build: 'Save files small and versioned so they sync (platform cloud API).', measure: [] });
  if (has(/workshop|level editor|mod/)) add.push({ id: 'ugc', name: 'User content / modding', build: 'Level/mod format, editor, sharing.', measure: [{ param: 'ugc_scope', unit: 'notes', how: 'what players can create and share' }] });
  if (has(/in-app purchase|microtransaction/)) add.push({ id: 'store', name: 'In-app store', build: 'Store screens, currencies, purchase flow (platform billing).', measure: [{ param: 'store_items', unit: 'table', how: 'items, prices, currencies' }] });
  if (has(/leaderboard/)) add.push({ id: 'leaderboards', name: 'Leaderboards', build: 'Score submission and boards.', measure: [{ param: 'boards', unit: 'list', how: 'which boards exist and their sort' }] });
  return add;
}

function chooseTarget({ target, kind, originalFp, perspective, platforms = [], web }) {
  if (target) {
    const t = normEngine(target);
    if (ENGINE_TARGETS.includes(t)) return { target: t, name: ENGINES[t]?.name ?? t, engine: true, why: 'requested' };
    if (APP_TARGETS[t]) return { target: t, name: APP_TARGETS[t], engine: false, why: 'requested' };
    return { target: t, name: t, engine: false, why: 'requested (language/framework: no project skeleton is generated)' };
  }
  if (kind === 'app') {
    const p = platforms.map(s => String(s).toLowerCase()).join(' ');
    if (web || (!/ios|android|iphone|ipad/.test(p) && /web|browser/.test(p))) return { target: 'web', name: APP_TARGETS.web, engine: false, why: 'the original is a web app' };
    if (/ios|iphone|ipad/.test(p) && /android/.test(p)) return { target: 'flutter', name: APP_TARGETS.flutter, engine: false, why: 'the original ships on iOS and Android: one codebase for both' };
    if (originalFp === 'flutter' || originalFp === 'react-native' || originalFp === 'electron') return { target: originalFp, name: APP_TARGETS[originalFp], engine: false, why: 'same framework as the original: same widgets, scrolling physics and transitions' };
    return { target: 'flutter', name: APP_TARGETS.flutter, engine: false, why: 'cross-platform default for app rebuilds' };
  }
  const fp = originalFp ? FOOTPRINTS[originalFp] : null;
  if (fp && ENGINE_TARGETS.includes(fp.rebuildTarget)) return { target: fp.rebuildTarget, name: ENGINES[fp.rebuildTarget].name, engine: true, why: `the original runs on ${fp.name}: the same engine gives the same physics tick, camera conventions and rendering defaults, so measured values carry over 1:1` };
  if (web) return { target: 'threejs', name: ENGINES.threejs.name, engine: true, why: 'the original is a browser game' };
  if (/^2d/.test(perspective)) return { target: 'godot', name: ENGINES.godot.name, engine: true, why: '2D game: Godot has pixel-exact 2D, tilemaps and a light runtime' };
  return { target: 'godot', name: ENGINES.godot.name, engine: true, why: 'default: free, light, good 2D and 3D; choose unity or unreal with target if the original is high-end 3D' };
}

const ident = p => { const s = snakeCase(p); return /^\d/.test(s) ? `p_${s}` : s; };
const isNum = m => !NON_NUMERIC.has(m.unit);

function stubFiles(target, systems, name) {
  const files = {};
  for (const s of systems) {
    const nums = s.measure.filter(isNum), other = s.measure.filter(m => !isNum(m));
    const header = (c) => [`${c} ${s.name} — rebuild of the original's behaviour with your own code and assets.`, `${c} ${s.build}`, `${c} Values come from parity.json (measured on the original); 0 means not measured yet.`, ...other.map(m => `${c} TODO(measure) ${m.param} [${m.unit}]: ${m.how}`)].join('\n');
    const C = `${pascalCase(s.id)}System`;
    if (target === 'godot') {
      files[`systems/${snakeCase(s.id)}.gd`] = `${header('##')}\nextends Node\n\n${nums.map(m => `## ${m.how}\n@export var ${ident(m.param)}: float = 0.0 # ${m.unit}`).join('\n')}\n\nfunc _ready() -> void:\n\tpass\n\nfunc _physics_process(delta: float) -> void:\n\tpass\n`;
    } else if (target === 'godot-csharp') {
      files[`Systems/${C}.cs`] = `${header('//')}\nusing Godot;\n\npublic partial class ${C} : Node\n{\n${nums.map(m => `\t/// <summary>${m.how} (${m.unit})</summary>\n\t[Export] public float ${pascalCase(ident(m.param))} { get; set; } = 0f;`).join('\n')}\n\n\tpublic override void _PhysicsProcess(double delta) { }\n}\n`;
    } else if (target === 'unity') {
      files[`Assets/Scripts/Systems/${C}.cs`] = `${header('//')}\nusing UnityEngine;\n\npublic class ${C} : MonoBehaviour\n{\n${nums.map(m => `    [Tooltip("${m.how.replace(/"/g, "'")} (${m.unit})")]\n    [SerializeField] float ${camelCase(ident(m.param))} = 0f;`).join('\n')}\n\n    void FixedUpdate() { }\n}\n`;
    } else if (target === 'threejs') {
      files[`src/systems/${kebabCase(s.id)}.ts`] = `${header('//')}\nexport const ${camelCase(s.id)}Params = {\n${nums.map(m => `  /** ${m.how} (${m.unit}) */\n  ${camelCase(ident(m.param))}: 0,`).join('\n')}\n};\n\nexport class ${C} {\n  constructor(readonly params = { ...${camelCase(s.id)}Params }) {}\n  fixedUpdate(_dt: number): void {}\n}\n`;
    } else if (target === 'unreal') {
      const P = pascalCase(name);
      files[`Source/${P}/Systems/${C}Component.h`] = `${header('//')}\n#pragma once\n#include "CoreMinimal.h"\n#include "Components/ActorComponent.h"\n#include "${C}Component.generated.h"\n\nUCLASS(ClassGroup=(Rebuild), meta=(BlueprintSpawnableComponent))\nclass U${C}Component : public UActorComponent\n{\n\tGENERATED_BODY()\npublic:\n${nums.map(m => `\t/** ${m.how} (${m.unit}; Unreal uses cm) */\n\tUPROPERTY(EditAnywhere, Category="Measured") float ${pascalCase(ident(m.param))} = 0.f;`).join('\n')}\n};\n`;
    }
  }
  return files;
}

function markdown(bp) {
  const L = [];
  L.push(`# Rebuild blueprint — ${bp.name}`, '', `Working title: **${bp.workingTitle}** — pick your own product name, logo and art before anything is published.`, '');
  L.push('## What it is', '', `- Kind: ${bp.kind}; perspective: ${bp.perspective}`, `- Archetypes: ${bp.archetypes.map(a => `${a.name} (${a.why.join(', ')})`).join('; ') || 'none matched — add genres/tags or archetypes'}`);
  if (bp.original.engine) L.push(`- Original engine: ${bp.original.engine}${bp.original.version ? ` ${bp.original.version}` : ''} (${bp.original.confidence ?? 'given'})`);
  if (bp.original.conventions) L.push(`- Original conventions: ${bp.original.conventions}`);
  L.push(`- Target: **${bp.target.name}** — ${bp.target.why}`);
  if (bp.target.conventions) L.push(`- Target conventions: ${bp.target.conventions}`);
  if (bp.target.note) L.push(`- ${bp.target.note}`);
  L.push('', '## Clean-room rules', '', `- Rebuild freely: ${KNOWLEDGE.cleanRoom.free.join('; ')}.`, `- Make your own: ${KNOWLEDGE.cleanRoom.own.join('; ')}.`, `- Never: ${KNOWLEDGE.cleanRoom.never.join('; ')}.`, '');
  L.push('## Capture the original', '', ...KNOWLEDGE.method.capture.map(s => `- ${s}`), '', '### How to measure', '', ...KNOWLEDGE.method.measure.map(s => `- ${s}`), '');
  if (bp.references.length) L.push('### Public references', '', ...bp.references.map(r => `- ${r}`), '');
  L.push('## Systems', '');
  for (const s of bp.systems) {
    L.push(`### ${s.name}`, '', s.build, '', '| Parameter | Unit | How to measure | Value | ± |', '| --- | --- | --- | --- | --- |');
    for (const m of s.measure) L.push(`| \`${m.param}\` | ${m.unit} | ${m.how} | | ${isNum(m) ? '5%' : '—'} |`);
    L.push('');
  }
  L.push('## Milestones', '', ...bp.milestones.map((m, i) => `${i}. **${m.name}** — ${m.done}`), '');
  L.push('## Verify', '', ...KNOWLEDGE.method.verify.map(s => `- ${s}`), '', '`parity.json` holds every parameter: fill `original` from your measurements, `rebuild` from the same measurement on your build; a parameter passes inside its tolerance.', '');
  if (bp.openSource.length) L.push('## Existing open-source work', '', ...bp.openSource.map(o => `- [${o.repo}](${o.url}) — ${o.kind}${o.license ? `, ${o.license}` : ', no license given'}: ${o.description}`), '', 'Check each license before reusing any of it; "no license" means all rights reserved.', '');
  return `${L.join('\n')}\n`;
}

export async function blueprintTool({ lookupId, name, kind, genres = [], tags = [], description = '', engine, target, perspective, archetypes = [], output, scaffold: wantScaffold = true } = {}) {
  const d = lookupId ? await loadLookup(lookupId) : null;
  const title = name ?? d?.name;
  if (!title) throw new RPError('INVALID_ARGUMENT', 'Give a name (or a lookupId from re_lookup).');
  const theKind = kind ?? (d?.kind === 'app' || d?.kind === 'web' && !(d?.tech?.web?.stack ?? []).some(s => s.group === 'engine') ? 'app' : 'game');
  for (const a of archetypes) if (!KNOWLEDGE.archetypes.some(x => x.id === a)) throw new RPError('INVALID_ARGUMENT', `Unknown archetype ${a}. Archetypes: ${KNOWLEDGE.archetypes.map(x => x.id).join(', ')}.`);
  const allGenres = [...genres, ...(d?.identity?.genres ?? []), ...(d?.identity?.modes ?? [])];
  const allTags = [...tags, ...(d?.identity?.categories ?? [])];
  const text = [description, d?.identity?.description, title].filter(Boolean).join(' ');
  const matched = matchArchetypes({ genres: allGenres, tags: allTags, text, kind: theKind, force: archetypes });
  const origEngine = engine ? { name: engine, confidence: 'given' } : d?.tech?.engines?.[0] ?? null;
  const originalFp = origEngine ? footprintFor(origEngine.name) : (d?.tech?.web ? 'web' : null);
  const persp = perspective ?? perspectiveOf([...allGenres, ...allTags, ...(d ? Object.values(d.identity ?? {}).flat().filter(x => typeof x === 'string') : [])], originalFp);
  const web = !!d?.tech?.web;
  const tgt = chooseTarget({ target, kind: theKind, originalFp, perspective: persp, platforms: d?.identity?.platforms ?? [], web });
  const origKey = originalFp && FOOTPRINTS[originalFp]?.engineId;
  const conv = k => { const e = ENGINES[k]; return e ? `${e.axes.up} up, ${e.axes.forward} forward, ${e.handedness}-handed, ${e.units}, physics ${e.physicsTick}, FOV ${e.fov}` : null; };
  if (tgt.engine) {
    tgt.conventions = conv(tgt.target);
    if (origKey && origKey !== tgt.target && ENGINES[origKey]) tgt.note = `Original (${ENGINES[origKey].name}) and target differ: convert every measured position/rotation/FOV with port_convert {from:"${origKey}", to:"${tgt.target}"}; physics ${ENGINES[origKey].physicsTick} vs ${ENGINES[tgt.target].physicsTick}.`;
  }

  const core = KNOWLEDGE.core[theKind] ?? KNOWLEDGE.core.game;
  const fromArch = matched.flatMap(m => KNOWLEDGE.archetypes.find(a => a.id === m.id).systems.map(s => ({ ...s, archetype: m.id })));
  const extra = platformFeatures(d?.identity?.categories ?? allTags, d?.tech?.app ? d?.identity?.categories ?? [] : []);
  const seen = new Set();
  const systems = [...fromArch, ...core.map(s => ({ ...s, archetype: 'core' })), ...extra.map(s => ({ ...s, archetype: 'platform' }))].filter(s => !seen.has(s.id) && seen.add(s.id));

  const slug = kebabCase(title).slice(0, 40) || 'rebuild';
  const workingTitle = `${title.replace(/[™®©]/g, '').trim()} Rebuild`;
  const milestones = [
    { name: 'Reference capture', done: 'recordings and screenshots of the original exist; the feel parameters of the first two systems are measured in parity.json' },
    { name: 'Graybox vertical slice', done: `${systems[0]?.name ?? 'the core system'}, camera and input work in one level/screen with placeholder shapes, and their parameters pass parity` },
    { name: 'All systems', done: 'every system in this blueprint works with placeholder content; every numeric parameter is filled' },
    { name: 'Own content', done: 'own art, audio, text and levels/screens replace the placeholders (nothing taken from the original)' },
    { name: 'UI and feedback parity', done: 'every screen matches the layout fractions; sounds fire on the same events' },
    { name: 'Side-by-side verification', done: 'all parity.json parameters within tolerance; blind test remarks resolved' },
  ];
  const references = [...(d?.references?.pages ?? []).map(p => `${p.title}: ${p.url}`), ...(d?.references?.videos ?? []).slice(0, 4).map(v => `Video: ${v}`), ...(d?.references?.screenshots ?? []).slice(0, 6).map(s => `Screenshot: ${s}`)];
  const openSource = (d?.openSource ?? []).filter(o => o.kind !== 'related').slice(0, 8);
  const bp = {
    name: title, workingTitle, kind: theKind, perspective: persp, lookupId: lookupId ?? null,
    archetypes: matched, original: { engine: origEngine?.name ?? null, version: origEngine?.version ?? null, confidence: origEngine?.confidence ?? null, footprint: originalFp, conventions: origKey ? conv(origKey) : null },
    target: tgt, systems: systems.map(({ id, name: n, build, measure, archetype }) => ({ id, name: n, archetype, build, measure })),
    milestones, references, openSource, cleanRoom: KNOWLEDGE.cleanRoom, method: KNOWLEDGE.method,
  };

  // Files: BLUEPRINT.md, parity.json and (for engine targets) a project skeleton with every parameter as a tunable.
  const dir = path.join(await workspaceDir('blueprints'), slug);
  await fsp.mkdir(dir, { recursive: true });
  const parity = { name: title, target: tgt.target, tolerance: { default: '5%', frames: 1 }, parameters: bp.systems.flatMap(s => s.measure.map(m => ({ system: s.id, param: m.param, unit: m.unit, how: m.how, numeric: isNum(m), original: null, rebuild: null, tolerance: isNum(m) ? '5%' : null, status: 'todo' }))) };
  await fsp.writeFile(path.join(dir, 'BLUEPRINT.md'), markdown(bp));
  await writeJson(path.join(dir, 'parity.json'), parity);
  const written = ['BLUEPRINT.md', 'parity.json'].map(f => path.join(dir, f));
  let projectDir = null;
  if (wantScaffold && tgt.engine) {
    const busy = async p => { const st = await statOrNull(p); return !!st && (!st.isDirectory() || (await fsp.readdir(p)).length > 0); };
    if (output) {
      projectDir = path.resolve(output);
      if (await busy(projectDir)) throw new RPError('OUTPUT_NOT_EMPTY', `Output folder must be new or empty: ${projectDir}`);
    } else {
      projectDir = path.join(dir, `project-${tgt.target}`);
      for (let n = 2; await busy(projectDir); n++) projectDir = path.join(dir, `project-${tgt.target}-${n}`);
    }
    const files = { ...scaffold(tgt.target, { name: workingTitle }), ...stubFiles(tgt.target, bp.systems, workingTitle) };
    for (const [rel, content] of Object.entries(files)) {
      const abs = path.resolve(projectDir, rel);
      if (!isInside(abs, projectDir)) continue;
      await fsp.mkdir(path.dirname(abs), { recursive: true });
      await fsp.writeFile(abs, content);
      written.push(abs);
    }
    await fsp.copyFile(path.join(dir, 'BLUEPRINT.md'), path.join(projectDir, 'BLUEPRINT.md'));
    await fsp.copyFile(path.join(dir, 'parity.json'), path.join(projectDir, 'parity.json'));
  }
  return {
    ...bp, method: undefined, cleanRoom: { never: KNOWLEDGE.cleanRoom.never, note: KNOWLEDGE.cleanRoom.note },
    parameters: parity.parameters.length, files: { blueprint: path.join(dir, 'BLUEPRINT.md'), parity: path.join(dir, 'parity.json'), project: projectDir, written: written.length },
    next: [
      'Capture the original (BLUEPRINT.md → Capture) and fill parity.json "original" values',
      projectDir ? `Open ${projectDir} in ${tgt.name}; the systems/ stubs hold every numeric parameter as a tunable` : `Set up a ${tgt.name} project; mirror the systems list as modules`,
      ...(openSource.length ? ['Open-source work exists (openSource): check licenses; re_lookup {github, mirror:true} + port_plan if you may reuse it'] : []),
      ...(tgt.note ? ['port_convert for every measured transform/FOV (engines differ)'] : []),
      'Measure the rebuild the same way, fill "rebuild", and keep going until every parameter is within tolerance',
    ],
  };
}

export const ARCHETYPE_IDS = KNOWLEDGE.archetypes.map(a => a.id);
