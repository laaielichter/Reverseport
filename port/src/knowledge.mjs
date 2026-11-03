// Porting knowledge: engine conventions and API maps (knowledge/maps/*.json) plus helpers that find
// which mapped APIs a source file uses and which source-engine leftovers remain in ported code.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RPError } from './util.mjs';
import { closest } from './agent.mjs';
import { physicsProfile } from './physics.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'knowledge');
export const ENGINES = JSON.parse(fs.readFileSync(path.join(ROOT, 'engines.json'), 'utf8'));
const MAPS = new Map();
for (const f of fs.readdirSync(path.join(ROOT, 'maps')).filter(f => f.endsWith('.json')).sort()) {
  const m = JSON.parse(fs.readFileSync(path.join(ROOT, 'maps', f), 'utf8'));
  for (const e of m.entries) {
    if (e.pattern) e.re = new RegExp(e.pattern, 'gm');
    if (e.leftover) e.leftoverRe = new RegExp(e.leftover, 'gm');
  }
  MAPS.set(`${m.from}->${m.to}`, m);
}

const ALIASES = {
  gdscript: 'godot', 'godot4': 'godot', 'godot 4': 'godot', 'godot-gdscript': 'godot',
  'godot-c#': 'godot-csharp', 'godot-cs': 'godot-csharp', 'godot.net': 'godot-csharp', 'godot-net': 'godot-csharp', 'godot-dotnet': 'godot-csharp',
  three: 'threejs', 'three.js': 'threejs', web: 'threejs', browser: 'threejs', webgl: 'threejs',
  ue: 'unreal', ue5: 'unreal', ue4: 'unreal', unreal5: 'unreal', unreal4: 'unreal', 'unreal 5': 'unreal', 'unreal engine': 'unreal', 'unreal-engine': 'unreal', 'unreal engine 5': 'unreal',
  godot3: 'godot', 'godot 3': 'godot', threejs: 'threejs', 'unity 6': 'unity', unity6: 'unity',
  'unity3d': 'unity', 'unity-csharp': 'unity',
};
export const normEngine = e => { const k = String(e ?? '').trim().toLowerCase(); return ALIASES[k] ?? k; };
export const mapPairs = () => [...MAPS.keys()];
export function mapFor(from, to) { return MAPS.get(`${normEngine(from)}->${normEngine(to)}`) ?? null; }

export function portMapTool({ from, to, query, topic } = {}) {
  if (!from && !to) return { engines: Object.fromEntries(Object.entries(ENGINES).map(([k, v]) => [k, v.name])), maps: mapPairs().map(p => { const m = MAPS.get(p); return { pair: p, title: m.title, entries: m.entries.length }; }), hint: 'Give from and to (e.g. {from:"godot", to:"unity"}) for the full map; query filters entries.' };
  const a = normEngine(from), b = normEngine(to);
  const map = mapFor(a, b);
  if (!map) {
    for (const [given, id] of [[from, a], [to, b]]) {
      if (ENGINES[id] || !given) continue;
      const near = closest(id, Object.keys(ENGINES), 3);
      if (near && (ENGINES[a] || ENGINES[b] || near)) throw new RPError('INVALID_ARGUMENT', `Unknown engine "${given}" — did you mean "${near}"? Engines: ${Object.keys(ENGINES).join(', ')}; anything else is treated as a language.`);
    }
    if (!ENGINES[a] && !ENGINES[b]) return { from: a, to: b, note: 'No engine map for this pair: treat it as a language/framework port. Plan with port_plan; the unit checklist covers structure, idioms and parity.', available: mapPairs() };
    return { from: a, to: b, fromConventions: ENGINES[a] ?? null, toConventions: ENGINES[b] ?? null, note: 'No curated API map for this pair yet; conventions of both sides are given. Available maps: ' + mapPairs().join(', ') };
  }
  const q = query ? String(query).toLowerCase() : null;
  const entries = map.entries.filter(e => (!topic || e.topic === topic) && (!q || `${e.id} ${e.topic} ${e.from} ${e.to} ${e.notes ?? ''}`.toLowerCase().includes(q))).map(({ re, leftoverRe, pattern, leftover, ...e }) => e);
  let physics = null; try { const p = physicsProfile({ from: a, to: b }); physics = { differences: p.differences, from: p.profiles.from, to: p.profiles.to, hint: 'port_convert {from, to, physics:{gravity, fixedStep, linearDamp, friction, bounce, jumpVelocity, layers}} converts the actual numbers.' }; } catch { /* no profile for this pair */ }
  return { title: map.title, from: a, to: b, fromEngine: ENGINES[a] ?? null, toEngine: ENGINES[b] ?? null, conventions: map.conventions, topics: [...new Set(map.entries.map(e => e.topic))], entries, ...(physics && !q && !topic ? { physics } : {}), ...(!q && !topic ? { hint: 'This is the whole map; query or topic narrows it (e.g. {query:"signal"}). port_unit already lists the entries a file uses.' } : {}) };
}

/** Which mapped APIs does this source text use? */
export function apiHits(text, from, to) {
  const map = mapFor(from, to);
  if (!map) return [];
  const lineOf = idx => text.slice(0, idx).split('\n').length;
  const hits = [];
  for (const e of map.entries) {
    if (!e.re) continue;
    e.re.lastIndex = 0;
    const at = [];
    let m;
    while ((m = e.re.exec(text)) && at.length < 50) { at.push(lineOf(m.index)); if (m[0] === '') e.re.lastIndex++; }
    if (at.length) hits.push({ id: e.id, topic: e.topic, from: e.from, to: e.to, ...(e.notes ? { notes: e.notes } : {}), count: at.length, lines: [...new Set(at)].slice(0, 12) });
  }
  return hits;
}

/** Source-engine API patterns that should not survive in the ported file. */
export function leftovers(text, from, to) {
  const map = mapFor(from, to);
  if (!map) return [];
  const out = [];
  for (const e of map.entries) {
    if (!e.leftoverRe) continue;
    e.leftoverRe.lastIndex = 0;
    const n = (text.match(e.leftoverRe) ?? []).length;
    if (n) out.push({ id: e.id, pattern: e.leftover, count: n, use: e.to });
  }
  return out;
}

/** Lifecycle names that legitimately change across engines (for symbol-parity checks). */
export const LIFECYCLE_EQUIV = [
  ['_ready', '_enter_tree', 'Awake', 'Start', 'BeginPlay', 'OnEnable', 'constructor', 'init', '_Ready', '_EnterTree'],
  ['_process', 'Update', 'Tick', 'LateUpdate', 'update', '_Process'],
  ['_physics_process', 'FixedUpdate', 'Tick', 'fixedUpdate', '_PhysicsProcess', 'physicsUpdate'],
  ['_input', '_unhandled_input', 'OnInput', 'SetupPlayerInputComponent', 'onKeyDown', '_Input', '_UnhandledInput'],
  ['_exit_tree', 'OnDestroy', 'OnDisable', 'EndPlay', 'dispose', 'destroy', '_ExitTree'],
  ['OnTriggerEnter', 'body_entered', '_on_body_entered', 'OnOverlapBegin', 'NotifyActorBeginOverlap', 'onTriggerEnter'],
];
