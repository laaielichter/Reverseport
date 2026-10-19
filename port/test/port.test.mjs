import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tempDir } from './helpers.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const F = path.join(HERE, 'fixtures');
const dir = await tempDir();
process.env.REVERSEPORT_HOME = path.join(dir, 'home');
const { callTool } = await import('../src/tools.mjs');
const { parseGodotScene } = await import('../src/scene.mjs');

test('Godot → Unity: full port loop passes verify; Unity scene specs are converted', async () => {
  const plan = await callTool('port_plan', { source: path.join(F, 'godot-mini'), to: 'unity' });
  assert.equal(plan.map, 'godot->unity');
  assert.ok(plan.scaffold.includes('Assets/Editor/ReversePortSceneBuilder.cs'));
  const canned = path.join(F, 'ports', 'godot-mini-unity');
  for (let i = 0; i < 50; i++) {
    const u = await callTool('port_unit', { planId: plan.planId });
    if (u.done) break;
    if (u.action === 'convert-scene') await callTool('port_scene', { planId: plan.planId, unit: u.unit });
    else if (u.kind === 'script') {
      assert.ok(u.sourceText.length > 0 && Array.isArray(u.apiHints));
      await callTool('port_write', { planId: plan.planId, unit: u.unit, content: await fs.readFile(path.join(canned, path.basename(u.target)), 'utf8') });
    } else await callTool('port_write', { planId: plan.planId, unit: u.unit, content: '{"note":"rebuilt"}\n' });
  }
  const v = await callTool('port_verify', { planId: plan.planId });
  assert.equal(v.passed, true, JSON.stringify(v.warnings));
  const main = JSON.parse(await fs.readFile(path.join(plan.output, 'Assets/ReversePort/Specs/main.scene.json'), 'utf8'));
  assert.equal(main.kind, 'scene');
  assert.equal(main.savePath, 'Assets/Scenes/Main.unity');
  const cam = main.nodes.find(n => n.name === 'Camera3D');
  assert.deepEqual(cam.position, [0, 2, -8]);
  assert.equal(main.nodes.find(n => n.name === 'Player').prefab, 'Assets/Prefabs/actors/Player.prefab');
  const md = await fs.readFile(path.join(plan.output, 'PORT-PLAN.md'), 'utf8');
  assert.match(md, /13\/13 units \(100%\)/);
});

test('verify catches source-engine leftovers and missing functions', async () => {
  const plan = await callTool('port_plan', { source: path.join(F, 'godot-mini'), to: 'unity', include: 'actors/player\\.gd$' });
  assert.equal(plan.units, 1);
  const w = await callTool('port_write', { planId: plan.planId, unit: 'u001', content: 'public class Player : MonoBehaviour {\n  public event System.Action<int> Hit;\n  void Awake() { var n = get_node("Gun"); }\n  void FixedUpdate() { queue_free(); }\n  void OnHit(int d) {}\n}\n' });
  assert.ok(w.leftovers.some(l => l.id === 'get-node'));
  assert.deepEqual(w.missingFromSource, ['shoot']);
  const v = await callTool('port_verify', { planId: plan.planId });
  assert.equal(v.passed, false);
  assert.ok(v.leftovers >= 2);
  assert.equal(v.missingSymbols, 1);
});

test('Unity → Godot: scenes become .tscn that Godot can read back', async () => {
  const plan = await callTool('port_plan', { source: path.join(F, 'unity-mini'), to: 'godot' });
  for (;;) { const r = await callTool('port_scene', { planId: plan.planId }); if (r.message) break; }
  const tscn = await fs.readFile(path.join(plan.output, 'scenes', 'player.tscn'), 'utf8');
  const s = parseGodotScene(tscn);
  assert.equal(s.root.type, 'RigidBody3D');
  assert.deepEqual(s.root.children.find(c => c.name === 'Gun').transform.position, [0.5, 1.2, -0.3]);
  const main = parseGodotScene(await fs.readFile(path.join(plan.output, 'scenes', 'main.tscn'), 'utf8'));
  assert.equal(main.root.children.find(c => c.name === 'Player One').instance, 'res://scenes/player.tscn');
  assert.match(await fs.readFile(path.join(plan.output, 'project.godot'), 'utf8'), /run\/main_scene="res:\/\/scenes\/main\.tscn"/);
});

test('Godot → three.js and Godot → C#: generated scaffold and scenes', async () => {
  const web = await callTool('port_plan', { source: path.join(F, 'godot-mini'), to: 'threejs' });
  for (;;) { const r = await callTool('port_scene', { planId: web.planId }); if (r.message) break; }
  const mainTs = await fs.readFile(path.join(web.output, 'src', 'scenes', 'main.ts'), 'utf8');
  assert.match(mainTs, /import \{ buildPlayer \} from "\.\/actors\/player";/);
  assert.match(mainTs, /export function buildMain\(\): THREE\.Object3D/);
  assert.match(await fs.readFile(path.join(web.output, 'src', 'main.ts'), 'utf8'), /import \{ buildMain \} from "\.\/scenes\/main";/);
  const cs = await callTool('port_plan', { source: path.join(F, 'godot-mini'), to: 'godot-csharp' });
  for (;;) { const r = await callTool('port_scene', { planId: cs.planId }); if (r.message) break; }
  assert.match(await fs.readFile(path.join(cs.output, 'actors', 'player.tscn'), 'utf8'), /path="res:\/\/actors\/Player\.cs"/);
  const proj = await fs.readFile(path.join(cs.output, 'project.godot'), 'utf8');
  assert.match(proj, /Global="\*res:\/\/Global\.cs"/);
  assert.match(proj, /"C#"/);
});

test('safety: output never inside the source, never over foreign files, no path escapes', async () => {
  await assert.rejects(callTool('port_plan', { source: path.join(F, 'godot-mini'), to: 'unity', output: path.join(F, 'godot-mini', 'out') }), /must not be inside/);
  const busy = path.join(dir, 'busy');
  await fs.mkdir(busy); await fs.writeFile(path.join(busy, 'keep.txt'), 'mine');
  await assert.rejects(callTool('port_plan', { source: path.join(F, 'godot-mini'), to: 'unity', output: busy }), /not empty/);
  const plan = await callTool('port_plan', { source: path.join(F, 'godot-mini'), to: 'unity', include: 'global\\.gd$' });
  await assert.rejects(callTool('port_write', { planId: plan.planId, unit: 'u001', files: [{ path: '../../escape.cs', content: 'x' }] }), /unsafe path/i);
  await assert.rejects(callTool('port_plan', { source: path.join(F, 'godot-mini'), to: 'cobol' }), /Unknown target/);
});

test('verify catches dormant logic: stub bodies, unwired functions, added suppressions; resume pack is returned', async () => {
  const plan = await callTool('port_plan', { source: path.join(F, 'godot-mini'), to: 'unity', include: 'actors/player\\.gd$' });
  // Every name exists, but Shoot is a stub, OnHit is never wired, the signal is never raised, and a warning is silenced.
  const content = `#pragma warning disable 0414
using UnityEngine;
public class Player : MonoBehaviour {
  public event System.Action<int> Hit;
  void Awake() { }
  void FixedUpdate() { transform.position += Vector3.right * Time.fixedDeltaTime; }
  public void Shoot() { // PORT: later
  }
  void OnHit(int damage) { Debug.Log("hit"); }
}
`;
  await callTool('port_write', { planId: plan.planId, unit: 'u001', content });
  const v = await callTool('port_verify', { planId: plan.planId });
  assert.equal(v.passed, false);
  const w = v.warnings.find(x => x.issue.startsWith('dormant logic'));
  assert.ok(w, JSON.stringify(v.warnings));
  const has = (name, kind) => w.findings.some(f => f.name === name && f.kind === kind);
  assert.ok(has('Shoot', 'empty-body'), JSON.stringify(w.findings));
  assert.ok(has('OnHit', 'unwired'), JSON.stringify(w.findings));
  assert.ok(has('#pragma warning disable', 'suppression'));
  assert.ok(w.findings.some(f => f.name === 'signal hit' && f.kind === 'unwired'), JSON.stringify(w.findings));
  assert.ok(v.dormant >= 4);
  assert.match(v.resume, /# Port .*godot → unity/);
  assert.match(v.resume, /dormant logic/);
  assert.ok(v.resume.length < 6100);
  // The canned, real port has none of these.
  const good = await callTool('port_write', { planId: plan.planId, unit: 'u001', content: await fs.readFile(path.join(F, 'ports', 'godot-mini-unity', 'Player.cs'), 'utf8') });
  assert.ok(good);
  const v2 = await callTool('port_verify', { planId: plan.planId });
  assert.equal(v2.dormant, 0, JSON.stringify(v2.warnings));
  const st = await callTool('port_status', { planId: plan.planId });
  assert.match(st.resume, /progress 1\/1 done/);
});
