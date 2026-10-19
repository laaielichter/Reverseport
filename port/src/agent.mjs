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
  UNKNOWN_TOOL: ['invalid_input', false, 'Use a tool name from tools/list. Engine tools that are not listed can be found with engine_tools.'],
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
  UNKNOWN_PLAN: ['invalid_input', false, 'port_status {} lists the port plans in this workspace; use one of their planIds.'],
  UNKNOWN_CASE: ['invalid_input', false, 're_case {action:"list"} lists the cases; use one of their caseIds, or init a new one.'],
  GATE_FAILED: ['invalid_input', false, 'Do what the gate names (save evidence, record a decision, a test or limitations), then move the phase again. re_case {action:"check"} shows every finding.'],
  UNKNOWN_UNIT: ['invalid_input', false, 'port_status {planId} lists the units; omit unit to get the next one.'],
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
export function closest(word, candidates, max = 2) {
  let best = null, bestD = Infinity;
  for (const c of candidates) {
    const d = distance(String(word).toLowerCase(), String(c).toLowerCase());
    if (d < bestD) { best = c; bestD = d; }
  }
  return bestD <= max ? best : null;
}

function distance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length];
}

// ---------------------------------------------------------------------------------------------------- annotations
// MCP hints: clients use them to skip approval prompts for reads and to run reads in parallel.
const READ_ONLY = new Set(['re_scan', 're_graph', 're_symbols', 're_scene', 're_binary', 're_probe', 're_compare', 're_refs', 're_strings', 're_apicheck', 're_save', 'port_map', 'port_trace', 'port_convert', 'port_status', 'port_verify']);
const OPEN_WORLD = new Set(['re_lookup']);

export function annotationsFor(name) {
  const readOnly = READ_ONLY.has(name);
  return { readOnlyHint: readOnly, destructiveHint: false, idempotentHint: readOnly || name === 'port_unit', openWorldHint: OPEN_WORLD.has(name) };
}

// ---------------------------------------------------------------------------------------------------- formats
export const FORMATS = ['mcp', 'openai', 'openai-strict', 'responses', 'anthropic', 'gemini', 'json-schema'];

/** Tool definitions for any agent stack. `tools` are MCP-style: { name, title?, description, inputSchema, annotations? }. */
export function formatTools(tools, format = 'mcp') {
  switch (format) {
    case 'mcp': return tools.map(t => ({ name: t.name, ...(t.title ? { title: t.title } : {}), description: t.description, inputSchema: t.inputSchema, ...(t.annotations ? { annotations: t.annotations } : {}) }));
    case 'openai': return tools.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.inputSchema } }));
    case 'openai-strict': return tools.map(t => { const { parameters, strict } = strictOrPortable(t.inputSchema); return { type: 'function', function: { name: t.name, description: t.description, parameters, strict } }; });
    case 'responses': return tools.map(t => { const { parameters, strict } = strictOrPortable(t.inputSchema); return { type: 'function', name: t.name, description: t.description, parameters, strict }; });
    case 'anthropic': return tools.map(t => ({ name: t.name, description: t.description, input_schema: t.inputSchema }));
    case 'gemini': return [{ functionDeclarations: tools.map(t => ({ name: t.name, description: t.description, parameters: geminiSchema(portableSchema(t.inputSchema)) })) }];
    case 'json-schema': return Object.fromEntries(tools.map(t => [t.name, t.inputSchema]));
    default: throw new RPError('INVALID_ARGUMENT', `Unknown format "${format}". Formats: ${FORMATS.join(', ')}.`);
  }
}

/** Strict when the schema allows it; otherwise the portable schema with strict:false for that one tool. */
function strictOrPortable(schema) {
  const portable = portableSchema(schema);
  return strictCompatible(portable) ? { parameters: strictSchema(portable), strict: true } : { parameters: portable, strict: false };
}

function strictCompatible(s, depth = 0) {
  if (!s || typeof s !== 'object' || depth > 5) return false;
  if (s.type === 'object') return !!s.properties && Object.keys(s.properties).length > 0 && Object.values(s.properties).every(v => strictCompatible(v, depth + 1));
  if (s.type === 'array') return strictCompatible(s.items, depth + 1);
  return ['string', 'integer', 'number', 'boolean'].includes(s.type) || (Array.isArray(s.type) && s.type.every(t => ['string', 'integer', 'number', 'boolean', 'null'].includes(t)));
}

const DROP = new Set(['$schema', '$id', '$defs', 'definitions', 'dependentRequired', 'dependentSchemas', 'dependencies', 'minProperties', 'maxProperties', 'patternProperties', 'propertyNames', 'unevaluatedProperties', 'if', 'then', 'else', 'not', 'format', 'contentEncoding', 'contentMediaType', 'examples', 'default', 'title', 'readOnly', 'writeOnly', 'deprecated', 'pattern']);

/**
 * A schema every function-calling stack accepts: $ref inlined, unions of simple types folded into type lists, unions
 * of objects merged, const as enum, and keywords strict validators reject removed (their meaning moves into the
 * description when it matters). The server still validates the full schema, so nothing is loosened in practice.
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
    if (nonNull.every(v => typeof v.type === 'string' && v.type !== 'object' && v.type !== 'array')) {
      const types = [...new Set(nonNull.map(v => v.type))];
      const enums = nonNull.every(v => v.enum) ? [...new Set(nonNull.flatMap(v => v.enum))] : null;
      const type = hasNull ? [...types, 'null'] : types.length === 1 ? types[0] : types;
      return { ...base, type, ...(enums ? { enum: hasNull ? [...enums, null] : enums } : {}), ...(base.description || nonNull[0]?.description ? { description: base.description ?? nonNull[0].description } : {}) };
    }
    if (nonNull.every(v => v.type === 'object')) {
      const properties = {};
      for (const v of nonNull) Object.assign(properties, v.properties ?? {});
      const required = nonNull.map(v => new Set(v.required ?? [])).reduce((a, b) => new Set([...a].filter(x => b.has(x))));
      const note = nonNull.length > 1 ? ' Accepts one of several shapes; give the fields of one of them.' : '';
      return { ...base, type: 'object', properties, required: [...required], additionalProperties: false, description: `${base.description ?? nonNull[0]?.description ?? ''}${note}`.trim() };
    }
    return { ...base, ...nonNull[0], description: `${base.description ?? nonNull[0]?.description ?? ''}`.trim() };
  }
  return cleanKeys(schema, root, depth, seen);
}

function cleanKeys(schema, root, depth, seen) {
  const out = {};
  for (const [k, v] of Object.entries(schema)) {
    if (DROP.has(k)) continue;
    if (k === 'const') { out.enum = [v]; continue; }
    if (k === 'properties') out.properties = Object.fromEntries(Object.entries(v).map(([pk, pv]) => [pk, portableSchema(pv, root, depth + 1, seen)]));
    else if (k === 'items') out.items = Array.isArray(v) ? portableSchema(v[0], root, depth + 1, seen) : portableSchema(v, root, depth + 1, seen);
    else if (k === 'additionalProperties' && typeof v === 'object') out.additionalProperties = false;
    else if (k === 'allOf') Object.assign(out, ...v.map(x => portableSchema(x, root, depth + 1, seen)));
    else out[k] = v;
  }
  if (out.enum && !out.type) {
    const kinds = [...new Set(out.enum.map(v => (v === null ? 'null' : Number.isInteger(v) ? 'integer' : typeof v)))];
    out.type = kinds.length === 1 ? kinds[0] : kinds;
  }
  return out;
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

function dropUnsupported(s) {
  // Strict mode rejects a few numeric/array bounds on some models; keep them in the description instead.
  const notes = [];
  for (const k of ['minimum', 'maximum', 'minItems', 'maxItems']) if (s[k] !== undefined) { notes.push(`${k} ${s[k]}`); delete s[k]; }
  if (notes.length) s.description = `${s.description ?? ''}${s.description ? ' ' : ''}(${notes.join(', ')})`.trim();
  return s;
}

/**
 * Gemini function declarations (an OpenAPI 3.0 subset): one type per schema with nullable, string-only enums,
 * objects with declared properties, no additionalProperties. Anything that does not fit becomes a described string
 * (JSON for free-form objects), which ReversePort parses back.
 */
export function geminiSchema(s) {
  if (!s || typeof s !== 'object') return s;
  const out = {};
  let types = Array.isArray(s.type) ? s.type : s.type ? [s.type] : [];
  if (types.includes('null')) { out.nullable = true; types = types.filter(t => t !== 'null'); }
  let type = types.length === 1 ? types[0] : types.length ? 'string' : undefined;
  let note = types.length > 1 ? ` (one of: ${types.join(', ')}; send as text)` : '';
  if (type === 'object' && (!s.properties || !Object.keys(s.properties).length)) { type = 'string'; note += ' (a JSON object, sent as text)'; }
  if (type) out.type = type;
  for (const [k, v] of Object.entries(s)) {
    if (['additionalProperties', 'title', '$schema', 'type'].includes(k)) continue;
    if (k === 'properties' && type === 'object') out.properties = Object.fromEntries(Object.entries(v).map(([pk, pv]) => [pk, geminiSchema(pv)]));
    else if (k === 'required' && type === 'object') out.required = v;
    else if (k === 'items') out.items = geminiSchema(v);
    else if (k === 'enum') {
      const values = v.filter(x => x !== null);
      if (values.every(x => typeof x === 'string') && type === 'string') out.enum = values;
      else note += ` (allowed: ${values.join(', ')})`;
    } else if (k === 'properties' || k === 'required') continue;
    else out[k] = v;
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
