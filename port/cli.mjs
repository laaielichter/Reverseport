#!/usr/bin/env node
// ReversePort's own commands (recon, builds, lookups, blueprints, porting). Reached through `reverseport <command>`
// (bin/reverseport.mjs), which also routes the deep-analysis engine's commands.
//   reverseport scan ./MyGame
//   reverseport binary Game.exe --strings.match "*.dll"
//   reverseport archive Game.pck --action extract --match "*.gd"
//   reverseport plan ./MyGame --to unity
//   reverseport re_scene main.tscn            (tool names work too)
//   reverseport port_write --request write.json
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { tools, callTool, VERSION } from './src/tools.mjs';
import { workspaceRoot } from './src/workspace.mjs';
import { diskReport } from './src/agentdisk.mjs';
import { isMainModule } from './src/main-module.mjs';
import { errorPayload, formatTools, FORMATS, closest, readFeedback } from './src/agent.mjs';
import { RPError } from './src/util.mjs';

const ALIASES = {
  scan: 're_scan', graph: 're_graph', symbols: 're_symbols', scene: 're_scene', binary: 're_binary', bin: 're_binary', archive: 're_archive', pck: 're_archive',
  probe: 're_probe', extract: 're_extract', carve: 're_extract', compare: 're_compare', diff: 're_compare', 'compare-builds': 're_compare', refs: 're_refs', guids: 're_refs', strings: 're_strings', i18n: 're_strings', l10n: 're_strings', apicheck: 're_apicheck', decode: 're_decode', il2cpp: 're_il2cpp', gdc: 're_decode', api: 're_apicheck', upgrade: 'port_upgrade', 'godot3to4': 'port_upgrade', save: 're_save', savefile: 're_save', shader: 'port_shader', trace: 'port_trace', rpgmaker: 'port_rpgmaker', rpgm: 'port_rpgmaker', report: 're_report',
  lookup: 're_lookup', recon: 're_lookup', web: 're_lookup', blueprint: 're_blueprint', rebuild: 're_blueprint',
  map: 'port_map', convert: 'port_convert', plan: 'port_plan', unit: 'port_unit', write: 'port_write', 'port-scene': 'port_scene', 'copy-assets': 'port_copy_assets', status: 'port_status', verify: 'port_verify', case: 're_case', proof: 're_case',
};
const POSITIONAL = { re_scan: ['path'], re_graph: ['path'], re_symbols: ['path'], re_scene: ['file'], re_binary: ['file'], re_archive: ['file'], re_probe: ['file'], re_extract: ['file'], re_compare: ['a', 'b'], re_refs: ['path'], re_strings: ['path'], re_apicheck: ['path'], re_decode: ['path'], re_il2cpp: ['file'], port_upgrade: ['path'], re_save: ['file', 'compare'], port_shader: ['file', 'to'], port_trace: ['action', 'engine'], port_rpgmaker: ['path', 'out'], re_report: ['path'], re_lookup: ['query'], re_blueprint: ['name'], port_map: ['from', 'to'], port_convert: ['from', 'to'], port_plan: ['source'], port_unit: ['planId', 'unit'], port_write: ['planId', 'unit'], port_scene: ['planId', 'unit'], port_copy_assets: ['planId'], port_status: ['planId'], port_verify: ['planId'], re_case: ['action', 'caseId'] };

/** List arguments whose items can contain commas, so a plain value stays one item. */
const KEEP_COMMAS = new Set(['insteadOf']);

export function parseArgs(name, argv) {
  const tool = tools.find(t => t.name === name);
  const props = tool.inputSchema.properties ?? {};
  const args = {};
  const pos = [];
  const coerce = (key, raw) => {
    const top = key.split('.')[0];
    const schema = key.includes('.') ? props[top]?.properties?.[key.split('.')[1]] : props[top];
    if (raw === undefined) return true;
    if (schema?.type === 'string') return raw;
    if (schema?.type === 'array') {
      // JSON keeps working; a plain value becomes a list. Items of some lists may contain commas, so those are not split.
      try { const parsed = JSON.parse(raw); if (Array.isArray(parsed)) return parsed; } catch { /* plain value */ }
      if (KEEP_COMMAS.has(top)) return [raw];
      return raw.split(',').map(s => s.trim()).filter(Boolean);
    }
    try { return JSON.parse(raw); } catch { return raw; }
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      let [key, val] = a.slice(2).split(/=(.*)/s, 2);
      if (val === undefined && argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) val = argv[++i];
      if (key === 'json' || key === 'args') {
        if (val === undefined || !/^\s*\{/.test(val)) { if (val !== undefined) pos.push(val); continue; } // bare --json: output is JSON anyway
        try { Object.assign(args, JSON.parse(val)); } catch { throw new RPError('INVALID_ARGUMENT', `--${key} expects a JSON object, e.g. --args '{"path":"./Game"}'.`); }
        continue;
      }
      if (key === 'pretty' || key === 'compact') { if (val !== undefined) pos.push(val); continue; }
      const camel = key.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      const v = coerce(camel, val);
      if (camel.includes('.')) { const [k, sub] = camel.split('.'); args[k] = { ...(args[k] ?? {}), [sub]: v }; }
      else args[camel] = Array.isArray(v) && Array.isArray(args[camel]) ? [...args[camel], ...v] : v; // a repeated list flag adds to the list
    } else pos.push(a);
  }
  (POSITIONAL[name] ?? []).forEach((k, i) => { if (pos[i] !== undefined && args[k] === undefined) args[k] = pos[i]; });
  if (name === 'port_convert' && pos.length > 2) for (const p of pos.slice(2)) { const [k, v] = p.split('='); if (v) { try { args[k] = JSON.parse(v); } catch { throw new RPError('INVALID_ARGUMENT', `${k}= expects JSON, e.g. position=[1,2,3].`); } } }
  return args;
}

export async function doctor() {
  const major = Number(process.versions.node.split('.')[0]);
  const ws = workspaceRoot();
  let writable = true;
  try { await fs.mkdir(ws, { recursive: true }); await fs.writeFile(path.join(ws, '.doctor'), 'ok'); await fs.rm(path.join(ws, '.doctor')); } catch { writable = false; }
  // The package's engines range (the deep-analysis engine needs it); ReversePort's own tools also run on any Node 22+.
  const [maj, min, patch] = process.versions.node.split('.').map(Number);
  const atLeast = (m, p) => min > m || (min === m && patch >= p);
  const nodeOk = (maj === 22 && atLeast(23, 4)) || (maj === 24 && atLeast(22, 1)) || (maj === 26 && atLeast(12, 1)) || maj > 26;
  const disk = await diskReport(ws);
  return { ok: nodeOk && writable, version: VERSION, node: process.versions.node, nodeOk, nodeRequired: '22.23.4+ (22.x), 24.22.1+ (24.x) or 26.12.1+ (Node 23 and 25 are not supported)', workspace: ws, workspaceWritable: writable, workspaceBytes: disk.bytes, workspaceFolders: disk.folders.slice(0, 12), agentdisk: disk.agentdisk, tools: tools.length, platform: `${os.platform()} ${os.arch()}` };
}

function help() {
  return `ReversePort ${VERSION} — reverse engineer anything, port it anywhere.

Usage: reverseport <command> [positional] [--key value] [--json '{…}'] [--request args.json]

Reverse engineering
  scan <folder>              engine, languages, entry points (projects and game builds)
  graph <folder>             dependency graph, cycles, port order   (--format mermaid)
  symbols <file|folder>      classes, functions, signals            (--match player)
  scene <file>               Godot .tscn/.tres/project.godot, Unity .unity/.prefab
  binary <file>              PE/.NET/ELF/Mach-O/wasm/class/dex      (--strings.match "*.dll")
  archive <file>             .pck (also inside .exe), zip/apk/jar, tar.gz, asar  (--action extract --match "*.gd")
  probe <file>               hex, entropy map, embedded files, record strides (--offset 4096)
  extract <file> --offset N  carve bytes out (--length N)
  diff <a> <b>               diff two folders, packs, binaries or files (builds)
  report <folder>            write ARCHITECTURE.md

Recon without files and rebuilds
  lookup "<name>"            public dossier: engine, stack, structure, where files live, remakes  (--url, --steam-app-id, --github owner/repo --mirror)
  blueprint --lookup-id <id> precise clean-room rebuild spec + parity table + project skeleton (--target godot)

Porting
  map [from] [to]            conventions + API map (godot→unity, unity→godot, godot→unreal, godot→threejs…)
  convert <from> <to> position=[1,2,3] rotation=[0,0,0,1]   coordinates between engines
  plan <source> --to unity   plan a port and scaffold the output project
  unit <planId>              next unit with source, API hints, conventions
  write <planId> <unit> --content "…" | --copy | --request write.json
  port-scene <planId> <unit> convert a scene/prefab
  copy-assets <planId>       copy all asset units
  status [planId]            progress (no id: all plans)
  verify <planId>            parity, leftovers, markers

Proof (evidence ledger)
  case init --question "…" --target <what>       open a case (returns caseId)
  case evidence <caseId> --file f | --content "…" --locator L --note N
  case claim <caseId> --statement S --evidence E001 [--confidence observed --alternative A --falsifier F]
  case decision|test|limit|phase|check|report|show <caseId> …   (case list: all cases)

Other
  tools [--all] [--format f] [--profile compact|standard|full]   list the tools (--all adds the engine's when built); formats: ${FORMATS.join(', ')}
  run_batch --calls '[{"tool":"re_scan","arguments":{"path":"./Game"},"select":["primary.id"]}]'   several tools, one call
  describe <tool>            one tool's description and input schema (engine tools too, when built)
  skills [list]              the skills bundled with this version
  skills get <name>          one skill's full guide, matching this version (--json for JSON)
  feedback                   notes agents left with share_feedback (stays on this computer)
  connect [client]           config snippet for any agent: MCP clients, HTTP/OpenAPI, OpenAI, Anthropic, Gemini, shell
  serve                      HTTP API on http://127.0.0.1:32147 (REVERSEPORT_PORT)
  mcp                        MCP server on stdio (these tools + the deep-analysis engine)
  port doctor                check Node and the workspace (${workspaceRoot()}); disk use, with agentdisk when installed
`;
}

export async function main(argv = process.argv.slice(2)) {
  const [cmd, ...rest] = argv;
  const compact = argv.includes('--compact');
  const print = v => process.stdout.write(`${compact ? JSON.stringify(v) : JSON.stringify(v, null, 2)}\n`);
  const printError = e => { process.stderr.write(`${JSON.stringify({ error: errorPayload(e) }, null, compact ? 0 : 2)}\n`); return e.code === 'INVALID_ARGUMENT' || e.code === 'UNKNOWN_TOOL' ? 2 : 1; };
  if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') { process.stdout.write(help()); return 0; }
  if (cmd === '--version' || cmd === 'version') { process.stdout.write(`${VERSION}\n`); return 0; }
  if (cmd === 'tools') {
    const fi = rest.indexOf('--format');
    const pi = rest.indexOf('--profile');
    let all;
    try { all = await listing({ include: rest.includes('--all'), profile: pi >= 0 ? rest[pi + 1] : process.env.REVERSEPORT_PROFILE }); } catch (e) { return printError(e); }
    try {
      if (fi < 0) print(all.map(t => ({ name: t.name, title: t.title, description: t.description })));
      else print(formatTools(all, rest[fi + 1]));
      return 0;
    } catch (e) { return printError(e); }
  }
  if (cmd === 'describe') {
    const all = await listing({ include: true, profile: 'full' });
    const t = all.find(x => x.name === (ALIASES[rest[0]] ?? rest[0]));
    if (!t) {
      const { knownEngineToolNames } = await import('./src/relay.mjs');
      if (knownEngineToolNames().has(rest[0])) return printError(new RPError('ENGINE_UNAVAILABLE', `${rest[0]} is a deep-analysis engine tool; its schema comes from the built engine, which is not built in this copy.`));
    }
    if (!t) return printError(new RPError('UNKNOWN_TOOL', `Unknown tool "${rest[0] ?? ''}". ${closest(rest[0] ?? '', all.map(x => x.name), 3) ? `Did you mean "${closest(rest[0], all.map(x => x.name), 3)}"? ` : ''}reverseport tools --all lists them.`));
    print({ name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema, annotations: t.annotations, cli: `reverseport ${t.name} ${(POSITIONAL[t.name] ?? []).map(p => `<${p}>`).join(' ')} [--key value] [--args '{…}']`.replace(/\s+/g, ' ').trim() });
    return 0;
  }
  if (cmd === 'skills') {
    const { listSkills, getSkill } = await import('./src/skills.mjs');
    const [sub, name] = rest.filter(x => !x.startsWith('--'));
    try {
      if (!sub || sub === 'list') { print({ version: VERSION, skills: await listSkills() }); return 0; }
      if (sub === 'get') {
        const s = await getSkill(name);
        if (argv.includes('--json')) print({ version: VERSION, name: s.name, description: s.description, body: s.body });
        else process.stdout.write(`<!-- ReversePort ${VERSION} · skill ${s.name} -->\n${s.text.endsWith('\n') ? s.text : `${s.text}\n`}`);
        return 0;
      }
      return printError(new RPError('INVALID_ARGUMENT', `Unknown skills command "${sub}". Use: reverseport skills list | reverseport skills get <name>`));
    } catch (e) { return printError(e); }
  }
  if (cmd === 'feedback') { print(await readFeedback()); return 0; }
  if (cmd === 'connect') {
    const { connect } = await import('./src/connect.mjs');
    const mi = rest.indexOf('--mode');
    try {
      const r = connect({ client: rest.find((x, i) => !x.startsWith('--') && !(mi >= 0 && i === mi + 1)), mode: mi >= 0 ? rest[mi + 1] : undefined });
      if (r.snippet && !argv.includes('--json')) { process.stdout.write(`# ${r.where}\n${r.snippet}\n`); return 0; }
      print(r); return 0;
    } catch (e) { return printError(e); }
  }
  if (cmd === 'doctor') { const r = await doctor(); print(r); return r.ok ? 0 : 1; }
  if (cmd === 'serve') { const { start } = await import('./server.mjs'); const s = await start(); console.log(`ReversePort ${VERSION} — http://127.0.0.1:${s.address().port}/api/agent/tools`); return null; }
  if (cmd === 'mcp') { await import('./mcp.mjs'); return null; }
  if (cmd === 'port') return main(rest.length ? rest : ['help']); // `reverseport port <command>` reaches this file as-is
  const name = ALIASES[cmd] ?? cmd;
  if (!tools.some(t => t.name === name) && name !== 'run_batch' && name !== 'set_tool_profile') {
    const { knownEngineToolNames } = await import('./src/relay.mjs');
    if (knownEngineToolNames().has(name) || name === 'engine_call' || name === 'engine_tools') return printError(new RPError('ENGINE_UNAVAILABLE', `${name} is a deep-analysis engine tool. On the command line it runs through the engine commands (\`reverseport engine --help\`), and over MCP or \`reverseport serve\` as a tool; this file only runs ReversePort's own tools.`));
  }
  if (name === 'set_tool_profile') return printError(new RPError('INVALID_ARGUMENT', 'set_tool_profile changes what an MCP client lists. On the command line every tool can always be called; for a shorter list use `reverseport tools --profile compact` (or set REVERSEPORT_PROFILE).'));
  if (name === 'run_batch') {
    try { return await runBatch(await readRequest(rest), rest, print); } catch (e) { return printError(e); }
  }
  if (!tools.some(t => t.name === name)) {
    const near = closest(cmd, [...Object.keys(ALIASES), ...tools.map(t => t.name), 'run_batch'], 2);
    return printError(new RPError('UNKNOWN_TOOL', `Unknown command "${cmd}".${near ? ` Did you mean "${near}"?` : ''} Run: reverseport help`));
  }
  try {
    const args = await readRequest(rest);
    Object.assign(args, parseArgs(name, rest));
    print(await callTool(name, args));
    return 0;
  } catch (e) { return printError(e); }
}

/** --request <file|-> as the starting arguments (removed from argv), then --args '{…}' merged on top. */
async function readRequest(rest) {
  let args = {};
  const reqIdx = rest.indexOf('--request');
  if (reqIdx >= 0) {
    const src = rest[reqIdx + 1];
    if (!src) throw new RPError('INVALID_ARGUMENT', '--request needs a JSON file path, or - for stdin.');
    let text;
    try { text = src === '-' ? await readStdin() : await fs.readFile(src, 'utf8'); } catch (e) { throw new RPError(e.code === 'ENOENT' ? 'NOT_FOUND' : 'INVALID_ARGUMENT', `--request: cannot read ${src} (${e.code ?? e.message}).`); }
    try { args = JSON.parse(text); } catch { throw new RPError('INVALID_ARGUMENT', `--request: ${src} is not a JSON object.`); }
    rest.splice(reqIdx, 2);
  }
  return args;
}

/**
 * run_batch on the command line: the same steps and select as over MCP. The engine starts only when a step needs
 * one of its tools. Exit code 1 when a step failed; the JSON says which and why.
 */
async function runBatch(args, argv, print) {
  const { createRelay } = await import('./src/relay.mjs');
  for (const [i, a] of argv.entries()) {
    if (a === '--args' && /^\s*\{/.test(argv[i + 1] ?? '')) { try { Object.assign(args, JSON.parse(argv[i + 1])); } catch { throw new RPError('INVALID_ARGUMENT', '--args expects a JSON object, e.g. --args \'{"calls":[{"tool":"re_scan","arguments":{"path":"./Game"}}]}\'.'); } }
    if (a === '--calls') { try { args.calls = JSON.parse(argv[i + 1] ?? ''); } catch { throw new RPError('INVALID_ARGUMENT', '--calls expects a JSON list, e.g. --calls \'[{"tool":"re_scan","arguments":{"path":"./Game"},"select":["primary.id"]}]\'.'); } }
    if (a === '--continue-on-error') args.continueOnError = true;
  }
  const calls = Array.isArray(args.calls) ? args.calls : [];
  const local = new Set(tools.map(t => t.name));
  const relay = createRelay({}, calls.every(c => local.has(ALIASES[c?.tool] ?? c?.tool)) ? { engine: false } : {});
  try {
    await relay.ensureStarted({ name: 'reverseport-cli', version: VERSION });
    const result = await relay.call('run_batch', { ...args, calls: calls.map(c => (c && ALIASES[c.tool] ? { ...c, tool: ALIASES[c.tool] } : c)) }, relay.view(undefined, { stateless: true }));
    const value = result.structuredContent ?? JSON.parse(result.content?.[0]?.text ?? '{}');
    if (result.isError) { process.stderr.write(`${JSON.stringify(value)}\n`); return value?.error?.category === 'invalid_input' ? 2 : 1; }
    print(value);
    return value.results?.every(r => r.ok) ? 0 : 1;
  } finally { relay.close(); }
}

/** The list an MCP client gets in that profile (ReversePort's tools, run_batch, and with include every engine tool). */
async function listing({ include = false, profile } = {}) {
  const { createRelay, engineCommand, PROFILES } = await import('./src/relay.mjs');
  if (profile !== undefined && !PROFILES[String(profile).toLowerCase()]) throw new RPError('INVALID_ARGUMENT', `Unknown profile "${profile}". Profiles: ${Object.keys(PROFILES).join(', ')}.`);
  const withEngine = include && !!engineCommand().command;
  const relay = createRelay({}, { profile, ...(withEngine ? { tools: 'all' } : { engine: false }) });
  try {
    if (withEngine) await relay.ensureStarted({ name: 'reverseport-cli', version: VERSION });
    return relay.listTools().filter(t => t.name !== 'set_tool_profile');
  } finally { relay.close(); }
}

async function readStdin() {
  let text = '';
  for await (const chunk of process.stdin) text += chunk;
  return text;
}

if (isMainModule(import.meta.url)) {
  const code = await main();
  if (code !== null) process.exitCode = code;
}
