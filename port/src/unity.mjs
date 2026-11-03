// Unity asset bundles (UnityFS, LZ4/LZMA blocks) and serialized asset files (.assets, level*, globalgamemanagers,
// CAB-* inside bundles), read without Unity and without dependencies. Lists every object by class and name, the
// bundle's container paths, the C# scripts the objects use and the scenes in the build; extracts TextAssets,
// AudioClip banks (FSB5), textures as PNG, and any object as JSON when the file carries type trees (bundles do),
// or as raw bytes when it does not (most player builds). Nothing is decrypted: encrypted bundles are reported.
import path from 'node:path';
import fs from 'node:fs/promises';
import { RPError, readAt, statOrNull, MiB } from './util.mjs';
import { lz4Block, lzmaDecode } from './decompress.mjs';
import { TEXTURE_FORMATS, DECODABLE, chainBytes, textureFile } from './texture.mjs';
import { meshToObj } from './mesh.mjs';

/** Unity class ids → class names (the ids Unity writes in YAML as !u!<id> and in binary object tables). */
export const CLASS_NAMES = {
  1: 'GameObject', 2: 'Component', 3: 'LevelGameManager', 4: 'Transform', 5: 'TimeManager', 6: 'GlobalGameManager', 8: 'Behaviour',
  9: 'GameManager', 11: 'AudioManager', 13: 'InputManager', 18: 'EditorExtension', 19: 'Physics2DSettings', 20: 'Camera', 21: 'Material',
  23: 'MeshRenderer', 25: 'Renderer', 27: 'Texture', 28: 'Texture2D', 29: 'OcclusionCullingSettings', 30: 'GraphicsSettings', 33: 'MeshFilter',
  41: 'OcclusionPortal', 43: 'Mesh', 45: 'Skybox', 47: 'QualitySettings', 48: 'Shader', 49: 'TextAsset', 50: 'Rigidbody2D',
  53: 'Collider2D', 54: 'Rigidbody', 55: 'PhysicsManager', 56: 'Collider', 57: 'Joint', 58: 'CircleCollider2D', 59: 'HingeJoint',
  60: 'PolygonCollider2D', 61: 'BoxCollider2D', 62: 'PhysicsMaterial2D', 64: 'MeshCollider', 65: 'BoxCollider', 66: 'CompositeCollider2D',
  68: 'EdgeCollider2D', 70: 'CapsuleCollider2D', 72: 'ComputeShader', 74: 'AnimationClip', 78: 'TagManager', 81: 'AudioListener',
  82: 'AudioSource', 83: 'AudioClip', 84: 'RenderTexture', 86: 'CustomRenderTexture', 89: 'Cubemap', 90: 'Avatar', 91: 'AnimatorController',
  93: 'RuntimeAnimatorController', 94: 'ScriptMapper', 95: 'Animator', 96: 'TrailRenderer', 98: 'DelayedCallManager', 102: 'TextMesh',
  104: 'RenderSettings', 108: 'Light', 109: 'CGProgram', 111: 'Animation', 114: 'MonoBehaviour', 115: 'MonoScript', 116: 'MonoManager',
  117: 'Texture3D', 119: 'Projector', 120: 'LineRenderer', 121: 'Flare', 123: 'LensFlare', 124: 'FlareLayer', 128: 'Font',
  129: 'PlayerSettings', 130: 'NamedObject', 134: 'PhysicMaterial', 135: 'SphereCollider', 136: 'CapsuleCollider',
  137: 'SkinnedMeshRenderer', 138: 'FixedJoint', 141: 'BuildSettings', 142: 'AssetBundle', 143: 'CharacterController',
  144: 'CharacterJoint', 145: 'SpringJoint', 146: 'WheelCollider', 147: 'ResourceManager', 150: 'PreloadData', 153: 'ConfigurableJoint',
  154: 'TerrainCollider', 156: 'TerrainData', 157: 'LightmapSettings', 158: 'WebCamTexture', 159: 'EditorSettings', 162: 'EditorUserSettings',
  164: 'AudioReverbFilter', 165: 'AudioHighPassFilter', 166: 'AudioChorusFilter', 167: 'AudioReverbZone', 168: 'AudioEchoFilter',
  169: 'AudioLowPassFilter', 170: 'AudioDistortionFilter', 171: 'SparseTexture', 180: 'AudioBehaviour', 181: 'AudioFilter',
  182: 'WindZone', 183: 'Cloth', 184: 'SubstanceArchive', 185: 'ProceduralMaterial', 186: 'ProceduralTexture', 187: 'Texture2DArray',
  188: 'CubemapArray', 191: 'OffMeshLink', 192: 'OcclusionArea', 193: 'Tree', 195: 'NavMeshAgent', 196: 'NavMeshSettings',
  198: 'ParticleSystem', 199: 'ParticleSystemRenderer', 200: 'ShaderVariantCollection', 205: 'LODGroup', 206: 'BlendTree',
  207: 'Motion', 208: 'NavMeshObstacle', 210: 'SortingGroup', 212: 'SpriteRenderer', 213: 'Sprite', 214: 'CachedSpriteAtlas',
  215: 'ReflectionProbe', 218: 'Terrain', 220: 'LightProbeGroup', 221: 'AnimatorOverrideController', 222: 'CanvasRenderer',
  223: 'Canvas', 224: 'RectTransform', 225: 'CanvasGroup', 226: 'BillboardAsset', 227: 'BillboardRenderer', 228: 'SpeedTreeWindAsset',
  229: 'AnchoredJoint2D', 230: 'Joint2D', 231: 'SpringJoint2D', 232: 'DistanceJoint2D', 233: 'HingeJoint2D', 234: 'SliderJoint2D',
  235: 'WheelJoint2D', 238: 'NavMeshData', 240: 'AudioMixer', 241: 'AudioMixerController', 243: 'AudioMixerGroupController',
  244: 'AudioMixerEffectController', 245: 'AudioMixerSnapshotController', 246: 'PhysicsUpdateBehaviour2D', 247: 'ConstantForce2D',
  248: 'Effector2D', 249: 'AreaEffector2D', 250: 'PointEffector2D', 251: 'PlatformEffector2D', 252: 'SurfaceEffector2D',
  258: 'LightProbes', 271: 'SampleClip', 272: 'AudioMixerSnapshot', 273: 'AudioMixerGroup', 290: 'AssetBundleManifest',
  300: 'RuntimeInitializeOnLoadManager', 319: 'AvatarMask', 320: 'PlayableDirector', 328: 'VideoPlayer', 329: 'VideoClip',
  331: 'SpriteMask', 363: 'OcclusionCullingData', 1001: 'PrefabInstance', 1101: 'AnimatorStateTransition', 1102: 'AnimatorState',
  1105: 'HumanTemplate', 1107: 'AnimatorStateMachine', 1108: 'PreviewAnimationClip', 1109: 'AnimatorTransition', 1111: 'AnimatorTransitionBase',
  1113: 'LightmapParameters', 1120: 'LightingDataAsset', 19719996: 'TilemapCollider2D', 156049354: 'Grid', 483693784: 'TilemapRenderer',
  687078895: 'SpriteAtlas', 1660057539: 'SceneRoots', 1839735485: 'Tilemap',
};
export const className = id => CLASS_NAMES[id] ?? `Class${id}`;

// Unity's shared type-tree string table: a node name or type with the top offset bit set is an index into this
// null-separated list (the list as Unity writes it; UnityPy and AssetStudio carry the same table).
const COMMON = (`AABB AnimationClip AnimationCurve AnimationState Array Base BitField bitset bool char ColorRGBA Component data deque double
dynamic_array FastPropertyName first float Font GameObject ${'Generic Mono'} GradientNEW GUID GUIStyle int list ${'long long'} map Matrix4x4f MdFour
MonoBehaviour MonoScript m_ByteSize m_Curve m_EditorClassIdentifier m_EditorHideFlags m_Enabled m_ExtensionPtr m_GameObject m_Index m_IsArray
m_IsStatic m_MetaFlag m_Name m_ObjectHideFlags m_PrefabInternal m_PrefabParentObject m_Script m_StaticEditorFlags m_Type m_Version Object pair
PPtr<Component> PPtr<GameObject> PPtr<Material> PPtr<MonoBehaviour> PPtr<MonoScript> PPtr<Object> PPtr<Prefab> PPtr<Sprite> PPtr<TextAsset>
PPtr<Texture> PPtr<Texture2D> PPtr<Transform> Prefab Quaternionf Rectf RectInt RectOffset second set short size SInt16 SInt32 SInt64 SInt8
staticvector string TextAsset TextMesh Texture Texture2D Transform TypelessData UInt16 UInt32 UInt64 UInt8 ${'unsigned int'} ${'unsigned long long'}
${'unsigned short'} vector Vector2f Vector3f Vector4f m_ScriptingClassIdentifier Gradient Type* int2_storage int3_storage BoundsInt
m_CorrespondingSourceObject m_PrefabInstance m_PrefabAsset FileSize Hash128 RenderingLayerMask fixed_array EntityId LoadableObjectId LoadableSceneId`);
const COMMON_STRINGS = (() => {
  // Multi-word entries are protected above by template slots; split on whitespace, then restore them.
  const multi = ['Generic Mono', 'long long', 'unsigned int', 'unsigned long long', 'unsigned short'];
  let text = COMMON;
  multi.forEach((m, i) => { text = text.replace(m, `\u0001${i}`); });
  const map = new Map();
  let off = 0;
  for (const raw of text.split(/\s+/).filter(Boolean)) {
    const s = raw.startsWith('\u0001') ? multi[Number(raw.slice(1))] : raw;
    map.set(off, s); off += Buffer.byteLength(s) + 1;
  }
  return map;
})();

const PLATFORMS = { 2: 'macOS', 5: 'Windows (32-bit)', 9: 'iOS', 13: 'Android', 19: 'Windows (64-bit)', 20: 'WebGL', 24: 'Linux (64-bit)', 31: 'PS4', 33: 'Xbox One', 38: 'Nintendo Switch' };

// ---------------------------------------------------------------- binary reader
class Bin {
  constructor(buf, le = true, base = 0) { this.b = buf; this.le = le; this.p = 0; this.base = base; }
  need(n) { if (n < 0 || this.p + n > this.b.length) throw new RangeError('read past the end'); }
  get left() { return this.b.length - this.p; }
  u8() { this.need(1); return this.b[this.p++]; }
  i8() { this.need(1); return this.b.readInt8(this.p++); }
  u16() { this.need(2); const v = this.le ? this.b.readUInt16LE(this.p) : this.b.readUInt16BE(this.p); this.p += 2; return v; }
  i16() { this.need(2); const v = this.le ? this.b.readInt16LE(this.p) : this.b.readInt16BE(this.p); this.p += 2; return v; }
  u32() { this.need(4); const v = this.le ? this.b.readUInt32LE(this.p) : this.b.readUInt32BE(this.p); this.p += 4; return v; }
  i32() { this.need(4); const v = this.le ? this.b.readInt32LE(this.p) : this.b.readInt32BE(this.p); this.p += 4; return v; }
  i64() { this.need(8); const v = this.le ? this.b.readBigInt64LE(this.p) : this.b.readBigInt64BE(this.p); this.p += 8; return v; }
  u64() { this.need(8); const v = this.le ? this.b.readBigUInt64LE(this.p) : this.b.readBigUInt64BE(this.p); this.p += 8; return v; }
  f32() { this.need(4); const v = this.le ? this.b.readFloatLE(this.p) : this.b.readFloatBE(this.p); this.p += 4; return v; }
  f64() { this.need(8); const v = this.le ? this.b.readDoubleLE(this.p) : this.b.readDoubleBE(this.p); this.p += 8; return v; }
  bytes(n) { this.need(n); const v = this.b.subarray(this.p, this.p + n); this.p += n; return v; }
  align(n = 4) { const abs = this.base + this.p; this.p = Math.min(this.b.length, this.p + ((n - (abs % n)) % n)); }
  cstr() { const e = this.b.indexOf(0, this.p); if (e < 0) throw new RangeError('unterminated string'); const s = this.b.toString('utf8', this.p, e); this.p = e + 1; return s; }
  /** Aligned length-prefixed string as raw bytes (Unity's read_aligned_string). */
  strBytes() { const n = this.i32(); if (n <= 0) return Buffer.alloc(0); const v = this.bytes(n); this.align(); return v; }
  str() { return this.strBytes().toString('utf8'); }
}

const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const textOf = buf => { try { const s = utf8.decode(buf); return /\0/.test(s) ? null : s; } catch { return null; } };
const looksName = s => s != null && s.length <= 512 && !/[\u0000-\u0008\u000e-\u001f]/.test(s);

// ---------------------------------------------------------------- byte sources
/** A file read through a small cache of 1 MiB chunks (object tables are read in file order). */
class FileSource {
  constructor(abs, size) { this.abs = abs; this.size = size; this.cache = new Map(); }
  async read(off, len) {
    if (off < 0 || len < 0 || off + len > this.size) throw new RPError('BAD_FORMAT', `Unity data points past the end of ${path.basename(this.abs)}.`);
    if (len > MiB) return readAt(this.abs, off, len);
    const first = Math.floor(off / MiB), last = Math.floor((off + len - 1) / MiB);
    const parts = [];
    for (let c = first; c <= last; c++) {
      let chunk = this.cache.get(c);
      if (!chunk) {
        chunk = await readAt(this.abs, c * MiB, MiB);
        this.cache.set(c, chunk);
        if (this.cache.size > 16) this.cache.delete(this.cache.keys().next().value);
      }
      parts.push(chunk);
    }
    const all = parts.length === 1 ? parts[0] : Buffer.concat(parts);
    const start = off - first * MiB;
    return all.subarray(start, start + len);
  }
}

class SliceSource {
  constructor(parent, base, size) { this.parent = parent; this.base = base; this.size = size; }
  read(off, len) {
    if (off < 0 || len < 0 || off + len > this.size) throw new RPError('BAD_FORMAT', 'Unity data points past the end of a bundle entry.');
    return this.parent.read(this.base + off, len);
  }
}

const BLOCK_CACHE_BYTES = 256 * MiB, MAX_BLOCK = 1024 * MiB;

/** The uncompressed data of a UnityFS bundle, decompressed block by block on demand. */
class BlockStream {
  constructor(abs, blocks, dataStart) {
    this.abs = abs; this.blocks = []; this.cache = new Map(); this.cached = 0;
    let u = 0, c = dataStart;
    for (const b of blocks) { this.blocks.push({ ...b, uOff: u, cOff: c }); u += b.uSize; c += b.cSize; }
    this.size = u;
  }
  async block(i) {
    const hit = this.cache.get(i);
    if (hit) { this.cache.delete(i); this.cache.set(i, hit); return hit; }
    const b = this.blocks[i];
    if (b.uSize > MAX_BLOCK) throw new RPError('TOO_LARGE', `A bundle block unpacks to ${Math.round(b.uSize / MiB)} MiB, over the ${MAX_BLOCK / MiB} MiB limit.`);
    const raw = await readAt(this.abs, b.cOff, b.cSize);
    if (raw.length < b.cSize) throw new RPError('BAD_FORMAT', 'The bundle is truncated.');
    const out = decompress(raw, b.flags & 0x3f, b.uSize, 'bundle block');
    this.cache.set(i, out); this.cached += out.length;
    while (this.cached > BLOCK_CACHE_BYTES && this.cache.size > 1) { const [k, v] = this.cache.entries().next().value; this.cache.delete(k); this.cached -= v.length; }
    return out;
  }
  async read(off, len) {
    if (off < 0 || len < 0 || off + len > this.size) throw new RPError('BAD_FORMAT', 'A bundle entry points past the end of the bundle data.');
    if (!len) return Buffer.alloc(0);
    let lo = 0, hi = this.blocks.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (this.blocks[mid].uOff <= off) lo = mid; else hi = mid - 1; }
    const parts = [];
    let need = len, pos = off;
    for (let i = lo; need > 0 && i < this.blocks.length; i++) {
      const b = this.blocks[i];
      const s = pos - b.uOff, take = Math.min(need, b.uSize - s);
      if ((b.flags & 0x3f) === 0) { // stored: read the slice straight from the file, whatever the block's size
        const raw = await readAt(this.abs, b.cOff + s, take);
        if (raw.length < take) throw new RPError('BAD_FORMAT', 'The bundle is truncated.');
        parts.push(raw);
      } else parts.push((await this.block(i)).subarray(s, s + take));
      need -= take; pos += take;
    }
    return parts.length === 1 ? parts[0] : Buffer.concat(parts);
  }
}

const COMPRESSION = ['none', 'LZMA', 'LZ4', 'LZ4HC', 'LZHAM'];
function decompress(buf, kind, size, what) {
  if (kind === 0) return buf;
  if (kind === 2 || kind === 3) return lz4Block(buf, size);
  if (kind === 1) return lzmaDecode(buf.subarray(0, 5), buf.subarray(5), size);
  throw new RPError('UNSUPPORTED_ARCHIVE', `${COMPRESSION[kind] ?? `compression ${kind}`} ${what}s are not supported (LZ4, LZ4HC, LZMA and stored are).`);
}

// ---------------------------------------------------------------- UnityFS bundle
const versionTuple = s => (String(s).match(/^(\d+)\.(\d+)\.(\d+)/) ?? [0, 0, 0, 0]).slice(1).map(Number);
const vcmp = (a, b) => { for (let i = 0; i < 3; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) - (b[i] ?? 0); return 0; };

async function openBundle(abs, size) {
  const head = await readAt(abs, 0, Math.min(size, 4096));
  const r = new Bin(head, false);
  const sig = r.cstr();
  const fmt = r.u32();
  // UnityWeb/UnityRaw format 6 uses the UnityFS layout with one extra byte after the flags; older ones do not.
  if (sig !== 'UnityFS' && fmt !== 6) {
    return { format: 'unity-bundle', signature: sig, bundleFormat: fmt, entries: [], note: `${sig} bundles of format ${fmt} (Unity 5.2 and older) are identified but not unpacked; UnityFS bundles and format-6 ${sig} bundles are.` };
  }
  const player = r.cstr(), revision = r.cstr();
  r.i64();
  const cInfo = r.u32(), uInfo = r.u32(), flags = r.u32();
  if (sig !== 'UnityFS') r.u8();
  if (cInfo > size - r.p) throw new RPError('BAD_FORMAT', 'The bundle is truncated (block table larger than the file).');
  const ver = versionTuple(revision);
  const oldFlags = vcmp(ver, [2020, 0, 0]) < 0 || (ver[0] === 2020 && vcmp(ver, [2020, 3, 34]) < 0) || (ver[0] === 2021 && vcmp(ver, [2021, 3, 2]) < 0) || (ver[0] === 2022 && vcmp(ver, [2022, 1, 1]) < 0);
  const base = { format: 'unityfs', ...(sig !== 'UnityFS' ? { signature: sig } : {}), bundleFormat: fmt, unityVersion: player === '5.x.x' ? revision : player, unityRevision: revision, blockInfoCompression: COMPRESSION[flags & 0x3f] ?? flags & 0x3f };
  if (flags & (oldFlags ? 0x200 : 0x1400)) return { ...base, encrypted: true, entries: [], note: 'This bundle uses Unity asset-bundle encryption (as some UnityCN builds do): it is identified, never decrypted.' };
  if (fmt >= 7 || (ver[0] === 2019 && vcmp(ver, [2019, 4, 15]) >= 0)) r.align(16);
  let infoRaw, dataStart;
  if (flags & 0x80) { infoRaw = await readAt(abs, size - cInfo, cInfo); dataStart = r.p; }
  else { infoRaw = await readAt(abs, r.p, cInfo); dataStart = r.p + cInfo; }
  if (infoRaw.length < cInfo) throw new RPError('BAD_FORMAT', 'The bundle is truncated (block table).');
  if (!oldFlags && flags & 0x200) dataStart = Math.ceil(dataStart / 16) * 16;
  const info = new Bin(decompress(infoRaw, flags & 0x3f, uInfo, 'block table'), false);
  info.bytes(16);
  const blockCount = info.i32();
  if (blockCount < 0 || blockCount * 10 > info.left) throw new RPError('BAD_FORMAT', 'Bad block count in the bundle.');
  const blocks = [];
  for (let i = 0; i < blockCount; i++) blocks.push({ uSize: info.u32(), cSize: info.u32(), flags: info.u16() });
  const nodeCount = info.i32();
  if (nodeCount < 0 || nodeCount * 21 > info.left) throw new RPError('BAD_FORMAT', 'Bad file count in the bundle.');
  const nodes = [];
  for (let i = 0; i < nodeCount; i++) nodes.push({ offset: Number(info.i64()), size: Number(info.i64()), flags: info.u32(), path: info.cstr() });
  const stream = new BlockStream(abs, blocks, dataStart);
  for (const n of nodes) if (n.offset < 0 || n.size < 0 || n.offset + n.size > stream.size) throw new RPError('BAD_FORMAT', `Bundle entry ${n.path} lies outside the bundle data.`);
  const kinds = [...new Set(blocks.map(b => COMPRESSION[b.flags & 0x3f] ?? `compression ${b.flags & 0x3f}`))];
  return { ...base, compression: kinds.length === 1 ? kinds[0] : kinds.join('+'), blockCompression: kinds, blocks: blocks.length, nodes, stream };
}

// ---------------------------------------------------------------- serialized files
/** Does this look like a Unity serialized file of `size` bytes (it has no magic, so check the header's own sums)? */
export function looksLikeSerializedFile(head, size) {
  if (head.length < 48) return false;
  const version = head.readUInt32BE(8);
  if (version < 14 || version > 40) return false;
  let metadataSize = head.readUInt32BE(0), fileSize = head.readUInt32BE(4), dataOffset = head.readUInt32BE(12);
  if (version >= 22) { metadataSize = head.readUInt32BE(20); fileSize = Number(head.readBigUInt64BE(24)); dataOffset = Number(head.readBigUInt64BE(32)); }
  return head[16] <= 1 && fileSize === size && dataOffset <= size && metadataSize > 0 && metadataSize < size && !head[17] && !head[18] && !head[19];
}

function parseTypeTree(r, version) {
  if (version >= 23) {
    if (r.bytes(4).toString('latin1') !== 'mhtt') throw new RPError('BAD_FORMAT', 'Bad type tree blob.');
    r.i32();
  }
  const count = r.i32(), strSize = r.i32();
  const size = version >= 19 ? 32 : 24;
  if (count < 1 || count * size > r.left) throw new RPError('BAD_FORMAT', 'Bad type tree.');
  const raw = new Bin(r.bytes(count * size), r.le), strings = r.bytes(strSize);
  const name = v => {
    if (v & 0x80000000) return COMMON_STRINGS.get(v & 0x7fffffff) ?? String(v & 0x7fffffff);
    const e = strings.indexOf(0, v);
    return strings.toString('utf8', v, e < 0 ? strings.length : e);
  };
  const nodes = [];
  for (let i = 0; i < count; i++) {
    raw.u16(); const level = raw.u8(); raw.u8();
    const type = name(raw.u32()), field = name(raw.u32()), byteSize = raw.i32(); raw.i32(); const meta = raw.i32();
    if (size === 32) raw.u64();
    nodes.push({ level, type, name: field, byteSize, meta, children: [] });
  }
  const stack = [nodes[0]];
  for (const n of nodes.slice(1)) {
    while (stack.length && stack[stack.length - 1].level >= n.level) stack.pop();
    if (!stack.length) break;
    stack[stack.length - 1].children.push(n); stack.push(n);
  }
  return nodes[0];
}

const ALIGNED = 0x4000;
const PRIMS = {
  SInt8: r => r.i8(), UInt8: r => r.u8(), char: r => r.u8(), short: r => r.i16(), SInt16: r => r.i16(), 'unsigned short': r => r.u16(), UInt16: r => r.u16(),
  int: r => r.i32(), SInt32: r => r.i32(), 'unsigned int': r => r.u32(), UInt32: r => r.u32(), 'Type*': r => r.u32(),
  'long long': r => r.i64(), SInt64: r => r.i64(), 'unsigned long long': r => r.u64(), UInt64: r => r.u64(), FileSize: r => r.u64(),
  float: r => r.f32(), double: r => r.f64(), bool: r => r.u8() !== 0,
};
const BYTE_TYPES = new Set(['SInt8', 'UInt8', 'char']);

/** Does a node always take at least one byte (so an array of it cannot be longer than the bytes left)? */
const takesBytes = n => n.byteSize > 0 || !!PRIMS[n.type] || n.type === 'string' || n.type === 'TypelessData' || n.children.some(takesBytes);
const MAX_EMPTY_ITEMS = 1 << 20;

/**
 * Read one value by its type-tree node. Strings come back as text when valid UTF-8, else as a Buffer.
 * `ctx`: { refTypes, registry } — [SerializeReference] data is read with the file's ref-type trees, and only the
 * first ManagedReferencesRegistry is read (nested ones hold no data), as Unity writes them.
 */
function readValue(node, r, ctx = {}) {
  let v, align = node.meta & ALIGNED;
  const prim = PRIMS[node.type];
  if (prim) v = prim(r);
  else if (node.type === 'string') { const b = r.strBytes(); v = b.length > 65536 ? b : textOf(b) ?? b; }
  else if (node.type === 'TypelessData') { const n = r.i32(); v = r.bytes(n); }
  else if (node.type === 'pair') {
    if (node.children.length < 2) throw new RangeError('pair without two children');
    v = [readValue(node.children[0], r, ctx), readValue(node.children[1], r, ctx)];
  } else if (node.type === 'ReferencedObject') {
    v = {};
    for (const c of node.children) {
      if (c.type !== 'ReferencedObjectData') { v[c.name] = readValue(c, r, ctx); continue; }
      const t = v.type ?? {};
      if (!t.class) continue; // null reference: no data
      const tree = ctx.refTypes?.find(x => x.className === t.class && x.namespace === t.ns && x.assembly === t.asm)?.tree;
      if (!tree) throw new RangeError(`[SerializeReference] type ${t.ns ? `${t.ns}.` : ''}${t.class} is not in the file's ref types`);
      v[c.name] = readValue(tree, r, ctx);
    }
  } else if (node.children[0]?.type === 'Array') {
    const arr = node.children[0];
    if (arr.meta & ALIGNED) align = true;
    const n = r.i32(), item = arr.children[1];
    if (!item) throw new RangeError('array without an item type');
    if (n < 0 || n > (takesBytes(item) ? r.left : MAX_EMPTY_ITEMS)) throw new RangeError('bad array length');
    if (BYTE_TYPES.has(item.type)) v = r.bytes(n);
    else { v = new Array(n); for (let i = 0; i < n; i++) v[i] = readValue(item, r, ctx); }
  } else {
    v = {};
    for (const c of node.children) {
      if (c.type === 'ManagedReferencesRegistry') { if (ctx.registry) continue; v[c.name] = readValue(c, r, { ...ctx, registry: true }); continue; }
      v[c.name] = readValue(c, r, ctx);
    }
  }
  if (align) r.align();
  return v;
}

/** Read the root's fields in order until every wanted field is found (or all fields are read). */
function readFields(sf, root, r, wanted) {
  const out = {};
  const ctx = { refTypes: sf.refTypes };
  let left = wanted ? wanted.size : Infinity;
  for (const c of root.children) {
    if (c.type === 'ManagedReferencesRegistry') { if (ctx.registry) continue; out[c.name] = readValue(c, r, { ...ctx, registry: true }); ctx.registry = true; }
    else out[c.name] = readValue(c, r, ctx);
    if (wanted?.has(c.name) && --left === 0) break;
  }
  return out;
}

/** One SerializedType entry (the object types, or with `ref` the [SerializeReference] types). */
function readType(r, version, typeTree, label, ref) {
  const t = { classId: r.i32() };
  if (version >= 16) r.u8();
  t.scriptTypeIndex = version >= 17 ? r.i16() : -1;
  if ((ref && t.scriptTypeIndex >= 0) || (version < 16 && t.classId < 0) || (version >= 16 && t.classId === 114)) r.bytes(16);
  r.bytes(16);
  if (typeTree) {
    let present = true;
    if (version >= 23) { r.bytes(16); present = r.i32() !== 0; }
    if (present) t.tree = parseTypeTree(r, version);
    if (version >= 21) {
      if (ref) { t.className = r.cstr(); t.namespace = r.cstr(); t.assembly = r.cstr(); }
      else { const n = r.i32(); if (n < 0 || n * 4 > r.left) throw new RPError('BAD_FORMAT', `${label}: bad type dependencies.`); r.bytes(n * 4); }
    }
  }
  return t;
}

/**
 * The Unity version a file's layouts follow. Bundles built with "strip Unity version" write "0.0.0" in the file:
 * then the bundle's revision is used, else the lowest version that writes this serialized format.
 */
function layoutVersion(unityVersion, fallback, version) {
  const own = versionTuple(unityVersion);
  if (own[0]) return own;
  const fb = versionTuple(fallback ?? '');
  if (fb[0]) return fb;
  return version >= 22 ? [2020, 1, 0] : version >= 21 ? [2019, 3, 0] : version >= 20 ? [2019, 1, 0] : version >= 19 ? [2018, 3, 0] : version >= 17 ? [5, 5, 0] : [5, 0, 0];
}

async function parseSerialized(src, label, fallbackVersion) {
  try { return await parseSerializedRaw(src, label, fallbackVersion); }
  catch (e) { if (e instanceof RangeError || e instanceof TypeError) throw new RPError('BAD_FORMAT', `${label}: the serialized file is truncated or corrupt (${e.message}).`); throw e; }
}

async function parseSerializedRaw(src, label, fallbackVersion) {
  const h = new Bin(await src.read(0, Math.min(48, src.size)), false);
  let metadataSize = h.u32(), fileSize = h.u32();
  const version = h.u32();
  let dataOffset = h.u32();
  if (version < 14) throw new RPError('UNSUPPORTED_ARCHIVE', `Serialized file version ${version} (Unity 4 or older) is not supported; Unity 5 and newer are.`);
  const big = h.u8() === 1; h.bytes(3);
  if (version >= 22) { metadataSize = h.u32(); fileSize = Number(h.i64()); dataOffset = Number(h.i64()); h.i64(); }
  const headerSize = h.p;
  if (metadataSize > src.size - headerSize || dataOffset > src.size) throw new RPError('BAD_FORMAT', `${label}: header sizes do not fit the file.`);
  const r = new Bin(await src.read(headerSize, metadataSize), !big, headerSize);
  const unityVersion = r.cstr(), platform = r.i32(), typeTree = r.u8() !== 0;
  const typeCount = r.i32();
  if (typeCount < 0 || typeCount > r.left) throw new RPError('BAD_FORMAT', `${label}: bad type count.`);
  const types = [];
  for (let i = 0; i < typeCount; i++) types.push(readType(r, version, typeTree, label, false));
  const objectCount = r.i32();
  if (objectCount < 0 || objectCount > r.left) throw new RPError('BAD_FORMAT', `${label}: bad object count.`);
  const objects = [];
  for (let i = 0; i < objectCount; i++) {
    r.align();
    const pathId = r.i64();
    const start = (version >= 22 ? Number(r.i64()) : r.u32()) + dataOffset;
    const size = r.u32(), typeId = r.i32();
    let classId, type;
    if (version < 16) { classId = r.u16(); type = types.find(t => t.classId === typeId); }
    else { type = types[typeId]; classId = type?.classId; }
    if (version < 17) r.i16();
    if (version === 15 || version === 16) r.u8();
    if (classId == null || start + size > src.size) throw new RPError('BAD_FORMAT', `${label}: object ${pathId} is out of range.`);
    objects.push({ pathId, start, size, classId, tree: type?.tree });
  }
  const scriptCount = r.i32();
  if (scriptCount < 0 || scriptCount * 12 > r.left) throw new RPError('BAD_FORMAT', `${label}: bad script table.`);
  for (let i = 0; i < scriptCount; i++) { r.i32(); r.align(); r.i64(); }
  const extCount = r.i32();
  if (extCount < 0 || extCount > r.left) throw new RPError('BAD_FORMAT', `${label}: bad externals table.`);
  const externals = [];
  for (let i = 0; i < extCount; i++) { r.cstr(); r.bytes(16); r.i32(); externals.push(r.cstr()); }
  const refTypes = [];
  if (version >= 20 && r.left >= 4) {
    const n = r.i32();
    if (n < 0 || n > r.left) throw new RPError('BAD_FORMAT', `${label}: bad ref type count.`);
    for (let i = 0; i < n; i++) refTypes.push(readType(r, version, typeTree, label, true));
  }
  const unityTuple = layoutVersion(unityVersion, fallbackVersion, version);
  return { label, src, version, unityVersion: versionTuple(unityVersion)[0] ? unityVersion : fallbackVersion ?? unityVersion, unityVersionStripped: !versionTuple(unityVersion)[0], unityTuple, platform: PLATFORMS[platform] ?? platform, typeTree, le: !big, objects, externals, refTypes };
}

// ---------------------------------------------------------------- reading objects
const PEEK = 64 * 1024;
const objBin = (sf, obj, buf) => new Bin(buf, sf.le, obj.start);
/** Raw readers in the file's byte order, for the scans that look at fixed offsets. */
const order = le => ({
  u32: (b, o) => (le ? b.readUInt32LE(o) : b.readUInt32BE(o)), i32: (b, o) => (le ? b.readInt32LE(o) : b.readInt32BE(o)),
  u64: (b, o) => Number(le ? b.readBigUInt64LE(o) : b.readBigUInt64BE(o)),
});
const pptr = r => ({ fileId: r.i32(), pathId: r.i64() });
/** The bytes `inspect` needs: the whole object for script, bundle and build-settings objects, else the first 64 KiB. */
const headOf = (sf, o) => sf.src.read(o.start, [115, 141, 142].includes(o.classId) ? Math.min(o.size, 64 * MiB) : Math.min(o.size, PEEK));

/** The parts of an object the inventory needs, from its first bytes: name, script pointer, script identity, container, scenes. */
function inspect(sf, obj, buf) {
  const out = {};
  const r = objBin(sf, obj, buf);
  try {
    if (obj.tree) {
      const want = { 114: ['m_Script', 'm_Name'], 115: ['m_Name', 'm_ClassName', 'm_Namespace', 'm_AssemblyName'], 142: ['m_Name', 'm_Container'], 141: ['scenes', 'levels'] }[obj.classId] ?? ['m_Name'];
      const f = readFields(sf, obj.tree, r, obj.classId === 141 ? new Set(['scenes']) : new Set(want));
      if (typeof f.m_Name === 'string') out.name = f.m_Name;
      if (f.m_Script && typeof f.m_Script === 'object' && 'm_PathID' in f.m_Script) out.script = { fileId: f.m_Script.m_FileID, pathId: f.m_Script.m_PathID };
      if (obj.classId === 115) out.monoScript = { className: f.m_ClassName, namespace: f.m_Namespace, assembly: f.m_AssemblyName };
      if (obj.classId === 142 && Array.isArray(f.m_Container)) out.container = f.m_Container.map(([p, info]) => ({ path: p, pathId: info?.asset?.m_PathID, fileId: info?.asset?.m_FileID }));
      if (obj.classId === 141) out.scenes = f.scenes ?? f.levels;
      if (obj.classId === 28) Object.assign(out, textureHeader(sf, obj, buf));
      return out;
    }
    if (obj.classId === 1) { // GameObject: components, layer, name
      const n = r.i32();
      if (n < 0 || n > 100000) return out;
      r.bytes(n * (vcmp(sf.unityTuple, [5, 5, 0]) >= 0 ? 12 : 16)); r.u32();
      const s = r.str(); if (looksName(s)) out.name = s;
      return out;
    }
    if (obj.classId === 114) { // MonoBehaviour: m_GameObject, m_Enabled, m_Script, m_Name
      pptr(r); r.u8(); r.align(); out.script = pptr(r);
      const s = r.str(); if (looksName(s)) out.name = s;
      return out;
    }
    if (obj.classId === 141) { // BuildSettings: the scene list comes first
      const n = r.i32(); if (n < 0 || n > 65536) return out;
      const scenes = []; for (let i = 0; i < n; i++) scenes.push(r.str());
      if (scenes.every(looksName)) out.scenes = scenes;
      return out;
    }
    const name = r.str();
    if (!looksName(name)) return out;
    out.name = name;
    if (obj.classId === 115) {
      r.i32(); if (sf.unityTuple[0] >= 5) r.bytes(16); else r.u32();
      const className = r.str(), namespace = r.str(), assembly = r.str();
      if ([className, namespace, assembly].every(looksName)) out.monoScript = { className, namespace, assembly };
    } else if (obj.classId === 142) {
      const pre = r.i32(); if (pre < 0 || pre * 12 > r.left) return out;
      r.bytes(pre * 12);
      const n = r.i32(); if (n < 0 || n > r.left) return out;
      out.container = [];
      for (let i = 0; i < n; i++) { const p = r.str(); r.i32(); r.i32(); const a = pptr(r); out.container.push({ path: p, pathId: a.pathId, fileId: a.fileId }); }
    } else if (obj.classId === 28) Object.assign(out, textureHeader(sf, obj, buf));
  } catch (e) { if (!(e instanceof RangeError || e instanceof TypeError || e?.code === 'BAD_FORMAT')) throw e; }
  return out;
}

/** Texture2D size and format: from the type tree, or (no type tree) found by checking the size arithmetic. */
function textureHeader(sf, obj, buf) {
  if (obj.tree) {
    const f = readFields(sf, obj.tree, objBin(sf, obj, buf), new Set(['m_Width', 'm_Height', 'm_TextureFormat', 'm_MipCount', 'm_CompleteImageSize']));
    return { width: f.m_Width, height: f.m_Height, format: f.m_TextureFormat, mips: f.m_MipCount, imageSize: f.m_CompleteImageSize };
  }
  const r = objBin(sf, obj, buf);
  r.str();
  const from = r.p, rd = order(sf.le);
  // Up to 5.2.0 the word after the format holds bools (m_MipMap, m_IsReadable, m_ReadAllowed), not m_MipCount.
  const boolMips = vcmp(sf.unityTuple, [5, 2, 1]) < 0;
  for (let k = from; k <= from + 32 && k + 24 <= buf.length; k += 4) {
    const w = rd.u32(buf, k), h = rd.u32(buf, k + 4), size = rd.u32(buf, k + 8);
    if (!w || !h || w > 16384 || h > 16384 || !size) continue;
    for (const fo of [12, 16]) {
      if (k + fo + 8 > buf.length) continue;
      const format = rd.i32(buf, k + fo);
      if (!TEXTURE_FORMATS[format]) continue;
      const mips = boolMips ? (buf[k + fo + 4] ? Math.floor(Math.log2(Math.max(w, h))) + 1 : 1) : rd.i32(buf, k + fo + 4);
      if (mips < 1 || mips > 15) continue;
      const expected = chainBytes(format, w, h, mips);
      if (expected === size) return { width: w, height: h, format, mips, imageSize: size };
      // Formats without a size rule here (crunched): accept when the pixel data's own size agrees.
      if (expected == null && (trailingStream(sf, buf)?.size === size || inlineAt(sf, buf, size) >= 0)) return { width: w, height: h, format, mips, imageSize: size };
    }
  }
  return {};
}

/** Where the inline image data starts (its length prefix), or -1. Texture2D ends with the image data, then m_StreamData. */
function inlineAt(sf, buf, imageSize) {
  const rd = order(sf.le), tail = (sf.unityTuple[0] >= 2020 ? 8 : 4) + 8;
  const exact = buf.length - tail - Math.ceil(imageSize / 4) * 4 - 4;
  if (exact >= 0 && rd.u32(buf, exact) === imageSize) return exact;
  for (let p = Math.min(exact, buf.length - 4 - imageSize); p >= 0; p--) if (p % 4 === 0 && rd.u32(buf, p) === imageSize) return p;
  return -1;
}

/** Full Texture2D: header plus where its pixels are (inline or in a .resS resource). */
function textureData(sf, obj, buf) {
  if (obj.tree) {
    const f = readFields(sf, obj.tree, objBin(sf, obj, buf));
    const sd = f.m_StreamData ?? {};
    return { width: f.m_Width, height: f.m_Height, format: f.m_TextureFormat, inline: Buffer.isBuffer(f['image data']) ? f['image data'] : Buffer.alloc(0), stream: sd.path ? { path: sd.path, offset: Number(sd.offset), size: Number(sd.size) } : null };
  }
  const head = textureHeader(sf, obj, buf);
  if (!head.format) return null;
  // Streamed: the object ends with offset, size and a .resS path. Inline: a length prefix equal to the image size,
  // with the pixels running to (nearly) the end of the object.
  const stream = trailingStream(sf, buf);
  if (stream) return { ...head, inline: Buffer.alloc(0), stream };
  const at = inlineAt(sf, buf, head.imageSize);
  return { ...head, inline: at >= 0 ? buf.subarray(at + 4, at + 4 + head.imageSize) : Buffer.alloc(0), stream: null };
}

/** A StreamingInfo at the end of an object: offset (8 bytes from 2020.1, else 4), size, aligned path string. */
function trailingStream(sf, buf) {
  const rd = order(sf.le), wide = sf.unityTuple[0] >= 2020;
  for (let q = buf.length - 4; q >= Math.max(wide ? 12 : 8, buf.length - 1024); q -= 4) {
    const n = rd.u32(buf, q);
    if (n === 0 || q + 4 + n > buf.length || Math.ceil((q + 4 + n) / 4) * 4 !== buf.length) continue;
    const p = buf.toString('latin1', q + 4, q + 4 + n);
    if (!/^[\x20-\x7e]+$/.test(p) || !/\.(resS|resource)$|^archive:/.test(p)) continue;
    return { path: p, offset: wide ? rd.u64(buf, q - 12) : rd.u32(buf, q - 8), size: rd.u32(buf, q - 4) };
  }
  return null;
}

/** AudioClip's m_Resource { m_Source, m_Offset, m_Size }. */
function audioResource(sf, obj, buf) {
  if (obj.tree) {
    const f = readFields(sf, obj.tree, objBin(sf, obj, buf), new Set(['m_Resource', 'm_CompressionFormat']));
    const res = f.m_Resource;
    return res?.m_Source ? { path: res.m_Source, offset: Number(res.m_Offset), size: Number(res.m_Size) } : null;
  }
  // No type tree: find the resource path string, then the 8-byte offset and size after its alignment.
  const rd = order(sf.le);
  for (let q = 0; q + 8 <= buf.length; q += 4) {
    const n = rd.u32(buf, q);
    if (n < 5 || n > 512 || q + 4 + n + 16 > buf.length) continue;
    const p = buf.toString('latin1', q + 4, q + 4 + n);
    if (!/^[\x20-\x7e]+$/.test(p) || !/\.(resource|resS)$/.test(p)) continue;
    const at = q + 4 + Math.ceil(n / 4) * 4;
    return { path: p, offset: rd.u64(buf, at), size: rd.u64(buf, at + 8) };
  }
  return null;
}

// ---------------------------------------------------------------- JSON view of an object
/**
 * A value as JSON for a file on disk: arrays in full, byte arrays up to 16 MiB as { bytes, base64 } (larger ones as a
 * size only, counted in `stats.omitted`), 64-bit ids as numbers when exact, else strings.
 */
function jsonSafe(v, stats = { omitted: 0 }, depth = 0) {
  if (typeof v === 'bigint') return Number.isSafeInteger(Number(v)) ? Number(v) : String(v);
  if (Buffer.isBuffer(v)) { if (v.length > 16 * MiB) { stats.omitted++; return { bytes: v.length }; } return { bytes: v.length, base64: v.toString('base64') }; }
  if (Array.isArray(v)) return v.map(x => jsonSafe(x, stats, depth + 1));
  if (v && typeof v === 'object') { const o = {}; for (const [k, x] of Object.entries(v)) o[k] = jsonSafe(x, stats, depth + 1); return o; }
  if (typeof v === 'number' && !Number.isFinite(v)) return String(v);
  return v;
}
const jsonFile = value => {
  const stats = { omitted: 0 };
  const data = Buffer.from(JSON.stringify(jsonSafe(value, stats), null, 1));
  return { data, ...(stats.omitted ? { note: `${stats.omitted} byte array(s) over 16 MiB are given by size only` } : {}) };
};

// ---------------------------------------------------------------- inventory and entries
const ORDER = [49, 28, 83, 213, 43, 74, 21, 48, 128, 329, 687078895, 91, 115, 142, 141, 1, 114];
const rank = id => { const i = ORDER.indexOf(id); return i < 0 ? ORDER.length : i; };
const safeName = s => {
  const n = String(s).replace(/[\u0000-\u001f<>:"/\\|?*]/g, '_').replace(/^\.+/, '_').trim().slice(0, 120).replace(/[. ]+$/, '');
  return /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i.test(n) ? `_${n}` : n;
};
const resourceBase = p => String(p).replace(/^archive:\/[^/]*\//, '').split(/[\\/]/).pop();

/**
 * Inventory of serialized files: one entry per object, with a producer that writes the useful form of it.
 * `files`: [{ sf, prefix }], `resource(name)`: async → source of a resource file (.resS/.resource) or null,
 * `resolveExternal(sf, fileId)`: the parsed file a PPtr's file id points to, or null.
 */
async function inventory(files, resource, resolveExternal) {
  const entries = [], classes = {}, used = new Map(), scenes = [], container = new Map();
  let named = 0;
  const scriptIndex = new Map(); // `${label}:${pathId}` → script identity
  for (const { sf } of files) for (const o of sf.objects) {
    if (o.classId !== 115) continue;
    const info = inspect(sf, o, await headOf(sf, o));
    if (info.monoScript) scriptIndex.set(`${sf.label}:${o.pathId}`, info.monoScript);
  }
  const lookupScript = async (sf, p) => {
    if (!p || (p.fileId === 0 && p.pathId === 0n)) return null;
    const target = p.fileId === 0 ? sf : await resolveExternal(sf, p.fileId);
    if (!target) return { unresolved: sf.externals[p.fileId - 1] ?? `file ${p.fileId}` };
    const key = `${target.label}:${p.pathId}`;
    if (!scriptIndex.has(key)) {
      const o = target.objects.find(x => x.pathId === p.pathId && x.classId === 115);
      const info = o ? inspect(target, o, await headOf(target, o)) : {};
      scriptIndex.set(key, info.monoScript ?? null);
    }
    return scriptIndex.get(key);
  };
  for (const { sf, prefix } of files) {
    const seen = new Set();
    const sorted = [...sf.objects].sort((a, b) => rank(a.classId) - rank(b.classId) || a.start - b.start);
    for (const o of sorted) {
      const cls = className(o.classId);
      classes[cls] = (classes[cls] ?? 0) + 1;
      const info = inspect(sf, o, await headOf(sf, o));
      if (info.name) named++;
      if (info.container) for (const c of info.container) if (c.fileId === 0 && c.pathId != null) container.set(`${sf.label}:${c.pathId}`, c.path);
      if (info.scenes) scenes.push(...info.scenes.filter(s => typeof s === 'string'));
      let script = null;
      if (o.classId === 114 && info.script) {
        script = await lookupScript(sf, info.script);
        const key = script?.className ? [script.namespace, script.className].filter(Boolean).join('.') : script?.unresolved ? `? (${script.unresolved})` : null;
        if (key) { const u = used.get(key) ?? { class: key, assembly: script.assembly, instances: 0 }; u.instances++; used.set(key, u); }
      }
      let ext = sf.typeTree ? '.json' : '.bin', kind = 'object';
      if (o.classId === 49) { kind = 'text'; ext = '.txt'; }
      else if (o.classId === 83) { kind = 'audio'; ext = '.fsb'; }
      else if (o.classId === 43 && o.tree) { kind = 'mesh'; ext = '.obj'; }
      else if (o.classId === 28 && info.format) { kind = 'texture'; ext = DECODABLE.has(info.format) ? '.png' : textureFile(Buffer.alloc(0), info.format, 1, 1).ext; }
      let base = safeName(info.name || (o.classId === 114 && script?.className) || String(o.pathId)) || String(o.pathId);
      let rel = `${prefix}${cls}/${base}${ext}`;
      if (seen.has(rel.toLowerCase())) { base = `${base}~${o.pathId}`; rel = `${prefix}${cls}/${base}${ext}`; }
      seen.add(rel.toLowerCase());
      const entry = { path: rel, size: o.size, pathId: String(o.pathId), derived: true, rank: rank(o.classId) };
      if (o.classId === 28 && info.format) Object.assign(entry, { width: info.width, height: info.height, textureFormat: TEXTURE_FORMATS[info.format] ?? info.format });
      if (o.classId === 114 && script?.className) entry.script = [script.namespace, script.className].filter(Boolean).join('.');
      entry.produce = () => produce(sf, o, kind, resource);
      entry.label = `${sf.label}:${o.pathId}`;
      entries.push(entry);
    }
  }
  for (const e of entries) { const c = container.get(e.label); if (c) e.asset = c; delete e.label; }
  // Asset classes first across every file (a data.unity3d starts with managers and scripts).
  entries.sort((a, b) => a.rank - b.rank);
  for (const e of entries) delete e.rank;
  const scripts = [...used.values()].sort((a, b) => b.instances - a.instances);
  return {
    entries,
    assets: {
      objects: entries.length, named,
      classes: Object.fromEntries(Object.entries(classes).sort((a, b) => b[1] - a[1])),
      ...(scripts.length ? { scripts: scripts.slice(0, 100), scriptsTotal: scripts.length } : {}),
      ...(scenes.length ? { scenes: scenes.slice(0, 50), ...(scenes.length > 50 ? { scenesTotal: scenes.length } : {}) } : {}),
      ...(container.size ? { containerPaths: container.size } : {}),
    },
  };
}

async function produce(sf, o, kind, resource) {
  try { return await produceRaw(sf, o, kind, resource); }
  catch (e) { if (e instanceof RangeError || e instanceof TypeError) throw new RPError('BAD_FORMAT', `Object ${o.pathId} could not be read (${e.message}).`); throw e; }
}

async function produceRaw(sf, o, kind, resource) {
  const buf = await sf.src.read(o.start, o.size);
  const fromResource = async (ref, what) => {
    if (!ref?.path || !ref.size) return null;
    const res = await resource(resourceBase(ref.path), sf);
    if (!res) throw new RPError('NOT_FOUND', `${what} data is in ${resourceBase(ref.path)}, which is not next to this file.`);
    return res.read(ref.offset, ref.size);
  };
  if (kind === 'text') {
    if (o.tree) {
      // Read up to m_Script with the type tree, then take its bytes as stored (no text round trip).
      const r = objBin(sf, o, buf);
      for (const c of o.tree.children) { if (c.name === 'm_Script') return { data: r.strBytes() }; readValue(c, r, { refTypes: sf.refTypes }); }
      throw new RPError('BAD_FORMAT', 'TextAsset without m_Script.');
    }
    const r = objBin(sf, o, buf); r.str(); const n = r.i32(); return { data: r.bytes(n) };
  }
  if (kind === 'audio') {
    const data = await fromResource(audioResource(sf, o, buf), 'AudioClip');
    if (!data) throw new RPError('NOT_FOUND', 'This AudioClip has no streamed resource (Unity 4-style inline audio is not exported).');
    return { data, note: data.subarray(0, 4).toString('latin1') === 'FSB5' ? undefined : 'not an FSB5 bank' };
  }
  if (kind === 'texture') {
    const t = textureData(sf, o, buf);
    if (!t?.format) throw new RPError('BAD_FORMAT', 'Texture2D header not understood.');
    const pixels = t.inline.length ? t.inline : await fromResource(t.stream, 'Texture2D');
    if (!pixels?.length) throw new RPError('NOT_FOUND', 'This texture has no pixel data in the build.');
    const file = textureFile(pixels, t.format, t.width, t.height);
    return { data: file.data, note: file.note };
  }
  if (kind === 'mesh') {
    const fields = readFields(sf, o.tree, objBin(sf, o, buf));
    const obj = await meshToObj(fields, sf.unityTuple, (p, offset, size) => fromResource({ path: p, offset, size }, 'Mesh'), { le: sf.le });
    if (obj) return { data: Buffer.from(obj.text), note: `${obj.vertices} vertices, ${obj.faces} triangles` };
    return { ...jsonFile(fields), note: 'no readable vertex data: written as JSON' };
  }
  if (o.tree) return jsonFile(readFields(sf, o.tree, objBin(sf, o, buf)));
  return { data: buf };
}

/** Per-file rows (first 20) with the values every file shares hoisted out. */
function summarize(list) {
  const rows = list.map(sf => ({ file: sf.label, serializedVersion: sf.version, unityVersion: sf.unityVersion, platform: sf.platform, typeTree: sf.typeTree, objects: sf.objects.length, ...(sf.externals.length ? { externals: sf.externals.length } : {}), ...(sf.unityVersionStripped ? { unityVersionStripped: true } : {}) }));
  const shared = {};
  for (const k of ['serializedVersion', 'unityVersion', 'platform', 'typeTree']) if (rows.length && rows.every(r => r[k] === rows[0][k])) { shared[k] = rows[0][k]; for (const r of rows) delete r[k]; }
  return { ...shared, serializedFiles: rows.slice(0, 20), ...(rows.length > 20 ? { serializedFilesTotal: rows.length } : {}) };
}

const NO_TREE_NOTE = 'This file has no type trees (player builds strip them): names, scripts, TextAssets, audio and most textures still come out; other objects extract as raw bytes instead of JSON.';

/** The bundle's files that are not serialized files (.resS, .resource…), first 20. */
function otherFiles(nodes, serialized) {
  const names = new Set(serialized.map(s => s.node.path));
  const rest = nodes.filter(n => !names.has(n.path)).map(n => ({ path: n.path, size: n.size }));
  return rest.length ? { otherFiles: rest.slice(0, 20), ...(rest.length > 20 ? { otherFilesTotal: rest.length } : {}) } : {};
}

/** A UnityFS bundle: its files, and the objects of the serialized files inside. */
export async function readUnityBundle(abs, size) {
  let b;
  try { b = await openBundle(abs, size); }
  catch (e) { if (e instanceof RangeError || e instanceof TypeError) throw new RPError('BAD_FORMAT', `The bundle header or block table is truncated or corrupt (${e.message}).`); throw e; }
  if (!b.stream) return b;
  const { stream, nodes, ...head } = b;
  const entries = nodes.map(n => ({ path: `raw/${n.path}`, size: n.size, produce: async () => ({ chunks: (async function* () { for (let o = 0; o < n.size; o += 16 * MiB) yield await stream.read(n.offset + o, Math.min(16 * MiB, n.size - o)); })() }) }));
  const serialized = [], skippedFiles = [];
  for (const n of nodes) {
    const src = new SliceSource(stream, n.offset, n.size);
    let sf;
    try {
      if (!looksLikeSerializedFile(await src.read(0, Math.min(48, n.size)), n.size)) continue;
      sf = await parseSerialized(src, n.path, head.unityRevision);
    } catch (e) { if (e.code !== 'TOO_LARGE' && e.code !== 'UNSUPPORTED_ARCHIVE') throw e; skippedFiles.push({ path: n.path, reason: e.message }); continue; }
    serialized.push({ sf, node: n });
  }
  const multi = serialized.length > 1;
  const byName = new Map(nodes.map(n => [n.path.split('/').pop(), n]));
  const resource = async name => { const n = byName.get(name); return n ? new SliceSource(stream, n.offset, n.size) : null; };
  const resolveExternal = async (sf, fileId) => { const ext = sf.externals[fileId - 1]; const hit = serialized.find(s => s.node.path === resourceBase(ext)); return hit?.sf ?? null; };
  const inv = await inventory(serialized.map(({ sf, node }) => ({ sf, prefix: multi ? `${node.path}/` : '' })), resource, resolveExternal);
  return {
    ...head,
    entries: [...inv.entries, ...entries],
    assets: { ...inv.assets, ...summarize(serialized.map(s => s.sf)), ...otherFiles(nodes, serialized), ...(skippedFiles.length ? { unreadFiles: skippedFiles } : {}) },
    ...(serialized.some(s => !s.sf.typeTree) ? { note: NO_TREE_NOTE } : {}),
  };
}

/** A loose serialized file from a player build (sharedassets0.assets, level0, globalgamemanagers…). */
export async function readUnityAssets(abs, size) {
  const dir = path.dirname(abs);
  const sf = await parseSerialized(new FileSource(abs, size), path.basename(abs));
  const opened = new Map([[path.basename(abs), sf]]);
  const sibling = async name => {
    if (!name || name !== path.basename(name)) return null;
    const file = path.join(dir, name);
    const st = await statOrNull(file);
    return st?.isFile() ? { file, size: st.size } : null;
  };
  const resource = async name => { const s = await sibling(name); return s ? new FileSource(s.file, s.size) : null; };
  const resolveExternal = async (from, fileId) => {
    const name = resourceBase(from.externals[fileId - 1] ?? '');
    if (opened.has(name)) return opened.get(name);
    opened.set(name, null);
    const s = await sibling(name);
    if (!s || opened.size > 16) return null;
    try {
      const src = new FileSource(s.file, s.size);
      if (!looksLikeSerializedFile(await src.read(0, Math.min(48, s.size)), s.size)) return null;
      const other = await parseSerialized(src, name);
      opened.set(name, other);
      return other;
    } catch { return null; }
  };
  const inv = await inventory([{ sf, prefix: '' }], resource, resolveExternal);
  const siblings = await siblingAssets(dir, path.basename(abs));
  return {
    format: 'unity-assets', unityVersion: sf.unityVersion, entries: inv.entries,
    assets: { ...inv.assets, ...summarize([sf]), ...(siblings.length ? { otherAssetFiles: siblings } : {}) },
    ...(sf.typeTree ? {} : { note: NO_TREE_NOTE }),
    ...(siblings.length ? { next: `Each serialized file is read on its own: run re_archive on ${siblings.slice(0, 3).join(', ')}${siblings.length > 3 ? '…' : ''} too (same folder).` } : {}),
  };
}

/** The other serialized files of a player build next to this one (level*, sharedassets*, resources.assets…), first 20. */
async function siblingAssets(dir, self) {
  let names = [];
  try { names = await fs.readdir(dir); } catch { return []; }
  return names.filter(n => n !== self && /^(data\.unity3d|level\d+|sharedassets\d+\.assets|resources\.assets|globalgamemanagers(\.assets)?)$/.test(n))
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true })).slice(0, 20);
}

