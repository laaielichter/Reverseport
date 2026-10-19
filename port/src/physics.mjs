// Physics profiles: what each engine does differently (gravity, fixed step, damping, friction/bounce combination,
// layers, character controllers, units) and how to carry one project's physics numbers to another engine.
// Numbers come from the engines' documented defaults and source (Godot: PhysicsMaterial.xml, godot_body_pair_3d.cpp;
// Unity: Physics/Rigidbody/PhysicMaterial manual; Unreal: UPhysicalMaterial/CharacterMovementComponent docs).
import { RPError } from './util.mjs';

export const PHYSICS = {
  godot: {
    label: 'Godot 4', units: 'm (3D) / px (2D, 100 px ≈ 1 m by default)', gravity3d: 9.8, gravity2d: 980, fixedStep: 1 / 60, fixedStepSetting: 'physics/common/physics_ticks_per_second (60)',
    engineSetting: 'physics/3d/physics_engine: "Jolt Physics" (default since 4.4) or "GodotPhysics3D"',
    gravitySetting: 'physics/3d/default_gravity (9.8) + physics/3d/default_gravity_vector; 2D: physics/2d/default_gravity (980)',
    linearDamp: 0.1, angularDamp: 0.1, dampSetting: 'physics/3d/default_linear_damp (0.1) and default_angular_damp (0.1); per body linear_damp with linear_damp_mode Combine (adds to default) or Replace',
    dampFormula: 'v *= 1 - min(damp * dt, 1) per physics tick (same shape as Unity drag and Unreal damping)',
    friction: 1.0, bounce: 0.0, frictionCombine: 'min of both (GodotPhysics; rough=true wins), Jolt: geometric mean sqrt(f1*f2)', bounceCombine: 'sum clamped to 1 (GodotPhysics; absorbent subtracts), Jolt: max',
    material: 'PhysicsMaterial { friction (one value, no static/dynamic split), bounce, rough, absorbent } on the body or shape owner',
    layers: '32 layers; each body has collision_layer (what it is) and collision_mask (what it scans). A collides with B when A.mask includes B.layer — one-directional per body, no global matrix',
    character: 'CharacterBody3D: no gravity, you integrate velocity and call move_and_slide(); floor_max_angle 45°, floor_snap_length 0.1, wall_min_slide_angle 15°',
    ccd: 'RigidBody3D.continuous_cd (Jolt supports it; GodotPhysics uses it for shape casts)', mass: 'RigidBody3D.mass (kg, default 1); center_of_mass_mode Auto',
    interpolation: 'physics/common/physics_interpolation (4.3+) or manual lerp in _process',
  },
  'godot-csharp': { alias: 'godot' },
  unity: {
    label: 'Unity', units: 'm (3D) / units with Pixels Per Unit (2D sprites, default 100 px per unit)', gravity3d: 9.81, gravity2d: 9.81, fixedStep: 0.02, fixedStepSetting: 'Time.fixedDeltaTime / Project Settings ▸ Time ▸ Fixed Timestep (0.02 s = 50 Hz)',
    engineSetting: 'PhysX (3D) / Box2D (2D); Unity 6: Physics ▸ Simulation Mode',
    gravitySetting: 'Physics.gravity (0, -9.81, 0); Physics2D.gravity (0, -9.81)',
    linearDamp: 0, angularDamp: 0.05, dampSetting: 'Rigidbody.drag / linearDamping (0) and angularDrag / angularDamping (0.05) per body; no project default',
    dampFormula: 'v *= clamp01(1 - drag * fixedDeltaTime) per fixed step',
    friction: 0.6, bounce: 0.0, frictionCombine: 'Average by default (Minimum, Maximum, Multiply per PhysicMaterial)', bounceCombine: 'Average by default',
    material: 'PhysicMaterial { dynamicFriction (0.6), staticFriction (0.6), bounciness (0), frictionCombine, bounceCombine } on the Collider',
    layers: '32 layers with a global Layer Collision Matrix (ProjectSettings/DynamicsManager.asset m_LayerCollisionMatrix); a pair collides when the matrix allows it, symmetric',
    character: 'CharacterController: no gravity, you add it and call Move(); slopeLimit 45°, stepOffset 0.3, skinWidth 0.08, minMoveDistance 0.001',
    ccd: 'Rigidbody.collisionDetectionMode (Discrete, Continuous, ContinuousDynamic, ContinuousSpeculative)', mass: 'Rigidbody.mass (kg, default 1); automatic center of mass',
    interpolation: 'Rigidbody.interpolation (None, Interpolate, Extrapolate)',
  },
  unreal: {
    label: 'Unreal Engine 5', units: 'cm', gravity3d: 980, gravity2d: 980, fixedStep: null, fixedStepSetting: 'variable (frame rate) by default; Project Settings ▸ Physics ▸ Substepping or Tick Physics Async for a fixed step',
    engineSetting: 'Chaos',
    gravitySetting: 'Project Settings ▸ Physics ▸ Default Gravity Z (-980 cm/s²); WorldSettings GlobalGravityZ; per actor GravityScale',
    linearDamp: 0.01, angularDamp: 0, dampSetting: 'BodyInstance LinearDamping (0.01) and AngularDamping (0) per primitive component',
    dampFormula: 'v *= max(0, 1 - damping * dt) per substep (PhysX/Chaos convention)',
    friction: 0.7, bounce: 0.3, frictionCombine: 'Average by default (Min, Multiply, Max; bOverrideFrictionCombineMode on the physical material)', bounceCombine: 'Average by default',
    material: 'UPhysicalMaterial { Friction (0.7), StaticFriction (0, uses Friction unless overridden), Restitution (0.3), Density (1 g/cm³) } assigned to the mesh or collision',
    layers: 'Object channels (WorldStatic, Pawn, PhysicsBody, custom…) with per-component responses Block/Overlap/Ignore, usually via Collision Presets; asymmetric responses possible (both must Block to collide)',
    character: 'CharacterMovementComponent: gravity applied by the component (GravityScale 1), JumpZVelocity 420 cm/s, MaxWalkSpeed 600 cm/s, GroundFriction 8, BrakingDecelerationWalking 2048, MaxStepHeight 45 cm, WalkableFloorAngle 44.765°',
    ccd: 'BodyInstance bUseCCD', mass: 'computed from volume × material density unless MassInKg override is set (default: a 1 m cube ≈ 1000 kg)',
    interpolation: 'smooth by default with substepping; Chaos async tick interpolates',
  },
  threejs: {
    label: 'three.js + Rapier (or cannon-es)', units: 'm', gravity3d: 9.81, gravity2d: 9.81, fixedStep: 1 / 60, fixedStepSetting: 'world.timestep (Rapier default 1/60) driven by your own accumulator',
    engineSetting: 'no physics in three.js itself; Rapier (recommended), cannon-es, ammo.js',
    gravitySetting: 'new RAPIER.World({ x: 0, y: -9.81, z: 0 })',
    linearDamp: 0, angularDamp: 0, dampSetting: 'RigidBodyDesc.setLinearDamping / setAngularDamping per body',
    dampFormula: 'v *= 1 / (1 + damping * dt) per step (Rapier)',
    friction: 0.5, bounce: 0.0, frictionCombine: 'Average by default (ColliderDesc.setFrictionCombineRule: Average, Min, Multiply, Max)', bounceCombine: 'Average by default (setRestitutionCombineRule)',
    material: 'ColliderDesc.setFriction / setRestitution per collider',
    layers: 'collision groups: 16 membership bits + 16 filter bits packed in one u32 (ColliderDesc.setCollisionGroups); pair collides when each side\'s filter includes the other\'s membership',
    character: 'KinematicCharacterController: you apply gravity to the desired translation; setMaxSlopeClimbAngle, enableAutostep, enableSnapToGround',
    ccd: 'RigidBodyDesc.setCcdEnabled(true)', mass: 'from collider density (ColliderDesc.setDensity, default 1) or setMass; three.js has none',
    interpolation: 'copy body translation/rotation into the mesh after each step; interpolate with the accumulator alpha',
  },
};
const profile = e => { const k = String(e ?? '').toLowerCase().replace(/[^a-z-]/g, ''); const p = PHYSICS[k]; if (!p) throw new RPError('INVALID_ARGUMENT', `Unknown engine ${e}; physics profiles: ${Object.keys(PHYSICS).join(', ')}.`); return p.alias ? { ...PHYSICS[p.alias], label: `${PHYSICS[p.alias].label} (C#)` } : p; };
const r4 = x => Math.round(x * 1e4) / 1e4;

/**
 * Carry physics numbers from one engine to another.
 * values: { gravity, fixedStep, linearDamp, angularDamp, friction, bounce, mass, speed, jumpVelocity, jumpHeight, force, impulse, layers: [{name, index, collidesWith:[...]}], dimension: '2d'|'3d' }
 */
export function physicsProfile({ from, to, values = {} } = {}) {
  const a = profile(from), b = profile(to);
  const srcKey = String(from).toLowerCase().replace(/[^a-z-]/g, ''), dstKey = String(to).toLowerCase().replace(/[^a-z-]/g, '');
  const dim = values.dimension === '2d' ? '2d' : '3d';
  const unitFactor = (dstKey === 'unreal' ? 100 : 1) / (srcKey === 'unreal' ? 100 : 1) * (dim === '2d' ? ((dstKey.startsWith('godot') ? 100 : 1) / (srcKey.startsWith('godot') ? 100 : 1)) : 1);
  const converted = {};
  const settings = [];
  const notes = [];
  const g = v => v == null ? null : r4(Math.abs(v) * unitFactor);
  const gravity = values.gravity != null ? g(values.gravity) : null;
  const defaultG = dim === '2d' ? b.gravity2d : b.gravity3d;
  if (gravity != null) {
    converted.gravity = gravity;
    settings.push(`${b.gravitySetting} → ${gravity}${dstKey === 'unreal' ? ' (Default Gravity Z = -' + gravity + ')' : ''}`);
    if (Math.abs(gravity - defaultG) > 1e-6) notes.push(`Gravity ${gravity} differs from the ${b.label} default ${defaultG}: set it in the project, not per body, or jumps and falls change.`);
  } else settings.push(`gravity: ${a.label} default ${dim === '2d' ? a.gravity2d : a.gravity3d} → ${b.label} default ${defaultG} (${b.gravitySetting})`);
  const step = values.fixedStep ?? a.fixedStep;
  if (step != null) {
    converted.fixedStep = b.fixedStep ?? step;
    if (b.fixedStep == null) { settings.push(`${b.fixedStepSetting}: enable substepping or async physics tick and set 1/${Math.round(1 / step)} s to keep a fixed ${Math.round(1 / step)} Hz step`); notes.push('Unreal physics runs at frame rate by default; per-frame forces and friction-based movement then depend on FPS unless substepping is on.'); }
    else if (Math.abs(step - b.fixedStep) > 1e-9) { settings.push(`${b.fixedStepSetting} → ${Math.round(1 / step)} Hz to match the source (or keep ${Math.round(1 / b.fixedStep)} Hz and retune)`); notes.push(`Fixed step changes from ${Math.round(1 / step)} Hz to ${Math.round(1 / b.fixedStep)} Hz by default: anything added per physics tick (forces in FixedUpdate/_physics_process, per-tick velocity += …) scales by ${r4(step / b.fixedStep)} unless you multiply by delta.`); }
  }
  for (const k of ['linearDamp', 'angularDamp']) {
    if (values[k] == null) continue;
    converted[k] = values[k];
    const def = b[k];
    settings.push(`${b.dampSetting.split(';')[0]}: ${values[k]}${dstKey.startsWith('godot') && values[k] !== def ? ` with ${k === 'linearDamp' ? 'linear_damp_mode' : 'angular_damp_mode'} = Replace (Combine adds the project default ${def})` : ''}`);
  }
  if ((values.linearDamp == null || values.angularDamp == null) && (a.linearDamp !== b.linearDamp || a.angularDamp !== b.angularDamp)) notes.push(`Default damping differs: ${a.label} ${a.linearDamp}/${a.angularDamp} vs ${b.label} ${b.linearDamp}/${b.angularDamp} (linear/angular). Bodies that relied on defaults coast differently; set them explicitly.`);
  if (values.friction != null || values.bounce != null) {
    if (values.friction != null) converted.friction = values.friction;
    if (values.bounce != null) converted.bounce = values.bounce;
    settings.push(`${b.material}: friction ${values.friction ?? '(default ' + b.friction + ')'}, bounce ${values.bounce ?? '(default ' + b.bounce + ')'}`);
    if (a.frictionCombine !== b.frictionCombine) notes.push(`Friction combination differs: ${a.label} = ${a.frictionCombine}; ${b.label} = ${b.frictionCombine}. Two surfaces of friction ${values.friction ?? a.friction} and ${b.friction} land at different values; put the same friction on both bodies or set the combine mode where the engine allows.`);
    if (a.bounceCombine !== b.bounceCombine) notes.push(`Bounce combination differs: ${a.label} = ${a.bounceCombine}; ${b.label} = ${b.bounceCombine}.`);
  } else notes.push(`Default material differs: friction ${a.friction} → ${b.friction}, bounce ${a.bounce} → ${b.bounce}; objects slide and bounce differently unless materials are set on both sides.`);
  if (values.mass != null) { converted.mass = values.mass; settings.push(`${b.mass}: ${values.mass}`); if (dstKey === 'unreal') notes.push('Unreal derives mass from volume and density: set MassInKg (Override Mass) on each body or weights are off by orders of magnitude.'); }
  for (const k of ['speed', 'force', 'impulse']) if (values[k] != null) converted[k] = g(values[k]);
  if (values.jumpHeight != null) { converted.jumpHeight = g(values.jumpHeight); converted.jumpVelocity = r4(Math.sqrt(2 * (gravity ?? defaultG) * converted.jumpHeight)); settings.push(`jump velocity for ${converted.jumpHeight} ${dstKey === 'unreal' ? 'cm' : 'units'} under gravity ${gravity ?? defaultG}: ${converted.jumpVelocity}`); }
  else if (values.jumpVelocity != null) { const srcG = values.gravity != null ? Math.abs(values.gravity) : (dim === '2d' ? a.gravity2d : a.gravity3d); const h = (values.jumpVelocity ** 2) / (2 * srcG); converted.jumpHeight = g(h); converted.jumpVelocity = r4(Math.sqrt(2 * (gravity ?? defaultG) * converted.jumpHeight)); settings.push(`jump velocity ${values.jumpVelocity} (height ${r4(h)}) → ${converted.jumpVelocity} so the height stays ${converted.jumpHeight} under gravity ${gravity ?? defaultG}`); }
  if (values.layers?.length) {
    converted.layers = values.layers.map((l, i) => {
      const idx = l.index ?? i;
      const peers = l.collidesWith ?? [];
      const bit = n => 1 << n;
      const indexOf = name => { const pos = values.layers.findIndex(x => x.name === name); return pos < 0 ? -1 : (values.layers[pos].index ?? pos); };
      const mask = peers.map(p => (typeof p === 'number' ? p : indexOf(p))).filter(n => n >= 0).reduce((m, n) => m | bit(n), 0);
      if (dstKey.startsWith('godot')) return { name: l.name, collision_layer: bit(idx), collision_mask: mask, godot: `collision_layer = ${bit(idx)}, collision_mask = ${mask} (layer ${idx + 1})` };
      if (dstKey === 'threejs') return { name: l.name, membership: bit(idx) & 0xffff, filter: mask & 0xffff, rapier: `setCollisionGroups(${((bit(idx) & 0xffff) << 16 | (mask & 0xffff)) >>> 0})` };
      if (dstKey === 'unreal') return { name: l.name, channel: `ECC_GameTraceChannel${idx + 1} ("${l.name}")`, responses: Object.fromEntries(values.layers.map(x => [x.name, peers.includes(x.name) || peers.includes(x.index) ? 'Block' : 'Ignore'])) };
      return { name: l.name, layer: idx, matrixRow: Object.fromEntries(values.layers.map(x => [x.name, peers.includes(x.name) || peers.includes(x.index)])) };
    });
    if (srcKey === 'unity' && dstKey.startsWith('godot')) notes.push('Unity\'s layer matrix is symmetric; Godot masks are per body. For every pair the matrix allows, both bodies need the other in their mask (or only the one that must react).');
    if (dstKey === 'unreal') notes.push('Define the channels in Project Settings ▸ Collision and build a Collision Preset per layer; Unreal needs Block on both sides to collide.');
  }
  if (srcKey === 'unity' && dstKey.startsWith('godot')) notes.push('Unity CharacterController → CharacterBody3D: keep your own gravity integration; Unity stepOffset has no direct equivalent (use a raycast or floor_snap_length), skinWidth has none.');
  if (dstKey === 'unreal' && (srcKey.startsWith('godot') || srcKey === 'unity')) notes.push('Unreal CharacterMovementComponent applies gravity, friction and braking itself (GroundFriction 8, BrakingDecelerationWalking 2048): remove manual gravity/friction code or set those to 0 and keep your own.');
  if (srcKey.startsWith('godot') && dstKey === 'unity') notes.push('Godot default linear/angular damp 0.1 is added to every body (Combine mode); Unity bodies default to drag 0: set drag 0.1 on ported rigidbodies that relied on the default.');
  if (dim === '2d') notes.push(`2D units: ${a.units} → ${b.units}; speeds and gravity were scaled ×${unitFactor}.`);
  return {
    from: a.label, to: b.label, dimension: dim, unitFactor,
    profiles: { from: pick(a), to: pick(b) },
    converted, settings, differences: notes,
    next: 'Apply the settings, then check in play: fall time from a fixed height, a jump\'s peak, a sliding box\'s stop distance and a dropped ball\'s bounce count should match the original within tolerance (re_blueprint parity.json style).',
  };
}
const pick = p => ({ units: p.units, gravity3d: p.gravity3d, gravity2d: p.gravity2d, fixedStep: p.fixedStep, fixedStepSetting: p.fixedStepSetting, engine: p.engineSetting, damping: `${p.linearDamp}/${p.angularDamp} — ${p.dampFormula}`, friction: p.friction, bounce: p.bounce, frictionCombine: p.frictionCombine, bounceCombine: p.bounceCombine, material: p.material, layers: p.layers, character: p.character, ccd: p.ccd, mass: p.mass, interpolation: p.interpolation });
