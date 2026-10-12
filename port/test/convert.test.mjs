import test from 'node:test';
import assert from 'node:assert/strict';
import { convert, quatToMat, matToEulerYXZ, eulerYXZToMat, SYSTEMS } from '../src/convert.mjs';

const close = (a, b, eps = 1e-4) => assert.ok(a.every((v, i) => Math.abs(v - b[i]) < eps), `${JSON.stringify(a)} ≈ ${JSON.stringify(b)}`);
const sameRotation = (q1, q2) => { const d = Math.abs(q1.reduce((s, v, i) => s + v * q2[i], 0)); assert.ok(Math.abs(d - 1) < 1e-4, `${q1} vs ${q2}`); };

test('Godot → Unity mirrors Z', () => {
  const r = convert({ from: 'godot', to: 'unity', position: [1, 2, 3], rotation: [0, 0.7071068, 0, 0.7071068] });
  close(r.position, [1, 2, -3]);
  sameRotation(r.rotation.quaternion, [0, -0.7071068, 0, 0.7071068]);
  close(r.rotation.euler.degrees, [0, -90, 0]);
});

test('Godot → Unreal: forward -Z becomes +X, meters become centimeters', () => {
  const r = convert({ from: 'godot', to: 'unreal', position: [1, 2, -3] });
  close(r.position, [300, 100, 200]);
  assert.equal(r.unitFactor, 100);
});

test('round trips through every system keep position and rotation', () => {
  const q = [0.1, 0.2, 0.3, Math.sqrt(1 - 0.14)];
  for (const sys of Object.keys(SYSTEMS)) {
    const there = convert({ from: 'godot', to: sys, position: [1.5, -2, 4], rotation: q });
    const back = convert({ from: sys, to: 'godot', position: there.position, rotation: there.rotation.quaternion });
    close(back.position, [1.5, -2, 4]);
    sameRotation(back.rotation.quaternion, q);
  }
});

test('visual direction is preserved (camera forward)', () => {
  const rotY = deg => [0, Math.sin((deg * Math.PI) / 360), 0, Math.cos((deg * Math.PI) / 360)];
  const fwd = (q, f) => { const m = quatToMat(q); return [0, 1, 2].map(i => m[i][0] * f[0] + m[i][1] * f[1] + m[i][2] * f[2]); };
  const g = rotY(30);
  const gDir = fwd(g, [0, 0, -1]);
  const u = convert({ from: 'godot', to: 'unity', rotation: g }).rotation.quaternion;
  close(fwd(u, [0, 0, 1]), [gDir[0], gDir[1], -gDir[2]]);
  const ue = convert({ from: 'godot', to: 'unreal', rotation: g }).rotation.quaternion;
  close(fwd(ue, [1, 0, 0]), [-gDir[2], gDir[0], gDir[1]]);
});

test('Euler YXZ decomposition is exact', () => {
  const e = [0.3, -1.1, 0.7];
  close(matToEulerYXZ(eulerYXZToMat(e)), e);
});

test('FOV: vertical ↔ horizontal for Unreal', () => {
  const r = convert({ from: 'godot', to: 'unreal', fov: 70, aspect: 16 / 9 });
  assert.equal(r.fov.axis, 'horizontal');
  assert.ok(Math.abs(r.fov.degrees - 102.45) < 0.01);
  const back = convert({ from: 'unreal', to: 'unity', fov: r.fov.degrees, aspect: 16 / 9 });
  assert.ok(Math.abs(back.fov.degrees - 70) < 1e-6);
});
