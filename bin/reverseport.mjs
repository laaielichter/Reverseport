#!/usr/bin/env node
// ReversePort — one command for everything.
//
//   reverseport setup                 connect your coding agents (MCP + skill), once
//   reverseport scan ./MyGame         ReversePort's own commands: recon, builds, lookups, blueprints, porting
//   reverseport analyze ./App         deep-analysis engine commands: decompile, xrefs, runtime evidence, …
//   reverseport mcp                   one MCP server with every tool
//
// ReversePort's own commands need nothing but Node. The engine commands need the built engine (installed from npm
// it is always built; in a git checkout run `npm ci && npm run build`).
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VERSION = JSON.parse(readFileSync(path.join(REPO, 'package.json'), 'utf8')).version;
const PORT_COMMANDS = new Set([
  'scan', 'graph', 'symbols', 'scene', 'binary', 'bin', 'archive', 'pck', 'probe', 'extract', 'carve', 'diff',
  'compare-builds', 'report', 'lookup', 'recon', 'web', 'blueprint', 'rebuild', 'map', 'convert', 'plan', 'unit',
  'write', 'port-scene', 'copy-assets', 'status', 'verify', 'case', 'proof', 'tools', 'serve', 'describe', 'feedback',
  'connect', 'skills', 'refs', 'guids', 'strings', 'i18n', 'l10n', 'apicheck', 'api', 'upgrade', 'godot3to4',
]);
const ALWAYS_ENGINE = ['setup', 'doctor', 'update', 'uninstall', 'mcp', 'capabilities', 'providers', 'help'];

/** Engine command names, read from the built engine or its source, so a typo is never mistaken for a missing build. */
function engineCommands() {
  for (const file of [path.join(REPO, 'src', 'cliCommandNames.ts'), path.join(REPO, 'dist', 'cliCommandNames.js')]) {
    try { return new Set([...ALWAYS_ENGINE, ...[...readFileSync(file, 'utf8').matchAll(/:\s*"([a-z0-9-]+)"/g)].map(m => m[1])]); } catch {}
  }
  return null;
}

function distance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) { let prev = row[0]; row[0] = i; for (let j = 1; j <= b.length; j++) { const t = row[j]; row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = t; } }
  return row[b.length];
}
function suggestion(cmd, names) {
  let best = null, d = 3;
  for (const n of names) { const x = distance(cmd, n); if (x < d) { d = x; best = n; } }
  return best;
}

const engineBuilt = () => existsSync(path.join(REPO, 'dist', 'cli-runtime', 'cli.js')) && existsSync(path.join(REPO, 'dist', 'mcp', 'main.js'));
const ENGINE_MISSING = `The deep-analysis engine is not built in this copy of ReversePort.
  Installed from npm?  npx -y reverseport@latest setup
  Git checkout?        npm ci && npm run build      (Node ${'>='}22.19)
ReversePort's own commands (scan, binary, archive, diff, lookup, blueprint, plan, …) work without it.
`;

function help() {
  return `ReversePort ${VERSION} — reverse engineer anything. Port it anywhere.

Start
  reverseport setup                  connect Claude Code, Codex, Cursor, Gemini, Copilot, OpenCode and more (MCP + skill)
  reverseport doctor                 check the installation, engines and agent registrations
  reverseport mcp                    MCP server on stdio with every tool

Understand anything (no build needed)
  reverseport scan <folder>          engine + version, languages, entry points — projects and exported games
  reverseport lookup "<name>"        no files: engine, stack, structure, remakes from public sources (--url, --github)
  reverseport binary <file>          PE/.NET/ELF/Mach-O/wasm/class/dex at a glance
  reverseport archive <file>         Godot .pck (also inside .exe), zip/apk/jar, tar.gz, asar — list or extract
  reverseport diff <a> <b>           what changed between two builds, packs or binaries
  reverseport refs <unity-project>   broken Unity GUID references, duplicate and missing .meta files
  reverseport strings <folder>       extract translatable text (.pot/.csv); --action apply writes a translated copy
  reverseport apicheck <file|folder> Godot 3 names, invented members, too-new classes; --engine godot@4.3
  reverseport upgrade <godot3-project> Godot 3 → 4 as a copy; --action apply --out <folder>; lists what needs a human
  reverseport report <folder>        ARCHITECTURE.md
  reverseport port help              every ReversePort command and option

Go deep (deep-analysis engine)
  reverseport analyze <target>       open a binary/app and summarize it
  reverseport decompile <target>     pseudocode for functions (Ghidra, Hopper or IDA)
  reverseport xrefs | trace | search call graphs, references, strings
  reverseport analyze-javascript-application <dir>   Electron / web apps
  reverseport inspect-android-package <apk>          Android
  reverseport engine --help          all engine commands

Rebuild and port
  reverseport blueprint --lookup-id <id>   clean-room rebuild spec + parity table + skeleton
  reverseport plan <source> --to unity     port Godot ⇄ Unity, → Unreal, → three.js, → Godot C#, any language
  reverseport verify <planId>              prove nothing was left behind

Proof (evidence ledger)
  reverseport case init --question "…" --target <what>   open a proof case
  reverseport case evidence <caseId> ...                 add supporting evidence
  reverseport case claim <caseId> ...                    record a claim with evidence
  reverseport case check <caseId>                        validate the proof case

Only analyse or port what you own or may legally use. https://github.com/laaielichter/reverseport
`;
}

// Agents read stderr as JSON when they asked for JSON or are not a terminal; people get plain text.
const wantsJson = () => process.argv.includes('--json') || !process.stderr.isTTY;
function fail(code, message, action, exitCode) {
  if (wantsJson()) process.stderr.write(`${JSON.stringify({ error: { code, category: code === 'UNKNOWN_COMMAND' ? 'invalid_input' : 'unavailable', retryable: false, message, remediation: { action } } })}\n`);
  else process.stderr.write(`${message}\n${code === 'UNKNOWN_COMMAND' ? '' : `\n${ENGINE_MISSING}`}`);
  process.exitCode = exitCode;
}

async function runEngine(args) {
  if (!engineBuilt()) {
    const known = engineCommands();
    const cmd = args[0];
    if (known && cmd && !cmd.startsWith('-') && !known.has(cmd)) {
      const near = suggestion(cmd, [...PORT_COMMANDS, ...known]);
      return fail('UNKNOWN_COMMAND', `Unknown command "${cmd}".${near ? ` Did you mean "${near}"?` : ''}`, 'Run `reverseport help` for the commands.', 2);
    }
    return fail('ENGINE_UNAVAILABLE', !cmd || cmd.startsWith('-') ? 'The deep-analysis engine commands need the built engine, which is not built in this copy.' : `"${cmd}" is a deep-analysis engine command and the engine is not built in this copy.`, 'Ask the user first, then `npx -y reverseport@latest setup`, or in this checkout `npm ci && npm run build`. ReversePort\'s own commands work without it.', 1);
  }
  // In-process, so agent registrations written by `setup` point at this command (process.argv[1]).
  process.argv = [process.argv[0], process.argv[1], ...args];
  await import(pathToFileURL(path.join(REPO, 'scripts', 'rea.mjs')).href);
}

async function runPort(args) {
  const { main } = await import(pathToFileURL(path.join(REPO, 'port', 'cli.mjs')).href);
  const code = await main(args);
  if (code !== null) process.exitCode = code;
}

const argv = process.argv.slice(2);
const [cmd, ...rest] = argv;

if (!cmd || cmd === 'help' || cmd === '--help' || cmd === '-h') process.stdout.write(help());
else if (cmd === '--version' || cmd === '-v' || cmd === 'version') process.stdout.write(`${VERSION}\n`);
else if ((cmd === 'mcp' || cmd === '--mcp') && rest.length === 0) await import(pathToFileURL(path.join(REPO, 'port', 'mcp.mjs')).href);
else if (cmd === 'port') await runPort(rest.length ? rest : ['help']);
else if (cmd === 'engine') await runEngine(rest);
else if (PORT_COMMANDS.has(cmd) || /^(re|port)_[a-z_]+$/.test(cmd)) await runPort(argv);
else if (cmd === 'doctor' && !engineBuilt()) {
  const { doctor } = await import(pathToFileURL(path.join(REPO, 'port', 'cli.mjs')).href);
  const report = await doctor();
  const ignored = argv.slice(1).filter(a => a !== '--json');
  const out = { ...report, ok: false, reverseport: { ok: report.ok }, engine: { built: false, ok: false, remediation: ['npx -y reverseport@latest setup', 'npm ci && npm run build   (in this checkout)'] }, registration: 'Checking agent registrations needs the engine. Meanwhile `reverseport connect <client>` prints the configuration for any agent.', ...(ignored.length ? { ignoredOptions: ignored } : {}) };
  process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
  if (!wantsJson()) process.stderr.write(`\n${ENGINE_MISSING}`);
  process.exitCode = 1;
} else await runEngine(argv);