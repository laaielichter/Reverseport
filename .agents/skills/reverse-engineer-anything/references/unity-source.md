# Porting from Unity to Godot

Read [porting and rebuilds](porting-and-rebuilds.md) for the loop; this guide holds the Unity-specific judgement.

## Prepare the source

- Scenes and prefabs must be text: Unity → Project Settings → Editor → Asset Serialization = **Force Text**. Without
  it `re_scene` cannot read them.
- Keep the `.meta` files: they map GUIDs to scripts and prefabs.
- GDScript or C#? Large, idiomatic C# codebases port faster to **godot-csharp** (only engine API calls change);
  smaller or designer-facing projects read better as GDScript (`to:"godot"`).

## What converts automatically

`port_scene` turns every `.prefab` and `.unity` into a `.tscn`: Rigidbody → RigidBody3D (kinematic →
AnimatableBody3D), CharacterController → CharacterBody3D, trigger colliders → Area3D, other colliders →
StaticBody3D, Box/Sphere/Capsule colliders → CollisionShape3D, built-in primitives → BoxMesh/SphereMesh/…, Camera,
Light, AudioSource, tags → groups, prefab instances → instanced scenes, scripts → the ported script. Transforms are
mirrored on Z. Model meshes, materials, animators and UI are flagged as `metadata/reverseport_todo` in the scene.

## Code: the usual translations

- One GameObject with several MonoBehaviours → one node per behaviour (child nodes) or merge them into one script.
- `GetComponent<T>()` → the node itself or a child (`$Child`); components are nodes in Godot.
- `[SerializeField]` → `@export`; prefab fields (`GameObject`) → `PackedScene`.
- Coroutines → `await get_tree().create_timer(t).timeout`; events/UnityEvent → signals.
- `OnTriggerEnter` → the Area3D `body_entered` signal; `Physics.Raycast` → `PhysicsRayQueryParameters3D`.
- `transform.forward` (+Z) → `-global_basis.z`; degrees → radians (`deg_to_rad`) or `rotation_degrees`.
- `Random.Range(int a, int b)` excludes b; `randi_range` includes it.
- Input Manager axes/buttons → Input Map actions (create them in Project Settings, same names).

Then run `port_verify` until it passes and open the folder in Godot 4.
