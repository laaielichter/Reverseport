# Challenge self-check

Small programs whose answers are known exactly, used to check what ReversePort's quick look reveals without a
decompiler. The eight challenge families and their oracle come from
[rea-lab](https://github.com/pablodiazjorge/rea-lab) (`challenges/generate.mjs`, `challenges/large.mjs` and `challenges/oracle.mjs`, MIT,
copyright 2026 pablodiazjorge), vendored unchanged in [`challenges/`](challenges).

```bash
npm run bench:challenges            # or: node bench/selfcheck.mjs [--set small|large] [--seed N] [--cc clang] [--cxx clang++] [--keep ./out] [--json]
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

## The large set

```bash
node bench/selfcheck.mjs --set large
```

rea-lab's large set (`large.mjs`, generator version 2, seed 20261013) has eight harder programs. Each hides its real
check among 64 checkers reached through a table of function pointers, built over hundreds of hash functions, and
decodes its result messages at run time. The real check is a substitution table or arithmetic constraints
(`haystack`), bytecode in a small virtual machine (`vm`), C++ rule objects behind virtual methods (`cpp`), or three
chained stages (`stages`). Four of them also carry a decoy note, aimed at analysis tools, that names a wrong code.
Like rea-lab, the check builds `-O2` only, with and without symbols; the C++ programs need a C++ compiler (`c++`,
`g++` or `clang++`; `CXX` or `--cxx`).

Result on Linux x64 with `cc` and `c++`, seed 20261013:

| Check                                         | Result                                      |
| --------------------------------------------- | ------------------------------------------- |
| Oracle agrees with the recorded answers       | 8 of 8 challenges                           |
| Ground truth holds when the binaries run      | 16 of 16 binaries                           |
| `re_binary` strings reveal the accepted input | 0 of 16                                     |
| The decoy's wrong code is among the strings   | 8 of 8 binaries that have one (all of them) |

So the strings reveal nothing true here, and the one code they do show is the wrong one. An agent that trusts strings
on these programs gets misled; the real answers need the deep-analysis engine or careful reasoning. As with the small
set, this check does not measure either.

rea-lab builds Windows binaries with a pinned llvm-mingw for byte-identical hashes; this check uses the host compiler,
so its binaries differ from rea-lab's published ones (`public-manifest.json` and `public-manifest-large.json`).
