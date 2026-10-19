import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parityFindings, traceHarness, compareTraces, portTraceTool } from '../src/trace.mjs';

const SRC = `using UnityEngine;
public class P : MonoBehaviour {
  public float speed = 3f;
  void Start() { Random.InitState(7); Time.fixedDeltaTime = 0.01f; }
  void FixedUpdate() { transform.position += Vector3.right * speed * Time.fixedDeltaTime; if (Random.value < 0.1f) Fire(); }
  void Fire() { Random.Range(0, 3); }
}`;

test('parity findings: tick moved, delta dropped, seed missing, time setting dropped', () => {
  const bad = 'extends Node3D\nvar speed := 3.0\nfunc _process(delta):\n\tposition.x += speed\n\tif randf() < 0.1:\n\t\tfire()\nfunc fire():\n\tpass\n';
  const kinds = parityFindings({ sourceText: SRC, sourceLang: 'csharp', targetText: bad, targetLang: 'gdscript' }).map(f => f.kind);
  assert.deepEqual(kinds, ['tick-moved', 'delta-dropped', 'seed-missing', 'timescale-dropped']);
  const good = 'extends Node3D\nvar speed := 3.0\nfunc _ready():\n\tseed(7)\n\tEngine.physics_ticks_per_second = 100\nfunc _physics_process(delta):\n\tposition.x += speed * delta\n\tif randf() < 0.1:\n\t\tfire()\nfunc fire():\n\trandi_range(0, 2)\n';
  assert.deepEqual(parityFindings({ sourceText: SRC, sourceLang: 'csharp', targetText: good, targetLang: 'gdscript' }), []);
});

test('harnesses exist for every engine and compare finds the divergence', async () => {
  for (const e of ['godot', 'unity', 'threejs', 'unreal']) { const h = traceHarness({ engine: e, properties: ['position', 'velocity'] }); assert.ok(h.text.includes('12345') && h.fileName); }
  assert.ok(traceHarness({ engine: 'godot' }).text.includes('row["position"]'));
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rp-trace-'));
  const mk = (rate, n, f) => ({ engine: 'x', tickRate: rate, ticks: Array.from({ length: n }, (_, i) => ({ t: i, position: f(i / rate), hp: i < n / 2 ? 3 : 2 })) });
  await fs.writeFile(path.join(dir, 'a.json'), JSON.stringify(mk(60, 300, t => [t * 2, -4.9 * t * t, 0])));
  await fs.writeFile(path.join(dir, 'b.json'), JSON.stringify(mk(50, 250, t => [t * 2, -4.9 * t * t * 1.02, 0])));
  await fs.writeFile(path.join(dir, 'c.json'), JSON.stringify(mk(60, 300, t => [t * 2, -4.9 * t * t, 0])));
  const r = await compareTraces({ a: path.join(dir, 'a.json'), b: path.join(dir, 'b.json'), tolerance: 0.05 });
  assert.equal(r.passed, false);
  assert.deepEqual(r.failing, ['position']);
  assert.equal(r.properties.position.drift, 'growing');
  assert.ok(r.properties.position.firstDivergence.seconds > 0.5);
  assert.ok(r.hints.some(h => /tick rates differ/.test(h)) && r.hints.some(h => /integration differs/.test(h)));
  const same = await compareTraces({ a: path.join(dir, 'a.json'), b: path.join(dir, 'c.json') });
  assert.equal(same.passed, true);
  const t = await portTraceTool({ action: 'harness', engine: 'unity', out: path.join(dir, 'ReversePortTrace.cs') });
  assert.ok((await fs.readFile(t.file, 'utf8')).includes('class ReversePortTrace'));
  await fs.rm(dir, { recursive: true, force: true });
});
