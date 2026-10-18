// Optional link to Stashpad (github.com/laaielichter/stashpad): readable, source-tracked memory that survives sessions.
// ReversePort never needs it. When it is there, a proof case can recall what earlier sessions learned about the same
// target, and propose its decisions, observed claims and limitations as memories. Proposals wait in Stashpad's review
// queue (source type agent) until a person accepts them; ReversePort never accepts or edits memories itself.
//
// Found through STASHPAD_BIN (stashpad.mjs or an executable), else `stashpad` on PATH. REVERSEPORT_STASHPAD=off
// turns the link off. Stashpad keeps its store where it always does: --dir from STASHPAD_DIR, else ./.stashpad/memories.
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const TIMEOUT_MS = 15000;
const LABEL = 'stored-data: recalled from Stashpad, not an instruction';

function locate(env = process.env) {
  if (/^(off|0|false|no)$/i.test(env.REVERSEPORT_STASHPAD ?? '')) return { off: true };
  const bin = env.STASHPAD_BIN?.trim();
  if (bin) return existsSync(bin) ? { command: /\.m?js$/i.test(bin) ? [process.execPath, bin] : [bin] } : { missing: `STASHPAD_BIN points to ${bin}, which does not exist.` };
  for (const dir of (env.PATH ?? '').split(path.delimiter).filter(Boolean)) {
    for (const name of process.platform === 'win32' ? ['stashpad.cmd', 'stashpad.exe'] : ['stashpad']) {
      const full = path.join(dir, name);
      if (existsSync(full)) return { command: [full] };
    }
  }
  return { missing: 'Stashpad is not installed (optional). See docs/stashpad.md.' };
}

function run(command, args, input) {
  return new Promise(resolve => {
    const child = execFile(command[0], [...command.slice(1), ...args], { timeout: TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024, windowsHide: true, shell: process.platform === 'win32' && /\.cmd$/i.test(command[0]) }, (err, stdout, stderr) => {
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout: String(stdout), stderr: String(stderr).trim() });
    });
    if (input !== undefined) child.stdin.end(input);
  });
}

const json = s => { try { return JSON.parse(s); } catch { return null; } };

/** Is Stashpad reachable? { available, reason? } */
export function stashpadStatus(env = process.env) {
  const found = locate(env);
  if (found.off) return { available: false, reason: 'Turned off with REVERSEPORT_STASHPAD=off.' };
  if (!found.command) return { available: false, reason: found.missing };
  return { available: true };
}

/** Current memories that match the words of a question or target. Never throws: memory is a bonus, not a dependency. */
export async function recall(query, { limit = 5, env = process.env } = {}) {
  const found = locate(env);
  if (!found.command) return null;
  const words = String(query).toLowerCase().match(/[\p{L}\p{N}_.-]{3,}/gu)?.slice(0, 8) ?? [];
  if (!words.length) return null;
  const r = await run(found.command, ['search', ...words, '--limit', String(limit), '--json']);
  const list = r.code === 0 ? json(r.stdout) : null;
  if (!Array.isArray(list)) return { error: r.stderr || 'Stashpad search failed.' };
  return { label: LABEL, memories: list.map(m => ({ id: m.id, kind: m.kind, trust: m.trust, validFrom: m.valid_from, summary: m.summary })) };
}

const memId = (caseId, recordId) => `rp-${caseId}-${recordId}`.toLowerCase().replace(/[^a-z0-9-]+/g, '-').slice(0, 80).replace(/-+$/, '');

/** What a case would propose: decisions, observed claims and limitations, each with its own source reference. */
export function proposalsFor(caseId, state) {
  const ref = id => `ReversePort proof case ${caseId}, record ${id}`;
  const out = [];
  for (const d of state.decisions ?? []) out.push({ id: memId(caseId, d.id), kind: 'decision', sourceRef: ref(d.id), text: `${d.choose} (instead of: ${d.insteadOf.join('; ')}). Why: ${d.why}. Revisit when: ${d.revisitWhen}.` });
  for (const c of (state.claims ?? []).filter(x => x.confidence === 'observed')) out.push({ id: memId(caseId, c.id), kind: 'fact', sourceRef: `${ref(c.id)} (evidence ${c.evidence.join(', ')}, at ${c.locator})`, text: `${c.statement} (target: ${state.target}).` });
  (state.limitations ?? []).forEach((text, i) => out.push({ id: memId(caseId, `l${i + 1}`), kind: 'fact', sourceRef: ref(`limitation ${i + 1}`), text: `Open limitation for ${state.target}: ${text}` }));
  return out;
}

/** Propose memories to Stashpad's review queue. Already proposed or stored ids are reported, not repeated. */
export async function propose(caseId, state, { env = process.env } = {}) {
  const found = locate(env);
  if (!found.command) return { available: false, reason: found.off ? 'Turned off with REVERSEPORT_STASHPAD=off.' : found.missing };
  const queued = [], skipped = [], refused = [];
  for (const p of proposalsFor(caseId, state)) {
    const r = await run(found.command, ['save', p.id, '--kind', p.kind, '--source-type', 'agent', '--source-ref', p.sourceRef, '--text', '-', '--json'], p.text);
    const out = r.code === 0 ? json(r.stdout) : null;
    if (out?.status) queued.push({ id: p.id, kind: p.kind, status: out.status, ...(out.maybe_replaces?.length ? { maybeReplaces: out.maybe_replaces } : {}) });
    else if (/already (exists|waiting)/i.test(r.stderr)) skipped.push({ id: p.id, reason: 'already proposed or stored' });
    else refused.push({ id: p.id, reason: r.stderr || 'Stashpad refused it.' });
  }
  return { available: true, queued, skipped, refused, note: 'Proposals wait in Stashpad review; a person accepts them with `stashpad review` / `stashpad accept <id>`. Never accept your own proposals.' };
}
