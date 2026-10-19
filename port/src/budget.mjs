// Output budget for agents: a tool result that would flood the agent's context is saved whole to a file in the
// workspace, and the agent gets a shortened result plus where the full one is. Same idea as coding agents that save
// long tool output to disk ("full output saved to …"). Files older than a week are removed on the next save.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { workspaceDir } from './workspace.mjs';

export const DEFAULT_MAX_OUTPUT_BYTES = 256 * 1024;
const KEEP_DAYS = 7;
const LONG_STRING = 16 * 1024;

/** Byte budget from REVERSEPORT_MAX_OUTPUT_BYTES: a number (at least 4096), or "off"/"0" for no budget. */
export function outputLimit(env = process.env) {
  const raw = String(env.REVERSEPORT_MAX_OUTPUT_BYTES ?? '').trim().toLowerCase();
  if (raw === 'off' || raw === '0') return Infinity;
  const n = Number(raw);
  return raw && Number.isFinite(n) ? Math.max(4096, Math.floor(n)) : DEFAULT_MAX_OUTPUT_BYTES;
}

const size = v => Buffer.byteLength(JSON.stringify(v) ?? '', 'utf8');

/** Every array and long string in a value, with its path and serialized size. */
function parts(value, at = '', out = []) {
  if (Array.isArray(value)) {
    out.push({ at, kind: 'array', ref: value, bytes: size(value) });
    value.forEach((v, i) => parts(v, `${at}[${i}]`, out));
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) parts(v, at ? `${at}.${k}` : k, out);
  } else if (typeof value === 'string' && value.length > LONG_STRING) out.push({ at, kind: 'string', bytes: value.length });
  return out;
}

const isUnder = (at, parent) => at.length > parent.length && at.startsWith(parent) && (parent === '' || at[parent.length] === '.' || at[parent.length] === '[');

function setAt(root, at, fn) {
  const keys = [...at.matchAll(/\[(\d+)\]|([^.[\]]+)/g)].map(m => (m[1] !== undefined ? Number(m[1]) : m[2]));
  if (!keys.length) return fn(root);
  let o = root;
  for (const k of keys.slice(0, -1)) o = o[k];
  o[keys.at(-1)] = fn(o[keys.at(-1)]);
  return root;
}

/**
 * Shorten a JSON value until it fits `max` bytes: halve the biggest array (keeping its head) or cut the longest
 * string, again and again. Returns { value, shortened: [{ path, kept, of }] }.
 */
export function shrink(value, max) {
  let v = structuredClone(value);
  const originals = new Map();
  for (let round = 0; round < 200 && size(v) > max; round++) {
    const cands = parts(v).filter(p => (p.kind === 'array' ? p.ref.length > 1 : true)).sort((a, b) => b.bytes - a.bytes);
    // Start at the biggest part; when most of it sits in one child (a list inside a list item, a long string),
    // shorten that child instead, so one huge entry does not empty the whole list.
    let pick = cands[0];
    if (!pick) break;
    for (;;) {
      const child = cands.find(p => p !== pick && isUnder(p.at, pick.at) && p.bytes >= pick.bytes * 0.6);
      if (!child) break;
      pick = child;
    }
    if (pick.kind === 'array') {
      if (!originals.has(pick.at)) originals.set(pick.at, pick.ref.length);
      v = setAt(v, pick.at, a => a.slice(0, Math.max(1, Math.floor(a.length / 2))));
    } else {
      if (!originals.has(pick.at)) originals.set(pick.at, pick.bytes);
      v = setAt(v, pick.at, s => `${s.slice(0, Math.max(1024, Math.floor(s.length / 2)))}… [cut]`);
    }
  }
  const shortened = [];
  for (const [at, of] of originals) {
    let now; try { now = at ? setAtRead(v, at) : v; } catch { continue; }
    if (Array.isArray(now)) shortened.push({ path: at, kept: now.length, of });
    else if (typeof now === 'string') shortened.push({ path: at, keptChars: now.length, ofChars: of });
  }
  return { value: v, shortened };
}

function setAtRead(root, at) {
  const keys = [...at.matchAll(/\[(\d+)\]|([^.[\]]+)/g)].map(m => (m[1] !== undefined ? Number(m[1]) : m[2]));
  let o = root;
  for (const k of keys) o = o[k];
  return o;
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
  const note = { fullOutput, fullBytes: bytes, limitBytes: max, shortened: shortened.slice(0, 20), next: NEXT };
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
    return { ...result, content: [...(result.content ?? []).filter(c => c?.type !== 'text'), { type: 'text', text: JSON.stringify(small) }], structuredContent: small };
  }
  const full = texts.join('\n');
  const fullOutput = await saveFull(tool, full, 'txt');
  const head = Buffer.from(full, 'utf8').subarray(0, Math.max(1024, max - 1024)).toString('utf8').replace(/�+$/, '');
  const lines = full.split('\n').length, shown = head.split('\n').length;
  const marker = `\n\n[showing lines 1-${shown} of ${lines} (${head.length} of ${full.length} characters); full output saved to ${fullOutput}. Read the rest from that file, or call again with a narrower request.]`;
  return { ...result, content: [...(result.content ?? []).filter(c => c?.type !== 'text'), { type: 'text', text: head + marker }] };
}
