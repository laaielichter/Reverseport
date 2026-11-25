// Valve KeyValues text (VDF / ACF): appmanifest_*.acf, libraryfolders.vdf, config.vdf, localconfig.vdf and game
// .vdf files. Nested "key" "value" pairs and "key" { … } blocks, quoted or bare tokens, backslash escapes,
// // comments and [$CONDITION] tags. Read-only; the binary KeyValues variants (appinfo.vdf, shortcuts.vdf) are
// a different format and are not read here.
import { RPError } from './util.mjs';

const bad = msg => new RPError('BAD_FORMAT', msg);
const MAX_DEPTH = 64, MAX_PAIRS = 1_000_000;
const ESCAPES = { n: '\n', t: '\t', r: '\r', '\\': '\\', '"': '"' };

/** Does this text start like KeyValues: a quoted root key followed by an opening brace? */
export function looksLikeVdf(text) {
  return /^\s*(?:\/\/[^\n]*\n\s*)*"[^"\n]*"\s*(?:\/\/[^\n]*\n\s*)*\{/.test(text.slice(0, 4096));
}

/** KeyValues text → plain object. Values are strings (as stored); a key that repeats becomes an array. */
export function parseVdf(text) {
  let i = 0, pairs = 0;
  const n = text.length;
  const lineOf = pos => text.slice(0, pos).split('\n').length;
  /** Next token: { brace } or { str, quoted }; null at the end. */
  const token = () => {
    for (;;) {
      while (i < n && /\s/.test(text[i])) i++;
      if (text[i] === '/' && text[i + 1] === '/') { while (i < n && text[i] !== '\n') i++; continue; }
      break;
    }
    if (i >= n) return null;
    const ch = text[i];
    if (ch === '{' || ch === '}') { i++; return { brace: ch, at: i - 1 }; }
    if (ch === '"') {
      const start = i++;
      let s = '';
      for (; i < n; i++) {
        const c = text[i];
        if (c === '\\' && i + 1 < n && ESCAPES[text[i + 1]] !== undefined) { s += ESCAPES[text[++i]]; continue; }
        if (c === '"') { i++; return { str: s, quoted: true, at: start }; }
        s += c;
      }
      throw bad(`VDF string that starts on line ${lineOf(start)} never closes`);
    }
    const start = i;
    while (i < n && !/[\s{}"]/.test(text[i])) i++;
    return { str: text.slice(start, i), quoted: false, at: start };
  };
  const isCondition = t => t && !t.quoted && t.str !== undefined && /^\[.*\]$/.test(t.str);
  // Values are strings or blocks, so an array always means "this key repeated".
  const add = (obj, key, value) => {
    if (!Object.hasOwn(obj, key)) Object.defineProperty(obj, key, { value, enumerable: true, writable: true, configurable: true });
    else if (Array.isArray(obj[key])) obj[key].push(value);
    else obj[key] = [obj[key], value];
  };
  const block = (depth, openedAt) => {
    if (depth > MAX_DEPTH) throw bad(`VDF nests deeper than ${MAX_DEPTH} levels`);
    const obj = {};
    for (;;) {
      let k = token();
      if (!k) { if (depth === 0) return obj; throw bad(`VDF block opened on line ${lineOf(openedAt)} is never closed`); }
      if (k.brace === '}') { if (depth === 0) throw bad(`VDF has a stray "}" on line ${lineOf(k.at)}`); return obj; }
      if (k.brace) throw bad(`VDF has "{" without a key on line ${lineOf(k.at)}`);
      if (isCondition(k)) continue;
      let v = token();
      if (isCondition(v)) v = token();
      if (!v) throw bad(`VDF key "${k.str.slice(0, 40)}" on line ${lineOf(k.at)} has no value`);
      if (v.brace === '}') throw bad(`VDF key "${k.str.slice(0, 40)}" on line ${lineOf(k.at)} has no value`);
      if (++pairs > MAX_PAIRS) throw bad('VDF holds more than a million pairs');
      add(obj, k.str, v.brace === '{' ? block(depth + 1, v.at) : v.str);
    }
  };
  const root = block(0, 0);
  if (!pairs) throw bad('VDF holds no key/value pair');
  return root;
}

const num = v => (typeof v === 'string' && /^\d+$/.test(v) && Number(v) <= Number.MAX_SAFE_INTEGER ? Number(v) : undefined);
const ci = (obj, key) => { if (!obj || typeof obj !== 'object') return undefined; const k = Object.keys(obj).find(x => x.toLowerCase() === key.toLowerCase()); return k === undefined ? undefined : obj[k]; };
const isoSeconds = v => { const s = num(v); return s && s < 1e11 ? new Date(s * 1000).toISOString().replace('.000Z', 'Z') : undefined; };

/** Summary of the Steam files people ask about; null for other KeyValues documents. */
export function vdfSummary(data) {
  const app = ci(data, 'AppState');
  if (app && typeof app === 'object') {
    const depots = ci(app, 'InstalledDepots');
    const out = {
      kind: 'steam-appmanifest', appid: num(ci(app, 'appid')) ?? ci(app, 'appid'), name: ci(app, 'name'), installdir: ci(app, 'installdir'),
      buildid: ci(app, 'buildid'), size: num(ci(app, 'SizeOnDisk')), lastUpdated: isoSeconds(ci(app, 'LastUpdated')), stateFlags: num(ci(app, 'StateFlags')),
      depots: depots && typeof depots === 'object' ? Object.entries(depots).slice(0, 100).map(([id, d]) => ({ id, manifest: ci(d, 'manifest'), size: num(ci(d, 'size')) })) : [],
    };
    const beta = ci(ci(app, 'UserConfig'), 'BetaKey') ?? ci(ci(app, 'MountedConfig'), 'BetaKey');
    if (beta) out.branch = beta;
    for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
    return out;
  }
  const lib = ci(data, 'libraryfolders') ?? ci(data, 'LibraryFolders');
  if (lib && typeof lib === 'object') {
    const folders = Object.entries(lib).filter(([k]) => /^\d+$/.test(k)).slice(0, 50).map(([, f]) => {
      if (typeof f === 'string') return { path: f };
      const apps = ci(f, 'apps');
      return { path: ci(f, 'path'), ...(ci(f, 'label') ? { label: ci(f, 'label') } : {}), ...(num(ci(f, 'totalsize')) ? { totalSize: num(ci(f, 'totalsize')) } : {}), apps: apps && typeof apps === 'object' ? Object.keys(apps).length : 0, ...(apps && typeof apps === 'object' ? { appids: Object.keys(apps).slice(0, 200) } : {}) };
    });
    return { kind: 'steam-libraryfolders', folders };
  }
  return null;
}
