---
name: godot-port
description: Port a Godot 4 project (GDScript) to Unity, Unreal Engine, three.js/web or Godot C# with ReversePort — signals, node paths, autoloads, scenes, physics bodies, input actions and coordinates done right. Use whenever the source of a port is a Godot project, including "make a web/browser version of my Godot game".
---

# Porting from Godot

Use the port-project skill for the loop; this skill holds the Godot-specific judgement.

## Before planning

- Godot 3 source (`config_version=4` in project.godot)? Upgrade first: `port_upgrade {path, action:"apply"}`
  writes a Godot 4 copy and lists what needs a human; fix those, `re_apicheck` the copy, then port from the copy.
- `re_scene {file:"project.godot"}` → main scene, autoloads (singletons), input actions, physics tick rate.
  Autoloads become singletons (Unity: DontDestroyOnLoad MonoBehaviour; Unreal: GameInstanceSubsystem; web: module
  singleton). Input actions must be recreated by name in the target.
- Binary `.scn`/`.res` cannot be read as text: open them in Godot and save as `.tscn`/`.tres` first.
- `port_map {from:"godot", to}` — read the conventions once; they decide naming and coordinates.

## Things that silently break

| Godot                                                   | Watch out                                                                                         |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `-transform.basis.z` is forward                         | Unity forward is +Z, Unreal +X. Never copy direction math unconverted.                            |
| `rotation` is radians, Euler order YXZ                  | Unity eulerAngles are degrees; three.js default order is XYZ (set `rotation.order = 'YXZ'`).      |
| meters                                                  | Unreal is centimeters: speeds, forces, ranges, gravity ×100.                                      |
| `_physics_process` at 60 Hz                             | Unity FixedUpdate is 50 Hz by default; Unreal ticks per frame. Retune or set the rate.            |
| `move_and_slide()` uses `velocity` and delta internally | Unity `CharacterController.Move` wants a displacement (× deltaTime) and no built-in gravity.      |
| signals connected in the editor                         | They live in `.tscn` `[connection]` sections: `re_scene` lists them; recreate each one.           |
| `$Path` / `get_node`                                    | Target: serialized references (Unity), component pointers (Unreal), direct references (web).      |
| `await` on signals/timers                               | Unity: coroutines (or Awaitable); Unreal: timers/delegates; web: promises with a game-time timer. |
| groups                                                  | Unity tags, Unreal actor tags; port_scene carries the first group as the tag.                     |
| Camera3D `fov` is vertical                              | Unreal FieldOfView is horizontal: `port_convert {fov, aspect}`.                                   |

## Targets

- **godot-csharp**: the smallest port. Scenes, resources and project.godot are copied with script paths swapped by
  `port_scene`; only scripts are rewritten (`public partial class X : Base`, PascalCase API, `double delta`,
  `[Export]`, `[Signal] delegate void XEventHandler()`, struct properties copied out and back).
- **unity**: scenes become `*.scene.json` specs + the editor builder; build them in Unity after the scripts compile so
  components attach by class name.
- **threejs**: scenes become TypeScript builder modules (`buildMain()`); physics with Rapier; UI in HTML/CSS. Godot can
  export meshes as glTF for GLTFLoader.
- **unreal**: scripts become `.h/.cpp` pairs with UCLASS/UPROPERTY/UFUNCTION; scenes become specs in cm, Z-up.
