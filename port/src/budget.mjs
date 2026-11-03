// Output budget for agents: a tool result that would flood the agent's context is saved whole to a file in the
// workspace, and the agent gets a shortened result plus where the full one is. Same idea as coding agents that save
// long tool output to disk ("full output saved to …"). Files older than a week are removed on the next save.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { workspaceDir } from './workspace.mjs';

export const DEFAULT_MAX_OUTPUT_BYTES = 256 * 1024;
const KEEP_DAYS = 7;

/** Byte budget from REVERSEPORT_MAX_OUTPUT_BYTES: a number (at least 4096), or "off"/"0" for no budget. */
export function outputLimit(env = process.env) {
  const raw = String(env.REVERSEPORT_MAX_OUTPUT_BYTES ?? '').trim().toLowerCase();
  if (raw === 'off' || raw === '0') return Infinity;
  const n = Number(raw);
  return raw && Number.isFinite(n) ? Math.max(4096, Math.floor(n)) : DEFAULT_MAX_OUTPUT_BYTES;
}

const size = v => Buffer.byteLength(JSON.stringify(v) ?? '', 'utf8');
const MIN_STRING = 128; // strings are never cut below this many characters
const MAX_DEPTH = 64; // deeper parts are not shortened one by one; the last pass leaves out whole top-level fields

/** `files`, `items[0].data`, `byFile["src/a.ts"]`: a readable path for a list of keys. */
const pathText = keys => keys.map((k, i) => (typeof k === 'number' ? `[${k}]` : /^[A-Za-z_$][\w$]*$/.test(k) ? (i ? `.${k}` : k) : `[${JSON.stringify(k)}]`)).join('');

/** Every array and longer string in a value, with its keys and serialized size. */
function parts(value, keys = [], out = []) {
  if (Array.isArray(value)) {
    if (value.length > 1) out.push({ keys, kind: 'array', len: value.length, bytes: size(value) });
    if (keys.length < MAX_DEPTH) value.forEach((v, i) => parts(v, [...keys, i], out));
  } else if (value && typeof value === 'object') {
    if (keys.length < MAX_DEPTH) for (const [k, v] of Object.entries(value)) parts(v, [...keys, k], out);
  } else if (typeof value === 'string' && value.length > MIN_STRING * 2) out.push({ keys, kind: 'string', len: value.length, bytes: Buffer.byteLength(value, 'utf8') });
  return out;
}

const isUnder = (keys, parent) => keys.length > parent.length && parent.every((k, i) => keys[i] === k);
const getAt = (root, keys) => keys.reduce((o, k) => o?.[k], root);
function setAt(root, keys, fn) {
  if (!keys.length) return fn(root);
  const parent = getAt(root, keys.slice(0, -1));
  parent[keys.at(-1)] = fn(parent[keys.at(-1)]);
  return root;
}

/** Cut a string to about `n` characters without splitting an emoji or other surrogate pair. */
function cutString(s, n) {
  let end = Math.max(MIN_STRING, Math.min(n, s.length));
  const c = s.charCodeAt(end - 1);
  if (c >= 0xd800 && c <= 0xdbff) end--;
  return `${s.slice(0, end)}… [cut]`;
}

/**
 * Shorten a JSON value until it fits `max` bytes: halve the biggest array (keeping its head) or cut the longest
 * string, again and again. When that is not enough (very deep or very wide values), whole top-level fields are
 * left out, biggest first. Returns { value, shortened: [{ path, kept, of } | { path, keptChars, ofChars } | { path, leftOut, bytes }] }.
 */
export function shrink(value, max) {
  let v = structuredClone(value);
  const originals = new Map();
  for (let round = 0; round < 400; round++) {
    const total = size(v);
    if (total <= max) break;
    const cands = parts(v).sort((a, b) => b.bytes - a.bytes);
    // Start at the biggest part; when most of it sits in one child (a list inside a list item, a long string),
    // shorten that child instead, so one huge entry does not empty the whole list.
    let pick = cands[0];
    if (!pick) break;
    for (;;) {
      const child = cands.find(p => p !== pick && isUnder(p.keys, pick.keys) && p.bytes >= pick.bytes * 0.6);
      if (!child) break;
      pick = child;
    }
    const at = pathText(pick.keys);
    if (!originals.has(at)) originals.set(at, { keys: pick.keys, of: pick.len });
    if (pick.kind === 'array') v = setAt(v, pick.keys, a => a.slice(0, Math.max(1, Math.floor(a.length / 2))));
    else {
      // Cut at least half, or at once everything that is too much (measured in this string's bytes per character).
      const tooMuch = total - max, perChar = pick.bytes / pick.len;
      v = setAt(v, pick.keys, str => cutString(str, Math.min(Math.floor(str.length / 2), str.length - Math.ceil(tooMuch / perChar) - 16)));
    }
  }
  const shortened = [];
  for (const [at, { keys, of }] of originals) {
    const now = getAt(v, keys);
    if (Array.isArray(now)) shortened.push({ path: at, kept: now.length, of });
    else if (typeof now === 'string') shortened.push({ path: at, keptChars: now.length, ofChars: of });
  }
  // Last resort: leave out whole top-level fields, biggest first.
  if (size(v) > max && v && typeof v === 'object' && !Array.isArray(v)) {
    for (const [k, bytes] of Object.entries(v).map(([k, x]) => [k, size(x)]).sort((a, b) => b[1] - a[1])) {
      if (size(v) <= max) break;
      v[k] = `[left out: ${bytes} bytes; see fullOutput]`;
      shortened.push({ path: pathText([k]), leftOut: true, bytes });
    }
  } else if (size(v) > max && Array.isArray(v)) {
    const of = v.length;
    while (v.length > 0 && size(v) > max) v = v.slice(0, Math.floor(v.length / 2));
    shortened.push({ path: '', kept: v.length, of });
  }
  return { value: v, shortened };
}

/** Saved results are also MCP resources, so clients without file access can read them: reverseport://tool-output/<file>. */
export const TOOL_OUTPUT_URI = 'reverseport://tool-output/';
export const toolOutputUri = file => `${TOOL_OUTPUT_URI}${encodeURIComponent(path.basename(file))}`;

/** A resource_link content item for a saved full result. */
export function toolOutputLink(file, bytes, mimeType) {
  return { type: 'resource_link', uri: toolOutputUri(file), name: path.basename(file), mimeType, ...(bytes ? { size: bytes } : {}), description: 'The complete result, too big for one answer.' };
}

/** resources/read for reverseport://tool-output/<file>: only plain names inside the workspace's tool-output folder. */
export async function readToolOutput(uri) {
  const name = decodeURIComponent(String(uri).slice(TOOL_OUTPUT_URI.length));
  if (!name || name !== path.basename(name) || name.startsWith('.')) return null;
  const file = path.join(await workspaceDir('tool-output'), name);
  const text = await fs.readFile(file, 'utf8').catch(() => null);
  if (text === null) return null;
  return { contents: [{ uri, mimeType: name.endsWith('.json') ? 'application/json' : 'text/plain', text }] };
}

async function saveFull(tool, text, ext) {
  const dir = await workspaceDir('tool-output');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(dir, `${String(tool).replace(/[^\w-]+/g, '_')}-${stamp}-${crypto.randomBytes(3).toString('hex')}.${ext}`);
  await fs.writeFile(file, text);
  cleanOld(dir).catch(() => {});
  return file;
}

async function cleanOld(dir, now = Date.now()) {
  for (const name of await fs.readdir(dir)) {
    const f = path.join(dir, name);
    const st = await fs.stat(f).catch(() => null);
    if (st?.isFile() && now - st.mtimeMs > KEEP_DAYS * 86400000) await fs.rm(f, { force: true });
  }
}

const NEXT = 'The result was too big for one answer, so lists were shortened (see shortened). The full result is saved in fullOutput: read the part you need from that file, or call again with a narrower request (match, limit, a subfolder or byte range).';

/** Budget for one of ReversePort's own results (a JSON value). */
export async function budgetValue(tool, value, max = outputLimit()) {
  if (value === null || typeof value !== 'object' || !Number.isFinite(max)) return value;
  const full = JSON.stringify(value);
  const bytes = Buffer.byteLength(full, 'utf8');
  if (bytes <= max) return value;
  const fullOutput = await saveFull(tool, full, 'json');
  const room = Math.max(2048, Math.floor(max * 0.9) - 2048);
  const { value: small, shortened } = shrink(value, room);
  const note = { fullOutput, fullOutputUri: toolOutputUri(fullOutput), fullBytes: bytes, limitBytes: max, shortened: shortened.slice(0, 20), next: NEXT };
  return Array.isArray(small) ? { result: small, outputTruncated: note } : { ...small, outputTruncated: note };
}

/** Budget for a raw MCP tool result from the deep-analysis engine ({ content, structuredContent?, isError? }). */
export async function budgetMcpResult(tool, result, max = outputLimit()) {
  if (!result || typeof result !== 'object' || !Number.isFinite(max) || result.isError) return result;
  const texts = (result.content ?? []).filter(c => c?.type === 'text').map(c => c.text ?? '');
  const bytes = Math.max(texts.reduce((n, t) => n + Buffer.byteLength(t, 'utf8'), 0), result.structuredContent ? size(result.structuredContent) : 0);
  if (bytes <= max) return result;
  if (result.structuredContent && typeof result.structuredContent === 'object') {
    const small = await budgetValue(tool, result.structuredContent, max);
    const link = small?.outputTruncated?.fullOutput ? [toolOutputLink(small.outputTruncated.fullOutput, small.outputTruncated.fullBytes, 'application/json')] : [];
    return { ...result, content: [...(result.content ?? []).filter(c => c?.type !== 'text'), { type: 'text', text: JSON.stringify(small) }, ...link], structuredContent: small };
  }
  const full = texts.join('\n');
  const fullOutput = await saveFull(tool, full, 'txt');
  const head = Buffer.from(full, 'utf8').subarray(0, Math.max(1024, max - 1024)).toString('utf8').replace(/�+$/, '');
  const lines = full.split('\n').length, shown = head.split('\n').length;
  const marker = `\n\n[showing lines 1-${shown} of ${lines} (${head.length} of ${full.length} characters); full output saved to ${fullOutput}. Read the rest from that file (or MCP resource ${toolOutputUri(fullOutput)}), or call again with a narrower request.]`;
  return { ...result, content: [...(result.content ?? []).filter(c => c?.type !== 'text'), { type: 'text', text: head + marker }, toolOutputLink(fullOutput, Buffer.byteLength(full, 'utf8'), 'text/plain')] };
}
