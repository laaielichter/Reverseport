---
name: port-project
description: Port a game or codebase to another engine or language with ReversePort — Godot, Unity, Unreal, three.js (web) and Godot C#, or language to language — unit by unit in dependency order, with API maps, converted scenes and coordinates, and a verified result. Use for "port my game to…", "move this project from Unity to Godot", "make a web version", "convert this code to TypeScript/C#/C++".
---

# Port a project

The source is read-only; the port goes into a separate output project. Work in dependency order so every file you
write can use the real names of what it depends on.

## 0. Understand and decide

```text
re_scan {path}                         → engine, version, languages, entry points
re_graph {path}                        → cycles (port those files together), externals (need replacements)
port_map {from, to}                    → conventions (axes, units, lifecycle) and the API map with pitfalls
```

Tell the user the plan in a few lines: target, what converts automatically (scenes, transforms, assets, project
skeleton), what needs real porting work (scripts, shaders, UI, physics tuning), and risks (`risky` units, cycles,
engine features with no equivalent). Ask before starting when the target or scope is unclear.

## 1. Plan

```text
port_plan {source, to:"unity"|"godot"|"godot-csharp"|"unreal"|"threejs"|<language>, name?, output?, include?, exclude?}
```

Creates the output project with a scaffold (three.js: Vite + TypeScript + game loop; Unreal: .uproject + module;
Godot: project.godot; Godot C#: .csproj; Unity: the scene-builder editor script) and PORT-PLAN.md.

## 2. Loop

```text
port_copy_assets {planId}                       → textures, audio, models, fonts in one go
port_unit {planId}                              → next unit: source, symbols, apiHints (line numbers), conventions,
                                                   naming rules, dependencies with their ported symbols, checklist
  scenes:  port_scene {planId, unit}            → converted automatically; read its notes
  code:    write the port yourself, then
           port_write {planId, unit, files:[{path, content}], notes?}
           → fix every leftover and missingFromSource it reports before moving on
port_status {planId}                            → progress
```

Porting code well:

- Translate behaviour, not syntax. Use the target engine's idioms from the map (events instead of signals,
  serialized references instead of node paths, coroutines/timers instead of awaits…).
- Every position, direction, rotation, speed or distance crosses a coordinate system: use `port_convert`
  (Unreal is centimeters and Z-up; Unity mirrors Z; three.js matches Godot).
- Keep public names recognisable (PascalCase/snake_case per target) so `port_verify` can match them.
- Cannot port something yet? Write a `PORT:` comment that says what is missing and use `status:"partial"`.
- Large files: port in parts, but write the whole file in one port_write (files can hold up to 8 MiB).

## 3. Finish

Use the port-verify skill. Then tell the user exactly how to open the result (Unity: copy `Assets/` into a project,
run Tools ▸ ReversePort ▸ Build prefabs and scenes from specs; Godot: open the folder; three.js: `npm install && npm run
dev`; Unreal: right-click the .uproject → Generate project files, build), and what is left for them.
