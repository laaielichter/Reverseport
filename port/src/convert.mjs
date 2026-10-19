// Coordinate-system conversion between engines: positions, rotations (quaternions), scales, Euler angles
// in each engine's own convention, and camera field of view. Every system is an orthonormal axis map to
// Godot's frame (right-handed, Y up, -Z forward, meters) plus a unit scale.
import { RPError } from './util.mjs';
import { matToQuat } from './scene.mjs';
import { physicsProfile } from './physics.mjs';

const I = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
/** Rows map Godot coordinates into the system: p_sys = M · p_godot × scale. */
export const SYSTEMS = {
  godot: { M: I, scale: 1, label: 'Godot (right-handed, Y up, -Z forward, m)' },
  'godot-csharp': { M: I, scale: 1, label: 'Godot C# (same as Godot)' },
  threejs: { M: I, scale: 1, label: 'three.js (right-handed, Y up, -Z camera forward, m)' },
  gltf: { M: I, scale: 1, label: 'glTF 2.0 (right-handed, Y up, m; assets face +Z)' },
  bevy: { M: I, scale: 1, label: 'Bevy (right-handed, Y up, -Z forward, m)' },
  unity: { M: [[1, 0, 0], [0, 1, 0], [0, 0, -1]], scale: 1, label: 'Unity (left-handed, Y up, +Z forward, m) — Z mirrored' },
  'unity-xmirror': { M: [[-1, 0, 0], [0, 1, 0], [0, 0, 1]], scale: 1, label: 'Unity, X mirrored (glTF-importer style: model fronts stay on +Z)' },
  unreal: { M: [[0, 0, -1], [1, 0, 0], [0, 1, 0]], scale: 100, label: 'Unreal (left-handed, Z up, X forward, Y right, cm)' },
  blender: { M: [[1, 0, 0], [0, 0, -1], [0, 1, 0]], scale: 1, label: 'Blender (right-handed, Z up, m) via the glTF axis rule' },
};

const T = m => m[0].map((_, c) => m.map(r => r[c]));
const mul = (a, b) => a.map(r => b[0].map((_, c) => r.reduce((s, v, k) => s + v * b[k][c], 0)));
const mulVec = (m, v) => m.map(r => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
const clean = x => { const r = Math.round(x * 1e6) / 1e6; return Object.is(r, -0) ? 0 : r; };

export function quatToMat([x, y, z, w]) {
  const n = Math.hypot(x, y, z, w) || 1;
  x /= n; y /= n; z /= n; w /= n;
  return [
    [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
    [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
    [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
  ];
}

const rad = d => (d * Math.PI) / 180, deg = r => (r * 180) / Math.PI;
const clamp1 = v => Math.max(-1, Math.min(1, v));
const Rx = a => [[1, 0, 0], [0, Math.cos(a), -Math.sin(a)], [0, Math.sin(a), Math.cos(a)]];
const Ry = a => [[Math.cos(a), 0, Math.sin(a)], [0, 1, 0], [-Math.sin(a), 0, Math.cos(a)]];
const Rz = a => [[Math.cos(a), -Math.sin(a), 0], [Math.sin(a), Math.cos(a), 0], [0, 0, 1]];

/** R = Ry·Rx·Rz (Godot EULER_ORDER_YXZ; Unity applies Z, X, Y) → [x, y, z] radians. */
export function matToEulerYXZ(m) {
  const b = Math.asin(clamp1(-m[1][2]));
  if (Math.abs(m[1][2]) < 0.9999999) return [b, Math.atan2(m[0][2], m[2][2]), Math.atan2(m[1][0], m[1][1])];
  return [b, Math.atan2(-m[2][0], m[0][0]), 0];
}
/** R = Rx·Ry·Rz (three.js 'XYZ') → [x, y, z] radians. */
export function matToEulerXYZ(m) {
  const y = Math.asin(clamp1(m[0][2]));
  if (Math.abs(m[0][2]) < 0.9999999) return [Math.atan2(-m[1][2], m[2][2]), y, Math.atan2(-m[0][1], m[0][0])];
  return [Math.atan2(m[2][1], m[1][1]), y, 0];
}
export const eulerYXZToMat = ([x, y, z]) => mul(mul(Ry(y), Rx(x)), Rz(z));
export const eulerXYZToMat = ([x, y, z]) => mul(mul(Rx(x), Ry(y)), Rz(z));

function system(name) {
  const s = SYSTEMS[String(name ?? '').toLowerCase()];
  if (!s) throw new RPError('INVALID_ARGUMENT', `Unknown coordinate system "${name}". Use one of: ${Object.keys(SYSTEMS).join(', ')}.`);
  return s;
}

/** Axis transform from system A to system B (orthonormal) and unit factor. */
export function transformBetween(from, to) {
  const a = system(from), b = system(to);
  return { T: mul(b.M, T(a.M)), factor: b.scale / a.scale };
}

function eulerFor(sys, R) {
  if (['godot', 'godot-csharp', 'bevy'].includes(sys)) { const e = matToEulerYXZ(R); return { order: 'YXZ', unit: 'degrees (rotation_degrees); rotation uses radians', degrees: e.map(deg).map(clean), radians: e.map(clean) }; }
  if (sys.startsWith('unity')) { const e = matToEulerYXZ(R); return { order: 'Z, X, Y (Unity)', unit: 'degrees (localEulerAngles)', degrees: e.map(deg).map(clean) }; }
  if (sys === 'threejs') { const e = matToEulerXYZ(R); return { order: "XYZ (three.js default; for YXZ set rotation.order = 'YXZ')", unit: 'radians', radians: e.map(clean), yxz: matToEulerYXZ(R).map(clean) }; }
  return null;
}

/**
 * Convert transforms between engines. Inputs in the source system: position [x,y,z], rotation as a
 * quaternion [x,y,z,w] or euler degrees in the source engine's convention, scale [x,y,z], fov in degrees.
 */
export function convert({ from, to, position, rotation, euler, scale, fov, aspect = 16 / 9, physics } = {}) {
  const { T: M, factor } = transformBetween(from, to);
  const out = { from: system(from).label, to: system(to).label, axisMatrix: M.map(r => r.map(clean)), unitFactor: factor };
  if (physics) out.physics = physicsProfile({ from, to, values: typeof physics === 'object' ? physics : {} });
  const vec3 = (v, what) => { if (!Array.isArray(v) || v.length !== 3 || v.some(n => typeof n !== 'number' || !Number.isFinite(n))) throw new RPError('INVALID_ARGUMENT', `${what} must be [x, y, z] numbers.`); return v; };
  if (position) out.position = mulVec(M, vec3(position, 'position')).map(v => clean(v * factor));
  let R = null;
  const src = String(from).toLowerCase();
  if (rotation) {
    if (!Array.isArray(rotation) || rotation.length !== 4) throw new RPError('INVALID_ARGUMENT', 'rotation must be a quaternion [x, y, z, w].');
    R = quatToMat(rotation);
  } else if (euler) {
    const e = vec3(euler, 'euler').map(rad);
    if (['godot', 'godot-csharp', 'bevy'].includes(src) || src.startsWith('unity')) R = eulerYXZToMat(e);
    else if (src === 'threejs') R = eulerXYZToMat(e);
    else throw new RPError('INVALID_ARGUMENT', `Give a quaternion for ${from}; euler input is supported for godot, unity and threejs.`);
  }
  if (R) {
    const R2 = mul(mul(M, R), T(M));
    out.rotation = { quaternion: matToQuat(R2).map(clean), ...(eulerFor(String(to).toLowerCase(), R2) ? { euler: eulerFor(String(to).toLowerCase(), R2) } : {}) };
  }
  if (scale) out.scale = M.map(r => clean(r.reduce((s, v, k) => s + Math.abs(v) * vec3(scale, 'scale')[k], 0)));
  if (fov != null) {
    const verticalIn = !String(from).toLowerCase().startsWith('unreal');
    const verticalOut = !String(to).toLowerCase().startsWith('unreal');
    const v = verticalIn ? fov : deg(2 * Math.atan(Math.tan(rad(fov) / 2) / aspect));
    out.fov = { degrees: clean(verticalOut ? v : deg(2 * Math.atan(Math.tan(rad(v) / 2) * aspect))), axis: verticalOut ? 'vertical' : 'horizontal', aspect };
  }
  out.notes = [
    'Positions and rotations stay visually identical; the axis matrix shows where each source axis goes.',
    ...(Math.abs(det(M) + 1) < 1e-9 ? ['Handedness changes (mirror): meshes imported separately keep their own importer orientation — if a model looks backwards, rotate that node 180° about the up axis.'] : []),
    ...(factor !== 1 ? [`Distances scale ×${factor} (speeds, forces and ranges in code too).`] : []),
  ];
  return out;
}

const det = m => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);

/** Convert a neutral scene tree (from re_scene) into another system, in place on a copy. */
export function convertTree(node, from, to) {
  const { T: M, factor } = transformBetween(from, to);
  const visit = n => {
    const copy = { ...n };
    if (n.transform) {
      const R = quatToMat(n.transform.rotation ?? [0, 0, 0, 1]);
      copy.transform = {
        position: mulVec(M, n.transform.position ?? [0, 0, 0]).map(v => clean(v * factor)),
        rotation: matToQuat(mul(mul(M, R), T(M))).map(clean),
        scale: M.map(r => clean(r.reduce((s, v, k) => s + Math.abs(v) * (n.transform.scale ?? [1, 1, 1])[k], 0))),
      };
    }
    copy.children = (n.children ?? []).map(visit);
    return copy;
  };
  return visit(node);
}
