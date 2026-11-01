# Plugin evals

`claude plugin eval` runs each case twice: once with the ReversePort plugin and once without it. The difference
(`Δ`) is what the plugin adds. Each case needs Claude Code 2.1.269 or later.

| Case            | Question                                                  | Passes when the answer has |
| --------------- | --------------------------------------------------------- | -------------------------- |
| `godot-recon`   | Engine, version and start scene of a small Godot project  | Godot, 4.3 and `main.tscn` |
| `pck-contents`  | The GDScript files inside an exported Godot `.pck`        | both `res://scripts/*.gd`  |
| `coords-unreal` | A Godot position (1, 2, 3) in Unreal Engine 5 coordinates | -300, 100, 200             |

The `used-*` graders only show whether the plugin's tool was called; they do not count towards the score.

## Run

Every run is a real model call on your own account. Three cases, three runs each, two arms: 18 runs.

```bash
claude plugin eval . --trust-plugin --no-publish --max-cost-usd 5
```

By default the ReversePort tools answer from `mocks/reverseport/`: the real output of ReversePort on the
fixtures in each case folder, so a run needs no engine and never touches your files. To test the real server
instead (it runs as you, outside the eval sandbox; ReversePort's own tools only read):

```bash
claude plugin eval . --trust-plugin --no-publish --mocks off \
  --allow-tools "mcp__plugin_reverseport_reverseport__*"
```

Results go to `evals/results/<time>/` (`report.html`, `aggregate-result.json`); that folder is not committed.
