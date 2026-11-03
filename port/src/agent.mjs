// Agent experience helpers shared by every door (MCP, HTTP, CLI): one error shape with a next step, tool
// annotations, tool definitions in every vendor's function-calling format, "did you mean" suggestions and the
// feedback inbox.
import fs from 'node:fs/promises';
import path from 'node:path';
import { RPError } from './util.mjs';
import { workspaceRoot } from './workspace.mjs';

// ---------------------------------------------------------------------------------------------------- errors
// The same fields and categories as the deep-analysis engine's error contract (code, category, retryable,
// remediation), so an agent can branch on one shape whichever tool failed. ReversePort's codes are UPPERCASE; the
// engine's are lowercase.
const ERRORS = {
  INVALID_ARGUMENT: ['invalid_input', false, 'Correct the argument named in the message (the tool schema lists every argument), then call again.'],
  UNKNOWN_TOOL: ['invalid_input', false, 'Use a tool name from tools/list; the message names the closest one when there is one.'],
  NOT_FOUND: ['invalid_input', false, 'Check the path; absolute paths are safest. Ask the user where the file is if you cannot find it.'],
  NOT_A_FILE: ['invalid_input', false, 'This tool needs a file. For a folder use re_scan.'],
  NOT_A_FOLDER: ['invalid_input', false, 'This tool needs a folder. For a single file use re_binary, re_archive or re_probe.'],
  ACCESS_DENIED: ['unavailable', false, 'The file or folder is not readable for this process. Ask the user to grant access or copy it somewhere readable.'],
  UNSAFE_PATH: ['invalid_input', false, 'Use a path relative to the output project, without "..".'],
  OUTPUT_NOT_EMPTY: ['invalid_input', false, 'Choose a new or empty output folder; ReversePort never overwrites files it did not create.'],
  TOO_LARGE: ['resource_constraint', false, 'Narrow the request (match, limit, a subfolder, or a smaller byte range).'],
  NETWORK: ['unavailable', true, 'A public source could not be reached. Retry later, or continue with the sources that answered (see sources) or with local files.'],
  PRIVATE_ADDRESS: ['invalid_input', false, 'Lookups only read public web addresses. Use local tools (re_scan, re_binary) for files on this machine.'],
  BAD_FORMAT: ['unsupported_target', false, 'The file is not in a format this tool reads. re_probe identifies unknown data.'],
  UNSUPPORTED_SCENE: ['unsupported_target', false, 'Open the scene in Godot and save it as .tscn/.tres, then call again.'],
  UNSUPPORTED_ARCHIVE: ['unsupported_target', false, 'This pack type is identified but not readable here; port from the project source instead.'],
  UNSUPPORTED_VERSION: ['unsupported_target', false, 'This format version is not supported; say so to the user and continue with what can be read.'],
  NOT_A_PCK: ['invalid_input', false, 'No Godot pack found. The pack may be a separate *.pck next to the executable; re_scan the build folder.'],
  ENCRYPTED: ['unsupported_target', false, 'Encrypted content is reported, never decrypted. Use the project source.'],
  SOURCE_ERROR: ['unavailable', true, 'A public source answered with an error. Continue with the sources that answered, or retry later.'],
  ENGINE_UNAVAILABLE: ['unavailable', false, 'Deep-analysis tools need the built engine. Ask the user first, then `npx -y reverseport@latest setup`, or in a git checkout `npm ci && npm run build`, and restart the client. ReversePort\'s own tools keep working meanwhile.'],
  ENGINE_OFF: ['unavailable', false, 'The engine is turned off with REVERSEPORT_ENGINE=off. Unset it and reconnect to use engine tools; ReversePort\'s own tools keep working.'],
  ENGINE_STOPPED: ['unavailable', true, 'Call the engine tool again once: the server restarts the engine. If it stops again, tell the user and continue with ReversePort\'s own tools.'],
  ENGINE_RESTART_LIMIT: ['unavailable', false, 'The engine kept stopping and will not restart in this session. Tell the user, suggest `reverseport doctor` and a client restart, and continue with ReversePort\'s own tools.'],
  PLAN_UNREADABLE: ['execution_failure', false, 'Tell the user the plan file is damaged and has no usable backup. A new port_plan into a new output folder starts over; files already written stay where they are.'],
  UNKNOWN_PLAN: ['invalid_input', false, 'port_status {} lists the port plans in this workspace; use one of their planIds.'],
  UNKNOWN_CASE: ['invalid_input', false, 're_case {action:"list"} lists the cases; use one of their caseIds, or init a new one.'],
  GATE_FAILED: ['invalid_input', false, 'Do what the gate names (save evidence, record a decision, a test or limitations), then move the phase again. re_case {action:"check"} shows every finding.'],
  UNKNOWN_UNIT: ['invalid_input', false, 'port_status {planId} lists the units; omit unit to get the next one.'],
  UNKNOWN_ENDPOINT: ['invalid_input', false, 'Use one of the endpoints the message lists; GET /api/openapi.json describes every tool call.'],
  FORBIDDEN_HOST: ['invalid_input', false, 'Call ReversePort on 127.0.0.1 or localhost.'],
  FORBIDDEN_ORIGIN: ['invalid_input', false, 'Only pages served from localhost may call ReversePort from a browser.'],
  UNAUTHORIZED: ['invalid_input', false, 'Send the token the user set in REVERSEPORT_TOKEN as Authorization: Bearer <token>.'],
  TOOL_FAILED: ['execution_failure', true, 'Something unexpected failed. Retry once; if it fails again, tell the user what you were doing and continue with other tools.'],
};
const NODE_CODES = { ENOENT: 'NOT_FOUND', EACCES: 'ACCESS_DENIED', EPERM: 'ACCESS_DENIED', EISDIR: 'NOT_A_FILE', ENOTDIR: 'NOT_A_FOLDER', EFBIG: 'TOO_LARGE' };

/** One error object for every door: { code, category, retryable, message, remediation: { action }, details? }. */
export function errorPayload(e) {
  const raw = e?.code;
  const code = ERRORS[raw] ? raw : NODE_CODES[raw] ?? (typeof raw === 'string' && /^[A-Z_]+$/.test(raw) ? raw : 'TOOL_FAILED');
  const [category, retryable, action] = ERRORS[code] ?? ERRORS.TOOL_FAILED;
  return { code, category, retryable: typeof e?.retryable === 'boolean' ? e.retryable : retryable, message: String(e?.message ?? e), remediation: { action: e?.remediation ?? action }, ...(e?.details ? { details: e.details } : {}) };
}

// ---------------------------------------------------------------------------------------------------- suggestions
/**
 * The candidate a typo most likely meant, or null. Short words allow fewer edits (a third of their length, at least
 * one), so "cobol" never becomes "godot"; swapped neighbours count as one edit, so "scna" is still "scan".
 */
export function closest(word, candidates, max = 2) {
  const w = String(word).toLowerCase();
  const limit = Math.min(max, Math.max(1, Math.floor(w.length / 3)));
  let best = null, bestD = Infinity;
  for (const c of candidates) {
    const d = distance(w, String(c).toLowerCase());
    if (d < bestD) { best = c; bestD = d; }
  }
  return bestD <= limit ? best : null;
}

/** Edit distance with adjacent swaps (optimal string alignment). */
function distance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

// ---------------------------------------------------------------------------------------------------- annotations
// MCP hints: clients use them to skip approval prompts for reads and to run reads in parallel.
const READ_ONLY = new Set(['re_scan', 're_graph', 're_symbols', 're_scene', 're_binary', 're_probe', 're_compare', 're_refs', 're_strings', 're_apicheck', 're_save', 're_decode', 're_il2cpp', 'port_map', 'port_trace', 'port_convert', 'port_status', 'port_verify']);
const OPEN_WORLD = new Set(['re_lookup']);

export function annotationsFor(name) {
  const readOnly = READ_ONLY.has(name);
  return { readOnlyHint: readOnly, destructiveHint: false, idempotentHint: readOnly || name === 'port_unit', openWorldHint: OPEN_WORLD.has(name) };
}

// ---------------------------------------------------------------------------------------------------- formats
export const FORMATS = ['mcp', 'openai', 'openai-strict', 'responses', 'anthropic', 'gemini', 'json-schema'];

/** Function-calling APIs cap a tool description at 1024 characters. */
export const FUNCTION_DESCRIPTION_MAX = 1024;

/** Text cut to `max` characters at the last whole sentence, or at a word with "…" when no sentence fits. */
export function fit(text, max) {
  const s = String(text ?? '');
  if (s.length <= max) return s;
  const head = s.slice(0, max);
  let end = -1;
  for (const m of head.matchAll(/[.!?](?=\s+[A-Z(`"'])/g)) if (!/\b(e\.g|i\.e|incl|etc|vs)$/i.test(head.slice(Math.max(0, m.index - 4), m.index))) end = m.index + 1;
  if (end > max / 3) return head.slice(0, end);
  const cut = head.slice(0, max - 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), max / 2)).replace(/[,;:(\s]+$/, '')}…`;
}

/** Tool definitions for any agent stack. `tools` are MCP-style: { name, title?, description, inputSchema, annotations? }. */
export function formatTools(tools, format = 'mcp') {
  const d = t => fit(t.description, FUNCTION_DESCRIPTION_MAX);
  switch (format) {
    case 'mcp': return tools.map(t => ({ name: t.name, ...(t.title ? { title: t.title } : {}), description: t.description, inputSchema: t.inputSchema, ...(t.annotations ? { annotations: t.annotations } : {}) }));
    case 'openai': return tools.map(t => ({ type: 'function', function: { name: t.name, description: d(t), parameters: t.inputSchema } }));
    case 'openai-strict': return tools.map(t => { const { parameters, strict } = strictOrPortable(t.inputSchema); return { type: 'function', function: { name: t.name, description: d(t), parameters, strict } }; });
    case 'responses': return tools.map(t => { const { parameters, strict } = strictOrPortable(t.inputSchema); return { type: 'function', name: t.name, description: d(t), parameters, strict }; });
    case 'anthropic': return tools.map(t => ({ name: t.name, description: t.description, input_schema: t.inputSchema }));
    case 'gemini': return [{ functionDeclarations: tools.map(t => ({ name: t.name, description: d(t), parameters: geminiSchema(portableSchema(t.inputSchema)) })) }];
    case 'json-schema': return Object.fromEntries(tools.map(t => [t.name, t.inputSchema]));
    default: throw new RPError('INVALID_ARGUMENT', `Unknown format "${format}". Formats: ${FORMATS.join(', ')}.`);
  }
}

/** Strict when the schema allows it; otherwise the portable schema with strict:false for that one tool. */
function strictOrPortable(schema) {
  const portable = portableSchema(schema);
  if (strictCompatible(portable)) return { parameters: strictSchema(portable), strict: true };
  // A free-form object (tool arguments for engine_call or run_batch) cannot be strict; as a JSON string it can,
  // and ReversePort parses such strings back.
  const stringly = freeformAsString(portable);
  return strictCompatible(stringly) ? { parameters: strictSchema(stringly), strict: true } : { parameters: portable, strict: false };
}

function freeformAsString(s, depth = 0) {
  if (!s || typeof s !== 'object' || depth > 6) return s;
  if (s.type === 'object' && depth > 0 && !Object.keys(s.properties ?? {}).length) return { type: 'string', description: `${s.description ?? ''} Give a JSON object as a string, e.g. {"path":"/game"}.`.trim() };
  if (s.type === 'object') return { ...s, properties: Object.fromEntries(Object.entries(s.properties ?? {}).map(([k, v]) => [k, freeformAsString(v, depth + 1)])) };
  if (s.type === 'array') return { ...s, items: freeformAsString(s.items, depth + 1) };
  return s;
}

function strictCompatible(s, depth = 0) {
  if (!s || typeof s !== 'object' || depth > 5) return false;
  if (s.type === 'object') return !!s.properties && Object.keys(s.properties).length > 0 && Object.values(s.properties).every(v => strictCompatible(v, depth + 1));
  if (s.type === 'array') return strictCompatible(s.items, depth + 1);
  return ['string', 'integer', 'number', 'boolean'].includes(s.type) || (Array.isArray(s.type) && s.type.every(t => ['string', 'integer', 'number', 'boolean', 'null'].includes(t)));
}

// The keywords the portable schema keeps. Everything else is left out — a list of what to keep, not of what to drop,
// so a keyword nobody thought of never slips through — and what helps the model (a format, a short pattern) moves into
// the description. The server still validates every call against the full schema.
const PORTABLE_KEYS = new Set(['type', 'description', 'properties', 'required', 'items', 'enum', 'additionalProperties', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'minLength', 'maxLength', 'minItems', 'maxItems', 'multipleOf', 'uniqueItems']);
const SIMPLE = new Set(['string', 'integer', 'number', 'boolean']);

const withNote = (s, note) => (note ? { ...s, description: `${s.description ?? ''}${s.description ? ' ' : ''}${note}`.trim() } : s);
const typeList = (...types) => [...new Set(types.flat().filter(Boolean))];
const oneOrList = types => (types.length === 1 ? types[0] : types);
const kindOf = v => (v.enum ? `one of ${v.enum.map(x => JSON.stringify(x)).join(', ')}` : v.type === 'array' ? 'a list' : v.type === 'object' ? 'an object' : Array.isArray(v.type) ? v.type.join(' or ') : `a ${v.type ?? 'value'}`);

/** The same property in two variants of a union: one schema that accepts what either accepted. */
function mergeVariant(a, b) {
  if (stableJson(a) === stableJson(b)) return a;
  const ta = typeList(a.type), tb = typeList(b.type);
  if (ta.length === 1 && tb.length === 1 && ta[0] === 'object' && tb[0] === 'object') {
    const properties = { ...(a.properties ?? {}) };
    for (const [k, p] of Object.entries(b.properties ?? {})) properties[k] = k in properties ? mergeVariant(properties[k], p) : p;
    const required = (a.required ?? []).filter(k => (b.required ?? []).includes(k));
    return { ...a, properties, required };
  }
  if ([...ta, ...tb].every(t => SIMPLE.has(t) || t === 'null')) {
    const { enum: ea, ...restA } = a;
    const merged = { ...restA, type: oneOrList(typeList(ta, tb)) };
    return a.enum && b.enum ? { ...merged, enum: [...new Set([...a.enum, ...b.enum])] } : merged; // one side free → free
  }
  return withNote(a, `(also accepts ${kindOf(b)})`);
}

/** "kind \"file\": path; kind \"pid\": pid" — which fields belong together when a union of objects is merged into one. */
function shapesNote(variants) {
  if (variants.length < 2) return '';
  const shared = Object.keys(variants[0].properties ?? {}).find(k => variants.every(v => v.properties?.[k]?.enum?.length === 1));
  const fields = v => {
    const names = (v.required?.length ? v.required : Object.keys(v.properties ?? {})).filter(k => k !== shared);
    return names.length ? names.join(', ') : 'no other fields';
  };
  const parts = variants.map((v, i) => (shared ? `${shared} ${JSON.stringify(v.properties[shared].enum[0])}: ${fields(v)}` : `(${i + 1}) ${fields(v)}`));
  return `Give the fields of one shape — ${parts.join('; ')}.`;
}

function stableJson(v) {
  return v && typeof v === 'object' ? (Array.isArray(v) ? `[${v.map(stableJson).join(',')}]` : `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${stableJson(v[k])}`).join(',')}}`) : JSON.stringify(v) ?? 'null';
}

/**
 * A schema every function-calling stack accepts: $ref inlined, unions folded without losing an option (simple types
 * into type lists, objects merged with every allowed value of a shared field kept, a list or object preferred over a
 * single value), const as enum, tuples as lists, and only widely supported keywords kept. Whatever this schema allows
 * the real one allows too; the server validates every call against the real one.
 */
export function portableSchema(schema, root = schema, depth = 0, seen = new Set()) {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return schema;
  if (schema.$ref) {
    const ref = schema.$ref;
    if (seen.has(ref) || depth > 12) return { type: 'object', description: schema.description ?? 'Recursive structure (see the tool description).' };
    const target = ref.startsWith('#/') ? ref.slice(2).split('/').reduce((o, k) => o?.[k.replace(/~1/g, '/').replace(/~0/g, '~')], root) : null;
    if (!target) return { description: schema.description ?? '' };
    const { $ref, ...rest } = schema;
    return portableSchema({ ...target, ...rest }, root, depth + 1, new Set([...seen, ref]));
  }
  const union = schema.anyOf ?? schema.oneOf;
  if (union) {
    const variants = union.map(v => portableSchema(v, root, depth + 1, seen));
    const { anyOf, oneOf, ...rest } = schema;
    const base = cleanKeys(rest, root, depth, seen);
    const nonNull = variants.filter(v => v.type !== 'null');
    const hasNull = nonNull.length < variants.length;
    const description = base.description ?? nonNull.find(v => v.description)?.description;
    if (nonNull.every(v => typeList(v.type).every(t => SIMPLE.has(t)) && v.type !== undefined)) {
      const types = typeList(...nonNull.map(v => v.type));
      const enums = nonNull.every(v => v.enum) ? [...new Set(nonNull.flatMap(v => v.enum))] : null;
      const bounds = Object.fromEntries(Object.entries(Object.assign({}, ...nonNull)).filter(([k]) => !['type', 'enum', 'description'].includes(k)));
      return { ...(nonNull.length === 1 ? bounds : {}), ...base, type: oneOrList(hasNull ? [...types, 'null'] : types), ...(enums ? { enum: hasNull ? [...enums, null] : enums } : {}), ...(description ? { description } : {}) };
    }
    if (nonNull.every(v => v.type === 'object')) {
      const properties = {};
      for (const v of nonNull) for (const [k, p] of Object.entries(v.properties ?? {})) properties[k] = k in properties ? mergeVariant(properties[k], p) : p;
      const required = nonNull.map(v => new Set(v.required ?? [])).reduce((a, b) => new Set([...a].filter(x => b.has(x))));
      return withNote({ ...base, type: 'object', properties, required: [...required], additionalProperties: false, ...(description ? { description } : {}) }, shapesNote(nonNull));
    }
    // Mixed kinds: keep the most capable shape (a list or an object over one value) and name the others.
    const rank = v => (v.type === 'object' ? 0 : v.type === 'array' ? 1 : 2);
    const [best, ...others] = [...nonNull].sort((a, b) => rank(a) - rank(b));
    const kept = { ...best, ...base, ...(description ? { description } : {}) };
    if (hasNull) kept.type = oneOrList(typeList(kept.type, 'null'));
    return withNote(kept, others.length ? `(also accepts ${others.map(kindOf).join(' or ')})` : '');
  }
  return cleanKeys(schema, root, depth, seen);
}

function cleanKeys(schema, root, depth, seen) {
  const out = {};
  let note = '';
  for (const [k, v] of Object.entries(schema)) {
    if (k === 'const') out.enum = [v];
    else if (k === 'properties') out.properties = Object.fromEntries(Object.entries(v).map(([pk, pv]) => [pk, portableSchema(pv, root, depth + 1, seen)]));
    else if (k === 'items') out.items = Array.isArray(v) ? portableSchema(v[0], root, depth + 1, seen) : portableSchema(v, root, depth + 1, seen);
    else if (k === 'prefixItems' && Array.isArray(v) && v.length && schema.items === undefined) {
      out.items = portableSchema(v[0], root, depth + 1, seen);
      if (schema.minItems === undefined) out.minItems = v.length;
      if (schema.maxItems === undefined && schema.items !== true) out.maxItems = v.length;
    } else if (k === 'additionalProperties') out.additionalProperties = v === true ? true : false;
    else if (k === 'allOf') Object.assign(out, ...v.map(x => portableSchema(x, root, depth + 1, seen)));
    else if (k === 'format' && typeof v === 'string') note += `(format: ${v})`;
    else if (k === 'pattern' && typeof v === 'string' && v.length <= 40) note += `(pattern: ${v})`;
    else if (PORTABLE_KEYS.has(k)) out[k] = v;
  }
  if (out.enum && !out.type) out.type = oneOrList(typeList(out.enum.map(v => (v === null ? 'null' : Number.isInteger(v) ? 'integer' : typeof v))));
  return withNote(out, note);
}

/** OpenAI strict mode: every property required, optional ones nullable, no additional properties. Null means "not given". */
export function strictSchema(s) {
  if (!s || typeof s !== 'object') return s;
  if (s.type === 'object') {
    const props = s.properties ?? {};
    const required = new Set(s.required ?? []);
    const out = {};
    for (const [k, v] of Object.entries(props)) {
      const inner = strictSchema(v);
      out[k] = required.has(k) ? inner : nullable(inner);
    }
    return { type: 'object', ...(s.description ? { description: s.description } : {}), properties: out, required: Object.keys(props), additionalProperties: false };
  }
  if (s.type === 'array') return dropUnsupported({ ...s, items: strictSchema(s.items) });
  return dropUnsupported({ ...s });
}

function nullable(s) {
  const types = Array.isArray(s.type) ? s.type : [s.type];
  if (types.includes('null')) return s;
  if (s.enum) return { ...s, type: [...types, 'null'], enum: [...s.enum, null] };
  return { ...s, type: [...types, 'null'] };
}

const BOUNDS = ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'minLength', 'maxLength', 'minItems', 'maxItems', 'uniqueItems'];
/** Keywords a target does not take become words in the description, so the model still knows the limits. */
function boundsToDescription(s, keep = new Set()) {
  const notes = [];
  for (const k of BOUNDS) {
    if (s[k] === undefined || keep.has(k)) continue;
    notes.push(k === 'uniqueItems' ? (s[k] ? 'no duplicates' : null) : `${k} ${s[k]}`);
    delete s[k];
  }
  const said = notes.filter(Boolean);
  if (said.length) s.description = `${s.description ?? ''}${s.description ? ' ' : ''}(${said.join(', ')})`.trim();
  return s;
}

// OpenAI strict mode, and the OpenAI-compatible servers that copy it, take only these keywords on a property.
const STRICT_KEYS = new Set(['type', 'description', 'enum', 'items', 'properties', 'required', 'additionalProperties']);
function dropUnsupported(s) {
  boundsToDescription(s);
  for (const k of Object.keys(s)) if (!STRICT_KEYS.has(k)) delete s[k];
  return s;
}

/**
 * Gemini function declarations (an OpenAPI 3.0 subset): one type per schema with nullable, string-only enums,
 * objects with declared properties, no additionalProperties. Anything that does not fit becomes a described string
 * (JSON for free-form objects), which ReversePort parses back.
 */
// Gemini's Schema object takes these besides type, nullable, enum, properties, required and items.
const GEMINI_KEYS = new Set(['description', 'minimum', 'maximum', 'minLength', 'maxLength', 'minItems', 'maxItems']);
export function geminiSchema(s) {
  if (!s || typeof s !== 'object') return s;
  const out = {};
  let types = Array.isArray(s.type) ? s.type : s.type ? [s.type] : [];
  if (types.includes('null')) { out.nullable = true; types = types.filter(t => t !== 'null'); }
  let type = types.length === 1 ? types[0] : 'string';
  let note = types.length > 1 ? ` (one of: ${types.join(', ')}; send as text)` : types.length === 0 && !s.enum ? ' (any JSON value, sent as text)' : '';
  if (type === 'object' && (!s.properties || !Object.keys(s.properties).length)) { type = 'string'; note += ' (a JSON object, sent as text)'; }
  if (type === 'array' && !s.items) out.items = { type: 'string', description: 'One value, as text.' };
  out.type = type;
  const bounded = boundsToDescription({ ...s }, GEMINI_KEYS);
  for (const [k, v] of Object.entries(bounded)) {
    if (k === 'properties' && type === 'object') out.properties = Object.fromEntries(Object.entries(v).map(([pk, pv]) => [pk, geminiSchema(pv)]));
    else if (k === 'required' && type === 'object') out.required = v;
    else if (k === 'items' && type === 'array') out.items = geminiSchema(v);
    else if (k === 'enum') {
      const values = v.filter(x => x !== null);
      if (values.every(x => typeof x === 'string') && type === 'string') out.enum = values;
      else note += ` (allowed: ${values.join(', ')})`;
    } else if (GEMINI_KEYS.has(k) && (k === 'description' || (['minimum', 'maximum'].includes(k) ? ['integer', 'number'].includes(type) : ['minLength', 'maxLength'].includes(k) ? type === 'string' : type === 'array'))) out[k] = v;
  }
  if (note) out.description = `${out.description ?? ''}${note}`.trim();
  return out;
}

// ---------------------------------------------------------------------------------------------------- feedback
/** Agents can say what helped and what got in their way; notes stay local until the user shares them. */
export async function shareFeedback(args) {
  const dir = path.join(workspaceRoot(), 'feedback');
  await fs.mkdir(dir, { recursive: true });
  const entry = { at: new Date().toISOString(), tool: args.tool ?? null, rating: args.rating ?? null, worked: args.worked ?? null, friction: args.friction ?? null, suggestion: args.suggestion ?? null, agent: args.agent ?? null };
  const file = path.join(dir, 'feedback.jsonl');
  await fs.appendFile(file, `${JSON.stringify(entry)}\n`);
  return { saved: true, file, note: 'Thank you. This note stays on this computer; the user can read it or share it with the maintainers (reverseport feedback).' };
}

export async function readFeedback() {
  const file = path.join(workspaceRoot(), 'feedback', 'feedback.jsonl');
  let text = '';
  try { text = await fs.readFile(file, 'utf8'); } catch { return { file, entries: [] }; }
  return { file, entries: text.split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) };
}
