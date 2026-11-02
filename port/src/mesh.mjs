// Unity Mesh (as read through its type tree) → Wavefront OBJ: positions, first UV set, normals and one group per
// sub-mesh. Reads the vertex streams of Unity 5 through 6 (three vertex-format tables), external vertex data
// (m_StreamData) and compressed meshes (PackedBitVector). X is negated and faces are reversed, because Unity is
// left-handed and OBJ is right-handed (the convention AssetStudio and UnityPy use too).

const half = h => {
  const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 0x1f, f = h & 0x3ff;
  if (e === 0) return s * f * 2 ** -24;
  if (e === 31) return f ? NaN : s * Infinity;
  return s * (1 + f / 1024) * 2 ** (e - 15);
};

// [size, read(buf, offset)] per format, for the three tables Unity used over time.
const R = {
  f32: [4, (b, o) => b.readFloatLE(o)], f16: [2, (b, o) => half(b.readUInt16LE(o))],
  un8: [1, (b, o) => b[o] / 255], sn8: [1, (b, o) => Math.max(b.readInt8(o) / 127, -1)],
  un16: [2, (b, o) => b.readUInt16LE(o) / 65535], sn16: [2, (b, o) => Math.max(b.readInt16LE(o) / 32767, -1)],
  u8: [1, (b, o) => b[o]], s8: [1, (b, o) => b.readInt8(o)], u16: [2, (b, o) => b.readUInt16LE(o)], s16: [2, (b, o) => b.readInt16LE(o)],
  u32: [4, (b, o) => b.readUInt32LE(o)], s32: [4, (b, o) => b.readInt32LE(o)],
};
const FORMATS_5 = [R.f32, R.f16, R.un8, R.u8, R.u32];
const FORMATS_2017 = [R.f32, R.f16, R.un8, R.un8, R.sn8, R.un16, R.sn16, R.u8, R.s8, R.u16, R.s16, R.u32, R.s32];
const FORMATS_2019 = [R.f32, R.f16, R.un8, R.sn8, R.un16, R.sn16, R.u8, R.s8, R.u16, R.s16, R.u32, R.s32];

function unpackInts(pv, start = 0, count = pv.m_NumItems) {
  const bitSize = pv.m_BitSize, data = pv.m_Data, out = new Array(count);
  let bitPos = bitSize * start, index = Math.floor(bitPos / 8);
  bitPos %= 8;
  for (let i = 0; i < count; i++) {
    let bits = 0, value = 0;
    while (bits < bitSize) {
      if (index >= data.length) throw new RangeError('packed data too short');
      value += ((data[index] >> bitPos) % 2 ** (bitSize - bits)) * 2 ** bits;
      const n = Math.min(bitSize - bits, 8 - bitPos);
      bitPos += n; bits += n;
      if (bitPos === 8) { index++; bitPos = 0; }
    }
    out[i] = value;
  }
  return out;
}
function unpackFloats(pv, start = 0, count = pv.m_NumItems) {
  if (!pv.m_BitSize) return new Array(count).fill(pv.m_Start);
  const scale = pv.m_Range / (2 ** pv.m_BitSize - 1);
  return unpackInts(pv, start, count).map(x => x * scale + pv.m_Start);
}
const groups = (flat, n) => { const out = []; for (let i = 0; i + n <= flat.length; i += n) out.push(flat.slice(i, i + n)); return out; };

/**
 * Vertex attributes and index list of a Mesh value. `external(path, offset, size)` returns the bytes of
 * m_StreamData (vertex data kept in a .resS). Returns { positions, uvs, normals, indices, use16, subMeshes } or null.
 */
export async function meshGeometry(m, unity, external) {
  const major = unity[0];
  const out = { positions: null, uvs: null, normals: null, indices: null, subMeshes: m.m_SubMeshes ?? [] };
  // Index buffer width.
  out.use16 = m.m_Use16BitIndices != null ? !!m.m_Use16BitIndices : m.m_IndexFormat != null ? m.m_IndexFormat === 0 : true;
  const ib = Buffer.isBuffer(m.m_IndexBuffer) ? m.m_IndexBuffer : Buffer.alloc(0);
  if (ib.length) { const w = out.use16 ? 2 : 4; out.indices = []; for (let o = 0; o + w <= ib.length; o += w) out.indices.push(w === 2 ? ib.readUInt16LE(o) : ib.readUInt32LE(o)); }
  // Vertex streams.
  const vd = m.m_VertexData;
  let data = Buffer.isBuffer(vd?.m_DataSize) ? vd.m_DataSize : Buffer.alloc(0);
  if (vd?.m_VertexCount && !data.length && m.m_StreamData?.size && m.m_StreamData?.path) data = await external(m.m_StreamData.path, Number(m.m_StreamData.offset), Number(m.m_StreamData.size));
  if (vd?.m_VertexCount && data.length && Array.isArray(vd.m_Channels)) {
    const count = vd.m_VertexCount, channels = vd.m_Channels;
    const table = major < 2017 ? FORMATS_5 : major < 2019 ? FORMATS_2017 : FORMATS_2019;
    const fmt = c => table[c.format] ?? null;
    const streams = [];
    let offset = 0;
    const streamCount = 1 + Math.max(...channels.map(c => c.stream));
    for (let s = 0; s < streamCount; s++) {
      let stride = 0;
      for (const c of channels) if (c.stream === s && c.dimension > 0) stride += (c.dimension & 0xf) * (fmt(c)?.[0] ?? 0);
      streams.push({ offset, stride });
      offset = Math.ceil((offset + count * stride) / 16) * 16;
    }
    const read = (chn, dims) => {
      const c = channels[chn];
      if (!c || !(c.dimension & 0xf) || !fmt(c)) return null;
      const [size, get] = fmt(c), s = streams[c.stream], dim = c.dimension & 0xf, rows = [];
      for (let v = 0; v < count; v++) {
        const base = s.offset + v * s.stride + c.offset;
        if (base + dim * size > data.length) return null;
        const row = [];
        for (let k = 0; k < Math.min(dim, dims); k++) row.push(get(data, base + k * size));
        rows.push(row);
      }
      return rows;
    };
    out.positions = read(0, 3);
    out.normals = read(1, 3);
    out.uvs = read(major >= 2018 ? 4 : 3, 2);
  }
  // Compressed mesh (mesh compression on in the import settings).
  const cm = m.m_CompressedMesh;
  if (!out.positions && cm?.m_Vertices?.m_NumItems > 0) {
    const n = Math.floor(cm.m_Vertices.m_NumItems / 3);
    out.positions = groups(unpackFloats(cm.m_Vertices), 3);
    if (cm.m_UV?.m_NumItems >= n * 2) {
      const info = cm.m_UVInfo ?? 0;
      let start = 0, dim = 2;
      if (info) { const bits = info & 0xf; if (bits & 4) dim = 1 + (bits & 3); else start = -1; }
      if (start >= 0) out.uvs = groups(unpackFloats(cm.m_UV, 0, n * dim), dim).map(r => r.slice(0, 2));
    }
    if (cm.m_Normals?.m_NumItems > 0) {
      const xy = groups(unpackFloats(cm.m_Normals), 2), signs = unpackInts(cm.m_NormalSigns);
      out.normals = xy.map(([x, y], i) => {
        const zz = 1 - x * x - y * y;
        let z = zz >= 0 ? Math.sqrt(zz) : 0, nx = x, ny = y;
        if (zz < 0) { const l = Math.hypot(x, y) || 1; nx /= l; ny /= l; }
        if (signs[i] === 0) z = -z;
        return [nx, ny, z];
      });
    }
    if (!out.indices && cm.m_Triangles?.m_NumItems > 0) out.indices = unpackInts(cm.m_Triangles);
  }
  return out.positions?.length ? out : null;
}

const num = v => (Number.isFinite(v) ? String(Number(v.toPrecision(9))) : '0');

/** Mesh value → OBJ text, or null when the mesh has no readable vertices. */
export async function meshToObj(m, unity, external) {
  const g = await meshGeometry(m, unity, external);
  if (!g) return null;
  const name = String(m.m_Name ?? 'mesh').replace(/\s+/g, '_') || 'mesh';
  const lines = [`g ${name}`];
  for (const [x, y, z = 0] of g.positions) lines.push(`v ${num(-x)} ${num(y)} ${num(z)}`);
  const vt = g.uvs?.length === g.positions.length, vn = g.normals?.length === g.positions.length;
  if (vt) for (const [u, v = 0] of g.uvs) lines.push(`vt ${num(u)} ${num(v)}`);
  if (vn) for (const [x, y, z] of g.normals) lines.push(`vn ${num(-x)} ${num(y)} ${num(z)}`);
  const ref = i => { const n = i + 1; return vt && vn ? `${n}/${n}/${n}` : vt ? `${n}/${n}` : vn ? `${n}//${n}` : `${n}`; };
  const idx = g.indices ?? [];
  const valid = i => i >= 0 && i < g.positions.length;
  let faces = 0;
  g.subMeshes.forEach((s, k) => {
    lines.push(`g ${name}_${k}`);
    const first = Math.floor(s.firstByte / (g.use16 ? 2 : 4)), count = s.indexCount, base = s.baseVertex ?? 0;
    const at = i => idx[i] + base;
    if (s.topology === 0) {
      for (let i = first; i + 2 < first + count && i + 2 < idx.length; i += 3) {
        const a = at(i), b = at(i + 1), c = at(i + 2);
        if ([a, b, c].every(valid)) { lines.push(`f ${ref(c)} ${ref(b)} ${ref(a)}`); faces++; }
      }
    } else if (s.topology === 2) {
      for (let i = first; i + 3 < first + count && i + 3 < idx.length; i += 4) {
        const [a, b, c, d] = [at(i), at(i + 1), at(i + 2), at(i + 3)];
        if ([a, b, c, d].every(valid)) { lines.push(`f ${ref(c)} ${ref(b)} ${ref(a)}`, `f ${ref(d)} ${ref(c)} ${ref(a)}`); faces += 2; }
      }
    }
  });
  return { text: `${lines.join('\n')}\n`, vertices: g.positions.length, faces };
}
