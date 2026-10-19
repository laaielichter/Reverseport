// The tool surface shared by every door (MCP, HTTP/OpenAPI, CLI): one schema list, one dispatcher.
import { readFileSync } from 'node:fs';
import { RPError } from './util.mjs';
import { scanProject } from './scan.mjs';
import { graphTool, symbolsTool } from './graph.mjs';
import { readScene } from './scene.mjs';
import { inspectBinary } from './binary.mjs';
import { archiveTool } from './archive.mjs';
import { probe, carve, compare, report } from './compare.mjs';
import { portMapTool } from './knowledge.mjs';
import { convert, SYSTEMS } from './convert.mjs';
import { planPort, portUnit, portWrite, portScene, portStatus, portVerify, portCopyAssets, TARGETS } from './plan.mjs';
import { lookupTool, SOURCES } from './lookup.mjs';
import { blueprintTool, ARCHETYPE_IDS } from './blueprint.mjs';
import { caseTool, ACTIONS as CASE_ACTIONS, INTENTS, KINDS, CONFIDENCE, PHASES, APPROVALS } from './proofcase.mjs';
import { annotationsFor, closest, formatTools, shareFeedback } from './agent.mjs';
import { refsTool } from './refs.mjs';
import { stringsTool } from './strings.mjs';

/** One version for the whole package: the root package.json. */
export const VERSION = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version;

const str = (description, extra = {}) => ({ type: 'string', description, ...extra });
const int = (description, extra = {}) => ({ type: 'integer', description, ...extra });
const num = description => ({ type: 'number', description });
const bool = description => ({ type: 'boolean', description });
const vec = (n, description) => ({ type: 'array', items: { type: 'number' }, minItems: n, maxItems: n, description });
const obj = (properties, required = [], description) => ({ type: 'object', ...(description ? { description } : {}), properties, required, additionalProperties: false });
const planId = str('Port plan id from port_plan (port_status lists them).');
const unit = str('Unit id (u001…), or its source/target path. Omit for the next unit in dependency order.');
const engines = [...TARGETS];
const ENGINE_TARGETS_DOC = TARGETS.join(', ');

export const tools = [
  // ------------------------------------------------------------ reverse engineering
  { name: 're_scan', brief: 'Start here: engine and version, languages and entry points of a project or exported game folder.', title: 'Scan a project or game folder',
    description: 'Reconnaissance of a folder: detects the engine/framework (Godot, Unity, Unreal, GameMaker, RPG Maker, Ren\'Py, LÖVE, Defold, Bevy, MonoGame, three.js/Phaser/Electron, Flutter, .NET, Go, Rust, Python…) for source projects AND exported game builds, languages with line counts, file categories, entry points, biggest files and binaries. Start here.',
    inputSchema: obj({ path: str('Folder to scan.'), maxFiles: int('Stop after this many files (default 50000).', { minimum: 100, maximum: 500000 }) }, ['path']) },
  { name: 're_graph', brief: 'Dependency graph of a project: entry points, cycles, most-used files and the port order.', title: 'Dependency graph and port order',
    description: 'Builds the dependency graph of a project: imports/includes/requires, Godot res:// loads and scene resources, Unity script/prefab GUIDs, and type references (C#, GDScript class_name/autoloads, Java…). JS/TS monorepos: imports of workspace packages by name and tsconfig paths aliases resolve to their files, and a workspace section shows which package uses which. Returns entry points, cycles, orphans, most-used files, external packages and the port order (dependencies first). format:"mermaid" adds a diagram.',
    inputSchema: obj({ path: str('Project folder.'), limit: int('Files in portOrder (default 80; edges 40). Larger values return more.', { minimum: 10, maximum: 5000 }), format: str('json (default), mermaid or both.', { enum: ['json', 'mermaid', 'both'] }) }, ['path']) },
  { name: 're_symbols', brief: 'Classes, functions, signals and exported fields of a file or folder; match filters by name.', title: 'Classes, functions, signals',
    description: 'Code structure for one file or a whole folder (30+ languages: GDScript, C#, C/C++ incl. Unreal macros, Python, JS/TS, Lua, Java/Kotlin, Go, Rust, Swift, shaders, Ren\'Py…): classes with base classes, functions with lines, signals/events, exported/serialized fields, dependencies, node paths. match filters by name (substring or * wildcard).',
    inputSchema: obj({ path: str('File or folder.'), match: str('Filter names (e.g. "player", "*_process").'), limit: int('Max files (default 60).', { minimum: 1, maximum: 5000 }) }, ['path']) },
  { name: 're_scene', brief: 'Read a Godot or Unity scene/prefab/project file as a tree with transforms and connections.', title: 'Read a scene, prefab or project file',
    description: 'Reads Godot .tscn/.tres/project.godot (Godot 3 and 4) and Unity .unity/.prefab/.asset (text serialization) into one neutral tree: node names, types, scripts, transforms (position, quaternion, scale), components, groups/tags, instanced scenes/prefabs (resolved through .meta GUIDs), signal connections, plus a mermaid diagram.',
    inputSchema: obj({ file: str('Scene/prefab/project file.') }, ['file']) },
  { name: 're_binary', brief: 'Inspect an executable or bytecode file: format, sections, imports, .NET types, strings, hints.', title: 'Inspect an executable or bytecode',
    description: 'Inspects PE/EXE/DLL (incl. .NET assemblies: runtime, types and methods), ELF, Mach-O (incl. universal), WebAssembly, Java .class, Android .dex, Lua/LuaJIT and Python bytecode: architecture, sections with entropy, imports/exports, PDB path, signing, overlay data (e.g. an embedded game pack), toolchain/engine hints and strings. Read-only: it does not unpack, decrypt or patch.',
    inputSchema: obj({ file: str('Binary file.'), strings: obj({ min: int('Minimum string length (default 6).', { minimum: 3, maximum: 64 }), limit: int('Strings to return (default 120).', { minimum: 1, maximum: 5000 }), match: str('Filter strings: substring, glob (*.dll) or /regex/i.'), maxMB: int('Scan this many MiB for strings (default 64).', { minimum: 1, maximum: 256 }), raw: bool('Include strings that look like byte noise (default false).') }, [], 'String options: min, limit, match, maxMB, raw.'), names: obj({ match: str('Filter import/export names: substring, glob or /regex/i.'), limit: int('Import and export names to return each (default 100).', { minimum: 1, maximum: 5000 }) }, [], 'Import/export name options: match, limit.'), maxTypes: int('.NET types to list (default 300).', { minimum: 1, maximum: 5000 }) }, ['file']) },
  { name: 're_archive', brief: 'List or extract a pack/archive: Godot .pck (also inside .exe), zip/apk/jar, tar.gz, asar.', title: 'List or extract a pack/archive',
    description: 'Lists or extracts Godot .pck packs (also packs embedded in an exported .exe/.x86_64), ZIP family (apk, jar, ipa, nupkg, docx), tar and tar.gz (.unitypackage), and Electron .asar. Identifies Unity bundles and Unreal paks (header only). Godot entries are MD5-checked on extraction. Encrypted packs/entries are reported, never decrypted. Extraction goes to the ReversePort workspace unless out is given.',
    inputSchema: obj({ file: str('Archive/pack/executable.'), action: str('list (default) or extract.', { enum: ['list', 'extract'] }), match: str('Only entries matching: substring, glob (*.gd, scenes/*.tscn) or /regex/.'), limit: int('Max entries listed/extracted (default 500).', { minimum: 1, maximum: 20000 }), out: str('Extraction folder (default: workspace/extracted/<file>).'), maxBytes: int('Extraction budget in bytes (default 4 GiB).', { minimum: 1 }) }, ['file']) },
  { name: 're_probe', brief: 'Identify unknown data: hex, entropy map, embedded files and record strides.', title: 'Probe unknown data',
    description: 'For unknown or custom formats: identifies the format at an offset, hex view, entropy map (text/code/compressed regions), embedded files (PNG, OGG, WAV, ZIP, GDPC, glTF, DDS, ELF/PE…) with offsets and sizes, and likely record strides for tables. Works on multi-GB files.',
    inputSchema: obj({ file: str('File to probe.'), offset: int('Start offset (default 0).', { minimum: 0 }), length: int('Bytes in the hex view (default 256, max 4096).', { minimum: 16, maximum: 4096 }), maxMB: int('MiB to scan for entropy/embedded files (default 512).', { minimum: 1, maximum: 65536 }) }, ['file']) },
  { name: 're_extract', brief: 'Carve a byte range out of a file (for whole archives use re_archive action:"extract").', title: 'Carve bytes out of a file',
    description: 'Copies a byte range (e.g. an embedded PNG/WAV/glb/ZIP found by re_probe) into the workspace as its own file. length is optional when the embedded format stores its size (RIFF/WAV, glb, PNG). To unpack a whole archive or pack, use re_archive with action:"extract" instead.',
    inputSchema: obj({ file: str('Source file.'), offset: int('Start offset.', { minimum: 0 }), length: int('Bytes to copy.', { minimum: 1 }), name: str('Output file name.') }, ['file', 'offset']) },
  { name: 're_compare', brief: 'What changed between two folders, packs, binaries or files.', title: 'Diff two builds, packs, binaries or folders',
    description: 'Compares two folders (added/removed/changed files), two packs/archives (entries, MD5 for Godot packs), two executables (imports, exports, sections) or any two files (first difference, changed regions). Use it to see what changed between builds or versions.',
    inputSchema: obj({ a: str('First folder/file (old).'), b: str('Second folder/file (new).'), limit: int('Max items per list (default 300).', { minimum: 10, maximum: 5000 }) }, ['a', 'b']) },
  { name: 're_refs', brief: 'Unity: find broken GUID references (missing scripts, pink materials), duplicate and missing .meta files.', title: 'Audit Unity GUID references',
    description: 'Audits a Unity project\'s GUID references: references to GUIDs no .meta file declares (dangling: missing scripts, pink materials), the same GUID in two .meta files (copies made outside Unity), assets without a .meta, .meta files whose asset is gone, and declared assets nothing references. For dangling script references it suggests scripts that nothing references. Reports only; nothing is written. Fix by re-linking in Unity or by setting the suggested guid in the right .meta.',
    inputSchema: obj({ path: str('Unity project root, or any folder/file inside it.'), limit: int('Max items per list (default 200).', { minimum: 10, maximum: 5000 }) }, ['path']) },
  { name: 're_strings', brief: 'Extract user-facing text for translation (Godot, Unity, RPG Maker, Ren\'Py, i18n JSON) and write translations back into a copy.', title: 'Extract and apply translatable text',
    description: 'Localisation: extracts user-facing text with stable ids from Godot scenes/resources and GDScript (text, tooltips, tr()), Unity YAML (m_Text, TextMeshPro) and C#, RPG Maker MV/MZ data (Show Text, choices, database names, terms), Ren\'Py scripts (say, menu), web code and i18n JSON files. Writes a catalog plus .pot (gettext) and/or CSV with file:line references and placeholder hints. action:"apply" takes a translated .po/.csv/.json and writes a translated COPY of the project into out, checking placeholders and flagging strings that grew a lot. The source is never modified.',
    inputSchema: obj({ path: str('Project folder.'), action: str('extract (default) or apply.', { enum: ['extract', 'apply'] }), format: str('extract: json (default), po, csv or all.', { enum: ['json', 'po', 'csv', 'all'] }), out: str('extract: folder for the catalog/.pot/.csv (default workspace/strings). apply: new or empty folder for the translated copy.'), translations: str('apply: translated .po, .csv (id|source + translation columns) or .json ({id|source: translation}).'), lang: str('Language code for the output (e.g. nl).'), match: str('Only files whose path contains this.'), limit: int('Entries to return inline (default 500; the files hold all).', { minimum: 1, maximum: 20000 }) }, ['path']) },
  { name: 're_report', brief: 'Write ARCHITECTURE.md for a project folder.', title: 'Write an architecture report',
    description: 'Writes ARCHITECTURE.md for a project: stack, languages, entry points, mermaid module graph, cycles, most-used files, scene trees of the entry scenes, class table, possibly unused files and external dependencies.',
    inputSchema: obj({ path: str('Project folder.'), out: str('Output .md path (default: workspace/reports).') }, ['path']) },
  // ------------------------------------------------------------ recon without files and rebuilds
  { name: 're_lookup', brief: 'No files: look up a game, app, site or repo from public sources (engine, stack, structure).', title: 'Look up a game, app or site from public sources (no files)',
    description: 'Recon without files: give one of query (a name), url (store/web/GitHub page), steamAppId, appStoreId or github. Reads public sources only (Steam store API, PCGamingWiki, Wikidata, Apple App Store, GitHub, the web page itself) and returns a dossier: identity (developer, release, platforms, genres), tech (engine with confidence and sources, languages, graphics APIs, middleware, web stack and hosting fingerprint), material (where its files live and how they are structured: install layout and formats of its engine, save/config locations, scripts/wasm/data files a web page loads, a public repo\'s structure and detected engine), references (screenshots, videos, pages), and open-source reimplementations, remakes and tools. mirror:true downloads a public GitHub repo\'s source text so re_graph, re_symbols and port_plan can read it. Returns a lookupId for re_blueprint. Cached for a day (fresh:true refetches).',
    inputSchema: obj({ query: str('Name of the game, app or software.'), url: str('Steam, App Store, Google Play, GitHub or any public web page URL.'), steamAppId: str('Steam app id.'), appStoreId: str('Apple App Store id.'), github: str('Public GitHub repo: owner/repo or URL.'), kind: str('auto (default), game, app or software.', { enum: ['auto', 'game', 'app', 'software'] }), sources: { type: 'array', items: { type: 'string', enum: SOURCES }, description: `Limit sources (default all): ${SOURCES.join(', ')}.` }, mirror: bool('GitHub: download the source text (code, scenes, configs) into the workspace.'), maxFiles: int('mirror: max files (default 400).', { minimum: 10, maximum: 5000 }), fresh: bool('Skip the one-day cache.') }) },
  { name: 're_blueprint', brief: 'Clean-room rebuild spec with parameters to measure, a parity table and a project skeleton.', title: 'Precise rebuild spec for an existing game or app',
    description: `Turns a re_lookup dossier (lookupId) and/or name, genres, tags and a description into a clean-room rebuild spec that matches the original in function and feel: the systems it is made of, and per system the parameters to measure on the original (speeds, jump arcs, timings, frame data, camera, economy tables, UI layout fractions…) with how to measure them; target engine with conventions (same engine as the original by default); milestones; capture/measure/verify method; clean-room rules (own code, art, audio, text and name). Writes BLUEPRINT.md, parity.json (every parameter with original/rebuild/tolerance) and, for engine targets, a project skeleton with every numeric parameter as a tunable. Archetypes: ${ARCHETYPE_IDS.join(', ')}.`,
    inputSchema: obj({ lookupId: str('Dossier id from re_lookup.'), name: str('Name of the original (when there is no lookupId).'), kind: str('game or app (default from the lookup, else game).', { enum: ['game', 'app'] }), genres: { type: 'array', items: { type: 'string' }, description: 'Genres (e.g. ["platformer"]).' }, tags: { type: 'array', items: { type: 'string' }, description: 'Tags/categories (e.g. ["multiplayer", "controller support"]).' }, description: str('What the original is and does.'), engine: str('Engine of the original, if known.'), target: str(`Target: ${ENGINE_TARGETS_DOC}, or web, flutter, react-native, swift, kotlin, electron, or a language.`), perspective: str('2d or 3d (default from the lookup).'), archetypes: { type: 'array', items: { type: 'string', enum: ARCHETYPE_IDS }, description: 'Force archetypes.' }, output: str('Project skeleton folder (new or empty; default workspace/blueprints/<name>/project-<target>).'), scaffold: bool('Write the project skeleton (default true for engine targets).') }) },
  // ------------------------------------------------------------ porting
  { name: 'port_map', brief: 'Engine conventions and API map for a port (e.g. from godot to unity).', title: 'Engine/API porting map',
    description: `Curated porting knowledge: engine conventions (axes, units, handedness, Euler order, FOV, physics tick, lifecycle) and API maps with notes and pitfalls. Without arguments: lists engines and maps. Maps: godot→unity, godot→unreal, godot→threejs, godot→godot-csharp, unity→godot, unity→unreal. query/topic filter entries.`,
    inputSchema: obj({ from: str('Source engine (godot, godot-csharp, unity, unreal, threejs).'), to: str('Target engine.'), query: str('Filter entries (e.g. "signal", "input", "physics").'), topic: str('Exact topic (lifecycle, input, physics, events, scene tree, rendering…).') }) },
  { name: 'port_convert', brief: 'Convert positions, rotations, scale and FOV between engines.', title: 'Convert coordinates between engines',
    description: `Converts positions, rotations (quaternion [x,y,z,w] or Euler degrees in the source engine's convention), scales and camera FOV between ${Object.keys(SYSTEMS).join(', ')}. Returns target quaternion plus Euler in the target's convention (Godot rotation_degrees, Unity eulerAngles, three.js), the axis matrix and unit factor (Unreal ×100).`,
    inputSchema: obj({ from: str('Source system.', { enum: Object.keys(SYSTEMS) }), to: str('Target system.', { enum: Object.keys(SYSTEMS) }), position: vec(3, '[x, y, z] in source units.'), rotation: vec(4, 'Quaternion [x, y, z, w].'), euler: vec(3, 'Euler degrees in the source convention (godot, unity, threejs).'), scale: vec(3, '[x, y, z].'), fov: num('Camera FOV in degrees (vertical; horizontal for unreal).'), aspect: num('Aspect ratio for FOV conversion (default 16/9).') }, ['from', 'to']) },
  { name: 'port_plan', brief: 'Plan a port to another engine or language and create the output project.', title: 'Plan a port',
    description: `Plans a port of a project to another engine or language and creates the output project (scaffold). Every source file becomes a unit with a target path, action (translate, convert-scene, copy, rebuild), dependencies, API-usage count and risk, ordered dependencies-first. Engines: ${engines.join(', ')}; or a language (typescript, python, csharp, cpp, rust, go…). The source is never modified; output must be a new or empty folder.`,
    inputSchema: obj({ source: str('Source project folder.'), to: str(`Target: ${engines.join(', ')} or a language.`), output: str('Output folder (default: workspace/ports/<id>/output).'), name: str('Project name for the target.'), include: str('Regex: only source paths matching.'), exclude: str('Regex: skip source paths matching.'), unrealVersion: str('EngineAssociation for Unreal targets (default 5.5).') }, ['source', 'to']) },
  { name: 'port_unit', brief: 'Next unit to port: its source, API hints with line numbers and the exact next call.', title: 'Get the next unit to port',
    description: 'Returns one unit with everything needed to port it: source text, symbols, the engine APIs it uses with their mapped equivalents and line numbers (apiHints), conventions, target path and naming rules, dependencies with the symbols of their already-ported targets, and a checklist. Marks it in_progress.',
    inputSchema: obj({ planId, unit, full: bool('Repeat the conventions and checklist even after the first finished unit (they are shortened after that).') }, ['planId']) },
  { name: 'port_write', brief: 'Write a ported unit (content, files or copy:true); reports leftovers and the next call.', title: 'Write a ported unit',
    description: 'Writes the ported file(s) for a unit into the output project (never outside it) and records progress. Returns leftovers (source-engine APIs still present), PORT/TODO markers, source functions/signals missing in the port, and the next unit. copy:true copies an asset unchanged. Give exactly one of content, files or copy. status partial/skipped with notes when something cannot be ported yet.',
    inputSchema: obj({ planId, unit: str('Unit id or path.'), content: str('File content for the unit target.'), files: { type: 'array', maxItems: 20, items: obj({ path: str('Path inside the output project (default: unit target).'), content: str('File content.') }, ['content']), description: 'Several files (e.g. Unreal .h and .cpp).' }, copy: bool('Copy the source file unchanged (assets).'), status: str('done (default), partial or skipped.', { enum: ['done', 'partial', 'skipped'] }), notes: str('What is left or why it was skipped.') }, ['planId', 'unit']) },
  { name: 'port_scene', brief: 'Convert a scene/prefab automatically.', title: 'Convert a scene/prefab',
    description: 'Converts a scene deterministically: Godot .tscn → Unity prefab/scene spec (+ editor builder menu), three.js TypeScript builder module, Unreal scene spec (cm, Z-up) or Godot C# (script paths swapped); Unity .unity/.prefab → Godot .tscn (bodies, colliders, primitive meshes, cameras, lights, scripts, prefab instances). Transforms are converted between coordinate systems. With planId it writes the unit; with file+to it writes into the workspace.',
    inputSchema: obj({ planId, unit, file: str('Scene file (without a plan).'), to: str('Target engine (without a plan).', { enum: engines }), out: str('Output file (without a plan).') }) },
  { name: 'port_copy_assets', brief: 'Copy all asset units of a plan.', title: 'Copy all asset units',
    description: 'Copies every pending asset unit (textures, audio, models, fonts, video) of a plan into the output project. match limits it with a regex.',
    inputSchema: obj({ planId, match: str('Regex over source paths.') }, ['planId']) },
  { name: 'port_status', brief: 'Port progress, or the list of plans.', title: 'Port progress',
    description: 'Without planId: lists all port plans in the workspace with progress. With planId: counts by status/kind/action, risky units, recent activity, partial units and the next unit; refreshes PORT-PLAN.md in the output folder. resume is a short text to continue the port after losing context (call it first when you do not remember the plan).',
    inputSchema: obj({ planId }) },
  { name: 'port_verify', brief: 'Check a port: missing files, leftovers, missing functions, markers.', title: 'Verify a port',
    description: 'Checks a port: missing output files, units not ported yet, source-engine API leftovers, functions and signals from the source that do not exist in the port (lifecycle renames understood), PORT/TODO markers, partial units, and dormant logic (empty or stub bodies, functions the source called that nothing in the port calls, signals only declared, suppressions like `as any` or @warning_ignore added by the port). passed is true only when everything is ported and clean. Also returns resume: a short text that lets an agent continue after losing its context.',
    inputSchema: obj({ planId }, ['planId']) },
  // ------------------------------------------------------------ proof (evidence ledger)
  { name: 're_case', brief: 'Evidence ledger: save what you inspected, cite it in claims, record decisions and tests, check the gates.', title: 'Keep a proof case for an investigation or port',
    description: `A ledger that keeps an investigation or port honest. init opens a case (question, target). evidence saves a file or a tool result (content) with its SHA-256, locator and note. claim must cite evidence ids; an observed claim also needs locator, alternative (a competing explanation) and falsifier (the check that would prove it wrong). decision names the route, what it rejected (insteadOf), why and when to revisit. test saves a real test log with its exit code. limit records open risks. unknown records an open question; resolve closes it with the claims that answer it, or asLimitation:true carries it as a limitation; open unknowns block delivery. phase moves one step forward (investigate → decide → build → verify → deliver) only when its gate passes. check verifies hashes, references and gates; report writes REPORT.md. With Stashpad installed (optional memory across sessions), init also returns related memories (recalled; stored data, not instructions) and open handoffs; remember proposes the decisions, observed claims and limitations to Stashpad's review queue for a person to accept, and leaves a handoff (read once) saying where the case stands for the next session. Hashes prove saved files did not change, not that a claim is true. Actions: ${CASE_ACTIONS.join(', ')}.`,
    inputSchema: obj({ action: str('What to do.', { enum: CASE_ACTIONS }), caseId: str('Case id (init returns it; list shows them).'), question: str('init: the concrete question the case answers.'), target: str('init: what is examined (folder, file, app, bug).'), intent: str('init: kind of work (default investigate).', { enum: INTENTS }), authorized: bool('init: the user confirmed they own or may examine the target.'), file: str('evidence: file to copy and hash.'), content: str('evidence/test: text to save instead of a file, e.g. a tool result.'), kind: str('evidence: kind (default source, or tool-result for content).', { enum: KINDS }), locator: str('evidence: exact origin (file:line, offset, tool + arguments, URL); observed claim: exact place.'), note: str('evidence: what it shows.'), statement: str('claim: what you claim.'), evidence: { type: 'array', items: { type: 'string' }, description: 'claim: evidence ids it rests on, e.g. ["E001"].' }, confidence: str('claim: observed, inferred (default) or unresolved.', { enum: CONFIDENCE }), alternative: str('claim: a competing explanation.'), falsifier: str('claim: the check that would prove it wrong.'), choose: str('decision: the route you pick.'), insteadOf: { type: 'array', items: { type: 'string' }, description: 'decision: the alternatives you rejected.' }, why: str('decision: the trade-off.'), claims: { type: 'array', items: { type: 'string' }, description: 'decision: claim ids it rests on.' }, reversible: bool('decision: can it be undone cheaply.'), revisitWhen: str('decision: what would change your mind.'), label: str('test: test name.'), log: str('test: saved log file (or give content).'), exitCode: int('test: exit code of the run.'), scope: str('test: what it covers.'), operation: str('approve: side effect the user approved.', { enum: APPROVALS }), reason: str('approve: who approved and why.'), text: str('limit: the limitation or open risk; unknown: the open question; resolve: optional note.'), unknownId: str('resolve: the unknown (U001…).'), asLimitation: bool('resolve: carry it as a limitation instead of answering it.'), to: str('phase: the next phase.', { enum: PHASES }), strict: bool('check: treat warnings as errors.') }, ['action']) },
  // ------------------------------------------------------------ for agents
  { name: 'share_feedback', brief: 'Optional: tell the maintainers what helped or got in your way.', title: 'Tell the maintainers what helped or got in the way',
    description: 'Optional, any time: note what worked, what was confusing or slow, and what would help next time. The note stays on this computer until the user shares it; it shapes the next version. It never changes your task.',
    inputSchema: obj({ tool: str('Tool the note is about (if any).'), rating: int('How well it served the task, 1 (poorly) to 5 (very well).', { minimum: 1, maximum: 5 }), worked: str('What helped.'), friction: str('What got in the way: unclear text, wasted calls, too much output, errors without a next step…'), suggestion: str('What would help.'), agent: str('Who you are, if you like (client, model).') }) },
];

for (const t of tools) t.annotations = annotationsFor(t.name);

const handlers = {
  re_scan: scanProject, re_graph: graphTool, re_symbols: symbolsTool, re_scene: a => readScene(a.file), re_binary: inspectBinary,
  re_archive: archiveTool, re_probe: probe, re_extract: carve, re_compare: compare, re_refs: refsTool, re_strings: stringsTool, re_report: report, re_lookup: lookupTool, re_blueprint: blueprintTool,
  port_map: portMapTool, port_convert: convert, port_plan: planPort, port_unit: portUnit, port_write: portWrite, port_scene: portScene,
  port_copy_assets: portCopyAssets, port_status: portStatus, port_verify: portVerify, re_case: caseTool, share_feedback: shareFeedback,
};

function validate(schema, args, where = 'arguments') {
  if (schema.type === 'object') {
    if (!args || typeof args !== 'object' || Array.isArray(args)) throw new RPError('INVALID_ARGUMENT', `${where} must be an object.`);
    const allowed = Object.keys(schema.properties ?? {});
    const unknown = Object.keys(args).filter(k => !schema.properties?.[k]);
    if (unknown.length && schema.additionalProperties === false) {
      const hints = unknown.map(k => { const near = closest(k, allowed, 3) ?? (schema.required ?? []).find(r => args[r] === undefined); return near ? `"${k}" (did you mean "${near}"?)` : `"${k}"`; });
      throw new RPError('INVALID_ARGUMENT', `Unknown argument ${hints.join(', ')}${where === 'arguments' ? '' : ` in ${where}`}. Allowed: ${allowed.join(', ')}.`);
    }
    for (const r of schema.required ?? []) if (args[r] === undefined || args[r] === null || args[r] === '') {
      const { description: d, enum: choices } = schema.properties?.[r] ?? {};
      throw new RPError('INVALID_ARGUMENT', `Missing ${r}${d ? ` (${d.replace(/\.$/, '')})` : ''}.${choices ? ` One of: ${choices.join(', ')}.` : ''}`);
    }
    for (const [k, v] of Object.entries(args)) if (v !== undefined && v !== null && schema.properties?.[k]) validate(schema.properties[k], v, k);
    return;
  }
  if (schema.type === 'string') { if (typeof args !== 'string') throw new RPError('INVALID_ARGUMENT', `${where} must be a string.`); if (schema.enum && !schema.enum.includes(args)) throw new RPError('INVALID_ARGUMENT', `${where} must be one of ${schema.enum.join(', ')}.`); return; }
  if (schema.type === 'integer') { if (!Number.isInteger(args)) throw new RPError('INVALID_ARGUMENT', `${where} must be an integer.`); if (schema.minimum !== undefined && args < schema.minimum) throw new RPError('INVALID_ARGUMENT', `${where} must be ≥ ${schema.minimum}.`); if (schema.maximum !== undefined && args > schema.maximum) throw new RPError('INVALID_ARGUMENT', `${where} must be ≤ ${schema.maximum}.`); return; }
  if (schema.type === 'number') { if (typeof args !== 'number' || !Number.isFinite(args)) throw new RPError('INVALID_ARGUMENT', `${where} must be a number.`); return; }
  if (schema.type === 'boolean') { if (typeof args !== 'boolean') throw new RPError('INVALID_ARGUMENT', `${where} must be true or false.`); return; }
  if (schema.type === 'array') {
    if (!Array.isArray(args)) throw new RPError('INVALID_ARGUMENT', `${where} must be an array.`);
    if (schema.minItems !== undefined && args.length < schema.minItems) throw new RPError('INVALID_ARGUMENT', `${where} needs at least ${schema.minItems} items.`);
    if (schema.maxItems !== undefined && args.length > schema.maxItems) throw new RPError('INVALID_ARGUMENT', `${where} allows at most ${schema.maxItems} items.`);
    args.forEach((x, i) => validate(schema.items, x, `${where}[${i}]`));
  }
}

export async function callTool(name, args = {}) {
  const tool = tools.find(t => t.name === name);
  if (!tool) throw new RPError('UNKNOWN_TOOL', `Unknown tool ${name}. Tools: ${tools.map(t => t.name).join(', ')}`);
  const adjusted = {};
  const input = coerce(tool.inputSchema, args ?? {}, adjusted, '');
  validate(tool.inputSchema, input);
  const result = await handlers[name](input);
  return Object.keys(adjusted).length && result && typeof result === 'object' && !Array.isArray(result) ? { adjusted, ...result } : result;
}

/**
 * Forgive the common slips of smaller models and strict-mode clients: "20" for 20, "true" for true, a JSON string for
 * an object, null for "not given" (unless the schema allows null). Values that are still wrong fail validation.
 */
export function coerceArgs(schema, value) {
  return coerce(schema, value, null, '');
}

const allowsNull = s => s && (s.type === 'null' || (Array.isArray(s.type) && s.type.includes('null')) || (s.anyOf ?? s.oneOf ?? []).some(x => x?.type === 'null'));

function coerce(schema, value, adjusted = null, at = '') {
  if (value === null || value === undefined) return value;
  if (schema?.type === 'object' && typeof value === 'string' && /^\s*\{/.test(value)) { try { value = JSON.parse(value); } catch { return value; } }
  if (schema?.type === 'object' && value && typeof value === 'object' && !Array.isArray(value)) {
    const out = {};
    for (const [k, v] of Object.entries(value)) { if (v === null && !(schema.required ?? []).includes(k) && !allowsNull(schema.properties?.[k])) continue; out[k] = schema.properties?.[k] ? coerce(schema.properties[k], v, adjusted, at ? `${at}.${k}` : k) : v; }
    return out;
  }
  if ((schema?.type === 'integer' || schema?.type === 'number') && adjusted && typeof value !== 'boolean') {
    let n = typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)) ? Number(value) : value;
    if (typeof n === 'number' && Number.isFinite(n)) {
      if (schema.type === 'integer' && !Number.isInteger(n)) { n = Math.round(n); adjusted[at] = `rounded to ${n}`; }
      if (schema.minimum !== undefined && n < schema.minimum) { adjusted[at] = `raised to the minimum ${schema.minimum}`; n = schema.minimum; }
      if (schema.maximum !== undefined && n > schema.maximum) { adjusted[at] = `lowered to the maximum ${schema.maximum}`; n = schema.maximum; }
      return n;
    }
  }
  if ((schema?.type === 'integer' && typeof value === 'string' && /^-?\d+$/.test(value.trim())) || (schema?.type === 'number' && typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)))) return Number(value);
  if (schema?.type === 'boolean' && typeof value === 'string') {
    const b = value.trim().toLowerCase();
    if (b === 'true' || b === 'false') return b === 'true';
    if (adjusted && ['yes', 'no', 'on', 'off', '1', '0'].includes(b)) { adjusted[at] = `read "${value}" as ${['yes', 'on', '1'].includes(b)}`; return ['yes', 'on', '1'].includes(b); }
  }
  if (schema?.type === 'boolean' && adjusted && (value === 1 || value === 0)) { adjusted[at] = `read ${value} as ${value === 1}`; return value === 1; }
  // "Godot" for "godot", "Mermaid " for "mermaid": only when exactly one allowed value matches.
  if (schema?.type === 'string' && Array.isArray(schema.enum) && typeof value === 'string' && !schema.enum.includes(value) && adjusted) {
    const norm = x => String(x).trim().toLowerCase().replace(/[\s_-]+/g, '');
    const hits = schema.enum.filter(e => norm(e) === norm(value));
    if (hits.length === 1) { adjusted[at] = `read "${value}" as "${hits[0]}"`; return hits[0]; }
  }
  if (schema?.type === 'array' && typeof value === 'string' && adjusted) {
    // A JSON list sent as text, or one value where a list is expected.
    if (/^\s*\[/.test(value)) { try { const parsed = JSON.parse(value); if (Array.isArray(parsed)) { adjusted[at] = 'parsed the list from text'; return parsed.map((v, i) => coerce(schema.items, v, adjusted, `${at}[${i}]`)); } } catch { /* not JSON: validation explains */ } }
    else if (schema.items?.type === 'string' && value.trim() !== '') { adjusted[at] = 'wrapped the single value in a list'; return [value]; }
  }
  if (schema?.type === 'array' && Array.isArray(value)) return value.map((v, i) => coerce(schema.items, v, adjusted, `${at}[${i}]`));
  return value;
}

/** OpenAI function-calling format. */
export const openaiTools = () => formatTools(tools, 'openai');

export function openapi(port) {
  const paths = {};
  for (const t of tools) {
    paths[`/api/agent/tools/${t.name}`] = { post: { operationId: t.name, summary: t.title, description: t.description, requestBody: { required: true, content: { 'application/json': { schema: t.inputSchema } } }, responses: { 200: { description: 'Result', content: { 'application/json': { schema: { type: 'object' } } } }, 400: { description: 'Error' } } } };
  }
  return { openapi: '3.1.0', info: { title: 'ReversePort', version: VERSION, description: 'Reverse engineer anything. Port it anywhere. Local tools for agents.' }, servers: [{ url: `http://127.0.0.1:${port}` }], paths };
}
