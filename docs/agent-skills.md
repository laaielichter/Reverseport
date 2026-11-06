# Skills

Setup and the Claude Code plugin install skills that teach the agent the workflows, so it knows which tool comes
next without being told:

| Skill              | Use it for                                                                                               |
| ------------------ | -------------------------------------------------------------------------------------------------------- |
| `reverse-engineer` | "How does this work?" — engine and stack, architecture, dependency graph, classes, scenes, unknown files |
| `build-inspector`  | Exported builds: engine and version, what is inside the `.pck` or Unity/Unreal build, what changed       |
| `rebuild`          | No files: find out how a game, app or site is built, then write a measured clean-room rebuild spec       |
| `port-project`     | Any port, unit by unit in dependency order, with API maps, converted scenes and a verified result        |
| `godot-port`       | Godot 4 → Unity, Unreal, three.js or Godot C#: signals, node paths, autoloads, physics, input, axes      |
| `unity-to-godot`   | Unity → Godot 4: MonoBehaviours, prefabs and scenes to `.tscn`, colliders, rigidbodies                   |
| `port-verify`      | The finish line: fix leftovers and missing functions, then hand over with an honest list of what is left |
| `proof-case`       | Keep an investigation honest: evidence, claims that cite it, decisions, tests and open unknowns          |
| `troubleshoot`     | Errors and odd results: unreadable scenes, packs that will not list, refused paths, MCP problems         |

The Claude Code plugin also adds the `port-architect` agent, which runs a whole port from recon to hand-over, and
[guard hooks](proof-and-memory.md) that ask before a tool attaches to a program and stop a "done" while a proof
case fails its check.

A skill copied into an agent's folder can be older than the installed tool. `reverseport skills` lists the skills of
the version you have and `reverseport skills get <name>` prints the matching guide.
