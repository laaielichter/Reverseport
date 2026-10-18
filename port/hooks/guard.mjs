#!/usr/bin/env node
// Claude Code hooks for the ReversePort plugin: a deterministic guard around ReversePort's tools.
// Adapted from rea-jev's hook layer (MIT, Juan Alvarado): the same four points (session start, before a tool, after a
// tool, before "done"), with rules in code only. No model or network is called: ReversePort stays local.
//
//   session  short note on how to keep findings honest (proof cases, optional Stashpad memory)
//   pre      deny a non-loopback CDP/Inspector endpoint; ask before a tool runs, attaches to or controls a program;
//            ask when an argument carries what looks like a password, token or key
//   post     append a small event (tool, input hash, ok/error, caseId) to the session log in the workspace
//   stop     once per stop: block "done" while a proof case touched in this session fails its check
//
// REVERSEPORT_HOOKS=off turns them off, =shadow only logs what they would do. Every error fails open (exit 0, silent).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { isMainModule } from '../src/main-module.mjs';

const MODE = String(process.env.REVERSEPORT_HOOKS ?? 'on').toLowerCase();
const TOOL = /^mcp__(?:plugin_reverseport_)?reverseport__(.+)$/;
const RUNTIME_PREFIX = ['capture_', 'observe_'];
const RUNTIME_EXACT = new Set([
  'start_frida_session', 'instrument_with_frida', 'load_frida_script', 'resume_frida_session',
  'start_gdb_session', 'gdb_console', 'start_rizin_debug_session', 'rizin_debug_command', 'execute_rizin_command', 'cutter_command',
  'install_adb_package', 'uninstall_adb_package', 'push_adb_file', 'start_adb_app', 'start_adb_activity', 'stop_adb_app',
]);
const ENDPOINT_KEYS = new Set(['cdp_endpoint', 'inspector_endpoint']);
const SECRET_KEY = /(^|[_-])(pass(word|wd|phrase)?|secret|token|api[_-]?key|private[_-]?key|auth|credential)s?$/i;
const SECRET_VALUE = [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, /\bAKIA[0-9A-Z]{16}\b/, /\bgh[pousr]_[A-Za-z0-9]{36,}\b/, /\bsk-[A-Za-z0-9_-]{20,}\b/, /\bxox[abpr]-[A-Za-z0-9-]{10,}\b/];

const silent = () => process.exit(0);
const emit = obj => { process.stdout.write(JSON.stringify(obj)); process.exit(0); };

export const bare = name => TOOL.exec(String(name ?? ''))?.[1] ?? null;
export const isRuntime = name => RUNTIME_EXACT.has(name) || RUNTIME_PREFIX.some(p => name.startsWith(p));

function isLoopback(value) {
  try {
    const host = new URL(/^[a-z]+:\/\//i.test(value) ? value : `ws://${value}`).hostname.replace(/^\[|\]$/g, '');
    return host === 'localhost' || host === '::1' || /^127\./.test(host);
  } catch { return false; }
}

/** Walk the input once; report endpoint and secret findings with their key paths. */
export function findings(input) {
  const out = { endpoints: [], secrets: [] };
  const visit = (v, at, key) => {
    if (typeof v === 'string') {
      if (ENDPOINT_KEYS.has(key) && v.trim() && !isLoopback(v.trim())) out.endpoints.push(at);
      if ((SECRET_KEY.test(key ?? '') && v.trim().length >= 6) || SECRET_VALUE.some(r => r.test(v))) out.secrets.push(at);
    } else if (Array.isArray(v)) v.forEach((x, i) => visit(x, `${at}[${i}]`, key));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) visit(x, at ? `${at}.${k}` : k, k);
  };
  visit(input ?? {}, '', null);
  return out;
}

/** The PreToolUse decision, or null to stay out of the way. */
export function decide(name, input) {
  const f = findings(input);
  if (f.endpoints.length) return { decision: 'deny', reason: `ReversePort guard: ${f.endpoints.join(', ')} points to another machine. Attach only to a browser or process on this computer (localhost / 127.0.0.1).` };
  if (f.secrets.length) return { decision: 'ask', reason: `ReversePort guard: ${f.secrets.join(', ')} looks like a password, token or key. Check with the user before it is used or saved.` };
  if (isRuntime(name)) return { decision: 'ask', reason: `ReversePort guard: ${name} runs, attaches to or controls a program instead of only reading it. Confirm the user wants that, on a target they own or may examine.` };
  return null;
}

function workspace() { return path.resolve(process.env.REVERSEPORT_HOME?.trim() || path.join(process.env.HOME || process.env.USERPROFILE || '.', '.reverseport')); }
const logFile = sid => path.join(workspace(), 'sessions', `${String(sid ?? 'unknown').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80)}.jsonl`);
const hashOf = v => crypto.createHash('sha256').update(JSON.stringify(v ?? {})).digest('hex').slice(0, 16);

function append(sid, event) {
  const file = logFile(sid);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`);
}

function events(sid) {
  try { return fs.readFileSync(logFile(sid), 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; }
}

function responseText(r) {
  if (typeof r === 'string') return r;
  const parts = Array.isArray(r) ? r : Array.isArray(r?.content) ? r.content : [];
  return parts.map(p => (typeof p === 'string' ? p : p?.text ?? '')).join('\n');
}

async function readInput() {
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  try { return JSON.parse(raw); } catch { return null; }
}

async function main() {
  const phase = process.argv[2];
  if (MODE === 'off') return silent();
  const input = await readInput();
  if (!input) return silent();

  if (phase === 'session') {
    return emit({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: 'ReversePort: for an investigation or port, keep a proof case (re_case: evidence → claims that cite it → decision → tests). Say "unknown" rather than guess. If Stashpad is installed, re_case init recalls earlier findings and remember proposes new ones for the user to review.' } });
  }

  const name = bare(input.tool_name);
  if (phase === 'pre') {
    if (!name) return silent();
    const verdict = decide(name, input.tool_input);
    if (!verdict) return silent();
    try { append(input.session_id, { kind: 'pre', tool: name, decision: verdict.decision, shadow: MODE === 'shadow' || undefined }); } catch { /* the log is a bonus */ }
    if (MODE === 'shadow') return silent();
    return emit({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: verdict.decision, permissionDecisionReason: verdict.reason } });
  }

  if (phase === 'post') {
    if (!name) return silent();
    const text = responseText(input.tool_response);
    const ok = !/"error"\s*:\s*\{/.test(text.slice(0, 400)) && input.tool_response?.isError !== true;
    const caseId = name === 're_case' ? (input.tool_input?.caseId ?? /"caseId"\s*:\s*"([a-z0-9-]+)"/.exec(text)?.[1]) : undefined;
    append(input.session_id, { kind: 'post', tool: name, input: hashOf(input.tool_input), ok, ...(caseId ? { caseId } : {}) });
    return silent();
  }

  if (phase === 'stop') {
    if (input.stop_hook_active) return silent();
    const cases = [...new Set(events(input.session_id).filter(e => e.caseId).map(e => e.caseId))];
    if (!cases.length) return silent();
    const { caseTool } = await import('../src/proofcase.mjs');
    const failing = [];
    for (const caseId of cases) {
      try { const r = await caseTool({ action: 'check', caseId }); if (!r.passed) failing.push(`${caseId}: ${r.errors.slice(0, 3).join('; ')}`); } catch { /* a case that cannot be read is not this hook's call */ }
    }
    if (!failing.length) return silent();
    if (MODE === 'shadow') { append(input.session_id, { kind: 'stop', decision: 'block', shadow: true }); return silent(); }
    return emit({ decision: 'block', reason: `ReversePort guard: a proof case from this session does not pass its check — ${failing.join(' | ')}. Fix it (re_case {action:"check"} lists every finding), or tell the user plainly what is unproven and why.` });
  }
  return silent();
}

if (isMainModule(import.meta.url)) {
  const timer = setTimeout(silent, 9000); timer.unref?.();
  main().catch(() => silent());
}
