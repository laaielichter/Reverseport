// Proof cases: an evidence-to-delivery ledger for an investigation or a port. Every claim cites saved evidence,
// every decision names what it rejected, and phases only move forward through gates (investigate → decide → build →
// verify → deliver). Ported to Node from Digfox's proof.py (MIT, Digfox contributors) and fitted to ReversePort:
// cases live in the workspace, evidence can be a file or the text of a tool result, and every answer names the next call.
//
// The ledger records claims and checks integrity, not their truth: SHA-256 proves a saved file did not change; it does
// not prove the source was authentic, a claim is right or a test really ran.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { RPError, sha256, sha256File } from './util.mjs';
import { workspaceDir, workspaceRoot } from './workspace.mjs';
import { recall, propose } from './stashpad.mjs';

export const SCHEMA = 1;
export const PHASES = ['scope', 'investigate', 'decide', 'build', 'verify', 'deliver'];
export const INTENTS = ['investigate', 'design', 'build', 'audit', 'extract', 'port'];
export const KINDS = ['observation', 'source', 'tool-result', 'test-log', 'engine-evidence', 'artifact'];
export const CONFIDENCE = ['observed', 'inferred', 'unresolved'];
export const APPROVALS = ['active-observation', 'execute-unknown-target', 'send', 'publish', 'spend', 'deploy', 'delete', 'sensitive-data-sharing'];
export const ACTIONS = ['init', 'evidence', 'claim', 'decision', 'test', 'approve', 'limit', 'unknown', 'resolve', 'phase', 'check', 'report', 'show', 'list', 'remember'];
const MAX_EVIDENCE = 100 * 1024 * 1024;
const ID = /^(E|C|D|T|U)\d{3,}$/;
const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;

const now = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
const need = (value, message) => { if (typeof value !== 'string' || !value.trim()) throw new RPError('INVALID_ARGUMENT', message); return value.trim(); };
const slugify = s => String(s).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '') || 'case';

async function casesRoot() { return workspaceDir('cases'); }

async function caseDir(caseId) {
  const id = need(caseId, 'Missing caseId (re_case {action:"list"} lists the cases).');
  if (!SLUG.test(id)) throw new RPError('INVALID_ARGUMENT', `caseId "${id}" must be lowercase letters, digits and dashes.`);
  const dir = path.join(await casesRoot(), id);
  try { await fs.access(path.join(dir, 'case.json')); } catch { throw new RPError('UNKNOWN_CASE', `No case "${id}".`); }
  return dir;
}

async function readCase(dir) {
  const state = JSON.parse(await fs.readFile(path.join(dir, 'case.json'), 'utf8'));
  if (state.schema !== SCHEMA) throw new RPError('UNSUPPORTED_VERSION', 'Unsupported case schema; an unknown case is never rewritten.');
  return state;
}

/** Write next to the target and rename, so an interrupted write never leaves half a ledger. */
async function writeCase(dir, state) {
  const tmp = path.join(dir, `.case-${crypto.randomBytes(6).toString('hex')}.json`);
  const fh = await fs.open(tmp, 'w');
  try { await fh.writeFile(`${JSON.stringify(state, null, 2)}\n`); await fh.sync(); } finally { await fh.close(); }
  await fs.rename(tmp, path.join(dir, 'case.json'));
}

const newId = (items, prefix) => {
  const used = new Set(items.map(x => x.id));
  for (let n = 1; n < 1e6; n++) { const id = `${prefix}${String(n).padStart(3, '0')}`; if (!used.has(id)) return id; }
  throw new RPError('TOO_LARGE', 'Too many records in one case.');
};

// ------------------------------------------------------------------------------------------------------- actions
async function init(a) {
  const question = need(a.question, 'Missing question: a concrete question the case answers (at least 12 characters).');
  if (question.length < 12) throw new RPError('INVALID_ARGUMENT', 'Make the question concrete and falsifiable (at least 12 characters).');
  const target = need(a.target, 'Missing target: what is being examined (a folder, file, app or bug).');
  const intent = a.intent ?? 'investigate';
  const root = await casesRoot();
  let id = a.caseId?.trim() || slugify(question);
  if (!SLUG.test(id)) throw new RPError('INVALID_ARGUMENT', `caseId "${id}" must be lowercase letters, digits and dashes.`);
  if (!a.caseId) { const base = id; for (let n = 2; await exists(path.join(root, id)); n++) id = `${base.slice(0, 58)}-${n}`; }
  const dir = path.join(root, id);
  if (await exists(dir)) throw new RPError('OUTPUT_NOT_EMPTY', `Case "${id}" already exists; it is never overwritten.`);
  await fs.mkdir(path.join(dir, 'evidence'), { recursive: true });
  try {
    await fs.mkdir(path.join(dir, 'outputs'));
    const t = now();
    await writeCase(dir, { schema: SCHEMA, created: t, question, target, intent, authorized: a.authorized === true, phase: 'investigate', phaseHistory: [{ phase: 'scope', at: t }, { phase: 'investigate', at: t }], evidence: [], claims: [], decisions: [], tests: [], approvals: [], limitations: [], unknowns: [] });
  } catch (e) { await fs.rm(dir, { recursive: true, force: true }); throw e; }
  const memory = await recall(`${question} ${target}`);
  return { caseId: id, folder: dir, phase: 'investigate', ...(memory?.memories?.length || memory?.openHandoffs?.length ? { recalled: memory } : {}), next: `Save what you inspect: re_case {action:"evidence", caseId:"${id}", file|content, locator, note}. Then claims that cite it.` };
}

async function addEvidence(dir, state, a, kindOverride) {
  const kind = kindOverride ?? a.kind ?? (a.content !== undefined ? 'tool-result' : 'source');
  if (!KINDS.includes(kind)) throw new RPError('INVALID_ARGUMENT', `kind must be one of ${KINDS.join(', ')}.`);
  const locator = need(a.locator, 'Missing locator: where exactly it came from (file:line, offset, tool and arguments, URL).');
  const note = need(a.note, 'Missing note: what this evidence shows.');
  const hasFile = typeof a.file === 'string' && a.file.trim();
  if (hasFile === (a.content !== undefined)) throw new RPError('INVALID_ARGUMENT', 'Give exactly one of file (a file to copy and hash) or content (text such as a tool result).');
  const id = newId(state.evidence, 'E');
  let data, ext;
  if (hasFile) {
    const src = path.resolve(a.file);
    const lst = await fs.lstat(src);
    if (lst.isSymbolicLink()) throw new RPError('INVALID_ARGUMENT', 'Refusing a symlink as evidence; pass the real file.');
    if (!lst.isFile()) throw new RPError('NOT_A_FILE', 'Evidence must be a regular file.');
    if (lst.size > MAX_EVIDENCE) throw new RPError('TOO_LARGE', 'Evidence over 100 MiB: save a smaller excerpt (re_extract) instead.');
    data = await fs.readFile(src);
    if (sha256(data) !== await sha256File(src)) throw new RPError('TOOL_FAILED', 'The file changed while it was being saved; try again.');
    // The original file name is never stored: names can carry private details.
    ext = path.extname(src).toLowerCase();
    if (!/^\.[a-z0-9]{1,10}$/.test(ext)) ext = '.bin';
  } else {
    data = Buffer.from(typeof a.content === 'string' ? a.content : JSON.stringify(a.content, null, 2));
    if (data.length > MAX_EVIDENCE) throw new RPError('TOO_LARGE', 'Evidence over 100 MiB: save a smaller excerpt.');
    ext = /^\s*[[{]/.test(data.toString('utf8', 0, 64)) ? '.json' : '.txt';
  }
  const rel = `evidence/${id}${ext}`;
  await fs.writeFile(path.join(dir, rel), data, { flag: 'wx' });
  const record = { id, kind, path: rel, sha256: sha256(data), bytes: data.length, locator, note, captured: now() };
  state.evidence.push(record);
  return record;
}

async function evidence(dir, state, a) {
  const record = await addEvidence(dir, state, a);
  await writeCase(dir, state);
  return { caseId: path.basename(dir), evidence: record, next: `Cite it in a claim: re_case {action:"claim", caseId:"${path.basename(dir)}", statement, evidence:["${record.id}"], confidence}.` };
}

async function claim(dir, state, a) {
  const statement = need(a.statement, 'Missing statement: what you claim.');
  if (statement.length < 8) throw new RPError('INVALID_ARGUMENT', 'The statement is too short to check.');
  const confidence = a.confidence ?? 'inferred';
  const refs = a.evidence ?? [];
  if (!refs.length) throw new RPError('INVALID_ARGUMENT', 'Every claim cites evidence: evidence:["E001"]. Save the evidence first.');
  const known = new Set(state.evidence.map(e => e.id));
  const bad = refs.filter(r => !known.has(r));
  if (bad.length || new Set(refs).size !== refs.length) throw new RPError('INVALID_ARGUMENT', `Unknown or repeated evidence ids: ${bad.join(', ') || 'repeated'}. Known: ${[...known].join(', ') || 'none'}.`);
  if (confidence === 'observed' && !(a.locator?.trim() && a.alternative?.trim() && a.falsifier?.trim())) {
    throw new RPError('INVALID_ARGUMENT', 'An observed claim needs locator (exact place), alternative (a competing explanation) and falsifier (the check that would prove it wrong). Otherwise use confidence:"inferred".');
  }
  const id = newId(state.claims, 'C');
  state.claims.push({ id, statement, evidence: refs, confidence, locator: a.locator?.trim() ?? '', alternative: a.alternative?.trim() ?? '', falsifier: a.falsifier?.trim() ?? '', created: now() });
  await writeCase(dir, state);
  return { caseId: path.basename(dir), claim: id, confidence, next: confidence === 'unresolved' ? 'Name what would resolve it, or record it as a limitation.' : 'When the claims support a route: re_case {action:"phase", to:"decide"}, then a decision.' };
}

async function decision(dir, state, a) {
  const choose = need(a.choose, 'Missing choose: the route you pick.');
  const why = need(a.why, 'Missing why: the trade-off that decided it.');
  const revisitWhen = need(a.revisitWhen, 'Missing revisitWhen: what would make you change your mind.');
  const insteadOf = (a.insteadOf ?? []).map(s => String(s).trim()).filter(Boolean);
  if (!insteadOf.length) throw new RPError('INVALID_ARGUMENT', 'Name at least one real alternative you rejected: insteadOf:["…"].');
  if (insteadOf.includes(choose)) throw new RPError('INVALID_ARGUMENT', 'The chosen route cannot also be a rejected alternative.');
  const known = new Set(state.claims.map(c => c.id));
  const bad = (a.claims ?? []).filter(c => !known.has(c));
  if (bad.length) throw new RPError('INVALID_ARGUMENT', `Unknown claim ids: ${bad.join(', ')}.`);
  const id = newId(state.decisions, 'D');
  state.decisions.push({ id, choose, insteadOf, why, claims: a.claims ?? [], reversible: a.reversible === true, revisitWhen, created: now() });
  await writeCase(dir, state);
  return { caseId: path.basename(dir), decision: id, next: (a.claims ?? []).length ? 're_case {action:"phase", to:"build"} when you start building.' : 'This decision rests on no claim: it is an explicit assumption. Cite claims if you have them.' };
}

async function test(dir, state, a) {
  const label = need(a.label, 'Missing label: which test.');
  const scope = need(a.scope, 'Missing scope: what the test covers.');
  if (!Number.isInteger(a.exitCode)) throw new RPError('INVALID_ARGUMENT', 'Missing exitCode: the exit code the test run returned.');
  const ev = await addEvidence(dir, state, { file: a.log, content: a.content, locator: `test: ${label}`, note: scope }, 'test-log');
  const id = newId(state.tests, 'T');
  state.tests.push({ id, label, evidence: ev.id, exitCode: a.exitCode, scope, recorded: now(), attestation: 'reported by the agent; log integrity checked, the run itself is not attested' });
  await writeCase(dir, state);
  return { caseId: path.basename(dir), test: id, evidence: ev.id, next: a.exitCode === 0 ? 'Also record a failing or edge case when you have one.' : 'A failing run is useful evidence; fix and record the passing run too.' };
}

async function approve(dir, state, a) {
  if (!APPROVALS.includes(a.operation)) throw new RPError('INVALID_ARGUMENT', `operation must be one of ${APPROVALS.join(', ')}.`);
  const reason = need(a.reason, 'Missing reason: who approved it and why.');
  state.approvals.push({ operation: a.operation, reason, recorded: now() });
  await writeCase(dir, state);
  return { caseId: path.basename(dir), approval: a.operation, note: 'Recorded as an audit statement; it does not prove who approved.' };
}

// Residual unknowns (after REA's unknowns): questions still open. They block delivery until resolved by a claim or
// knowingly carried as a limitation, so nothing unanswered is presented as settled.
async function unknown(dir, state, a) {
  const question = need(a.text, 'Missing text: the open question (what is not known yet).');
  state.unknowns ??= [];
  const id = newId(state.unknowns, 'U');
  state.unknowns.push({ id, question, status: 'open', created: now() });
  await writeCase(dir, state);
  return { caseId: path.basename(dir), unknown: id, open: state.unknowns.filter(u => u.status === 'open').length, next: `When answered: re_case {action:"resolve", unknownId:"${id}", claims:["C…"]}; if it stays open: resolve with asLimitation:true.` };
}

async function resolve(dir, state, a) {
  const u = (state.unknowns ?? []).find(x => x.id === a.unknownId);
  if (!u) throw new RPError('INVALID_ARGUMENT', `Unknown unknownId "${a.unknownId ?? ''}". Open: ${(state.unknowns ?? []).filter(x => x.status === 'open').map(x => x.id).join(', ') || 'none'}.`);
  if (u.status !== 'open') throw new RPError('INVALID_ARGUMENT', `${u.id} is already ${u.status}.`);
  if (a.asLimitation === true) {
    u.status = 'carried';
    state.limitations.push(`Still unknown (${u.id}): ${u.question}${a.text?.trim() ? ` — ${a.text.trim()}` : ''}`);
  } else {
    const known = new Set(state.claims.map(c => c.id));
    const refs = a.claims ?? [];
    if (!refs.length || refs.some(r => !known.has(r))) throw new RPError('INVALID_ARGUMENT', 'Resolve with the claim ids that answer it (claims:["C001"]), or asLimitation:true to carry it as a limitation.');
    u.status = 'resolved';
    u.claims = refs;
  }
  u.closed = now();
  await writeCase(dir, state);
  return { caseId: path.basename(dir), unknown: u.id, status: u.status, open: state.unknowns.filter(x => x.status === 'open').length };
}

async function limit(dir, state, a) {
  state.limitations.push(need(a.text, 'Missing text: the limitation or open risk.'));
  await writeCase(dir, state);
  return { caseId: path.basename(dir), limitations: state.limitations.length };
}

function safeEvidencePath(dir, rel) {
  if (typeof rel !== 'string' || !/^evidence\/[A-Z]\d{3,}\.[a-z0-9]{1,10}$/.test(rel)) return null;
  return path.join(dir, rel);
}

export async function checkCase(dir, state, strict = false) {
  const errors = [], warnings = [];
  const ev = new Set();
  for (const e of state.evidence ?? []) {
    if (ev.has(e.id) || !ID.test(e.id ?? '') || !e.id.startsWith('E')) errors.push(`Duplicate or invalid evidence id: ${e.id}`);
    ev.add(e.id);
    const p = safeEvidencePath(dir, e.path);
    let ok = false;
    if (p) { try { const st = await fs.lstat(p); ok = st.isFile() && await sha256File(p) === e.sha256; } catch { ok = false; } }
    if (!ok) errors.push(`Evidence ${e.id}: missing, unsafe path or SHA-256 mismatch`);
    if (!e.locator || !e.note) errors.push(`Evidence ${e.id}: locator or note missing`);
  }
  const cl = new Set();
  for (const c of state.claims ?? []) {
    if (cl.has(c.id) || !ID.test(c.id ?? '') || !c.id.startsWith('C')) errors.push(`Duplicate or invalid claim id: ${c.id}`);
    cl.add(c.id);
    if (!c.statement || !c.evidence?.length || !c.evidence.every(r => ev.has(r))) errors.push(`Claim ${c.id}: missing statement or evidence`);
    if (!CONFIDENCE.includes(c.confidence)) errors.push(`Claim ${c.id}: invalid confidence`);
    if (c.confidence === 'observed' && !(c.locator && c.alternative && c.falsifier)) errors.push(`Claim ${c.id}: observed claim without locator, alternative and falsifier`);
  }
  for (const d of state.decisions ?? []) {
    if (!d.choose || !d.insteadOf?.length || !d.why || !d.revisitWhen) errors.push(`Decision ${d.id}: missing choice, alternative, trade-off or revisit condition`);
    if (!(d.claims ?? []).every(c => cl.has(c))) errors.push(`Decision ${d.id}: cites unknown claims`);
  }
  for (const t of state.tests ?? []) if (!ev.has(t.evidence) || !Number.isInteger(t.exitCode)) errors.push(`Test ${t.id}: invalid log or exit code`);
  const at = PHASES.indexOf(state.phase);
  if (at < 0) errors.push('Invalid phase');
  if (['investigate', 'audit', 'extract'].includes(state.intent) && !state.authorized) warnings.push('Authorization to examine the target is not recorded; keep to passive work on what the user owns or may examine.');
  if (at >= 3 && !state.decisions.length) errors.push('Decision gate: choose a route and name what you rejected before building.');
  if (at >= 4 && !state.tests.some(t => t.exitCode === 0)) errors.push('Verification gate: record at least one passing test.');
  if (at >= 4 && !state.tests.some(t => t.exitCode !== 0)) warnings.push('No failing or negative test recorded; edge cases may be untested.');
  if (!state.evidence.length) warnings.push('No evidence saved.');
  if (!state.claims.length) warnings.push('No claims recorded.');
  if (at >= 2 && !state.decisions.length) warnings.push('No decision recorded.');
  const unknownIds = new Set();
  for (const u of state.unknowns ?? []) {
    if (unknownIds.has(u.id) || !ID.test(u.id ?? '') || !u.id.startsWith('U')) errors.push(`Duplicate or invalid unknown id: ${u.id}`);
    unknownIds.add(u.id);
    if (u.status === 'resolved' && !(u.claims ?? []).every(c => cl.has(c))) errors.push(`Unknown ${u.id}: resolved by unknown claims`);
  }
  const open = (state.unknowns ?? []).filter(u => u.status === 'open');
  if (open.length && at >= 4) warnings.push(`Open unknowns: ${open.map(u => u.id).join(', ')}; resolve them or carry them as limitations before delivery.`);
  if (state.phase === 'deliver') {
    if (open.length) errors.push(`Delivery gate: open unknowns ${open.map(u => u.id).join(', ')}.`);
    if (!state.limitations.length) errors.push('Delivery gate: state the limitations.');
    if (!await exists(path.join(dir, 'REPORT.md'))) errors.push('Delivery gate: render the report first.');
  }
  if (strict && warnings.length) { errors.push(...warnings.map(w => `Strict: ${w}`)); warnings.length = 0; }
  return { passed: errors.length === 0, errors, warnings };
}

async function phase(dir, state, a) {
  const to = a.to;
  const from = PHASES.indexOf(state.phase);
  if (!PHASES.includes(to) || PHASES.indexOf(to) !== from + 1) throw new RPError('INVALID_ARGUMENT', `Phases move one step forward: from ${state.phase} the next is ${PHASES[from + 1] ?? 'none (delivered)'}.`);
  const gate = { decide: [!state.evidence.length, 'Investigation gate: save some evidence first.'], build: [!state.decisions.length, 'Decision gate: record a decision with a rejected alternative.'], verify: [!state.tests.length, 'Verification gate: record a real test log first.'], deliver: [!state.limitations.length, 'Delivery gate: record the limitations first.'] }[to];
  const openUnknowns = (state.unknowns ?? []).filter(u => u.status === 'open');
  if (to === 'deliver' && openUnknowns.length) throw new RPError('GATE_FAILED', `Delivery gate: open unknowns ${openUnknowns.map(u => u.id).join(', ')}. Resolve them with claims, or resolve with asLimitation:true.`);
  if (gate?.[0]) throw new RPError('GATE_FAILED', gate[1]);
  if (to === 'deliver' && !await exists(path.join(dir, 'REPORT.md'))) throw new RPError('GATE_FAILED', 'Delivery gate: re_case {action:"report"} first.');
  const next = { ...state, phase: to, phaseHistory: [...state.phaseHistory, { phase: to, at: now() }] };
  const result = await checkCase(dir, next);
  if (!result.passed) throw new RPError('GATE_FAILED', `Gate failed: ${result.errors.join('; ')}`);
  await writeCase(dir, next);
  return { caseId: path.basename(dir), phase: to, warnings: result.warnings };
}

const md = s => String(s ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').replace(/`/g, "'");

async function report(dir, state) {
  const { errors, warnings } = await checkCase(dir, state);
  const L = ['# Case report', '', `**Question:** ${md(state.question)}`, `**Target:** ${md(state.target)}`, `**Intent:** ${state.intent}`, `**Phase:** ${state.phase}`, `**Authorization recorded:** ${state.authorized}`, '',
    '## Evidence (integrity-checked)', '', '| ID | Kind | Saved file | Locator | Note |', '|---|---|---|---|---|',
    ...state.evidence.map(e => `| ${e.id} | ${e.kind} | \`${e.path}\` sha256 \`${e.sha256.slice(0, 12)}…\` | ${md(e.locator)} | ${md(e.note)} |`),
    '', '## Claims (hashes do not make a claim true)', '', '| ID | Confidence | Claim | Evidence | Competing explanation | Falsifier |', '|---|---|---|---|---|---|',
    ...state.claims.map(c => `| ${c.id} | ${c.confidence} | ${md(c.statement)} | ${c.evidence.join(', ')} | ${md(c.alternative)} | ${md(c.falsifier)} |`),
    '', '## Decisions and rejected alternatives', ''];
  for (const d of state.decisions) L.push(`### ${d.id}: ${md(d.choose)}`, `- Rejected: ${d.insteadOf.map(md).join('; ')}`, `- Why: ${md(d.why)}`, `- Claims: ${d.claims.join(', ') || 'none (explicit assumption)'}`, `- Reversible: ${d.reversible}`, `- Revisit when: ${md(d.revisitWhen)}`, '');
  L.push('## Tests (recorded by the agent)', '', '| ID | Test | Exit code | Log | Scope |', '|---|---|---|---|---|', ...state.tests.map(t => `| ${t.id} | ${md(t.label)} | ${t.exitCode} | ${t.evidence} | ${md(t.scope)} |`));
  L.push('', '## Approvals on record (not proof of identity)', '', ...(state.approvals.length ? state.approvals.map(x => `- ${x.operation}: ${md(x.reason)}`) : ['- none']));
  L.push('', '## Unknowns', '', ...((state.unknowns ?? []).length ? state.unknowns.map(u => `- ${u.id} (${u.status}${u.claims ? `: ${u.claims.join(', ')}` : ''}): ${md(u.question)}`) : ['- none recorded']));
  L.push('', '## Limitations and open risks', '', ...(state.limitations.length ? state.limitations.map(x => `- ${md(x)}`) : ['- none recorded']));
  L.push('', '## Gates', '', ...errors.map(e => `- ERROR: ${e}`), ...warnings.map(w => `- WARNING: ${w}`), ...(errors.length || warnings.length ? [] : ['- No findings.']));
  L.push('', '_SHA-256 proves saved files did not change. It does not prove the source was authentic, a claim is right, authorization was given or a test really ran._', '');
  const file = path.join(dir, 'REPORT.md');
  await fs.writeFile(file, L.join('\n'));
  return { caseId: path.basename(dir), report: file, passed: errors.length === 0, errors, warnings };
}

async function show(dir, state) {
  const { passed, errors, warnings } = await checkCase(dir, state);
  return { caseId: path.basename(dir), folder: dir, question: state.question, target: state.target, intent: state.intent, phase: state.phase, counts: { evidence: state.evidence.length, claims: state.claims.length, decisions: state.decisions.length, tests: state.tests.length, limitations: state.limitations.length, openUnknowns: (state.unknowns ?? []).filter(u => u.status === 'open').length }, unknowns: (state.unknowns ?? []).map(({ id, status, question }) => ({ id, status, question })), evidence: state.evidence.map(({ id, kind, locator }) => ({ id, kind, locator })), claims: state.claims.map(({ id, confidence, statement }) => ({ id, confidence, statement })), passed, errors, warnings };
}

async function list() {
  const root = path.join(workspaceRoot(), 'cases');
  let names = [];
  try { names = (await fs.readdir(root, { withFileTypes: true })).filter(d => d.isDirectory()).map(d => d.name); } catch { /* no cases yet */ }
  const cases = [];
  for (const n of names.sort()) {
    try { const s = await readCase(path.join(root, n)); cases.push({ caseId: n, question: s.question, phase: s.phase, evidence: s.evidence.length, claims: s.claims.length }); } catch { cases.push({ caseId: n, unreadable: true }); }
  }
  return { cases, next: cases.length ? 're_case {action:"show", caseId} for one case.' : 'Start one: re_case {action:"init", question, target}.' };
}

async function exists(p) { try { await fs.access(p); return true; } catch { return false; } }

export async function caseTool(a) {
  const action = a.action;
  if (action === 'init') return init(a);
  if (action === 'list') return list();
  const dir = await caseDir(a.caseId);
  const state = await readCase(dir);
  switch (action) {
    case 'evidence': return evidence(dir, state, a);
    case 'claim': return claim(dir, state, a);
    case 'decision': return decision(dir, state, a);
    case 'test': return test(dir, state, a);
    case 'approve': return approve(dir, state, a);
    case 'limit': return limit(dir, state, a);
    case 'unknown': return unknown(dir, state, a);
    case 'resolve': return resolve(dir, state, a);
    case 'phase': return phase(dir, state, a);
    case 'check': return { caseId: a.caseId, phase: state.phase, ...(await checkCase(dir, state, a.strict === true)) };
    case 'report': return report(dir, state);
    case 'show': return show(dir, state);
    case 'remember': return { caseId: a.caseId, ...(await propose(a.caseId, state)) };
    default: throw new RPError('INVALID_ARGUMENT', `action must be one of ${ACTIONS.join(', ')}.`);
  }
}
