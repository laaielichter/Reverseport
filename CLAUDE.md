# Working on ReversePort

Read [AGENTS.md](AGENTS.md): layout, architecture rules, checks and tests for both engines.

- `port/` (ReversePort's own engine): Node ESM, zero runtime dependencies. New tool → schema and handler in
  `port/src/tools.mjs`, then docs, skills and tests. `npm run test:port`.
- `src/` (deep-analysis engine, TypeScript): `npm ci`, `npm run build:cached`, `npm run check:fast`, focused tests.
- Do not put chat or session links in commits, pull requests or files.
