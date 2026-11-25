// Mobile package readers, read-only: Android binary XML (AndroidManifest.xml inside an APK), the resource table
// (resources.arsc) and Apple property lists (binary bplist00 and XML; Info.plist inside an IPA or .app, and
// Unity PlayerPrefs on macOS). Hand-written from the public format descriptions: AOSP ResourceTypes.h for the
// Android chunks, CoreFoundation CFBinaryPList.c for bplist. Every offset is bounds-checked; damaged input
// ends in an RPError('BAD_FORMAT'), never in a raw RangeError or a hang.
import { RPError } from './util.mjs';

const bad = msg => new RPError('BAD_FORMAT', msg);

// ------------------------------------------------------------------------------------------------ Android chunks
const RES_STRING_POOL = 0x0001, RES_TABLE = 0x0002, RES_XML = 0x0003;
const XML_START_NS = 0x0100, XML_END_NS = 0x0101, XML_START_EL = 0x0102, XML_END_EL = 0x0103, XML_CDATA = 0x0104, XML_RESOURCE_MAP = 0x0180;
const TABLE_PACKAGE = 0x0200, TABLE_TYPE = 0x0201, TABLE_TYPE_SPEC = 0x0202;
const ANDROID_NS = 'http://schemas.android.com/apk/res/android';
const MAX_NODES = 200_000;

/** Framework attribute ids (android.R.attr, frameworks/base public.xml). Release builds often strip the attribute
 *  name strings, so the resource map is the only place the name survives. */
const ANDROID_ATTRS = {
  0x01010000: 'theme', 0x01010001: 'label', 0x01010002: 'icon', 0x01010003: 'name', 0x01010006: 'permission', 0x0101000b: 'sharedUserId',
  0x0101000e: 'enabled', 0x0101000f: 'debuggable', 0x01010010: 'exported', 0x01010011: 'process', 0x01010012: 'taskAffinity', 0x01010018: 'authorities',
  0x0101001c: 'priority', 0x0101001d: 'launchMode', 0x0101001e: 'screenOrientation', 0x0101001f: 'configChanges', 0x01010024: 'value', 0x01010025: 'resource',
  0x01010026: 'mimeType', 0x01010027: 'scheme', 0x01010028: 'host', 0x01010029: 'port', 0x0101002a: 'path', 0x0101002b: 'pathPrefix', 0x0101002c: 'pathPattern',
  0x01010202: 'targetActivity', 0x0101020c: 'minSdkVersion', 0x0101021b: 'versionCode', 0x0101021c: 'versionName', 0x01010270: 'targetSdkVersion',
  0x01010271: 'maxSdkVersion', 0x01010272: 'testOnly', 0x01010280: 'allowBackup', 0x01010281: 'glEsVersion', 0x0101028e: 'required', 0x010102b7: 'installLocation',
  0x010102d3: 'hardwareAccelerated', 0x0101035a: 'largeHeap', 0x010103af: 'supportsRtl', 0x010103f2: 'banner', 0x010103f4: 'isGame', 0x010104ea: 'extractNativeLibs',
  0x010104eb: 'fullBackupContent', 0x010104ec: 'usesCleartextTraffic', 0x01010527: 'networkSecurityConfig', 0x0101052c: 'roundIcon',
  0x01010572: 'compileSdkVersion', 0x01010573: 'compileSdkVersionCodename', 0x0101057a: 'appComponentFactory',
};

const hex8 = n => `0x${(n >>> 0).toString(16).padStart(8, '0')}`;

function chunkAt(buf, off, end = buf.length) {
  if (off < 0 || off + 8 > end) throw bad(`chunk header at ${off} is outside the data`);
  const type = buf.readUInt16LE(off), headerSize = buf.readUInt16LE(off + 2), size = buf.readUInt32LE(off + 4);
  if (headerSize < 8 || size < headerSize || off + size > end) throw bad(`chunk 0x${type.toString(16)} at ${off} has an impossible size (${size} bytes, header ${headerSize})`);
  return { type, headerSize, size, off, end: off + size };
}

/** ResStringPool: strings are decoded on demand, so a table with 100,000 strings costs nothing until one is read. */
export function readStringPool(buf, off, limitEnd = buf.length) {
  const c = chunkAt(buf, off, limitEnd);
  if (c.type !== RES_STRING_POOL || c.headerSize < 28) throw bad(`expected a string pool at ${off}`);
  const count = buf.readUInt32LE(off + 8), flags = buf.readUInt32LE(off + 16), stringsStart = buf.readUInt32LE(off + 20);
  const utf8 = !!(flags & 0x100);
  if (c.headerSize + count * 4 > c.size) throw bad(`string pool at ${off} lists ${count} strings but is only ${c.size} bytes`);
  const cache = new Map();
  const get = i => {
    if (!Number.isInteger(i) || i < 0 || i >= count) return null;
    if (cache.has(i)) return cache.get(i);
    let p = off + stringsStart + buf.readUInt32LE(off + c.headerSize + i * 4), s = null;
    if (utf8) {
      // Two lengths: UTF-16 length, then byte length; each is one byte, or two when the high bit is set.
      if (p + 2 <= c.end) {
        if (buf[p] & 0x80) p += 2; else p += 1;
        if (p < c.end) {
          let n = buf[p++];
          if (n & 0x80 && p < c.end) n = ((n & 0x7f) << 8) | buf[p++];
          if (p + n <= c.end) s = buf.toString('utf8', p, p + n);
        }
      }
    } else if (p + 2 <= c.end) {
      let n = buf.readUInt16LE(p); p += 2;
      if (n & 0x8000 && p + 2 <= c.end) { n = ((n & 0x7fff) << 16) | buf.readUInt16LE(p); p += 2; }
      if (p + n * 2 <= c.end) s = buf.toString('utf16le', p, p + n * 2);
    }
    cache.set(i, s);
    return s;
  };
  return { count, utf8, get, end: c.end };
}

/** Res_value as text the way aapt prints it. Dimensions and fractions stay raw (unit and radix are packed bits). */
function formatValue(type, data, pool) {
  switch (type) {
    case 0x00: return { kind: 'null', value: null, text: data === 1 ? '@empty' : '@null' };
    case 0x01: return { kind: 'reference', value: hex8(data), text: data ? `@${hex8(data)}` : '@null' };
    case 0x02: return { kind: 'attribute', value: hex8(data), text: `?${hex8(data)}` };
    case 0x03: { const s = pool.get(data) ?? ''; return { kind: 'string', value: s, text: s }; }
    case 0x04: { const b = Buffer.alloc(4); b.writeUInt32LE(data >>> 0); const f = b.readFloatLE(0); return { kind: 'float', value: f, text: String(f) }; }
    case 0x05: return { kind: 'dimension', value: hex8(data), text: `dimension(${hex8(data)})` };
    case 0x06: return { kind: 'fraction', value: hex8(data), text: `fraction(${hex8(data)})` };
    case 0x10: return { kind: 'int', value: data | 0, text: String(data | 0) };
    case 0x11: return { kind: 'hex', value: data >>> 0, text: hex8(data) };
    case 0x12: return { kind: 'bool', value: data !== 0, text: data !== 0 ? 'true' : 'false' };
    case 0x1c: case 0x1d: case 0x1e: case 0x1f: return { kind: 'color', value: hex8(data), text: `#${(data >>> 0).toString(16).padStart(8, '0')}` };
    default: return { kind: `type-0x${type.toString(16)}`, value: hex8(data), text: hex8(data) };
  }
}

const xmlEscape = s => String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ch => `&#${ch.charCodeAt(0)};`);

/**
 * Android binary XML → { root, xml }. root is a tree of { name, attrs: { name: { kind, value, text, ns? } },
 * children, text? }; xml is the same document as readable text.
 */
export function parseAxml(buf) {
  const top = chunkAt(buf, 0);
  if (top.type !== RES_XML) throw bad('not Android binary XML (the file does not start with a RES_XML chunk)');
  let pool = null, resMap = [];
  const nsPrefix = new Map(), pendingNs = [];
  const doc = { name: '#document', attrs: {}, children: [] };
  const stack = [doc];
  let nodes = 0;
  for (let p = top.headerSize; p + 8 <= top.end;) {
    const c = chunkAt(buf, p, top.end);
    const body = p + c.headerSize;
    if (c.type === RES_STRING_POOL) pool = readStringPool(buf, p, top.end);
    else if (c.type === XML_RESOURCE_MAP) { resMap = []; for (let q = body; q + 4 <= c.end; q += 4) resMap.push(buf.readUInt32LE(q)); }
    else if (c.type >= XML_START_NS && c.type <= XML_CDATA) {
      if (!pool) throw bad('binary XML has nodes before its string pool');
      if (++nodes > MAX_NODES) throw bad('binary XML has an implausible number of nodes');
      if (c.type === XML_START_NS) {
        if (body + 8 > c.end) throw bad('namespace chunk is too short');
        const prefix = pool.get(buf.readUInt32LE(body)) ?? '', uri = pool.get(buf.readUInt32LE(body + 4)) ?? '';
        nsPrefix.set(uri, prefix); pendingNs.push([prefix, uri]);
      } else if (c.type === XML_START_EL) {
        if (body + 20 > c.end) throw bad('element chunk is too short');
        const name = pool.get(buf.readUInt32LE(body + 4)) ?? '';
        const attrStart = buf.readUInt16LE(body + 8), attrSize = buf.readUInt16LE(body + 10), attrCount = buf.readUInt16LE(body + 12);
        if (attrCount && (attrSize < 20 || body + attrStart + attrCount * attrSize > c.end)) throw bad(`element <${name}> has attributes outside its chunk`);
        const el = { name, attrs: {}, children: [] };
        if (pendingNs.length) el.namespaces = pendingNs.splice(0);
        for (let i = 0; i < attrCount; i++) {
          const a = body + attrStart + i * attrSize;
          const nsIdx = buf.readUInt32LE(a), nameIdx = buf.readUInt32LE(a + 4), raw = buf.readUInt32LE(a + 8), type = buf[a + 15], data = buf.readUInt32LE(a + 16);
          const resId = nameIdx < resMap.length ? resMap[nameIdx] : 0;
          const uri = nsIdx === 0xffffffff ? null : pool.get(nsIdx);
          const attrName = pool.get(nameIdx) || ANDROID_ATTRS[resId] || (resId ? `attr_${hex8(resId)}` : `attr_${nameIdx}`);
          const v = formatValue(type, data, pool);
          if (v.kind === 'string' && !v.text && raw !== 0xffffffff) { const s = pool.get(raw); if (s) { v.value = s; v.text = s; } }
          // Stripped manifests drop the namespace too; a framework attribute id implies the android namespace.
          const ns = uri ?? (resId >>> 24 === 0x01 ? ANDROID_NS : null);
          el.attrs[attrName] = ns ? { ...v, ns } : v;
        }
        stack.at(-1).children.push(el);
        stack.push(el);
        if (stack.length > 200) throw bad('binary XML nests deeper than 200 elements');
      } else if (c.type === XML_END_EL) { if (stack.length > 1) stack.pop(); }
      else if (c.type === XML_CDATA && body + 4 <= c.end) { const t = pool.get(buf.readUInt32LE(body)); if (t && t.trim()) stack.at(-1).text = (stack.at(-1).text ?? '') + t; }
    }
    p = c.end;
  }
  const root = doc.children[0];
  if (!root) throw bad('binary XML has no root element');
  const lines = ['<?xml version="1.0" encoding="utf-8"?>'];
  const write = (el, depth) => {
    const pad = '  '.repeat(Math.min(depth, 40));
    const attrs = [];
    for (const [prefix, uri] of el.namespaces ?? []) attrs.push(`xmlns${prefix ? `:${prefix}` : ''}="${xmlEscape(uri)}"`);
    for (const [name, a] of Object.entries(el.attrs)) { const prefix = a.ns ? nsPrefix.get(a.ns) ?? (a.ns === ANDROID_NS ? 'android' : '') : ''; attrs.push(`${prefix ? `${prefix}:` : ''}${name}="${xmlEscape(a.text)}"`); }
    const open = `${pad}<${el.name}${attrs.length ? ` ${attrs.join(' ')}` : ''}`;
    if (!el.children.length && !el.text) { lines.push(`${open} />`); return; }
    if (!el.children.length) { lines.push(`${open}>${xmlEscape(el.text)}</${el.name}>`); return; }
    lines.push(`${open}>`);
    if (el.text) lines.push(`${pad}  ${xmlEscape(el.text)}`);
    for (const ch of el.children) write(ch, depth + 1);
    lines.push(`${pad}</${el.name}>`);
  };
  write(root, 0);
  return { root, xml: lines.join('\n') + '\n', stringCount: pool?.count ?? 0, utf8: pool?.utf8 ?? false };
}

const COMPONENT_CAP = 60;
/** What an analyst asks of a manifest first. `resolve` turns "@0x7f…" into text (see parseArsc().resolve). */
export function manifestSummary(root, { resolve } = {}) {
  if (root?.name !== 'manifest') throw bad(`binary XML root is <${root?.name}>, not <manifest>`);
  // A value given as a reference (@bool/…, @integer/…) is looked up; without a table it stays "@0x7f…".
  const val = (el, name) => { const a = el?.attrs[name]; if (!a) return undefined; if (a.kind !== 'reference') return a.value; const r = resolve?.(a.text); return r === undefined ? a.text : r; };
  const text = (el, name) => { const a = el?.attrs[name]; return a ? a.text : undefined; };
  const kids = (el, name) => (el?.children ?? []).filter(c => c.name === name);
  const withRef = (out, key, a) => {
    if (!a) return;
    if (a.kind === 'reference') { out[`${key}Ref`] = a.text; const r = resolve?.(a.text); if (typeof r === 'string') out[key] = r; }
    else out[key] = a.value;
  };
  const pkg = val(root, 'package');
  const out = { package: pkg };
  withRef(out, 'versionCode', root.attrs.versionCode);
  withRef(out, 'versionName', root.attrs.versionName);
  const sdk = kids(root, 'uses-sdk')[0];
  if (sdk) { out.minSdk = val(sdk, 'minSdkVersion'); out.targetSdk = val(sdk, 'targetSdkVersion'); if (val(sdk, 'maxSdkVersion') !== undefined) out.maxSdk = val(sdk, 'maxSdkVersion'); }
  if (val(root, 'compileSdkVersion') !== undefined) out.compileSdk = val(root, 'compileSdkVersion');
  const app = kids(root, 'application')[0];
  const full = n => (typeof n !== 'string' || !pkg ? n : n.startsWith('.') ? pkg + n : n.includes('.') ? n : `${pkg}.${n}`);
  if (app) {
    const a = {};
    withRef(a, 'label', app.attrs.label);
    withRef(a, 'icon', app.attrs.icon);
    if (val(app, 'name') !== undefined) a.name = full(val(app, 'name'));
    out.application = a;
    out.flags = { debuggable: val(app, 'debuggable') === true, allowBackup: val(app, 'allowBackup') ?? null, usesCleartextTraffic: val(app, 'usesCleartextTraffic') ?? null };
    if (val(app, 'extractNativeLibs') !== undefined) out.flags.extractNativeLibs = val(app, 'extractNativeLibs');
    if (val(app, 'isGame') !== undefined) out.flags.isGame = val(app, 'isGame');
    if (text(app, 'networkSecurityConfig')) out.flags.networkSecurityConfig = text(app, 'networkSecurityConfig');
  }
  const perms = [...kids(root, 'uses-permission'), ...kids(root, 'uses-permission-sdk-23')].map(p => val(p, 'name')).filter(Boolean);
  out.permissions = perms.slice(0, 200);
  if (perms.length > 200) out.permissionsTotal = perms.length;
  const features = kids(root, 'uses-feature').map(f => val(f, 'name') ?? (f.attrs.glEsVersion ? `glEsVersion ${f.attrs.glEsVersion.text}` : null)).filter(Boolean);
  if (features.length) out.features = features.slice(0, 50);
  let launcher = null;
  for (const [tag, key] of [['activity', 'activities'], ['activity-alias', 'activities'], ['service', 'services'], ['receiver', 'receivers'], ['provider', 'providers']]) {
    const list = out[key] ?? [];
    for (const el of kids(app, tag)) {
      const filters = kids(el, 'intent-filter');
      const item = { name: full(val(el, 'name')) };
      if (tag === 'activity-alias') item.aliasOf = full(val(el, 'targetActivity'));
      // Declared value only: without it the platform default applies (true with an intent filter before API 31).
      if (val(el, 'exported') !== undefined) item.exported = val(el, 'exported');
      if (filters.length) item.intentFilters = filters.length;
      if (text(el, 'permission')) item.permission = text(el, 'permission');
      if (tag === 'provider' && text(el, 'authorities')) item.authorities = text(el, 'authorities');
      const isLauncher = filters.some(f => kids(f, 'action').some(a => val(a, 'name') === 'android.intent.action.MAIN') && kids(f, 'category').some(c => ['android.intent.category.LAUNCHER', 'android.intent.category.LEANBACK_LAUNCHER'].includes(val(c, 'name'))));
      if (isLauncher && key === 'activities') { item.launcher = true; launcher ??= item.aliasOf ?? item.name; }
      const schemes = [...new Set(filters.flatMap(f => kids(f, 'data').map(d => val(d, 'scheme')).filter(Boolean)))];
      if (schemes.length) item.schemes = schemes.slice(0, 10);
      list.push(item);
    }
    out[key] = list;
  }
  out.launcherActivity = launcher;
  out.counts = {};
  for (const key of ['activities', 'services', 'receivers', 'providers']) {
    out.counts[key] = out[key].length;
    // The launcher and exported components first, so the cap never hides the attack surface.
    if (out[key].length > COMPONENT_CAP) out[key] = [...out[key].filter(c => c.launcher || c.exported), ...out[key].filter(c => !c.launcher && !c.exported)].slice(0, COMPONENT_CAP);
  }
  const meta = kids(app, 'meta-data').map(m => [val(m, 'name'), m.attrs.value?.text ?? m.attrs.resource?.text]).filter(([n]) => /^(unity\.|com\.epicgames\.|org\.godotengine\.|com\.google\.android\.gms\.games|android\.app\.lib_name)/.test(n ?? ''));
  if (meta.length) out.engineMetaData = Object.fromEntries(meta.slice(0, 30));
  return out;
}

// ------------------------------------------------------------------------------------------------ resources.arsc
/**
 * Resource table → packages with entry counts per type, plus resolve(id) for the default configuration (falls
 * back to the first configuration that defines the entry). `limit` bounds the listed string resources.
 */
export function parseArsc(buf, { limit = 0 } = {}) {
  const top = chunkAt(buf, 0);
  if (top.type !== RES_TABLE || top.headerSize < 12) throw bad('not an Android resource table (resources.arsc starts with a RES_TABLE chunk)');
  let global = null;
  const packages = [];
  const values = new Map(); // resource id → { type, data, isDefault }
  const names = new Map();
  const put = (id, type, data, isDefault) => { const old = values.get(id); if (!old || (isDefault && !old.isDefault)) values.set(id, { type, data, isDefault }); };
  for (let p = top.headerSize; p + 8 <= top.end;) {
    const c = chunkAt(buf, p, top.end);
    if (c.type === RES_STRING_POOL && !global) global = readStringPool(buf, p, top.end);
    else if (c.type === TABLE_PACKAGE) {
      if (c.headerSize < 284) throw bad('resource package header is too short');
      const id = buf.readUInt32LE(p + 8);
      const name = buf.toString('utf16le', p + 12, p + 268).replace(/\0[\s\S]*$/, '');
      const typeStringsOff = buf.readUInt32LE(p + 268), keyStringsOff = buf.readUInt32LE(p + 276);
      const typePool = typeStringsOff ? readStringPool(buf, p + typeStringsOff, c.end) : null;
      const keyPool = keyStringsOff ? readStringPool(buf, p + keyStringsOff, c.end) : null;
      const seen = new Map(); // type name → Set of entry indexes
      let configs = 0;
      for (let q = p + c.headerSize; q + 8 <= c.end;) {
        const t = chunkAt(buf, q, c.end);
        if (t.type === TABLE_TYPE) {
          if (t.headerSize < 24) throw bad('resource type chunk header is too short');
          configs++;
          const typeId = buf[q + 8], tflags = buf[q + 9], entryCount = buf.readUInt32LE(q + 12), entriesStart = buf.readUInt32LE(q + 16);
          const cfgSize = buf.readUInt32LE(q + 20);
          const cfgEnd = Math.min(q + 20 + cfgSize, q + t.headerSize);
          let isDefault = true;
          for (let k = q + 24; k < cfgEnd; k++) if (buf[k] !== 0) { isDefault = false; break; }
          const typeName = typePool?.get(typeId - 1) ?? `type${typeId}`;
          const set = seen.get(typeName) ?? new Set(); seen.set(typeName, set);
          const sparse = !!(tflags & 1), off16 = !!(tflags & 2);
          const slot = sparse ? 4 : off16 ? 2 : 4;
          if (q + t.headerSize + entryCount * slot > t.end) throw bad(`resource type ${typeName} lists ${entryCount} entries outside its chunk`);
          for (let i = 0; i < entryCount; i++) {
            const o = q + t.headerSize + i * slot;
            let index = i, rel;
            if (sparse) { index = buf.readUInt16LE(o); rel = buf.readUInt16LE(o + 2) * 4; }
            else if (off16) { rel = buf.readUInt16LE(o); if (rel === 0xffff) continue; rel *= 4; }
            else { rel = buf.readUInt32LE(o); if (rel === 0xffffffff) continue; }
            const e = q + entriesStart + rel;
            if (e + 8 > t.end) continue;
            const eflags = buf.readUInt16LE(e + 2);
            const resId = ((id & 0xff) << 24 | (typeId & 0xff) << 16 | (index & 0xffff)) >>> 0;
            set.add(index);
            if (eflags & 0x0008) { names.set(resId, keyPool?.get(buf.readUInt16LE(e)) ?? null); put(resId, eflags >>> 8, buf.readUInt32LE(e + 4), isDefault); continue; }
            names.set(resId, keyPool?.get(buf.readUInt32LE(e + 4)) ?? null);
            if (eflags & 0x0001 || e + 16 > t.end) continue; // bag (style, array, plurals): counted, not resolved
            put(resId, buf[e + 11], buf.readUInt32LE(e + 12), isDefault);
          }
        } else if (t.type !== TABLE_TYPE_SPEC && t.type !== RES_STRING_POOL && t.size === 0) break;
        q = t.end;
      }
      packages.push({ id, name, configurations: configs, types: Object.fromEntries([...seen].map(([n, s]) => [n, s.size])) });
    }
    p = c.end;
  }
  if (!global) throw bad('resource table has no global string pool');
  const toId = ref => (typeof ref === 'number' ? ref >>> 0 : /^[@?]?0x[0-9a-f]{1,8}$/i.test(String(ref)) ? Number(String(ref).replace(/^[@?]/, '')) >>> 0 : null);
  /** String or scalar behind a resource id or "@0x7f…" reference; undefined when it is not in the table. */
  const resolve = (ref, depth = 0) => {
    const id = toId(ref);
    if (id === null || depth > 8) return undefined;
    const v = values.get(id);
    if (!v) return undefined;
    if (v.type === 0x01) return v.data === id ? undefined : resolve(v.data, depth + 1);
    const f = formatValue(v.type, v.data, global);
    return v.type === 0x03 ? f.value : f.kind === 'int' || f.kind === 'bool' || f.kind === 'float' ? f.value : f.text;
  };
  const out = { packages, globalStrings: global.count, resources: values.size, resolve, nameOf: id => names.get(toId(id)) ?? null };
  if (limit > 0) {
    const strings = [];
    let total = 0;
    for (const [id, v] of values) {
      if (v.type !== 0x03) continue;
      total++;
      if (strings.length < limit) { const s = global.get(v.data) ?? ''; strings.push({ id: hex8(id), name: names.get(id) ?? null, value: s.length > 200 ? `${s.slice(0, 197)}…` : s }); }
    }
    out.strings = strings; out.stringsTotal = total;
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ Apple property lists
// Values that JSON cannot hold use the deep-analysis engine's shapes (src/domain/apple/plistValue.ts):
// { $plist_type: 'data', base64 }, { $plist_type: 'date', iso8601 }, { $plist_type: 'integer', decimal } for integers
// beyond 2^53, and { $plist_type: 'uid', value }. Sets become arrays.
const APPLE_EPOCH_MS = Date.UTC(2001, 0, 1);
const MAX_PLIST_NODES = 1_000_000, MAX_PLIST_DEPTH = 64;
const plistDate = ms => ({ $plist_type: 'date', iso8601: Number.isFinite(ms) && Math.abs(ms) < 8.64e15 ? new Date(ms).toISOString().replace('.000Z', 'Z') : null });
const plistInt = big => (big >= BigInt(Number.MIN_SAFE_INTEGER) && big <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(big) : { $plist_type: 'integer', decimal: big.toString() });

/** Own data property, also for a key named __proto__. */
const setOwn = (obj, key, value) => Object.defineProperty(obj, key, { value, enumerable: true, writable: true, configurable: true });

export const isBinaryPlist = buf => buf.length >= 8 && buf.toString('latin1', 0, 6) === 'bplist';

export function parseBinaryPlist(buf) {
  if (!isBinaryPlist(buf)) throw bad('not a binary property list (no bplist header)');
  if (buf.length < 40) throw bad('binary plist is too short to hold its 32-byte trailer');
  const t = buf.length - 32;
  const offSize = buf[t + 6], refSize = buf[t + 7];
  const count = buf.readBigUInt64BE(t + 8), topRef = buf.readBigUInt64BE(t + 16), tableOff = buf.readBigUInt64BE(t + 24);
  if (offSize < 1 || offSize > 8 || refSize < 1 || refSize > 8) throw bad(`binary plist trailer has an impossible offset size (${offSize}) or object-reference size (${refSize})`);
  if (count < 1n || count > BigInt(buf.length)) throw bad(`binary plist trailer claims ${count} objects in a ${buf.length}-byte file`);
  const n = Number(count);
  if (tableOff < 8n || tableOff + BigInt(n) * BigInt(offSize) > BigInt(t)) throw bad('binary plist offset table lies outside the file');
  if (topRef >= count) throw bad(`binary plist top object ${topRef} is past the object count ${n}`);
  const table = Number(tableOff);
  const uint = (p, size) => { let v = 0n; for (let i = 0; i < size; i++) v = (v << 8n) | BigInt(buf[p + i]); return v; };
  const need = (p, len, what) => { if (p < 8 || len < 0 || p + len > table) throw bad(`binary plist ${what} at offset ${p} runs outside the object area`); };
  const offsetOf = ref => {
    if (ref >= n) throw bad(`binary plist object reference ${ref} is past the object count ${n}`);
    const o = uint(table + ref * offSize, offSize);
    if (o < 8n || o >= BigInt(table)) throw bad(`binary plist object ${ref} points outside the file (offset ${o})`);
    return Number(o);
  };
  const active = new Set();
  let visited = 0;
  const read = (ref, depth) => {
    if (depth > MAX_PLIST_DEPTH) throw bad(`binary plist nests deeper than ${MAX_PLIST_DEPTH} levels`);
    if (++visited > MAX_PLIST_NODES) throw bad('binary plist expands to more than a million values (objects referenced over and over)');
    let p = offsetOf(ref);
    const marker = buf[p++], kind = marker >> 4, low = marker & 15;
    const length = () => {
      if (low !== 15) return low;
      need(p, 1, 'length');
      const m = buf[p++];
      if (m >> 4 !== 1) throw bad(`binary plist length at offset ${p - 1} is not an integer object`);
      const size = 1 << (m & 15);
      if (size > 8) throw bad('binary plist length is wider than 8 bytes');
      need(p, size, 'length');
      const v = uint(p, size); p += size;
      if (v > BigInt(buf.length)) throw bad(`binary plist length ${v} is larger than the file`);
      return Number(v);
    };
    const refs = len => { need(p, len * refSize, 'reference list'); const list = []; for (let i = 0; i < len; i++) list.push(Number(uint(p + i * refSize, refSize))); p += len * refSize; return list; };
    const container = fn => {
      if (active.has(ref)) throw bad(`binary plist object ${ref} contains itself`);
      active.add(ref);
      try { return fn(); } finally { active.delete(ref); }
    };
    switch (kind) {
      case 0x0:
        if (low === 0) return null;
        if (low === 8) return false;
        if (low === 9) return true;
        if (low === 15) return null; // fill byte
        throw bad(`binary plist has an unknown marker 0x${marker.toString(16)} at offset ${p - 1}`);
      case 0x1: {
        const size = 1 << low;
        if (size > 16) throw bad(`binary plist integer of ${size} bytes at offset ${p - 1}`);
        need(p, size, 'integer');
        // 1, 2 and 4 bytes are unsigned; 8 bytes is signed; 16 bytes is a signed 128-bit value.
        const v = uint(p, size);
        return plistInt(size === 8 ? BigInt.asIntN(64, v) : size === 16 ? BigInt.asIntN(128, v) : v);
      }
      case 0x2: {
        const size = 1 << low;
        if (size !== 4 && size !== 8) throw bad(`binary plist real of ${size} bytes at offset ${p - 1}`);
        need(p, size, 'real');
        return size === 4 ? buf.readFloatBE(p) : buf.readDoubleBE(p);
      }
      case 0x3: {
        if (low !== 3) throw bad(`binary plist date with marker 0x${marker.toString(16)}`);
        need(p, 8, 'date');
        return plistDate(APPLE_EPOCH_MS + buf.readDoubleBE(p) * 1000);
      }
      case 0x4: { const len = length(); need(p, len, 'data'); return { $plist_type: 'data', base64: buf.toString('base64', p, p + len) }; }
      case 0x5: { const len = length(); need(p, len, 'string'); return buf.toString('latin1', p, p + len); }
      case 0x6: { const len = length(); need(p, len * 2, 'UTF-16 string'); return Buffer.from(buf.subarray(p, p + len * 2)).swap16().toString('utf16le'); }
      case 0x7: { const len = length(); need(p, len, 'UTF-8 string'); return buf.toString('utf8', p, p + len); }
      case 0x8: { const size = low + 1; need(p, size, 'UID'); return { $plist_type: 'uid', value: Number(uint(p, Math.min(size, 8))) }; }
      case 0xa: case 0xb: case 0xc: { const list = refs(length()); return container(() => list.map(r => read(r, depth + 1))); }
      case 0xd: {
        const len = length();
        const keys = refs(len), vals = refs(len);
        return container(() => {
          const out = {};
          for (let i = 0; i < len; i++) { const k = read(keys[i], depth + 1); setOwn(out, typeof k === 'string' ? k : JSON.stringify(k), read(vals[i], depth + 1)); }
          return out;
        });
      }
      default: throw bad(`binary plist has an unknown marker 0x${marker.toString(16)} at offset ${p - 1}`);
    }
  };
  return read(Number(topRef), 0);
}

const XML_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unescapeXml = s => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
  if (e[0] !== '#') return XML_ENTITIES[e] ?? m;
  const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
  return cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
});

export const isXmlPlist = text => /<plist[\s>]/.test(text.slice(0, 2048));

/** Small tolerant XML plist reader: declaration, doctype and comments are skipped, unknown elements read as text. */
export function parseXmlPlist(text) {
  const tokens = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<![^>]*>|<(\/?)([A-Za-z][\w.-]*)[^>]*?(\/?)>|([^<]+)/g;
  let tok = null, visited = 0;
  const next = () => {
    for (;;) {
      const m = tokens.exec(text);
      if (!m) return (tok = null);
      if (m[2] !== undefined && m[3]) return (tok = { tag: m[3], close: m[2] === '/', self: m[4] === '/' });
      if (m[1] !== undefined) return (tok = { text: m[1], cdata: true });
      if (m[5] !== undefined) return (tok = { text: m[5] });
    }
  };
  const nextTag = () => { do next(); while (tok && tok.text !== undefined); return tok; };
  /** Text up to the closing tag of `tag`. */
  const body = tag => {
    let s = '';
    for (next(); tok; next()) {
      if (tok.text !== undefined) s += tok.cdata ? tok.text : unescapeXml(tok.text);
      else if (tok.close && tok.tag === tag) return s;
    }
    throw bad(`XML plist ends inside <${tag}>`);
  };
  const value = (t, depth) => {
    if (depth > MAX_PLIST_DEPTH) throw bad(`XML plist nests deeper than ${MAX_PLIST_DEPTH} levels`);
    if (++visited > MAX_PLIST_NODES) throw bad('XML plist holds more than a million values');
    if (t.close) throw bad(`XML plist has an unexpected </${t.tag}>`);
    if (t.tag === 'true') { if (!t.self) body('true'); return true; }
    if (t.tag === 'false') { if (!t.self) body('false'); return false; }
    if (t.tag === 'dict') {
      const out = {};
      if (t.self) return out;
      for (;;) {
        const k = nextTag();
        if (!k) throw bad('XML plist ends inside <dict>');
        if (k.close && k.tag === 'dict') return out;
        if (k.tag !== 'key' || k.close) throw bad(`XML plist <dict> has <${k.close ? '/' : ''}${k.tag}> where a <key> belongs`);
        const key = k.self ? '' : body('key');
        const v = nextTag();
        if (!v) throw bad(`XML plist ends after <key>${key}</key>`);
        setOwn(out, key, value(v, depth + 1));
      }
    }
    if (t.tag === 'array') {
      const out = [];
      if (t.self) return out;
      for (;;) {
        const v = nextTag();
        if (!v) throw bad('XML plist ends inside <array>');
        if (v.close && v.tag === 'array') return out;
        out.push(value(v, depth + 1));
      }
    }
    const raw = t.self ? '' : body(t.tag);
    switch (t.tag) {
      case 'integer': { const s = raw.trim(); if (!/^[+-]?(0x[0-9a-f]+|\d+)$/i.test(s)) throw bad(`XML plist <integer> holds "${s.slice(0, 40)}"`); const neg = s[0] === '-'; const mag = BigInt(s.replace(/^[+-]/, '')); return plistInt(neg ? -mag : mag); }
      case 'real': { const s = raw.trim().toLowerCase(); return s === 'nan' ? NaN : s === 'inf' || s === '+infinity' || s === 'infinity' ? Infinity : s === '-inf' || s === '-infinity' ? -Infinity : Number(s); }
      case 'date': return plistDate(Date.parse(raw.trim()));
      case 'data': return { $plist_type: 'data', base64: Buffer.from(raw.replace(/\s+/g, ''), 'base64').toString('base64') };
      default: return raw; // <string> and anything unknown
    }
  };
  let t = nextTag();
  if (t && t.tag === 'plist' && !t.close) { if (t.self) throw bad('XML plist is empty'); t = nextTag(); }
  if (!t || (t.close && t.tag === 'plist')) throw bad('XML plist has no value');
  return value(t, 0);
}

/** Binary or XML property list from bytes. */
export function parsePlist(buf) {
  if (isBinaryPlist(buf)) return parseBinaryPlist(buf);
  const text = buf.toString(buf[0] === 0xff && buf[1] === 0xfe ? 'utf16le' : 'utf8').replace(/^﻿/, '');
  if (!isXmlPlist(text)) throw bad('not a property list (neither bplist00 nor an XML <plist>)');
  return parseXmlPlist(text);
}

/** Info.plist of an app bundle: identity, versions, minimum OS, URL schemes and the permission usage strings. */
export function infoPlistSummary(info) {
  if (!info || typeof info !== 'object' || Array.isArray(info)) throw bad('Info.plist does not hold a dictionary');
  const s = v => (typeof v === 'string' || typeof v === 'number' ? v : undefined);
  const list = v => (Array.isArray(v) ? v.filter(x => typeof x === 'string' || typeof x === 'number').slice(0, 40) : undefined);
  const clip = v => (typeof v === 'string' && v.length > 200 ? `${v.slice(0, 197)}…` : v);
  const out = {
    bundleId: s(info.CFBundleIdentifier), name: s(info.CFBundleName), displayName: s(info.CFBundleDisplayName),
    version: s(info.CFBundleShortVersionString), build: s(info.CFBundleVersion), executable: s(info.CFBundleExecutable),
    minimumOS: s(info.MinimumOSVersion) ?? s(info.LSMinimumSystemVersion), platforms: list(info.CFBundleSupportedPlatforms), platform: s(info.DTPlatformName),
    deviceFamily: list(info.UIDeviceFamily), requiredCapabilities: Array.isArray(info.UIRequiredDeviceCapabilities) ? list(info.UIRequiredDeviceCapabilities) : info.UIRequiredDeviceCapabilities && typeof info.UIRequiredDeviceCapabilities === 'object' ? Object.keys(info.UIRequiredDeviceCapabilities).slice(0, 40) : undefined,
    sdk: s(info.DTSDKName), xcode: s(info.DTXcode),
  };
  const schemes = (Array.isArray(info.CFBundleURLTypes) ? info.CFBundleURLTypes : []).flatMap(t => (Array.isArray(t?.CFBundleURLSchemes) ? t.CFBundleURLSchemes : [])).filter(x => typeof x === 'string');
  out.urlSchemes = [...new Set(schemes)].slice(0, 40);
  const queries = list(info.LSApplicationQueriesSchemes);
  if (queries?.length) out.queriesSchemes = queries;
  const usage = Object.entries(info).filter(([k, v]) => /^NS\w+UsageDescription$/.test(k) && typeof v === 'string');
  out.permissions = Object.fromEntries(usage.slice(0, 60).map(([k, v]) => [k, clip(v)]));
  const ats = info.NSAppTransportSecurity;
  if (ats && typeof ats === 'object') out.allowsArbitraryLoads = ats.NSAllowsArbitraryLoads === true;
  const modes = list(info.UIBackgroundModes);
  if (modes?.length) out.backgroundModes = modes;
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  return out;
}

/** ABI folders and library names from a zip listing (lib/<abi>/lib*.so). */
export function nativeLibsFromEntries(paths) {
  const abis = new Map(), names = new Set();
  for (const p of paths) {
    const m = /^lib\/([^/]+)\/([^/]+\.so)$/.exec(p);
    if (!m) continue;
    abis.set(m[1], (abis.get(m[1]) ?? 0) + 1);
    names.add(m[2]);
  }
  if (!abis.size) return { abis: [], libraries: [] };
  const libs = [...names].sort();
  return { abis: [...abis.keys()].sort(), libraries: libs.slice(0, 60), ...(libs.length > 60 ? { librariesTotal: libs.length } : {}) };
}
