// Behaviour parity beyond names: timing (frame vs physics tick, delta use, fixed step), randomness (seeding, RNG
// calls) and execution order, compared between a source unit and its port; plus trace harnesses that log the
// same properties per physics tick in both engines and a comparer that finds the first divergence.
import fs from 'node:fs/promises';
import path from 'node:path';
import { RPError, requireFile } from './util.mjs';
import { functionBodies } from './dormant.mjs';

const FRAME = ['_process', 'Update', 'LateUpdate', 'Tick', 'update', '_Process', 'onUpdate', 'draw'];
const PHYSICS = ['_physics_process', 'FixedUpdate', '_PhysicsProcess', 'fixedUpdate', 'physicsUpdate', '_integrate_forces', '_IntegrateForces', 'TickPhysics', 'step'];
const DELTA_RE = /\b(delta|deltaTime|DeltaTime|fixedDeltaTime|DeltaSeconds|dt|elapsed|get_process_delta_time\(\)|get_physics_process_delta_time\(\))\b/;
const MOTION_RE = /\b(position|global_position|velocity|linear_velocity|angular_velocity|transform\.position|transform\.Translate|Translate|Rotate|rotation|rotate|move_and_slide|move_and_collide|MovePosition|AddForce|apply_force|apply_impulse|apply_central_impulse|AddTorque|SetActorLocation|AddActorLocalOffset|AddMovementInput|LaunchCharacter|\.x\s*[+-]=|\.y\s*[+-]=|\.z\s*[+-]=)\b/;
const RNG_CALL_RE = /\b(randf|randi|randf_range|randi_range|randfn|rand_range|randomize|RandomNumberGenerator|GD\.Randf|GD\.Randi|GD\.RandRange|Random\.(Range|value|insideUnitCircle|insideUnitSphere|onUnitSphere|rotation|InitState)|UnityEngine\.Random|System\.Random|new Random|Math\.random|FMath::(Rand\w*|FRand\w*|SRand|RandRange|VRand)|FRandomStream|rand\(\)|random\(\)|randint|uniform|choice|shuffle|RandomRange|RandomFloat|GetRandom\w*)\b/g;
const SEED_RE = /\b(seed\s*\(|randomize\s*\(|\.seed\s*=|set_seed|Random\.InitState|new Random\s*\(\s*\d|new System\.Random\s*\(\s*\w|FMath::SRandInit|FMath::RandInit|FRandomStream\s*\(|srand\s*\(|random\.seed|seedrandom|Mulberry|xorshift|RandomNumberGenerator\s*\.new\s*\(\s*\)\s*[\s\S]{0,80}?\.seed)/;
const ORDER_RE = /\b(DefaultExecutionOrder|process_priority|process_physics_priority|ExecutionOrder|TickGroup|PrimaryActorTick\.TickGroup|AddTickPrerequisiteActor|call_deferred|CallDeferred|Invoke\s*\(|InvokeRepeating|StartCoroutine|coroutine|yield return|await\s+ToSignal|await\s+\w+\.\w+|\.timeout\b|SetTimer|setTimeout|requestAnimationFrame)\b/g;
const TIMESCALE_RE = /\b(?:(?:Time\.timeScale|Engine\.time_scale|Engine\.TimeScale|CustomTimeDilation|Application\.targetFrameRate|Engine\.max_fps|Engine\.MaxFps|QualitySettings\.vSyncCount|Time\.fixedDeltaTime|Engine\.physics_ticks_per_second|Engine\.PhysicsTicksPerSecond|Time\.maximumDeltaTime|Engine\.max_physics_steps_per_frame)(?=\s*=[^=])|SetGlobalTimeDilation|t\.MaxFPS|ProjectSettings\.set_setting\("physics\/common\/physics_ticks_per_second")/g;

function bodiesByName(text, lang) {
  const out = new Map();
  for (const b of functionBodies(text, lang).functions) out.set(b.name, (out.get(b.name) ?? '') + '\n' + b.body);
  return out;
}
const cat = name => (FRAME.includes(name) ? 'frame' : PHYSICS.includes(name) ? 'physics' : null);

/** Timing/randomness/order findings for one unit. Returns [{kind, detail, fix}]. */
export function parityFindings({ sourceText, sourceLang, targetText, targetLang }) {
  const out = [];
  if (!sourceText || !targetText) return out;
  const src = bodiesByName(sourceText, sourceLang), dst = bodiesByName(targetText, targetLang);
  const srcCat = { frame: '', physics: '' }, dstCat = { frame: '', physics: '' };
  for (const [n, b] of src) { const c = cat(n); if (c) srcCat[c] += b; }
  for (const [n, b] of dst) { const c = cat(n); if (c) dstCat[c] += b; }
  // 1. Motion moved between frame and physics callbacks.
  const srcMotion = { frame: MOTION_RE.test(srcCat.frame), physics: MOTION_RE.test(srcCat.physics) };
  const dstMotion = { frame: MOTION_RE.test(dstCat.frame), physics: MOTION_RE.test(dstCat.physics) };
  if (srcMotion.physics && !dstMotion.physics && dstMotion.frame) out.push({ kind: 'tick-moved', detail: 'movement/physics code ran in the physics tick in the source but in the frame callback in the port', fix: 'move it to the physics callback (FixedUpdate / _physics_process / fixed-step accumulator) or results depend on frame rate' });
  if (srcMotion.frame && !dstMotion.frame && dstMotion.physics && !srcMotion.physics) out.push({ kind: 'tick-moved', detail: 'movement ran per frame in the source but per physics tick in the port', fix: 'fine for physics bodies; for visual-only motion keep it per frame or interpolate' });
  // 2. Delta usage changed where motion happens.
  const sAnyDelta = DELTA_RE.test(srcCat.frame + srcCat.physics) && MOTION_RE.test(srcCat.frame + srcCat.physics);
  const dAnyDelta = DELTA_RE.test(dstCat.frame + dstCat.physics), dAnyMotion = MOTION_RE.test(dstCat.frame + dstCat.physics);
  if (sAnyDelta && dAnyMotion && !dAnyDelta) out.push({ kind: 'delta-dropped', detail: 'the source scaled its motion by delta; the port moves by fixed amounts per callback', fix: 'multiply speeds by delta (or by the fixed step) in the port' });
  for (const c of ['frame', 'physics']) {
    if (sAnyDelta && !dAnyDelta) break;
    const sHas = DELTA_RE.test(srcCat[c]), dHas = DELTA_RE.test(dstCat[c]);
    if (MOTION_RE.test(srcCat[c]) && sHas && !dHas && (dstCat[c].trim() || c === 'frame')) out.push({ kind: 'delta-dropped', detail: `the source scaled ${c}-callback motion by delta; the port does not`, fix: 'multiply speeds by delta (or by the fixed step) in the port' });
    if (MOTION_RE.test(dstCat[c]) && !sHas && dHas && srcCat[c].trim()) out.push({ kind: 'delta-added', detail: `the port scales ${c}-callback motion by delta; the source used fixed per-tick amounts`, fix: 'either keep per-tick amounts at the same tick rate, or convert amounts to per-second values (amount × tick rate) when multiplying by delta' });
  }
  // 3. Randomness.
  const sRng = (sourceText.match(RNG_CALL_RE) ?? []).length, dRng = (targetText.match(RNG_CALL_RE) ?? []).length;
  if (sRng && !dRng) out.push({ kind: 'rng-missing', detail: `source uses randomness (${sRng} call(s)); the port has none`, fix: 'port the random choices; replays and difficulty depend on them' });
  if (sRng && dRng) {
    const sSeed = SEED_RE.test(sourceText), dSeed = SEED_RE.test(targetText);
    if (sSeed && !dSeed) out.push({ kind: 'seed-missing', detail: 'the source seeds its RNG (deterministic runs); the port does not', fix: 'seed the same way (seed(n) / Random.InitState(n) / FMath::SRandInit(n) / a seeded PRNG in JS) and draw in the same order' });
    if (!sSeed && dSeed) out.push({ kind: 'seed-added', detail: 'the port seeds its RNG; the source did not (runs varied)', fix: 'drop the fixed seed unless replays are wanted' });
    if (Math.abs(sRng - dRng) > Math.max(2, sRng * 0.5)) out.push({ kind: 'rng-count', detail: `random calls: ${sRng} in the source, ${dRng} in the port`, fix: 'same number of draws in the same order keeps seeded runs identical' });
  }
  // 4. Ordering and deferred execution.
  const sOrder = new Set((sourceText.match(ORDER_RE) ?? []).map(x => x.trim())), dOrder = new Set((targetText.match(ORDER_RE) ?? []).map(x => x.trim()));
  if (sOrder.size && !dOrder.size) out.push({ kind: 'order-dropped', detail: `the source controls execution order/deferral (${[...sOrder].slice(0, 5).join(', ')}); the port has nothing equivalent`, fix: 'map to process_priority / [DefaultExecutionOrder] / TickGroup, and deferred calls to call_deferred / coroutines / timers' });
  // 5. Time scale and frame-rate settings.
  const sTime = new Set((sourceText.match(TIMESCALE_RE) ?? [])), dTime = new Set((targetText.match(TIMESCALE_RE) ?? []));
  if (sTime.size && !dTime.size) out.push({ kind: 'timescale-dropped', detail: `the source sets time scale / frame rate / fixed step (${[...sTime].join(', ')}); the port does not`, fix: 'set the equivalent (Engine.time_scale, Time.timeScale, CustomTimeDilation; Engine.max_fps, Application.targetFrameRate; physics_ticks_per_second, Time.fixedDeltaTime)' });
  return out;
}

const TICK_RATE = { godot: 60, 'godot-csharp': 60, unity: 50, unreal: 60, threejs: 60 };

/** A logger that records properties of one node per physics tick to JSON, in the engine's own language. */
export function traceHarness({ engine, node = '.', properties = ['position'], ticks = 300, file = 'reverseport-trace.json', label = engine } = {}) {
  const e = String(engine).toLowerCase();
  const props = properties.map(p => String(p));
  const common = { ticks, properties: props, format: '{ "engine", "tickRate", "ticks": [{ "t": tick, "<property>": number | [numbers] }] } — compare two with port_trace action:"compare"' };
  if (e === 'godot' || e === 'godot-csharp') {
    const text = `extends Node
## ReversePort trace harness: add this node to the scene, set target to the node to watch, run ${ticks} physics ticks.
## Writes user://${file}. Compare with the original engine's trace: port_trace {action:"compare", a, b}.
@export var target_path: NodePath = ^"${node}"
@export var ticks: int = ${ticks}
var _rows: Array = []
var _tick := 0

func _ready() -> void:
\tseed(12345) # same seed in both engines
\tEngine.physics_ticks_per_second = ${TICK_RATE[e]}

func _physics_process(_delta: float) -> void:
\tvar target := get_node_or_null(target_path)
\tif target == null:
\t\treturn
\tvar row := {"t": _tick}
${props.map(p => `\trow["${p}"] = _num(target.get("${p}"))`).join('\n')}
\t_rows.append(row)
\t_tick += 1
\tif _tick >= ticks:
\t\t_flush()
\t\tset_physics_process(false)

func _num(v):
\tif v is Vector2: return [v.x, v.y]
\tif v is Vector3: return [v.x, v.y, v.z]
\tif v is Quaternion: return [v.x, v.y, v.z, v.w]
\tif v is bool: return 1.0 if v else 0.0
\treturn v

func _flush() -> void:
\tvar f := FileAccess.open("user://${file}", FileAccess.WRITE)
\tf.store_string(JSON.stringify({"engine": "${label}", "tickRate": ${TICK_RATE[e]}, "ticks": _rows}))
\tf.close()
\tprint("ReversePort trace written: ", ProjectSettings.globalize_path("user://${file}"))
`;
    return { engine: e, fileName: 'ReversePortTrace.gd', text, where: 'user:// folder (printed at the end)', ...common };
  }
  if (e === 'unity') {
    const text = `using System.Collections.Generic;
using System.IO;
using System.Text;
using UnityEngine;

// ReversePort trace harness: add to any GameObject, assign target, play ${ticks} fixed updates.
// Writes ${file} next to persistentDataPath. Compare with the port's trace: port_trace {action:"compare", a, b}.
public class ReversePortTrace : MonoBehaviour
{
    public Transform target;
    public int ticks = ${ticks};
    readonly List<string> rows = new List<string>();
    int tick;

    void Awake() { Random.InitState(12345); Time.fixedDeltaTime = 1f / ${TICK_RATE[e]}f; }

    void FixedUpdate()
    {
        if (target == null || tick >= ticks) return;
        var sb = new StringBuilder();
        sb.Append("{\\"t\\":").Append(tick);
${props.map(p => `        sb.Append(",\\"${p}\\":").Append(Num(Get("${p}")));`).join('\n')}
        sb.Append("}");
        rows.Add(sb.ToString());
        if (++tick >= ticks) Flush();
    }

    object Get(string prop)
    {
        var rb = target.GetComponent<Rigidbody>();
        var rb2 = target.GetComponent<Rigidbody2D>();
        switch (prop)
        {
            case "position": case "global_position": return target.position;
            case "rotation": return target.rotation;
            case "rotation_degrees": return target.eulerAngles;
            case "scale": return target.localScale;
            case "velocity": case "linear_velocity": return rb != null ? (object)rb.linearVelocity : rb2 != null ? (object)rb2.linearVelocity : null;
            case "angular_velocity": return rb != null ? (object)rb.angularVelocity : rb2 != null ? (object)rb2.angularVelocity : null;
        }
        foreach (var c in target.GetComponents<MonoBehaviour>())
        {
            var f = c.GetType().GetField(prop); if (f != null) return f.GetValue(c);
            var pr = c.GetType().GetProperty(prop); if (pr != null) return pr.GetValue(c);
        }
        return null;
    }

    static string Num(object v)
    {
        var ci = System.Globalization.CultureInfo.InvariantCulture;
        switch (v)
        {
            case null: return "null";
            case Vector2 a: return "[" + a.x.ToString("R", ci) + "," + a.y.ToString("R", ci) + "]";
            case Vector3 a: return "[" + a.x.ToString("R", ci) + "," + a.y.ToString("R", ci) + "," + a.z.ToString("R", ci) + "]";
            case Quaternion q: return "[" + q.x.ToString("R", ci) + "," + q.y.ToString("R", ci) + "," + q.z.ToString("R", ci) + "," + q.w.ToString("R", ci) + "]";
            case bool b: return b ? "1" : "0";
            case float f: return f.ToString("R", ci);
            case double d: return d.ToString("R", ci);
            case int i: return i.ToString(ci);
        }
        return "\\"" + v + "\\"";
    }

    void Flush()
    {
        var p = Path.Combine(Application.persistentDataPath, "${file}");
        File.WriteAllText(p, "{\\"engine\\":\\"${label}\\",\\"tickRate\\":${TICK_RATE[e]},\\"ticks\\":[" + string.Join(",", rows) + "]}");
        Debug.Log("ReversePort trace written: " + p);
    }
}
`;
    return { engine: e, fileName: 'ReversePortTrace.cs', text, where: 'Application.persistentDataPath (logged)', ...common };
  }
  if (e === 'threejs') {
    const text = `// ReversePort trace harness (three.js + your physics step). Call trace.tick(object) once per fixed step
// and trace.download() (browser) or trace.toJSON() after ${ticks} ticks. Compare: port_trace {action:"compare", a, b}.
export function createTrace({ ticks = ${ticks}, properties = ${JSON.stringify(props)}, label = ${JSON.stringify(label)} } = {}) {
  const rows = [];
  let tick = 0;
  const num = v => (v == null ? null : typeof v === 'number' ? v : typeof v === 'boolean' ? (v ? 1 : 0) : 'w' in v ? [v.x, v.y, v.z, v.w] : 'z' in v ? [v.x, v.y, v.z] : [v.x, v.y]);
  const get = (obj, p) => { const map = { position: obj.position, global_position: obj.getWorldPosition?.(new obj.position.constructor()) ?? obj.position, rotation: obj.quaternion, rotation_degrees: obj.rotation, scale: obj.scale, velocity: obj.userData?.velocity ?? obj.body?.linvel?.(), linear_velocity: obj.userData?.velocity ?? obj.body?.linvel?.(), angular_velocity: obj.body?.angvel?.() }; return p in map ? map[p] : obj.userData?.[p] ?? obj[p]; };
  return {
    tick(obj) { if (tick >= ticks) return; const row = { t: tick }; for (const p of properties) row[p] = num(get(obj, p)); rows.push(row); tick++; },
    done() { return tick >= ticks; },
    toJSON() { return { engine: label, tickRate: ${TICK_RATE[e]}, ticks: rows }; },
    download(name = ${JSON.stringify(file)}) { const blob = new Blob([JSON.stringify(this.toJSON())], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); },
  };
}
// Seed your PRNG the same way in both engines (e.g. a mulberry32(12345)) and use a fixed-step accumulator at 1/${TICK_RATE[e]} s.
`;
    return { engine: e, fileName: 'reverseport-trace.js', text, where: 'browser download or your own fs write', ...common };
  }
  if (e === 'unreal') {
    const text = `// ReversePort trace harness (Unreal, C++). Add this component to the actor to watch; it logs ${ticks} physics ticks
// to Saved/${file} on the TickGroup TG_PostPhysics. Compare: port_trace {action:"compare", a, b}.
#pragma once
#include "CoreMinimal.h"
#include "Components/ActorComponent.h"
#include "Misc/FileHelper.h"
#include "ReversePortTrace.generated.h"

UCLASS(ClassGroup=(ReversePort), meta=(BlueprintSpawnableComponent))
class UReversePortTrace : public UActorComponent
{
    GENERATED_BODY()
public:
    UPROPERTY(EditAnywhere) int32 Ticks = ${ticks};
    UReversePortTrace() { PrimaryComponentTick.bCanEverTick = true; PrimaryComponentTick.TickGroup = TG_PostPhysics; }
    virtual void BeginPlay() override { Super::BeginPlay(); FMath::SRandInit(12345); }
    virtual void TickComponent(float DeltaTime, ELevelTick TickType, FActorComponentTickFunction* ThisTickFunction) override
    {
        Super::TickComponent(DeltaTime, TickType, ThisTickFunction);
        if (Tick >= Ticks) return;
        AActor* A = GetOwner();
        const FVector P = A->GetActorLocation() / 100.0f; // cm → m, Unreal X-forward/Z-up: convert axes with port_convert before comparing
        const FQuat Q = A->GetActorQuat();
        const FVector V = A->GetVelocity() / 100.0f;
        Rows.Add(FString::Printf(TEXT("{\\"t\\":%d,\\"position\\":[%g,%g,%g],\\"rotation\\":[%g,%g,%g,%g],\\"velocity\\":[%g,%g,%g]}"), Tick, P.X, P.Y, P.Z, Q.X, Q.Y, Q.Z, Q.W, V.X, V.Y, V.Z));
        if (++Tick >= Ticks)
        {
            const FString Out = FString::Printf(TEXT("{\\"engine\\":\\"${label}\\",\\"tickRate\\":${TICK_RATE[e]},\\"ticks\\":[%s]}"), *FString::Join(Rows, TEXT(",")));
            FFileHelper::SaveStringToFile(Out, *(FPaths::ProjectSavedDir() / TEXT("${file}")));
            UE_LOG(LogTemp, Log, TEXT("ReversePort trace written: %s"), *(FPaths::ProjectSavedDir() / TEXT("${file}")));
        }
    }
private:
    int32 Tick = 0;
    TArray<FString> Rows;
};
`;
    return { engine: e, fileName: 'ReversePortTrace.h', text, where: 'Saved/ folder of the project', ...common, note: 'Unreal logs position/rotation/velocity in meters, Unreal axes; convert the other trace with port_convert or compare per axis with mapping.' };
  }
  throw new RPError('INVALID_ARGUMENT', `No trace harness for ${engine}; available: godot, unity, threejs, unreal.`);
}

/** Compare two traces: first divergence per property, max error, drift (error growth per tick). */
export async function compareTraces({ a, b, tolerance = 0.01, resample = true, axisMap } = {}) {
  const read = async f => { const { abs } = await requireFile(f); const j = JSON.parse(await fs.readFile(abs, 'utf8')); if (!Array.isArray(j.ticks)) throw new RPError('BAD_FORMAT', `${abs} is not a ReversePort trace (no ticks array).`); return { file: abs, ...j }; };
  const A = await read(a), B = await read(b);
  const rateA = A.tickRate ?? 60, rateB = B.tickRate ?? 60;
  const props = [...new Set([...Object.keys(A.ticks[0] ?? {}), ...Object.keys(B.ticks[0] ?? {})])].filter(k => k !== 't');
  const mapB = v => (Array.isArray(v) && axisMap && v.length >= 3 ? axisMap.map(i => (typeof i === 'string' ? (i.startsWith('-') ? -v[Number(i.slice(1))] : v[Number(i)]) : v[i])) : v);
  const at = (trace, rate, tSeconds) => {
    const idx = tSeconds * rate;
    const i0 = Math.floor(idx), i1 = Math.min(trace.ticks.length - 1, i0 + 1), f = idx - i0;
    const r0 = trace.ticks[i0], r1 = trace.ticks[i1];
    if (!r0) return null;
    if (!resample || !r1 || f === 0) return r0;
    const row = { t: idx };
    for (const k of Object.keys(r0)) { const x = r0[k], y = r1[k]; row[k] = Array.isArray(x) && Array.isArray(y) ? x.map((v, j) => v + (y[j] - v) * f) : typeof x === 'number' && typeof y === 'number' ? x + (y - x) * f : x; }
    return row;
  };
  const seconds = Math.min((A.ticks.length - 1) / rateA, (B.ticks.length - 1) / rateB);
  const steps = Math.max(1, Math.floor(seconds * Math.min(rateA, rateB)));
  const result = {};
  for (const p of props) {
    let first = null, maxErr = 0, maxAt = 0, sum = 0, n = 0, early = 0, late = 0;
    for (let s = 0; s <= steps; s++) {
      const t = s / Math.min(rateA, rateB);
      const ra = at(A, rateA, t), rb = at(B, rateB, t);
      if (!ra || !rb || ra[p] == null || rb[p] == null) continue;
      const va = ra[p], vb = mapB(rb[p]);
      const err = Array.isArray(va) ? Math.sqrt(va.reduce((acc, v, i) => acc + (v - (vb[i] ?? 0)) ** 2, 0)) : Math.abs(va - vb);
      if (!Number.isFinite(err)) continue;
      sum += err; n++;
      if (s < steps / 2) early += err; else late += err;
      if (err > maxErr) { maxErr = err; maxAt = t; }
      if (first === null && err > tolerance) first = { seconds: Math.round(t * 1000) / 1000, a: va, b: vb, error: Math.round(err * 1e6) / 1e6 };
    }
    result[p] = { matches: first === null, firstDivergence: first, maxError: Math.round(maxErr * 1e6) / 1e6, maxErrorAt: Math.round(maxAt * 1000) / 1000, meanError: n ? Math.round((sum / n) * 1e6) / 1e6 : null, drift: n ? (late > early * 1.5 ? 'growing' : late < early * 0.67 ? 'shrinking' : 'steady') : null };
  }
  const failing = Object.entries(result).filter(([, r]) => !r.matches).map(([p]) => p);
  const hints = [];
  if (rateA !== rateB) hints.push(`tick rates differ (${rateA} vs ${rateB} Hz): traces were resampled by time; per-tick amounts without delta scale by ${Math.round((rateB / rateA) * 1000) / 1000}`);
  for (const p of failing) { const r = result[p]; if (r.drift === 'growing') hints.push(`${p}: error grows over time → integration differs (delta vs per-tick, damping, gravity or friction); check the physics profile (port_convert physics)`); else if (r.firstDivergence && r.firstDivergence.seconds === 0) hints.push(`${p}: differs from the first tick → initial state, units or axes differ (axisMap, unit factor, spawn position)`); else hints.push(`${p}: diverges at ${r.firstDivergence?.seconds}s → an event (input, collision, random draw) happened differently there`); }
  return { a: { file: A.file, engine: A.engine, tickRate: rateA, ticks: A.ticks.length }, b: { file: B.file, engine: B.engine, tickRate: rateB, ticks: B.ticks.length }, comparedSeconds: Math.round(seconds * 1000) / 1000, tolerance, properties: result, passed: failing.length === 0, failing, hints };
}

export async function portTraceTool({ action = 'harness', engine, node, properties, ticks, out, a, b, tolerance, axisMap } = {}) {
  if (action === 'compare') { if (!a || !b) throw new RPError('INVALID_ARGUMENT', 'compare needs a and b: two trace JSON files.'); return compareTraces({ a, b, tolerance, axisMap }); }
  if (action !== 'harness') throw new RPError('INVALID_ARGUMENT', 'action must be harness or compare.');
  if (!engine) throw new RPError('INVALID_ARGUMENT', 'harness needs engine: godot, unity, threejs or unreal.');
  const h = traceHarness({ engine, node, properties, ticks });
  let file = null;
  if (out) { file = path.resolve(out); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, h.text); }
  return { ...h, ...(file ? { file } : {}), next: `Add ${h.fileName} to both projects (original and port) watching the same node and properties, run each for ${h.ticks} ticks from the same start, then port_trace {action:"compare", a:<original trace>, b:<port trace>, tolerance}.` };
}
