---
name: unity-to-godot
description: Port a Unity project (C#) to Godot 4 with ReversePort — MonoBehaviours to GDScript (or Godot C#), prefabs and scenes to .tscn with converted transforms, colliders, rigidbodies and prefab instances, plus the Unity-to-Godot API map. Use for "move my Unity game to Godot" or any port whose source is a Unity project.
---

# Porting from Unity to Godot

Use the port-project skill for the loop; this skill holds the Unity-specific judgement.

## Prepare the source

- Scenes and prefabs must be text: Unity → Project Settings → Editor → Asset Serialization = **Force Text**. Without
  it `re_scene` cannot read them.
- Keep the `.meta` files: they map GUIDs to scripts and prefabs. Run `re_refs` on the project first: a dangling
  GUID (missing script, pink material) is a component the port would silently lose; fix it in Unity before planning.
- GDScript or C#? Large, idiomatic C# codebases port faster to **godot-csharp** (only engine API calls change);
  smaller or designer-facing projects read better as GDScript (`to:"godot"`).

## What converts automatically

`port_scene` turns every `.prefab` and `.unity` into a `.tscn`: Rigidbody → RigidBody3D (kinematic →
AnimatableBody3D), CharacterController → CharacterBody3D, trigger colliders → Area3D, other colliders →
StaticBody3D, Box/Sphere/Capsule colliders → CollisionShape3D, built-in primitives → BoxMesh/SphereMesh/…, Camera,
Light, AudioSource, tags → groups, prefab instances → instanced scenes, scripts → the ported script. Transforms are
mirrored on Z. Prefab variants become inherited scenes (`instance=`) with `m_IsActive` applied and other
overrides listed. uGUI becomes Control nodes: Canvas → full-rect Control, Image/RawImage → TextureRect, Text and
TextMeshPro → Label (size, colour, alignment), Button → Button (label text, OnClick listed), Slider/Toggle/
ScrollRect/InputField/layout groups → HSlider/CheckBox/ScrollContainer/LineEdit/Box- and GridContainer, with
RectTransform anchors and offsets converted (Y flipped). Animator → an `AnimationPlayer` whose library holds the
ported clips plus an `Animator` child running the ported controller script. `.anim` files port to Godot
`Animation` resources (position/rotation/scale/property/sprite-swap/event tracks); `.controller` files port to a
GDScript state machine with the same states, parameters and transition conditions (blend trees and extra layers
are listed for an AnimationTree by hand). Model meshes and materials stay flagged as `metadata/reverseport_todo`.

## Code: the usual translations

After writing each script, `re_apicheck {path, engine: "godot@4.x"}`: models mix Godot 3 (`KinematicBody2D`,
`instance()`, `yield`, string `connect`) into Godot 4 code and invent members; the tool names the replacement.


- One GameObject with several MonoBehaviours → one node per behaviour (child nodes) or merge them into one script.
- `GetComponent<T>()` → the node itself or a child (`$Child`); components are nodes in Godot.
- `[SerializeField]` → `@export`; prefab fields (`GameObject`) → `PackedScene`.
- Coroutines → `await get_tree().create_timer(t).timeout`; events/UnityEvent → signals.
- `OnTriggerEnter` → the Area3D `body_entered` signal; `Physics.Raycast` → `PhysicsRayQueryParameters3D`.
- `transform.forward` (+Z) → `-global_basis.z`; degrees → radians (`deg_to_rad`) or `rotation_degrees`.
- `Random.Range(int a, int b)` excludes b; `randi_range` includes it.
- Input Manager axes/buttons → Input Map actions (create them in Project Settings, same names).

Then verify with the port-verify skill and open the folder in Godot 4.
