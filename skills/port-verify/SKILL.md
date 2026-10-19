---
name: port-verify
description: The finish line for a ReversePort port — run port_verify, fix leftovers, missing functions and signals, PORT markers and partial units, then hand over with clear run instructions and an honest list of what still needs a human. Use before calling any port done or when the user asks whether the port is complete.
---

# Verify a port — nothing is "done" before it passes

```text
port_verify {planId}
```

`passed:true` requires: every unit done or deliberately skipped, no missing output files, no source-engine API
left in ported code (`leftovers`), every source function and signal present in the port (`missingSymbols`; lifecycle
renames like `_ready` → `Awake` are understood), no units marked partial, and no dormant logic (`dormant`): a name
that exists but has an empty or stub body, a function the source called that nothing in the port calls, a signal the
port only declares, or a suppression (`as any`, `@warning_ignore`, `#pragma warning disable`) the port added.

Lost your context? `port_verify` and `port_status` return `resume`: the plan, where it stands, the next unit with its
ported dependencies, and the open findings. Read it before continuing.

## Fix loop

| Finding                                     | Fix                                                                                                               |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `not ported yet`                            | `port_unit {planId, unit}` and port it, or `port_write {status:"skipped", notes}` with a reason the user accepts. |
| `source-engine API left in the port`        | Replace each listed pattern with the `use` it names, `port_write` again.                                          |
| `functions/signals not found`               | Port them, or rename to the matching idiom. If the function truly became unnecessary, say why in notes.           |
| `lifecycle callbacks without a counterpart` | Fine when the work moved (e.g. connections replaced by OnTriggerEnter) — check it did.                            |
| `marked partial`                            | Finish it or explain what is missing and who needs to do it.                                                      |
| `PORT:` markers                             | Each is an open item: resolve it or list it in the hand-over.                                                     |
| `dormant logic`                             | `empty-body`/`thin-body`: port the statements. `unwired`: call or connect it where the source did. `suppression`: remove it and port the real fix. |

Run `port_verify` again until it passes (or the remaining items are explained to the user).

## Hand-over (short and factual)

- Where the output is and how to open/run it in the target engine.
- What converted automatically, what you ported by hand, what was skipped and why.
- Open items: PORT markers, partial units, assets to re-import (models, materials, animations), settings to recreate
  (input actions, tags, layers), and tuning to check in play (physics rates, speeds after unit conversion).
- Never claim it compiles or plays the same unless you ran it in the target engine.
