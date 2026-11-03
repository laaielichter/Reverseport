// Dormant-logic checks for port_verify: a port can have every function name and still do nothing.
// - empty bodies: functions whose body is only pass / return / null / a TODO / a thrown "not implemented"
// - thin bodies: the source function had many statements, the port has very few
// - unwired: functions the source called (or signals it connected) that the port defines but never calls/connects
// - suppressions the port added: as any, @ts-ignore, eslint-disable, @warning_ignore, #pragma warning disable, @SuppressWarnings
// Language-agnostic by design: it works on braces/indentation and statement counts, never on a full parse.
import { extractSymbols, stripComments, languageOf } from './symbols.mjs';
import { nameKey } from './util.mjs';

const INDENT_LANGS = new Set(['gdscript', 'python']);
const EMPTY_BODY = /^\s*(?:pass|return(?:\s+(?:null|nil|None|0|false|\{\}|\[\]|""|''|new\s+\w+\(\)|default))?\s*;?|throw\s+new\s+(?:NotImplementedException|Error\(["'][^"']*not implemented[^"']*["']\))\s*\(?\)?\s*;?|print(?:_debug|_rich)?\([^)]*\)|console\.(?:log|warn)\([^)]*\);?|Debug\.Log(?:Warning)?\([^)]*\);?|UE_LOG\([^)]*\);?|\.\.\.|TODO.*|PORT.*|FIXME.*|\/\/.*|#.*)\s*$/;
const SUPPRESSIONS = [
  { re: /\bas\s+any\b/g, what: 'as any' }, { re: /@ts-ignore|@ts-nocheck|@ts-expect-error/g, what: '@ts-ignore' }, { re: /eslint-disable/g, what: 'eslint-disable' },
  { re: /@warning_ignore\s*\(/g, what: '@warning_ignore' }, { re: /#pragma\s+warning\s+disable/g, what: '#pragma warning disable' }, { re: /@SuppressWarnings\s*\(/g, what: '@SuppressWarnings' },
  { re: /#\s*noqa\b|#\s*type:\s*ignore/g, what: '# noqa / type: ignore' }, { re: /\bunsafe\s*\{/g, what: 'unsafe block' }, { re: /\.unwrap\(\)\s*;?\s*\/\/\s*(?:TODO|PORT|FIXME)/g, what: 'unwrap with a TODO' },
];

/** Split code into function bodies by name: { name, line, body, statements }. Best effort, no full parser. */
export function functionBodies(text, language) {
  const code = stripComments(text, language);
  const sym = extractSymbols(code, language);
  const lines = code.split('\n');
  const lineStart = [0];
  for (let i = 0; i < code.length; i++) if (code[i] === '\n') lineStart.push(i + 1);
  const fns = [...sym.functions].sort((a, b) => a.line - b.line);
  const out = [];
  for (let i = 0; i < fns.length; i++) {
    const start = fns[i].line - 1;
    let body;
    if (INDENT_LANGS.has(language)) {
      const indent = lines[start].match(/^[ \t]*/)[0].length;
      let end = start + 1;
      while (end < lines.length && (!lines[end].trim() || lines[end].match(/^[ \t]*/)[0].length > indent)) end++;
      body = lines.slice(start + 1, end).join('\n');
      const same = lines[start].match(/:\s*(\S.*)$/); // `func f(): return 1`
      if (!body.trim() && same && !/^\s*(?:->|:)/.test(same[1])) body = same[1];
    } else {
      // Brace languages: from the first { after the signature to its matching } (strings skipped), or `=> expr`.
      const from = lineStart[start];
      const nextSig = i + 1 < fns.length ? lineStart[fns[i + 1].line - 1] : code.length;
      const head = code.slice(from, Math.min(code.length, from + 600));
      const arrow = head.match(/\)\s*(?:[\w<>[\],?]+\s+)?=>\s*([^\n;{]+)/);
      const brace = head.indexOf('{');
      if (arrow && (brace < 0 || head.indexOf('=>') < brace)) body = arrow[1];
      else if (brace >= 0) {
        let depth = 0, j = from + brace, quote = null;
        for (; j < code.length; j++) {
          const ch = code[j];
          if (quote) { if (ch === '\\') j++; else if (ch === quote) quote = null; continue; }
          if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
          if (ch === '{') depth++; else if (ch === '}') { depth--; if (depth === 0) break; }
        }
        body = code.slice(from + brace + 1, Math.min(j, nextSig > from + brace ? Math.max(j, 0) : j));
      } else body = '';
    }
    const statements = body.split(/[\n;]/).map(l => l.trim()).filter(l => l && !/^[{}]$/.test(l) && !/^(?:\/\/|#|\*|\/\*)/.test(l));
    out.push({ name: fns[i].name, line: fns[i].line, body, statements: statements.length, empty: statements.length === 0 || (statements.length <= 2 && statements.every(s => EMPTY_BODY.test(s))) });
  }
  return { functions: out, signals: sym.signals ?? [], code };
}

/** Names called or connected somewhere in `code` (not at their own definition). */
export function callSites(code, defined) {
  const calls = new Map();
  for (const name of defined) {
    const key = name.replace(/[^\w]/g, '');
    if (!key) continue;
    const re = new RegExp(`(?<![\\w.])(?:[\\w.]+\\.)?${key}\\s*\\(|["'&]${key}["')]|[(,]\\s*(?:self\\.|this\\.)?${key}\\s*[,)]|[+-]=\\s*(?:self\\.|this\\.)?${key}\\b|Callable\\([^)]*["']${key}["']\\)|nameof\\(${key}\\)`, 'g');
    const defRe = new RegExp(`\\b(?:func|def|function|void|int|bool|float|string|var|let|const|async|public|private|protected|static|override|fn)\\b[^\\n]*\\b${key}\\s*\\(`, 'g');
    const total = (code.match(re) ?? []).length;
    const defs = (code.match(defRe) ?? []).length;
    calls.set(name, Math.max(0, total - defs));
  }
  return calls;
}

/**
 * Compare one ported unit with its source.
 * Returns findings: [{ kind, name, detail }], with kinds empty-body, thin-body, unwired, suppression.
 */
export function dormantFindings({ sourceText, sourceLang, targetText, targetLang, lifecycleGroups = [] }) {
  const findings = [];
  const tgt = functionBodies(targetText, targetLang);
  const src = sourceText && sourceLang ? functionBodies(sourceText, sourceLang) : null;
  const srcByKey = new Map((src?.functions ?? []).map(f => [nameKey(f.name), f]));
  const lifecycleKeys = new Set(lifecycleGroups.flat().map(nameKey));

  for (const f of tgt.functions) {
    if (f.empty) {
      const s = srcByKey.get(nameKey(f.name)) ?? [...srcByKey.values()].find(x => sameLifecycle(x.name, f.name, lifecycleGroups));
      if (!s || !s.empty) findings.push({ kind: 'empty-body', name: f.name, line: f.line, detail: s ? `source has ${s.statements} statement(s); the port's body is empty or a stub` : 'body is empty or a stub' });
    } else if (src) {
      const s = srcByKey.get(nameKey(f.name)) ?? [...srcByKey.values()].find(x => sameLifecycle(x.name, f.name, lifecycleGroups));
      if (s && s.statements >= 6 && f.statements * 3 < s.statements) findings.push({ kind: 'thin-body', name: f.name, line: f.line, detail: `source has ${s.statements} statement(s), the port ${f.statements}` });
    }
  }

  if (src) {
    const srcCalls = callSites(src.code, src.functions.map(f => f.name));
    const tgtCalls = callSites(tgt.code, tgt.functions.map(f => f.name));
    for (const f of tgt.functions) {
      const key = nameKey(f.name);
      if (lifecycleKeys.has(key) || /^_/.test(f.name) && lifecycleKeys.has(key)) continue;
      const s = srcByKey.get(key);
      if (!s) continue;
      const calledInSource = srcCalls.get(s.name) ?? 0;
      const calledInPort = tgtCalls.get(f.name) ?? 0;
      if (calledInSource > 0 && calledInPort === 0) findings.push({ kind: 'unwired', name: f.name, line: f.line, detail: `the source calls/connects it ${calledInSource}×; nothing in the port does` });
    }
    for (const sig of src.signals) {
      const srcUses = (src.code.match(new RegExp(`\\b${sig.name}\\b\\.(?:connect|emit)|emit_signal\\(\\s*["']${sig.name}["']`, 'g')) ?? []).length;
      const variants = [sig.name, sig.name.replace(/_(\w)/g, (_, c) => c.toUpperCase()), sig.name[0].toUpperCase() + sig.name.slice(1).replace(/_(\w)/g, (_, c) => c.toUpperCase())];
      const portUses = variants.reduce((n, v) => n + (tgt.code.match(new RegExp(`\\b${v}\\b\\s*(?:\\?\\.|\\.)?\\s*(?:Invoke|emit|connect|\\()|emit_signal\\(\\s*["']${v}["']|EmitSignal\\(\\s*(?:SignalName\\.)?${v}\\b|\\b${v}\\b\\s*[+-]=|\\.(?:on|addEventListener|emit)\\(\\s*["']${v}["']`, 'g')) ?? []).length, 0);
      if (srcUses > 0 && portUses === 0) findings.push({ kind: 'unwired', name: `signal ${sig.name}`, detail: `emitted/connected ${srcUses}× in the source; the port only declares it (or not at all)` });
    }
  }

  const srcSupp = countSuppressions(sourceText ?? '');
  for (const { what, count } of countSuppressions(targetText)) {
    const before = srcSupp.find(s => s.what === what)?.count ?? 0;
    if (count > before) findings.push({ kind: 'suppression', name: what, detail: `${count}× in the port (${before}× in the source): hides errors instead of porting them` });
  }
  return findings;
}

function sameLifecycle(a, b, groups) { return groups.some(g => g.map(nameKey).includes(nameKey(a)) && g.map(nameKey).includes(nameKey(b))); }

export function countSuppressions(text) {
  return SUPPRESSIONS.map(s => ({ what: s.what, count: (text.match(s.re) ?? []).length })).filter(s => s.count);
}

/**
 * A compact "resume pack" for an agent that lost its context: what the plan is, where it stands, the next unit with
 * the signatures of its already-ported dependencies, and the open findings. Sized for a budget in characters.
 */
export function resumePack(plan, { verify = null, budget = 6000 } = {}) {
  const units = plan.units ?? [];
  const done = units.filter(u => u.status === 'done').length;
  const next = units.find(u => u.status === 'in_progress') ?? units.find(u => u.status === 'pending');
  const lines = [
    `# Port ${plan.id}: ${plan.from} → ${plan.to}`,
    `source ${plan.source}`, `output ${plan.output}`,
    `progress ${done}/${units.length} done, ${units.filter(u => u.status === 'partial').length} partial, ${units.filter(u => u.status === 'skipped').length} skipped`,
  ];
  if (next) {
    lines.push('', `## Next: ${next.id} ${next.source} → ${next.target} (${next.action})`);
    const deps = (next.dependsOn ?? []).map(d => units.find(u => u.id === d)).filter(Boolean);
    for (const d of deps.slice(0, 12)) lines.push(`- dep ${d.id} ${d.target} [${d.status}]${d.targetSymbols ? `: ${[...(d.targetSymbols.functions ?? d.targetSymbols)].slice(0, 8).map(x => x.name ?? x).join(', ')}` : ''}`);
  }
  if (verify) {
    const n = x => (Array.isArray(x) ? x.length : typeof x === 'number' ? x : 0);
    lines.push('', `## Verify${verify.at ? ` (${verify.at})` : ''}: ${verify.passed ? 'passed' : 'not passed'} (${n(verify.errors)} errors, ${n(verify.warnings)} warnings)`);
    for (const w of (Array.isArray(verify.warnings) ? verify.warnings : []).slice(0, 15)) lines.push(`- ${w.unit ?? ''} ${w.issue}${w.findings ? `: ${w.findings.slice(0, 4).map(f => `${f.kind} ${f.name}`).join(', ')}` : ''}`.trim());
  }
  lines.push('', `## Rules`, `- Port every statement; an empty body or "as any" is not done.`, `- After each unit: port_write, then port_verify before claiming completion.`);
  let text = lines.join('\n');
  if (text.length > budget) text = text.slice(0, budget - 20) + '\n… (truncated)';
  return text;
}
