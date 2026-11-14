# Turn a GDScript file into a C# first draft

`port_draft` gives you a mechanical starting point for moving a GDScript file to Godot C# or Unity. It keeps uncertain lines in place with `PORT:` comments and explains what needs a human decision. The output is not a finished port: review it and build it in the target engine.

These commands were run from the repository root on `main` at `54a195c3d59205eddd5f3e90da04b485fcfd5be4`, with Node.js 24.21.0. The fixture is `port/test/fixtures/godot-mini/actors/player.gd`:

```gdscript
class_name Player
extends CharacterBody3D

signal hit(damage: int)

@export var speed: float = 6.0
@export var jump_velocity := 4.5
@onready var anim: AnimationPlayer = $AnimationPlayer
@onready var muzzle := $Gun/Muzzle

const BULLET = preload("res://actors/bullet.tscn")

func _ready() -> void:
	add_to_group("players")
	hit.connect(_on_hit)

func _physics_process(delta: float) -> void:
	if not is_on_floor():
		velocity += get_gravity() * delta
	var dir := Input.get_axis("move_left", "move_right")
	velocity.x = dir * speed
	if Input.is_action_just_pressed("fire"):
		shoot()
	move_and_slide()

func shoot() -> void:
	var b := BULLET.instantiate()
	get_tree().current_scene.add_child(b)
	b.global_transform = muzzle.global_transform
	anim.play("shoot")

func _on_hit(damage: int) -> void:
	Global.add_score(-damage)
	if damage > 50:
		await get_tree().create_timer(0.5).timeout
		queue_free()
```

## Draft the file for each target

Run `port_draft` once for Godot C# and again for Unity:

```sh
node port/cli.mjs draft --file port/test/fixtures/godot-mini/actors/player.gd --to godot-csharp
node port/cli.mjs draft --file port/test/fixtures/godot-mini/actors/player.gd --to unity
```

The Godot C# run reported 29 statements, 100% translated cleanly, and no `PORT:` markers. These fields are copied from that run; the machine-specific output path and the rest of the generated C# are omitted:

```json
{
  "target": "godot-csharp",
  "statements": 29,
  "translatedCleanly": "100%",
  "portMarkers": 0
}
```

The Unity run reported 29 statements, 59% translated cleanly, and 17 markers. The `open` array groups unresolved notes by kind; these are the first entries from the actual result. The rest of the `open` array, generated code, and machine-specific output path are omitted:

```json
{
  "target": "unity",
  "statements": 29,
  "translatedCleanly": "59%",
  "portMarkers": 17,
  "open": [
    { "note": "Godot API add_to_group()", "count": 5, "sourceLines": [14, 19, 18, 24, 28] },
    { "note": "node path \"AnimationPlayer\": [SerializeField] reference wired in the prefab, or transform.Find(\"Path\") + GetComponent<T>()", "count": 2, "sourceLines": [8, 9] },
    { "note": "Godot member velocity", "count": 2, "sourceLines": [19, 21] },
    …
  ]
}
```

Read each `PORT:` comment alongside the `open` notes and finish the behavior for your target project. For example:

- `add_to_group("players")` has no direct Unity equivalent. Choose how your project identifies players, such as a tag, layer, or component, and replace the marker with that project-specific behavior.
- For the `AnimationPlayer` node path, wire the appropriate Unity component through a serialized field in the prefab, or use `transform.Find("Path")` and `GetComponent<T>()` after checking the actual scene hierarchy.
- `CharacterBody3D` and `velocity` need movement code in Unity. Add a `CharacterController` or a kinematic Rigidbody, maintain gravity and velocity yourself, and call `CharacterController.Move(velocity * Time.deltaTime)` if you use a controller.

The draft can be syntactically plausible while still needing engine-specific behavior. Compile it in Godot with .NET or Unity, run it in the target project, and review every marker. The tool does not build or run the output. Godot C# carrying over with no markers does not mean the file has been compiled.

## Draft one unit from a port plan

You can also draft a script that belongs to a larger project. These commands were run against the same fixture:

```sh
node port/cli.mjs plan port/test/fixtures/godot-mini --to godot-csharp
node port/cli.mjs draft godot-mini-to-godot-csharp-c203ee u001
```

The plan command returned 13 units: 6 scripts, 5 scenes, 1 resource, and 1 config. Its `nextUnit` was `u001`, `actors/bullet.gd`. The next command returned these fields (the machine-specific output path and remaining fields are omitted):

```json
{
  "planId": "godot-mini-to-godot-csharp-c203ee",
  "unit": "u001",
  "source": "actors/bullet.gd",
  "status": "partial",
  "translatedCleanly": "100%",
  "portMarkers": 0,
  "progress": { "done": 0, "skipped": 0, "partial": 1, "pending": 12, "total": 13, "percent": 0 }
}
```

Even with no markers, the unit stays `partial` until you review and submit it with `port_write`. The returned `nextCall` shows the plan ID, unit, and file path to write. Review the code, make the engine-specific changes, and send the edited file with `port_write`; do not treat a draft as completed work. This example stops before writing the unit, so its status correctly remains `partial`.

For a complete project port, repeat the plan/draft/review/write loop for the remaining units, then verify the port. See the [porting and rebuilds reference](../.agents/skills/reverse-engineer-anything/references/porting-and-rebuilds.md) for the broader workflow.
