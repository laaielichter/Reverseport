# Walkthrough: port a tiny Godot scene to three.js

This page ports a three-file Godot 4 project to a three.js + TypeScript project with ReversePort's own tools. Every
command below was run, and the output is pasted from that run. Long output is shortened where it says so, and the
folder `/home/me` stands for wherever you put the files.

You need Node.js 22 or newer. No build of the deep-analysis engine is needed.

## 1. The sample project

Make a folder `coin-game` with three files. The game is one box (the "coin") that spins.

`coin-game/project.godot`:

```ini
config_version=5

[application]
config/name="Coin Game"
run/main_scene="res://main.tscn"
config/features=PackedStringArray("4.4")
```

`coin-game/main.tscn`:

```ini
[gd_scene load_steps=3 format=3]

[ext_resource type="Script" path="res://coin.gd" id="1"]

[sub_resource type="BoxMesh" id="2"]
size = Vector3(1, 1, 1)

[node name="Main" type="Node3D"]

[node name="Coin" type="MeshInstance3D" parent="."]
transform = Transform3D(1, 0, 0, 0, 1, 0, 0, 0, 1, 2, 1, -3)
mesh = SubResource("2")
script = ExtResource("1")

[node name="Camera3D" type="Camera3D" parent="."]
transform = Transform3D(1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 2, 6)
```

`coin-game/coin.gd`:

```gdscript
extends MeshInstance3D

@export var spin_speed := 2.0

func _process(delta: float) -> void:
	rotate_y(spin_speed * delta)
```

## 2. Scan

```sh
npx reverseport scan coin-game
```

Output (shortened to the main fields):

```json
{
  "files": 3,
  "primary": {
    "id": "godot",
    "name": "Godot 4.4",
    "kind": "project"
  }
}
```

## 3. Plan the port

```sh
npx reverseport plan coin-game --to threejs --output coin-three
```

```json
{
  "planId": "coin-game-to-threejs-020b4f",
  "name": "Coin Game",
  "from": "godot",
  "to": "threejs",
  "source": "/home/me/coin-game",
  "output": "/home/me/coin-three",
  "map": "godot->threejs",
  "units": 3,
  "byKind": { "script": 1, "scene": 1, "config": 1 },
  "byStatus": { "pending": 3 },
  "byAction": { "translate": 1, "convert-scene": 1, "rebuild": 1 },
  "risky": [],
  "next": "port_unit {\"planId\":\"coin-game-to-threejs-020b4f\"}  (next: u001 coin.gd)",
  "nextUnit": { "unit": "u001", "source": "coin.gd", "action": "translate" },
  "scaffold": [
    "package.json",
    "tsconfig.json",
    "index.html",
    "src/engine/loop.ts",
    "src/main.ts"
  ]
}
```

The plan id ends in a random part, so yours differs. `coin-three` now holds a Vite project with a game loop
(`src/engine/loop.ts`) and a start file (`src/main.ts`). Use your own plan id in the next commands.

## 4. Port the script

Ask for the next unit:

```sh
npx reverseport unit coin-game-to-threejs-020b4f
```

Output (shortened; the full result also has the source text, its symbols, a checklist and the three.js conventions):

```json
{
  "unit": "u001",
  "source": "coin.gd",
  "action": "translate",
  "target": "src/coin.ts",
  "apiHints": [
    {
      "id": "script-class",
      "topic": "structure",
      "from": "extends Node3D",
      "to": "class X { object = new THREE.Group(); update(dt: number) {} }",
      "count": 1,
      "lines": [1]
    },
    {
      "id": "process",
      "topic": "lifecycle",
      "from": "_process(delta)",
      "to": "update(dt) called from renderer.setAnimationLoop with clock.getDelta()",
      "count": 1,
      "lines": [5]
    }
  ],
  "naming": {
    "className": "Coin",
    "rule": "export class in PascalCase, file in kebab-case",
    "file": "src/coin.ts"
  },
  "next": "port_write {\"planId\":\"coin-game-to-threejs-020b4f\",\"unit\":\"u001\",\"files\":[{\"path\":\"src/coin.ts\",\"content\":\"<ported code>\"}]}  (write the ported file, then send it)"
}
```

The translation is your part (or your agent's). Save this as `coin.ts`:

```ts
import * as THREE from "three";
import type { Behaviour } from "./engine/loop";

// Port of coin.gd: spins the node it is attached to.
export class Coin implements Behaviour {
  spinSpeed = 2.0; // @export var spin_speed

  constructor(readonly object: THREE.Object3D) {}

  update(dt: number): void {
    this.object.rotateY(this.spinSpeed * dt); // rotate_y(spin_speed * delta)
  }
}
```

Hand it to the plan. ReversePort writes it into the output and checks it for Godot calls that were left behind:

```sh
npx reverseport write coin-game-to-threejs-020b4f u001 --content "$(cat coin.ts)"
```

```json
{
  "planId": "coin-game-to-threejs-020b4f",
  "unit": "u001",
  "status": "done",
  "clean": true,
  "written": ["/home/me/coin-three/src/coin.ts"],
  "leftovers": [],
  "portMarkers": 0,
  "missingFromSource": [],
  "progress": {
    "done": 1,
    "skipped": 0,
    "partial": 0,
    "pending": 2,
    "total": 3,
    "percent": 33
  },
  "next": "port_scene {\"planId\":\"coin-game-to-threejs-020b4f\",\"unit\":\"u002\"}  (next: u002 main.tscn)"
}
```

## 5. Convert the scene

Scenes are converted for you:

```sh
npx reverseport port-scene coin-game-to-threejs-020b4f u002
```

```json
{
  "planId": "coin-game-to-threejs-020b4f",
  "unit": "u002",
  "written": ["/home/me/coin-three/src/scenes/main.ts"],
  "notes": [],
  "progress": {
    "done": 2,
    "skipped": 0,
    "partial": 0,
    "pending": 1,
    "total": 3,
    "percent": 67
  },
  "next": "port_unit {\"planId\":\"coin-game-to-threejs-020b4f\"}  (next: u003 project.godot)"
}
```

The generated `coin-three/src/scenes/main.ts`:

```ts
// Generated by ReversePort (port_scene) from a Godot scene. Positions/quaternions are unchanged:
// Godot and three.js share axes (right-handed, Y up, -Z forward, meters). userData keeps the Godot
// node type, script and collider so game code can attach behaviour and physics.
import * as THREE from "three";

export function buildMain(): THREE.Object3D {
  const o0 = new THREE.Group();
  o0.name = "Main";
  Object.assign(o0.userData, { godotType: "Node3D" });
  const o1 = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial(),
  );
  o1.name = "Coin";
  o1.position.set(2, 1, -3);
  Object.assign(o1.userData, {
    godotType: "MeshInstance3D",
    script: "res://coin.gd",
  });
  o0.add(o1);
  const o2 = new THREE.PerspectiveCamera(75, 16 / 9, 0.05, 4000);
  o2.name = "Camera3D";
  o2.position.set(0, 2, 6);
  Object.assign(o2.userData, { godotType: "Camera3D" });
  o0.add(o2);
  return o0;
}
```

Want to check one position by hand? `convert` shows how coordinates move between engines:

```sh
npx reverseport convert godot threejs 'position=[2,1,-3]'
```

Output (the axis matrix is folded onto one line):

```json
{
  "from": "Godot (right-handed, Y up, -Z forward, m)",
  "to": "three.js (right-handed, Y up, -Z camera forward, m)",
  "axisMatrix": [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1]
  ],
  "unitFactor": 1,
  "position": [2, 1, -3],
  "notes": [
    "Positions and rotations stay visually identical; the axis matrix shows where each source axis goes."
  ]
}
```

## 6. Note the project settings and verify

`project.godot` has no three.js file to become. The plan asks you to write down what you recreated:

```sh
npx reverseport write coin-game-to-threejs-020b4f u003 --content "# project.godot
- Main scene res://main.tscn: src/main.ts builds it with buildMain().
- No autoloads, input actions or groups to recreate."
```

Then check the whole port:

```sh
npx reverseport verify coin-game-to-threejs-020b4f
```

Output (shortened; the full result also has a `resume` text for the next session):

```json
{
  "planId": "coin-game-to-threejs-020b4f",
  "passed": true,
  "progress": {
    "done": 3,
    "skipped": 0,
    "partial": 0,
    "pending": 0,
    "total": 3,
    "percent": 100
  },
  "errors": [],
  "warnings": [],
  "portMarkers": 0,
  "leftovers": 0,
  "missingSymbols": 0,
  "dormant": 0,
  "behaviour": 0,
  "output": "/home/me/coin-three",
  "next": "Open the output in the target engine, build, run, and compare behaviour with the original."
}
```

## 7. What you finish by hand

The scene keeps the Godot script path in `userData`, but nothing attaches `Coin` to the box yet. Add two lines to
`coin-three/src/main.ts`:

```ts
import { Coin } from "./coin";
```

and, right after `game.scene.add(world);`:

```ts
// Attach the ported scripts: port_scene keeps the Godot script path in userData.
world.traverse((o) => {
  if (o.userData.script === "res://coin.gd") game.behaviours.add(new Coin(o));
});
```

Then build it:

```sh
cd coin-three
npm install
npm run build
```

```text
> build
> tsc --noEmit && vite build

vite v6.4.5 building for production...
transforming...
✓ 8 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                  0.37 kB │ gzip:   0.28 kB
dist/assets/index-DJo8S5KF.js  466.04 kB │ gzip: 117.64 kB
✓ built in 1.31s
```

`npm run dev` opens it in the browser: a grey box on a blue sky, spinning like the Godot original.

In a real game you also:

- Export meshes and materials from Godot as glTF 2.0 and load them with `GLTFLoader`; `port_scene` only builds
  simple meshes (box, sphere and the like) itself.
- Choose physics, input and UI yourself. three.js only draws; `port_unit` names a common stack in its conventions.
- Run both versions side by side and compare what you see.
