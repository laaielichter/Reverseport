# Challenge self-check

Small programs whose answers are known exactly, used to check what ReversePort's quick look reveals without a
decompiler. The eight challenge families and their oracle come from
[rea-lab](https://github.com/pablodiazjorge/rea-lab) (`challenges/generate.mjs` and `challenges/oracle.mjs`, MIT,
copyright 2026 pablodiazjorge), vendored unchanged in [`challenges/`](challenges).

```bash
npm run bench:challenges            # or: node bench/selfcheck.mjs [--seed N] [--cc clang] [--keep ./out] [--json]
```

The script generates the public seed, builds every challenge for this machine with a C compiler (`-O0`/`-O2`, with
and without symbols), runs each binary with a valid and a wrong input to prove the ground truth, checks that rea-lab's
oracle agrees, and then runs `re_binary` on every binary.

Result on Linux x64 with `cc`, seed 20261011:

| Check                                         | Result                       |
| --------------------------------------------- | ---------------------------- |
| Oracle agrees with the recorded answers       | 8 of 8 challenges            |
| Ground truth holds when the binaries run      | 32 of 32 binaries            |
| `re_binary` strings reveal the accepted input | 4 of 32 (only `c01-compare`) |

That is what it should be: only the plain string comparison is visible in the strings. The other seven families
(XOR, checksum, table, state machine, pairs, S-box, function-pointer table) need decompilation through the
deep-analysis engine or an agent's reasoning. This self-check does not measure those, and it does not measure agents.
For agent studies with preregistration, isolated runs and paired statistics, see rea-lab's own writeups.

rea-lab builds Windows binaries with a pinned llvm-mingw for byte-identical hashes; this check uses the host compiler,
so its binaries differ from rea-lab's published ones.
